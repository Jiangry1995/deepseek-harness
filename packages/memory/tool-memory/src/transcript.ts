/**
 * Compact one completed turn into extraction input.
 * @module @deepseek-ai/dsh-tool-memory/transcript
 */

import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'

/**
 * Facts collected from one turn for the extraction gate and LLM prompt.
 */
export interface TurnTranscript {
  /** Concatenated user-authored text. */
  readonly userText: string
  /** Compact role-labeled transcript, truncated to `maxChars`. */
  readonly text: string
  /** Whether the turn contains a tool call. */
  readonly hasToolCall: boolean
}

/**
 * Build a compact transcript for one numbered turn.
 * @param session - owning session log.
 * @param turn - turn number.
 * @param maxChars - inclusive character cap.
 * @returns user text, compact transcript, and tool-call flag.
 */
export function transcriptForTurn(session: Session, turn: number, maxChars: number): TurnTranscript {
  const events = eventsForTurn(session.events, turn)
  const lines: string[] = []
  const userParts: string[] = []
  let hasToolCall = false
  for (const event of events) {
    switch (event.type) {
      case 'user/message': {
        if (event.data.source.kind === 'plugin') break
        const text = contentText(event.data.content)
        if (text.length === 0) break
        userParts.push(text)
        lines.push(`user: ${text}`)
        break
      }
      case 'assistant/message': {
        const text = contentText(event.data.message.content)
        if (text.length > 0) lines.push(`assistant: ${text}`)
        break
      }
      case 'tool/call': {
        hasToolCall = true
        lines.push(`tool_call ${event.data.name} ${preview(event.data.arguments)}`)
        break
      }
      case 'tool/result': {
        const text = contentText(event.data.message.content)
        if (text.length > 0) lines.push(`tool_result: ${preview(text)}`)
        break
      }
      default:
        break
    }
  }
  return {
    userText: userParts.join('\n'),
    text: cap(lines.join('\n'), maxChars),
    hasToolCall,
  }
}

/**
 * Collect events belonging to one turn, from `turn/start` through `turn/end`.
 * @param events - complete session log.
 * @param turn - turn number.
 * @returns the inclusive slice, or an empty list when the turn is absent.
 */
export function eventsForTurn(events: readonly SessionEvent[], turn: number): SessionEvent[] {
  let start = -1
  for (let index = 0; index < events.length; index++) {
    const event = events[index]
    if (event === undefined) continue
    if (event.type === 'turn/start' && event.data.turn === turn) start = index
    if (start >= 0 && event.type === 'turn/end' && event.data.turn === turn) {
      return events.slice(start, index + 1)
    }
  }
  return []
}

/**
 * Join text blocks from mixed content, including nested tool-result payloads.
 * @param content - message content array.
 * @returns concatenated text.
 */
function contentText(content: readonly { type: string; text?: string; content?: readonly { type: string; text?: string }[] }[]): string {
  const parts: string[] = []
  for (const block of content) {
    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text)
      continue
    }
    if (block.type === 'tool-result' && Array.isArray(block.content)) {
      const nested = contentText(block.content)
      if (nested.length > 0) parts.push(nested)
    }
  }
  return parts.join('\n').trim()
}

/**
 * Bound a single tool argument or result preview.
 * @param value - raw string.
 * @returns a short preview.
 */
function preview(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact.length > 200 ? `${compact.slice(0, 200)}…` : compact
}

/**
 * Truncate a transcript at `maxChars`.
 * @param text - compact transcript.
 * @param maxChars - inclusive cap.
 * @returns original or truncated text.
 */
function cap(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}\n…(truncated)`
}
