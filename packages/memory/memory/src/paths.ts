/**
 * Memory-root path constants and containment checks.
 * @module @deepseek-ai/dsh-memory/paths
 */

import { isAbsolute, relative, resolve, sep } from 'node:path'

/** Owner-only file mode for memory files. */
export const MEMORY_FILE_MODE = 0o600
/** Owner-only directory mode for memory trees. */
export const MEMORY_DIR_MODE = 0o700
/** Default project-level directory under the agent cwd. */
export const DEFAULT_PROJECT_DIR = '.dsh/memory'
/** Always-injected summary filename. */
export const SUMMARY_FILE = 'memory_summary.md'
/** Retrievable handbook filename. */
export const HANDBOOK_FILE = 'MEMORY.md'
/** Phase-1 raw extraction log. */
export const RAW_FILE = 'raw_memories.md'
/** Per-root watermark and session cursors; never model-visible. */
export const STATE_FILE = 'state.json'
/** Inbox directory for explicit remember/forget notes. */
export const NOTES_DIR = 'notes'
/** Directory that holds notes after a successful consolidate. */
export const PROCESSED_NOTES_DIR = 'notes/processed'
/** Directory for per-rollout summaries. */
export const SESSION_SUMMARIES_DIR = 'session_summaries'
/** Directory for consolidator-written skills. */
export const SKILLS_DIR = 'skills'
/** Required first line of `memory_summary.md`. */
export const SUMMARY_VERSION_LINE = 'v1'
/** Maximum slug length used in generated filenames. */
export const MAX_SLUG_LENGTH = 40
/** Maximum bytes one `read` call returns. */
export const MAX_READ_BYTES = 256_000
/** Maximum grep hits returned from one search. */
export const MAX_SEARCH_HITS = 50
/** Preview cap for one search hit line. */
export const MAX_SEARCH_LINE_CHARS = 240

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * Return whether `name` is a legal kebab-case skill directory name.
 * @param name - candidate skill name.
 * @returns true when the name may be used as `skills/<name>/SKILL.md`.
 */
export function isSkillName(name: string): boolean {
  return SKILL_NAME.test(name)
}

/**
 * Convert a filesystem path to a root-relative POSIX path.
 * @param value - platform path relative to a memory root.
 * @returns the same path with `/` separators.
 */
export function toPosix(value: string): string {
  return value.split(sep).join('/')
}

/**
 * Return whether a root-relative POSIX path is host-private and must stay
 * invisible to tools.
 * @param relativePath - POSIX path inside a memory root.
 * @returns true for watermark, lock, and temp siblings.
 */
export function isHiddenMemoryPath(relativePath: string): boolean {
  const normalized = relativePath.replaceAll('\\', '/')
  const base = normalized.slice(normalized.lastIndexOf('/') + 1)
  return normalized === STATE_FILE
    || base === STATE_FILE
    || base.endsWith('.lock')
    || base.endsWith('.tmp')
}

/**
 * Collapse untrusted text into a filename slug.
 * @param value - raw slug or note excerpt.
 * @returns a lowercase hyphenated slug, or `note` when nothing remains.
 */
export function sanitizeSlug(value: string): string {
  const slug = value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
  return slug.length > 0 ? slug : 'note'
}

/**
 * Build an inbox note filename from a UTC timestamp and slug.
 * @param at - timestamp used for the prefix.
 * @param slug - already-sanitized slug.
 * @returns `YYYY-MM-DDTHH-MM-SS-<slug>.md`.
 */
export function noteFileName(at: Date, slug: string): string {
  const stamp = at.toISOString().slice(0, 19).replaceAll(':', '-')
  return `${stamp}-${slug}.md`
}

/**
 * Resolve `relativePath` inside `root` and reject any escape.
 * @param root - absolute memory root.
 * @param relativePath - caller-supplied relative path.
 * @returns the contained absolute path.
 */
export function resolveContainedPath(root: string, relativePath: string): string {
  const trimmed = relativePath.trim()
  if (trimmed.length === 0) {
    throw new Error('memory path must be a non-empty relative path')
  }
  if (trimmed.includes('\0')) {
    throw new Error('memory path must not contain NUL')
  }
  const normalizedRoot = resolve(root)
  const candidate = resolve(normalizedRoot, trimmed)
  const rel = relative(normalizedRoot, candidate)
  if (rel.length === 0) {
    throw new Error('memory path must name a file inside the memory root')
  }
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`memory path escapes the memory root: ${trimmed}`)
  }
  return candidate
}

/**
 * Root-relative POSIX path of a skill file.
 * @param name - validated skill name.
 * @returns `skills/<name>/SKILL.md`.
 */
export function skillFilePath(name: string): string {
  if (!isSkillName(name)) {
    throw new Error(`invalid memory skill name ${JSON.stringify(name)}`)
  }
  return `${SKILLS_DIR}/${name}/SKILL.md`
}

/**
 * Ensure `memory_summary.md` starts with the version line.
 * @param body - consolidator-supplied summary text.
 * @returns the body with a leading `v1` line.
 */
export function withSummaryVersion(body: string): string {
  const trimmed = body.replace(/^\uFEFF/, '').replace(/^\s+/, '')
  if (trimmed === SUMMARY_VERSION_LINE || trimmed.startsWith(`${SUMMARY_VERSION_LINE}\n`)) {
    return trimmed.endsWith('\n') ? trimmed : `${trimmed}\n`
  }
  const rest = trimmed.length === 0 ? '' : trimmed.endsWith('\n') ? trimmed : `${trimmed}\n`
  return `${SUMMARY_VERSION_LINE}\n${rest}`
}
