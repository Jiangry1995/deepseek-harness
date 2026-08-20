/**
 * Model-facing memory tools, standing HOWTO injection, and the background
 * extract-then-consolidate pipeline. Named exports preserve loader injection
 * metadata. There is no default export.
 * @module @deepseek-ai/dsh-tool-memory
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-memory'
import { Config, resolveMemoryToolConfig } from './config.ts'
import { startMemoryPipeline } from './pipeline.ts'
import { renderMemoryPrompt } from './prompt.ts'
import { registerMemoryTools } from './tools.ts'

export const name = 'tool-memory'
export const inject = ['memory', 'tools', 'systemPrompt']
export { Config }
export {
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_MAX_SUMMARY_CHARS,
  DEFAULT_MAX_TRANSCRIPT_CHARS,
  DEFAULT_TIMEOUT_MS,
  resolveMemoryToolConfig,
} from './config.ts'
export { CONSOLIDATION_SYSTEM_PROMPT, EXTRACTION_SYSTEM_PROMPT, MemoryPipeline, startMemoryPipeline } from './pipeline.ts'
export { MEMORY_HOWTO, renderMemoryPrompt, truncateSummary } from './prompt.ts'
export { parseJsonObject, resolveMemoryRoute } from './llm.ts'
export { hasRememberPhrase } from './signals.ts'
export { eventsForTurn, transcriptForTurn } from './transcript.ts'

/**
 * Register tools, inject the memory HOWTO, and start the background pipeline
 * when `llm` and `agents` are composed. `enabled: false` is a no-op.
 * @param ctx - registrant context.
 * @param config - Loader-supplied configuration after schemastery defaults.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveMemoryToolConfig(config)
  if (!resolved.enabled) return
  ctx.systemPrompt.section({
    name: 'tool:memory',
    order: 108,
    text: context => renderMemoryPrompt(ctx.memory, context, resolved.maxSummaryChars),
  })
  registerMemoryTools(ctx)
  ctx.inject(['llm', 'agents'], (runtime) => {
    startMemoryPipeline(runtime, resolved)
  })
}
