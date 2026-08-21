# Memory

English | [中文](memory.zh.md)

Local markdown memory — a host-owned file store ([dsh-memory](../../packages/memory/memory), `ctx.memory`) plus a model-facing consumer ([dsh-tool-memory](../../packages/memory/tool-memory)) that registers search/list/read/note tools, injects a standing HOWTO, and runs extract-then-consolidate in the background. This is **not** a third-party MCP memory overlay and **not** part of the agent-loop spine. The [first-party file memory Agent Note](../../.agents/notes/implemented/feature/2026-08-18-first-party-file-memory.md) owns the rationale.

Source: [`packages/memory/memory/src/types.ts`](../../packages/memory/memory/src/types.ts)

## Trees and files

`user` memory lives under the configured `userRoot` (`$DSH_HOME/memory` in the shipped composition). `project` memory lives at `{cwd}/.dsh/memory` unless `projectDir` is overridden. Each tree may hold `memory_summary.md` (first line `v1`), `MEMORY.md`, `raw_memories.md`, `session_summaries/`, `notes/`, `notes/processed/`, and `skills/<name>/SKILL.md`. `state.json` is the user-root watermark and is hidden from tools. Relative paths are contained inside the selected root.

The conversation model never writes the handbook. `memory_note` creates an inbox note when the user explicitly asks to remember, forget, or change a fact. A background job calls `purpose: 'memory'` JSON completions, and the host writes files from that JSON. Idle chat is a no-op. Secrets are redacted. `AGENTS.md` is not memory.

## Vocabulary

```ts type-equiv
/** Which on-disk memory tree a read or write targets. */
type MemoryScope = 'user' | 'project'
```

```ts type-equiv
/** One listed file inside a memory root. */
interface MemoryFileEntry {
  /** Root-relative POSIX path. */
  readonly path: string
  /** File size in UTF-8 bytes. */
  readonly bytes: number
}
```

```ts type-equiv
/** One grep hit inside a memory file. */
interface MemorySearchHit {
  /** Root-relative POSIX path of the matching file. */
  readonly path: string
  /** 1-based line number. */
  readonly line: number
  /** Matching line text, trimmed to the search preview cap. */
  readonly text: string
}
```

```ts type-equiv
/** Fields required to write one inbox note. */
interface MemoryNoteWrite {
  /** Note body after secret redaction. */
  readonly content: string
  /** Optional filename slug; derived from content when omitted. */
  readonly slug?: string
}
```

```ts type-equiv
/** One skill file the consolidator asked the host to write. */
interface MemorySkillFile {
  /** Kebab-case skill directory name. */
  readonly name: string
  /** Complete `SKILL.md` body. */
  readonly content: string
}
```

```ts type-equiv
/** Handbook files the consolidator asked the host to write. */
interface MemoryHandbook {
  /** Replacement `MEMORY.md` body. */
  readonly memoryMd: string
  /** Replacement `memory_summary.md` body; the store stamps the `v1` first line. */
  readonly memorySummaryMd: string
  /** Optional replacement skill files. */
  readonly skills?: readonly MemorySkillFile[]
}
```

## The service

`MemoryStore` (`ctx.memory`) lists, greps, and reads visible files, writes notes/raw/summaries/handbooks, and tracks per-session watermarks on the user root. `promptSummary` is synchronous because system-prompt assembly is synchronous. Project operations require an agent cwd. Auxiliary extract/consolidate calls use `GenerateOptions.purpose: 'memory'`; the DeepSeek adapter disables thinking for that purpose.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxmemory--memorystore"></a>

### `ctx.memory` — `MemoryStore`

File-backed memory store. Every relative path is resolved inside the selected root; watermark and lock files stay invisible to tools.

```ts cordis-catalog
/**
 * Resolve the absolute root for one scope.
 * @param scope - user-level or project-level tree.
 * @param cwd - agent working directory; required for `project`.
 * @returns the absolute memory root.
 */
rootFor(scope: MemoryScope, cwd?: string): string

/**
 * List visible files in one memory tree.
 * @param scope - user-level or project-level tree.
 * @param cwd - agent working directory; required for `project`.
 * @returns sorted file entries; a missing tree is empty.
 */
list(scope: MemoryScope, cwd?: string): Promise<MemoryFileEntry[]>

/**
 * Grep visible files in one memory tree.
 * @param scope - user-level or project-level tree.
 * @param query - case-insensitive substring.
 * @param cwd - agent working directory; required for `project`.
 * @returns matching lines up to the hit cap.
 */
search(scope: MemoryScope, query: string, cwd?: string): Promise<MemorySearchHit[]>

/**
 * Read one visible file.
 * @param scope - user-level or project-level tree.
 * @param relativePath - root-relative path.
 * @param cwd - agent working directory; required for `project`.
 * @returns file text, truncated when larger than the read cap.
 */
read(scope: MemoryScope, relativePath: string, cwd?: string): Promise<string>

/**
 * Write an inbox note. The model uses this only when the user explicitly
 * asked to remember, forget, or change a memory.
 * @param scope - user-level or project-level tree.
 * @param input - note body and optional slug.
 * @param cwd - agent working directory; required for `project`.
 * @returns the created root-relative POSIX path.
 */
async writeNote(scope: MemoryScope, input: MemoryNoteWrite, cwd?: string): Promise<string>

/**
 * List inbox notes that have not been moved to `notes/processed`.
 * @param scope - user-level or project-level tree.
 * @param cwd - agent working directory; required for `project`.
 * @returns pending note paths.
 */
async listPendingNotes(scope: MemoryScope, cwd?: string): Promise<string[]>

/**
 * Move inbox notes into `notes/processed` after a successful consolidate.
 * @param scope - user-level or project-level tree.
 * @param relativePaths - pending note paths to archive.
 * @param cwd - agent working directory; required for `project`.
 */
async markNotesProcessed(scope: MemoryScope, relativePaths: readonly string[], cwd?: string): Promise<void>

/**
 * Append one Phase-1 raw extraction block.
 * @param scope - user-level or project-level tree.
 * @param text - extraction text.
 * @param cwd - agent working directory; required for `project`.
 */
async appendRawMemory(scope: MemoryScope, text: string, cwd?: string): Promise<void>

/**
 * Write one session-summary file under `session_summaries/`.
 * @param scope - user-level or project-level tree.
 * @param slug - filename slug without extension.
 * @param text - summary body.
 * @param cwd - agent working directory; required for `project`.
 * @returns the created root-relative POSIX path.
 */
async writeSessionSummary(scope: MemoryScope, slug: string, text: string, cwd?: string): Promise<string>

/**
 * Replace the handbook, summary, and any returned skill files.
 * @param scope - user-level or project-level tree.
 * @param handbook - consolidator output.
 * @param cwd - agent working directory; required for `project`.
 */
async writeHandbook(scope: MemoryScope, handbook: MemoryHandbook, cwd?: string): Promise<void>

/**
 * Read `memory_summary.md` for prompt injection. A missing file is empty.
 * @param scope - user-level or project-level tree.
 * @param cwd - agent working directory; required for `project`.
 * @returns summary text, or an empty string.
 */
async readSummary(scope: MemoryScope, cwd?: string): Promise<string>

/**
 * Synchronously read `memory_summary.md` for prompt assembly.
 * @param scope - user-level or project-level tree.
 * @param cwd - agent working directory; required for `project`.
 * @returns summary text, or an empty string when the file is missing.
 */
promptSummary(scope: MemoryScope, cwd?: string): string

/**
 * Highest turn already considered for one session, from the user-root watermark.
 * @param sessionId - session identity.
 * @returns last considered turn, or `0` when none.
 */
async lastTurn(sessionId: string): Promise<number>

/**
 * Advance the user-root watermark after a turn has been considered.
 * @param sessionId - session identity.
 * @param turn - highest considered turn number.
 */
setLastTurn(sessionId: string, turn: number): Promise<void>
```

Source: [`packages/memory/memory/src/index.ts`](../../packages/memory/memory/src/index.ts)
<!-- END GENERATED cordis-surface -->
