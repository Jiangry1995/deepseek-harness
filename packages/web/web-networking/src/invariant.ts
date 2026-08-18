/** Package-owned durable web-networking invariants. @module @deepseek-ai/dsh-web-networking/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-web-networking'

/** Cordis companion plugin name. */
export const name = 'web-networking-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Validate one `web/networking` event before it reaches the durable log.
 * @param event - candidate session event.
 * @param fail - invariant failure reporter.
 */
function validateEvent(event: SessionEvent, fail: InvariantFailure): void {
  if (event.type !== 'web/networking') return
  const enabled = (event.data as { enabled?: unknown }).enabled
  if (typeof enabled !== 'boolean') {
    fail(`web/networking carries invalid enabled state ${JSON.stringify(enabled)}; expected a boolean`)
  }
}

/** Install validation for loaded and newly appended networking state. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const seed = (session: Session): void => {
    for (const event of session.events) validateEvent(event, fail)
  }
  for (const session of ctx.sessions.list()) seed(session)
  ctx.on('session/created', (session) => { seed(session) }, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [, event] = args as [Session, SessionEvent]
    validateEvent(event, fail)
  }, { global: true })
}, { inject: ['sessions'] })

/**
 * Register the web-networking invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
