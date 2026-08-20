/**
 * Model-facing memory HOWTO and summary injection.
 * @module @deepseek-ai/dsh-tool-memory/prompt
 */

import type { AssembleContext } from '@deepseek-ai/dsh-system-prompt'
import type { MemoryStore } from '@deepseek-ai/dsh-memory'
import { SUMMARY_FILE } from '@deepseek-ai/dsh-memory'
import type {} from '@deepseek-ai/dsh-agent'

/**
 * Standing instruction injected even when no memory files exist yet, so the
 * model knows `memory_note` and the search/read tools.
 */
export const MEMORY_HOWTO = [
  'Persistent memory lives in markdown files on this machine. The thin summaries below are always in context; open a handbook or note with the memory tools when you need detail.',
  'Use memory_search, memory_list, and memory_read to inspect user or project memory. Call memory_note only when the user explicitly asks to remember, forget, or change a stored fact. Do not write MEMORY.md yourself; a background job consolidates notes into the handbook.',
  'AGENTS.md and other repository instruction files are not memory.',
].join('\n\n')

/**
 * Build the memory system-prompt section for one assembly.
 * @param memory - file store.
 * @param context - prompt assembly context; project summaries need `agent`.
 * @param maxSummaryChars - truncation cap per summary file.
 * @returns HOWTO plus any available summaries.
 */
export function renderMemoryPrompt(memory: MemoryStore, context: AssembleContext, maxSummaryChars: number): string {
  const cwd = context.agent?.session.header.cwd
  const parts = [MEMORY_HOWTO]
  const userSummary = truncateSummary(memory.promptSummary('user'), maxSummaryChars)
  if (userSummary.length > 0) {
    parts.push(`## User memory (${SUMMARY_FILE})`, userSummary)
  }
  if (cwd !== undefined && cwd.length > 0) {
    const projectSummary = truncateSummary(memory.promptSummary('project', cwd), maxSummaryChars)
    if (projectSummary.length > 0) {
      parts.push(`## Project memory (${SUMMARY_FILE})`, projectSummary)
    }
  }
  return parts.join('\n\n')
}

/**
 * Truncate a summary for prompt injection.
 * @param text - file contents.
 * @param maxChars - inclusive cap.
 * @returns the original text or a truncated prefix.
 */
export function truncateSummary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}\n…(truncated)`
}
