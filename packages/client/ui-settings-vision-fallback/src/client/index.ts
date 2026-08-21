/** Browser plugin registering the Automatic vision tab in Plugins settings. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import {
  VisionFallbackSettingsController,
  type VisionFallbackSettings,
} from './controller.ts'
import {
  VisionFallbackSettingsTab,
  type VisionFallbackSettingsTabInjected,
} from './VisionFallbackSettingsTab.tsx'
import { en, zh, type VisionFallbackLocaleKey } from './locales.ts'

export type {
  VisionFallbackSettings,
  VisionFallbackSettingsState,
  VisualProviderOption,
} from './controller.ts'
export type {
  VisionFallbackSettingsTabInjected,
  VisionFallbackSettingsTabProps,
} from './VisionFallbackSettingsTab.tsx'
export type { VisionFallbackLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Automatic image fallback settings copy. */
    'settings.visionFallback': VisionFallbackLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.visionFallback'
/** Host settings namespace owned by the fallback provider. */
export const VISION_FALLBACK_SETTINGS_NAMESPACE = 'llm-vision-fallback'
/** Services required by settings, model catalog, locale, and slot registration. */
export const inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope']

/** Register the settings controller, invalidations, and Plugins tab. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-vision-fallback: dictionaries')
  const connection = ctx.get('connection') as ConnectionHandle
  const scope = ctx.settingsScope.bind<VisionFallbackSettings>({
    namespace: VISION_FALLBACK_SETTINGS_NAMESPACE,
  })
  const controller = new VisionFallbackSettingsController(scope, connection.api)
  const t = ctx.locale.bind(NS)
  const injected = (): VisionFallbackSettingsTabInjected => ({
    controller,
    hooks: { visionFallbackSettings: controller.store },
  })

  // `llm/adapters-updated` only fires when routes register or retry policy
  // changes. Editing `models[].input` on the Models page changes no route, so
  // the Host forwards `settings/document-updated` instead — and Plugins tabs
  // stay mounted after first visit, so this listener is what refetches.
  ctx.effect(() => {
    const refresh = (): void => { controller.refreshCatalogIfLoaded() }
    const disposers = [
      ctx.remote.$on('llm/adapters-updated', refresh),
      ctx.remote.$on('settings/document-updated', refresh),
      ctx.on('connection/reset', refresh),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'ui-settings-vision-fallback: model catalog invalidations')

  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'vision-fallback',
    order: 20,
    label: () => t('tab'),
    locale: NS,
    inject: injected,
  }, VisionFallbackSettingsTab))
}
