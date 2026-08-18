/**
 * Automatic image fallback plugin: register one LLM-backed projection that is
 * consulted only for exact models which explicitly exclude image input.
 */

import type { Context } from '@deepseek-ai/cordis'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { Config, resolveVisionFallbackConfig } from './config.ts'
import { VisionModelFallback } from './fallback.ts'

export {
  Config,
  DEFAULT_VISION_FALLBACK_MAX_TOKENS,
  DEFAULT_VISION_FALLBACK_PROMPT,
  DEFAULT_VISION_FALLBACK_TIMEOUT_MS,
  resolveVisionFallbackConfig,
} from './config.ts'
export {
  foldVisionTranscriptions,
  projectImageMessages,
  renderVisionFallbackText,
  VisionFallbackRequestId,
} from './events.ts'
export type {
  VisionFallbackRequestEventData,
  VisionFallbackRequestId as VisionFallbackRequestIdType,
  VisionFallbackResultEventData,
  VisionTranscription,
} from './events.ts'
export { VisionModelFallback } from './fallback.ts'
export type { ResolvedVisionFallbackConfig } from './fallback.ts'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'llm-vision-fallback'
/** LLM dispatch and durable session services required by the provider. */
export const inject = ['llm', 'sessions']
/** Settings namespace edited by the companion Web settings package. */
export const VISION_FALLBACK_SETTINGS_NAMESPACE = settingsNamespace('llm-vision-fallback')

/** Register the live settings-backed automatic fallback provider. */
export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  installSettingsSection(ctx, VISION_FALLBACK_SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => {
      current = source
    },
    // The fallback resolves the section at operation entry, so committed
    // settings need no registration churn.
    onChange: () => {},
  })
  ctx.llm.registerImageFallback(new VisionModelFallback(
    ctx,
    () => resolveVisionFallbackConfig(current()),
  ))
}
