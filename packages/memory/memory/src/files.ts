/**
 * Recursive listing and grep over one memory root.
 * @module @deepseek-ai/dsh-memory/files
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import type { MemoryFileEntry, MemorySearchHit } from './types.ts'
import {
  isHiddenMemoryPath,
  MAX_READ_BYTES,
  MAX_SEARCH_HITS,
  MAX_SEARCH_LINE_CHARS,
  toPosix,
} from './paths.ts'

/**
 * List visible files under `root`. A missing directory is an empty tree.
 * @param root - absolute memory root.
 * @returns POSIX-relative entries sorted by path.
 */
export async function listMemoryFiles(root: string): Promise<MemoryFileEntry[]> {
  const entries: MemoryFileEntry[] = []
  await walk(root, root, entries)
  entries.sort((left, right) => left.path.localeCompare(right.path))
  return entries
}

/**
 * Search visible files for a case-insensitive substring.
 * @param root - absolute memory root.
 * @param query - non-empty search string.
 * @returns hits in path then line order, truncated at the hit cap.
 */
export async function searchMemoryFiles(root: string, query: string): Promise<MemorySearchHit[]> {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) throw new Error('memory search query must be a non-empty string')
  const hits: MemorySearchHit[] = []
  const files = await listMemoryFiles(root)
  for (const file of files) {
    let content: string
    try {
      content = await readFile(join(root, file.path), 'utf8')
    } catch (error) {
      /* v8 ignore start -- ENOENT is a list/read race; other IO errors propagate */
      if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') continue
      throw error
      /* v8 ignore stop */
    }
    const lines = content.split('\n')
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index]
      if (line === undefined || !line.toLowerCase().includes(needle)) continue
      hits.push({
        path: file.path,
        line: index + 1,
        text: line.length > MAX_SEARCH_LINE_CHARS
          ? `${line.slice(0, MAX_SEARCH_LINE_CHARS)}…`
          : line,
      })
      if (hits.length >= MAX_SEARCH_HITS) return hits
    }
  }
  return hits
}

/**
 * Read one contained file, rejecting hidden watermark/lock paths.
 * @param absolutePath - already-contained absolute file path.
 * @param relativePath - POSIX path used in error messages and hidden-path checks.
 * @returns the file text, truncated when larger than the read cap.
 */
export async function readMemoryFile(absolutePath: string, relativePath: string): Promise<string> {
  if (isHiddenMemoryPath(relativePath)) {
    throw new Error(`memory file ${relativePath} is not readable by tools`)
  }
  let content: string
  try {
    content = await readFile(absolutePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') {
      throw new Error(`memory file not found: ${relativePath}`)
    }
    throw error
  }
  if (Buffer.byteLength(content, 'utf8') > MAX_READ_BYTES) {
    return `${content.slice(0, MAX_READ_BYTES)}\n…(truncated)`
  }
  return content
}

/**
 * Recursively collect visible files. Missing roots contribute nothing.
 * @param root - absolute memory root.
 * @param current - directory being visited.
 * @param entries - accumulator.
 */
async function walk(root: string, current: string, entries: MemoryFileEntry[]): Promise<void> {
  let dirents
  try {
    dirents = await readdir(current, { withFileTypes: true })
  } catch (error) {
    /* v8 ignore start -- missing roots are empty; other listing failures propagate */
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return
    throw error
    /* v8 ignore stop */
  }
  for (const dirent of dirents) {
    const absolute = join(current, dirent.name)
    const relativePath = toPosix(relative(root, absolute))
    if (isHiddenMemoryPath(relativePath)) continue
    if (dirent.isDirectory()) {
      await walk(root, absolute, entries)
      continue
    }
    /* v8 ignore next -- sockets and other non-files are not memory markdown */
    if (!dirent.isFile()) continue
    const info = await stat(absolute)
    entries.push({ path: relativePath, bytes: info.size })
  }
}
