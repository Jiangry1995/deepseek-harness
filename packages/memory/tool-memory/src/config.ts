/**
 * Resolved tool-memory configuration after defaulting and pair validation.
 * @module @deepseek-ai/dsh-tool-memory/config
 */

import z from '@deepseek-ai/schemastery'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'

/** Default cooperative timeout for one auxiliary memory call. */
export const DEFAULT_TIMEOUT_MS = 60_000
/** Default transcript cap fed to Phase 1. */
export const DEFAULT_MAX_TRANSCRIPT_CHARS = 80_000
/** Default prompt-injection cap per summary file. */
export const DEFAULT_MAX_SUMMARY_CHARS = 8_000
/** Default output token cap for auxiliary memory calls. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 4_000

/** Plugin config for the memory tools and background pipeline. */
export interface Config {
  /** Register tools, inject the prompt, and run extraction. Defaults to true. */
  enabled?: boolean
  /** End-to-end auxiliary request deadline in milliseconds. */
  timeoutMs?: number
  /** Character cap on one turn's extraction transcript. */
  maxTranscriptChars?: number
  /** Character cap on each injected `memory_summary.md`. */
  maxSummaryChars?: number
  /** Output token cap for extraction and consolidation calls. */
  maxOutputTokens?: number
  /** Optional provider override; must be paired with `model`. */
  provider?: string
  /** Optional model override; must be paired with `provider`. */
  model?: string
}

/** Complete config after defaults and pair checks. */
export interface ResolvedMemoryToolConfig {
  readonly enabled: boolean
  readonly timeoutMs: number
  readonly maxTranscriptChars: number
  readonly maxSummaryChars: number
  readonly maxOutputTokens: number
  readonly provider?: string
  readonly model?: string
}

/** Schemastery configuration for the memory tool consumer. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  timeoutMs: z.number().default(DEFAULT_TIMEOUT_MS),
  maxTranscriptChars: z.number().default(DEFAULT_MAX_TRANSCRIPT_CHARS),
  maxSummaryChars: z.number().default(DEFAULT_MAX_SUMMARY_CHARS),
  maxOutputTokens: z.number().default(DEFAULT_MAX_OUTPUT_TOKENS),
  provider: z.string(),
  model: z.string(),
})

/**
 * Validate and detach plugin configuration.
 * @param config - Loader-supplied config after schemastery defaults.
 * @returns immutable resolved policy.
 */
export function resolveMemoryToolConfig(config: Config): ResolvedMemoryToolConfig {
  const enabled = config.enabled ?? true
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxTranscriptChars = config.maxTranscriptChars ?? DEFAULT_MAX_TRANSCRIPT_CHARS
  const maxSummaryChars = config.maxSummaryChars ?? DEFAULT_MAX_SUMMARY_CHARS
  const maxOutputTokens = config.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS
  assertPositiveInteger('timeoutMs', timeoutMs)
  if (timeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`tool-memory: timeoutMs must not exceed ${MAX_TIMER_DELAY_MS}`)
  }
  assertPositiveInteger('maxTranscriptChars', maxTranscriptChars)
  assertPositiveInteger('maxSummaryChars', maxSummaryChars)
  assertPositiveInteger('maxOutputTokens', maxOutputTokens)
  const hasProvider = config.provider !== undefined
  const hasModel = config.model !== undefined
  if (hasProvider !== hasModel) {
    throw new Error('tool-memory: provider and model must be supplied together')
  }
  if (hasProvider
    && (typeof config.provider !== 'string' || config.provider.length === 0
      || typeof config.model !== 'string' || config.model.length === 0)) {
    throw new Error('tool-memory: provider and model overrides must be non-empty strings')
  }
  return {
    enabled,
    timeoutMs,
    maxTranscriptChars,
    maxSummaryChars,
    maxOutputTokens,
    ...config.provider !== undefined && config.model !== undefined
      ? { provider: config.provider, model: config.model }
      : {},
  }
}

/**
 * Reject non-integer or non-positive limits.
 * @param name - field name.
 * @param value - candidate number.
 */
function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`tool-memory: ${name} must be a positive integer`)
  }
}
