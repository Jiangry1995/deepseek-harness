/**
 * Best-effort secret stripping before memory files are written.
 * @module @deepseek-ai/dsh-memory/redact
 */

const PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bBearer\s+\S{12,}\b/gi,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*['"]?[^'"\s]{8,}['"]?/gi,
]

/** Replacement used for every matched secret span. */
const REDACTED = '[redacted]'

/**
 * Replace credential-shaped spans with a standing placeholder.
 * @param text - untrusted model or user text about to be persisted.
 * @returns the same text with matched secrets removed.
 */
export function redactMemoryText(text: string): string {
  let next = text
  for (const pattern of PATTERNS) {
    next = next.replace(pattern, REDACTED)
  }
  return next
}
