/**
 * Local markdown memory store (`ctx.memory`): user-level and project-level
 * files, path containment, and per-session watermarks.
 * @module @deepseek-ai/dsh-memory
 */

import { mkdir, readFile, rename } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { listMemoryFiles, readMemoryFile, searchMemoryFiles } from './files.ts'
import {
  DEFAULT_PROJECT_DIR,
  HANDBOOK_FILE,
  MEMORY_DIR_MODE,
  MEMORY_FILE_MODE,
  NOTES_DIR,
  PROCESSED_NOTES_DIR,
  RAW_FILE,
  resolveContainedPath,
  SESSION_SUMMARIES_DIR,
  noteFileName,
  sanitizeSlug,
  skillFilePath,
  SUMMARY_FILE,
  toPosix,
  withSummaryVersion,
} from './paths.ts'
import { redactMemoryText } from './redact.ts'
import { loadMemoryState, writeLastTurn } from './state.ts'
import type {
  MemoryFileEntry,
  MemoryHandbook,
  MemoryNoteWrite,
  MemoryScope,
  MemorySearchHit,
} from './types.ts'

export type {
  MemoryFileEntry,
  MemoryHandbook,
  MemoryNoteWrite,
  MemoryScope,
  MemorySearchHit,
  MemorySkillFile,
} from './types.ts'
export {
  DEFAULT_PROJECT_DIR,
  HANDBOOK_FILE,
  isHiddenMemoryPath,
  isSkillName,
  MAX_READ_BYTES,
  MAX_SEARCH_HITS,
  MAX_SEARCH_LINE_CHARS,
  MEMORY_DIR_MODE,
  MEMORY_FILE_MODE,
  NOTES_DIR,
  noteFileName,
  PROCESSED_NOTES_DIR,
  RAW_FILE,
  resolveContainedPath,
  sanitizeSlug,
  SESSION_SUMMARIES_DIR,
  skillFilePath,
  SUMMARY_FILE,
  SUMMARY_VERSION_LINE,
  toPosix,
  withSummaryVersion,
} from './paths.ts'
export { redactMemoryText } from './redact.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    memory: MemoryStore
  }
}

/** Plugin config for the file memory store. */
export interface Config {
  /** Absolute user-level memory root; required. */
  userRoot: string
  /** Project-level directory resolved against the agent cwd. Defaults to `.dsh/memory`. */
  projectDir?: string
}

/** Resolved store parameters after defaulting. */
interface ResolvedConfig {
  readonly userRoot: string
  readonly projectDir: string
}

/**
 * File-backed memory store. Every relative path is resolved inside the selected
 * root; watermark and lock files stay invisible to tools.
 */
export class MemoryStore extends Service {
  static Config: z<Config> = z.object({
    userRoot: z.string().required(),
    projectDir: z.string().default(DEFAULT_PROJECT_DIR),
  })

  private readonly spec: ResolvedConfig

  /**
   * @param ctx - Cordis context that publishes `ctx.memory`.
   * @param config - required user root and optional project directory.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'memory')
    const userRoot = config.userRoot.trim()
    if (userRoot.length === 0) throw new Error('memory: userRoot must be a non-empty path')
    const projectDir = (config.projectDir ?? DEFAULT_PROJECT_DIR).trim()
    if (projectDir.length === 0) throw new Error('memory: projectDir must be a non-empty path')
    this.spec = { userRoot, projectDir }
  }

  /**
   * Resolve the absolute root for one scope.
   * @param scope - user-level or project-level tree.
   * @param cwd - agent working directory; required for `project`.
   * @returns the absolute memory root.
   */
  rootFor(scope: MemoryScope, cwd?: string): string {
    if (scope === 'user') return this.spec.userRoot
    if (cwd === undefined || cwd.trim().length === 0) {
      throw new Error('memory: project scope requires an agent working directory')
    }
    return join(cwd, this.spec.projectDir)
  }

  /**
   * List visible files in one memory tree.
   * @param scope - user-level or project-level tree.
   * @param cwd - agent working directory; required for `project`.
   * @returns sorted file entries; a missing tree is empty.
   */
  list(scope: MemoryScope, cwd?: string): Promise<MemoryFileEntry[]> {
    return listMemoryFiles(this.rootFor(scope, cwd))
  }

  /**
   * Grep visible files in one memory tree.
   * @param scope - user-level or project-level tree.
   * @param query - case-insensitive substring.
   * @param cwd - agent working directory; required for `project`.
   * @returns matching lines up to the hit cap.
   */
  search(scope: MemoryScope, query: string, cwd?: string): Promise<MemorySearchHit[]> {
    return searchMemoryFiles(this.rootFor(scope, cwd), query)
  }

  /**
   * Read one visible file.
   * @param scope - user-level or project-level tree.
   * @param relativePath - root-relative path.
   * @param cwd - agent working directory; required for `project`.
   * @returns file text, truncated when larger than the read cap.
   */
  read(scope: MemoryScope, relativePath: string, cwd?: string): Promise<string> {
    const root = this.rootFor(scope, cwd)
    const absolute = resolveContainedPath(root, relativePath)
    return readMemoryFile(absolute, toPosix(relative(root, absolute)))
  }

  /**
   * Write an inbox note. The model uses this only when the user explicitly
   * asked to remember, forget, or change a memory.
   * @param scope - user-level or project-level tree.
   * @param input - note body and optional slug.
   * @param cwd - agent working directory; required for `project`.
   * @returns the created root-relative POSIX path.
   */
  async writeNote(scope: MemoryScope, input: MemoryNoteWrite, cwd?: string): Promise<string> {
    const content = redactMemoryText(input.content).trim()
    if (content.length === 0) throw new Error('memory note content must be a non-empty string')
    const slug = sanitizeSlug(input.slug ?? content.slice(0, 80))
    const relativePath = `${NOTES_DIR}/${noteFileName(new Date(), slug)}`
    await this.writeText(scope, relativePath, `${content}\n`, cwd)
    return relativePath
  }

  /**
   * List inbox notes that have not been moved to `notes/processed`.
   * @param scope - user-level or project-level tree.
   * @param cwd - agent working directory; required for `project`.
   * @returns pending note paths.
   */
  async listPendingNotes(scope: MemoryScope, cwd?: string): Promise<string[]> {
    const files = await this.list(scope, cwd)
    return files
      .map(entry => entry.path)
      .filter(path => path.startsWith(`${NOTES_DIR}/`) && !path.startsWith(`${PROCESSED_NOTES_DIR}/`))
  }

  /**
   * Move inbox notes into `notes/processed` after a successful consolidate.
   * @param scope - user-level or project-level tree.
   * @param relativePaths - pending note paths to archive.
   * @param cwd - agent working directory; required for `project`.
   */
  async markNotesProcessed(scope: MemoryScope, relativePaths: readonly string[], cwd?: string): Promise<void> {
    const root = this.rootFor(scope, cwd)
    const processedRoot = join(root, PROCESSED_NOTES_DIR)
    await mkdir(processedRoot, { recursive: true, mode: MEMORY_DIR_MODE })
    for (const relativePath of relativePaths) {
      if (!relativePath.startsWith(`${NOTES_DIR}/`) || relativePath.startsWith(`${PROCESSED_NOTES_DIR}/`)) {
        throw new Error(`memory note is not a pending inbox path: ${relativePath}`)
      }
      const source = resolveContainedPath(root, relativePath)
      const name = relativePath.slice(relativePath.lastIndexOf('/') + 1)
      const destination = resolveContainedPath(root, `${PROCESSED_NOTES_DIR}/${name}`)
      await rename(source, destination)
    }
  }

  /**
   * Append one Phase-1 raw extraction block.
   * @param scope - user-level or project-level tree.
   * @param text - extraction text.
   * @param cwd - agent working directory; required for `project`.
   */
  async appendRawMemory(scope: MemoryScope, text: string, cwd?: string): Promise<void> {
    const body = redactMemoryText(text).trim()
    if (body.length === 0) return
    const root = this.rootFor(scope, cwd)
    const filename = join(root, RAW_FILE)
    await mkdir(root, { recursive: true, mode: MEMORY_DIR_MODE })
    await withFileLock(filename, async () => {
      let previous = ''
      try {
        previous = await readFile(filename, 'utf8')
      } catch (error) {
        if ((error as NodeJS.ErrnoException | null)?.code !== 'ENOENT') throw error
      }
      const next = previous.length === 0 ? `${body}\n` : `${previous.replace(/\n*$/, '')}\n\n---\n\n${body}\n`
      await writeFileAtomic(filename, next, { mode: MEMORY_FILE_MODE, dirMode: MEMORY_DIR_MODE })
    })
  }

  /**
   * Write one session-summary file under `session_summaries/`.
   * @param scope - user-level or project-level tree.
   * @param slug - filename slug without extension.
   * @param text - summary body.
   * @param cwd - agent working directory; required for `project`.
   * @returns the created root-relative POSIX path.
   */
  async writeSessionSummary(scope: MemoryScope, slug: string, text: string, cwd?: string): Promise<string> {
    const body = redactMemoryText(text).trim()
    if (body.length === 0) throw new Error('memory session summary must be a non-empty string')
    const relativePath = `${SESSION_SUMMARIES_DIR}/${sanitizeSlug(slug)}.md`
    await this.writeText(scope, relativePath, `${body}\n`, cwd)
    return relativePath
  }

  /**
   * Replace the handbook, summary, and any returned skill files.
   * @param scope - user-level or project-level tree.
   * @param handbook - consolidator output.
   * @param cwd - agent working directory; required for `project`.
   */
  async writeHandbook(scope: MemoryScope, handbook: MemoryHandbook, cwd?: string): Promise<void> {
    await this.writeText(scope, HANDBOOK_FILE, redactMemoryText(handbook.memoryMd), cwd)
    await this.writeText(scope, SUMMARY_FILE, withSummaryVersion(redactMemoryText(handbook.memorySummaryMd)), cwd)
    for (const skill of handbook.skills ?? []) {
      await this.writeText(scope, skillFilePath(skill.name), redactMemoryText(skill.content), cwd)
    }
  }

  /**
   * Read `memory_summary.md` for prompt injection. A missing file is empty.
   * @param scope - user-level or project-level tree.
   * @param cwd - agent working directory; required for `project`.
   * @returns summary text, or an empty string.
   */
  async readSummary(scope: MemoryScope, cwd?: string): Promise<string> {
    try {
      return await this.read(scope, SUMMARY_FILE, cwd)
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('memory file not found:')) return ''
      throw error
    }
  }

  /**
   * Synchronously read `memory_summary.md` for prompt assembly.
   * @param scope - user-level or project-level tree.
   * @param cwd - agent working directory; required for `project`.
   * @returns summary text, or an empty string when the file is missing.
   */
  promptSummary(scope: MemoryScope, cwd?: string): string {
    const root = this.rootFor(scope, cwd)
    try {
      return readFileSync(join(root, SUMMARY_FILE), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return ''
      throw error
    }
  }

  /**
   * Highest turn already considered for one session, from the user-root watermark.
   * @param sessionId - session identity.
   * @returns last considered turn, or `0` when none.
   */
  async lastTurn(sessionId: string): Promise<number> {
    const state = await loadMemoryState(this.spec.userRoot)
    return state.sessions[sessionId]?.lastTurn ?? 0
  }

  /**
   * Advance the user-root watermark after a turn has been considered.
   * @param sessionId - session identity.
   * @param turn - highest considered turn number.
   */
  setLastTurn(sessionId: string, turn: number): Promise<void> {
    if (!Number.isInteger(turn) || turn < 0) {
      throw new Error('memory lastTurn must be a non-negative integer')
    }
    return writeLastTurn(this.spec.userRoot, sessionId, turn)
  }

  /**
   * Write one contained UTF-8 file.
   * @param scope - user-level or project-level tree.
   * @param relativePath - root-relative path.
   * @param content - complete next contents.
   * @param cwd - agent working directory; required for `project`.
   */
  private async writeText(scope: MemoryScope, relativePath: string, content: string, cwd?: string): Promise<void> {
    const root = this.rootFor(scope, cwd)
    const filename = resolveContainedPath(root, relativePath)
    await writeFileAtomic(filename, content.endsWith('\n') ? content : `${content}\n`, {
      mode: MEMORY_FILE_MODE,
      dirMode: MEMORY_DIR_MODE,
    })
  }
}

export default MemoryStore
