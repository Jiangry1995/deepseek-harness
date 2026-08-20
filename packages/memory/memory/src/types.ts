/**
 * File-memory store types. Runtime code lives in sibling modules.
 * @module @deepseek-ai/dsh-memory/types
 */

/** Which on-disk memory tree a read or write targets. */
export type MemoryScope = 'user' | 'project'

/** One listed file inside a memory root. */
export interface MemoryFileEntry {
  /** Root-relative POSIX path. */
  readonly path: string
  /** File size in UTF-8 bytes. */
  readonly bytes: number
}

/** One grep hit inside a memory file. */
export interface MemorySearchHit {
  /** Root-relative POSIX path of the matching file. */
  readonly path: string
  /** 1-based line number. */
  readonly line: number
  /** Matching line text, trimmed to the search preview cap. */
  readonly text: string
}

/** Fields required to write one inbox note. */
export interface MemoryNoteWrite {
  /** Note body after secret redaction. */
  readonly content: string
  /** Optional filename slug; derived from content when omitted. */
  readonly slug?: string
}

/** One skill file the consolidator asked the host to write. */
export interface MemorySkillFile {
  /** Kebab-case skill directory name. */
  readonly name: string
  /** Complete `SKILL.md` body. */
  readonly content: string
}

/** Handbook files the consolidator asked the host to write. */
export interface MemoryHandbook {
  /** Replacement `MEMORY.md` body. */
  readonly memoryMd: string
  /** Replacement `memory_summary.md` body; the store stamps the `v1` first line. */
  readonly memorySummaryMd: string
  /** Optional replacement skill files. */
  readonly skills?: readonly MemorySkillFile[]
}
