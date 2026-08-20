/**
 * Per-root watermark file. Tools never read this path.
 * @module @deepseek-ai/dsh-memory/state
 */

import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { MEMORY_DIR_MODE, MEMORY_FILE_MODE, STATE_FILE } from './paths.ts'

/** On-disk watermark document. */
export interface MemoryState {
  /** Document version. */
  readonly version: 1
  /** Last considered turn per session id. */
  readonly sessions: Record<string, { lastTurn: number }>
}

const EMPTY_STATE: MemoryState = { version: 1, sessions: {} }

/**
 * Load `state.json` from a memory root, treating a missing file as empty.
 * @param root - absolute memory root.
 * @returns the parsed state or an empty document.
 */
export async function loadMemoryState(root: string): Promise<MemoryState> {
  try {
    const raw = await readFile(join(root, STATE_FILE), 'utf8')
    return parseMemoryState(raw)
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return EMPTY_STATE
    throw error
  }
}

/**
 * Record the highest turn a session has already considered.
 * @param root - absolute memory root that owns the watermark.
 * @param sessionId - session identity.
 * @param lastTurn - highest processed turn number.
 */
export async function writeLastTurn(root: string, sessionId: string, lastTurn: number): Promise<void> {
  const filename = join(root, STATE_FILE)
  await mkdir(root, { recursive: true, mode: MEMORY_DIR_MODE })
  await withFileLock(filename, async () => {
    const current = await loadMemoryState(root)
    const next: MemoryState = {
      version: 1,
      sessions: {
        ...current.sessions,
        [sessionId]: { lastTurn },
      },
    }
    await writeFileAtomic(filename, `${JSON.stringify(next, null, 2)}\n`, {
      mode: MEMORY_FILE_MODE,
      dirMode: MEMORY_DIR_MODE,
    })
  })
}

/**
 * Parse a watermark document and reject unknown versions.
 * @param raw - file contents.
 * @returns a normalized state object.
 */
export function parseMemoryState(raw: string): MemoryState {
  const parsed: unknown = JSON.parse(raw)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('memory state.json must be an object')
  }
  const record = parsed as { version?: unknown; sessions?: unknown }
  if (record.version !== 1) {
    throw new Error(`unsupported memory state version ${JSON.stringify(record.version)}`)
  }
  if (record.sessions === undefined) return EMPTY_STATE
  if (record.sessions === null || typeof record.sessions !== 'object' || Array.isArray(record.sessions)) {
    throw new Error('memory state.json sessions must be an object')
  }
  const sessions: Record<string, { lastTurn: number }> = {}
  for (const [id, value] of Object.entries(record.sessions)) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`memory state.json session ${JSON.stringify(id)} must be an object`)
    }
    const lastTurn = (value as { lastTurn?: unknown }).lastTurn
    if (!Number.isInteger(lastTurn) || (lastTurn as number) < 0) {
      throw new Error(`memory state.json session ${JSON.stringify(id)} has an invalid lastTurn`)
    }
    sessions[id] = { lastTurn: lastTurn as number }
  }
  return { version: 1, sessions }
}
