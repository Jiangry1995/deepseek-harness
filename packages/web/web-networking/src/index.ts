/**
 * Session-scoped web tool networking gate: `/web` / `/web off` plus a
 * `webNetworking` projection. Turning it off masks inherited `web_search` and
 * `web_fetch` for that agent via `tools.restrict` (standing tool-web stays
 * mounted for every other session).
 * @module @deepseek-ai/dsh-web-networking
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { z as zod } from 'zod'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
// Type-only: optional command / projection children.
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-tools'
import type { WebNetworkingProjection } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Whether web_search / web_fetch are available from this point on.
     * Last event wins; a log with none folds to enabled.
     */
    'web/networking': { enabled: boolean }
  }
}

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-networking'

/** Tools this gate masks together. */
const WEB_TOOLS = ['web_search', 'web_fetch'] as const

/** Projection wire schema. */
const projectionSchema = zod.object({
  enabled: zod.boolean(),
})

/**
 * Fold the durable networking preference from the session log.
 * @param events - session events in order.
 * @returns true when web tools should be visible (default).
 */
export function foldWebNetworking(events: readonly SessionEvent[]): boolean {
  let enabled = true
  for (const event of events) {
    if (event.type === 'web/networking') enabled = event.data.enabled
  }
  return enabled
}

/**
 * Host service that keeps each agent's live tool mask in sync with the
 * session log. Restrictions are process-local and must be re-applied after
 * resume; the log is the durable source of truth.
 */
export class WebNetworkingController extends Service {
  /** Live restrict disposers keyed by session (process-local; re-applied on resume). */
  private readonly lifts = new WeakMap<Session, () => void>()

  constructor(ctx: Context) {
    super(ctx, 'webNetworking')

    ctx.on('agent/created', ({ agent }) => {
      this.sync(agent)
    })

    ctx.inject(['commands'], (commandCtx) => {
      commandCtx.commands.register({
        name: 'web',
        description: 'Enable or disable web_search and web_fetch for this session',
        input: { hint: '[off]' },
        handler: ({ agent, rawInput }) => {
          const enabled = rawInput.trim() !== 'off'
          const current = foldWebNetworking(agent.session.events)
          if (enabled === current) {
            return {
              kind: 'success',
              text: enabled ? 'Web tools already on.' : 'Web tools already off.',
            }
          }
          agent.session.append('web/networking', { enabled })
          this.sync(agent)
          return {
            kind: 'success',
            text: enabled
              ? 'Web tools on. Use /web off to disable search and fetch.'
              : 'Web tools off. Use /web to re-enable search and fetch.',
          }
        },
      })
    })

    ctx.inject(['sessionProjections'], (projectionCtx) => {
      projectionCtx.sessionProjections.register<'webNetworking', WebNetworkingProjection>({
        key: 'webNetworking',
        schema: projectionSchema,
        init: () => ({ enabled: true }),
        apply: (state, event) => {
          if (event.type === 'web/networking') return { enabled: event.data.enabled }
          return state
        },
        view: state => state,
        stateVersion: 1,
      })
    })
  }

  /**
   * Align the live restrict mask with the folded session preference.
   * @param agent - the agent whose inherited web tools to mask or restore.
   */
  sync(agent: Agent): void {
    const enabled = foldWebNetworking(agent.session.events)
    const existing = this.lifts.get(agent.session)
    if (!enabled) {
      if (existing !== undefined) return
      // Probe through the agent's complete view: production presets register
      // model-facing tools on an ancestor scope rather than the global layer.
      // A search-only preset has no web_fetch, and naming a missing tool would throw.
      const deny = WEB_TOOLS.filter(toolName => agent.ctx.tools.get(toolName, agent) !== undefined)
      if (deny.length === 0) return
      try {
        this.lifts.set(agent.session, agent.ctx.tools.restrict({ deny: [...deny] }))
      } catch (error: unknown) {
        // A race where tools disappear between the probe and restrict is not
        // fatal for this session; the next sync/command can retry.
        this.ctx.logger.warn(`web-networking: could not mask web tools: ${String(error)}`)
      }
      return
    }
    if (existing === undefined) return
    existing()
    this.lifts.delete(agent.session)
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    webNetworking: WebNetworkingController
  }
}

export default WebNetworkingController
