/**
 * Web networking control plugin, browser half: occupies `conversation.input.left`
 * with a globe toggle over the `webNetworking` projection and the `/web`
 * command channel. Reads ride `useProjection`; zero client-side networking state.
 */
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ui-conversation SlotMap merge (input.left).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the `webNetworking` SessionProjectionMap merge.
import type {} from '@deepseek-ai/dsh-web-networking/client'
import { WebChip } from './WebNetworkingControl.tsx'
import { en, zh, type WebKey } from './locales.ts'

export type { WebKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The composer web networking chip's copy. */
    web: WebKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'web'

/** Injected business face of the composer web networking chip. */
export interface WebChipInjected {
  /**
   * Enable or disable web tools by executing `/web` or `/web off`.
   * @param enabled - desired networking state.
   * @returns null on admitted execution; a user-visible failure line otherwise.
   */
  setWebNetworking: (enabled: boolean) => Promise<string | null>
}

/** Required services: the seat's slot registry, commands Remote, and locale registry. */
export const inject = ['slots', 'remote', 'remote.commands', 'locale']

/**
 * Client plugin body: register the web networking chip over the command channel.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-web: dictionaries')

  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'web-networking',
    order: 10,
    locale: NS,
    inject: (sessionId: SessionId): WebChipInjected => ({
      // Failure strings stay English (error-surface policy: not localized).
      setWebNetworking: async (enabled) => {
        const line = enabled ? '/web' : '/web off'
        const result = await ctx.remote.commands.execute(sessionId, line)
        if (!result.ok) return `${result.error.message} (${result.error.code})`
        if (result.value === undefined) return `unknown command: ${line}`
        return null
      },
    }),
  }, WebChip))
}
