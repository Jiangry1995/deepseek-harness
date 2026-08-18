/**
 * Fold / projection coverage for the webNetworking unit: empty log defaults
 * to enabled; web/networking flips stick; unloading the fiber removes the key.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import WebNetworkingController, { foldWebNetworking } from '../src/index.ts'

interface Bench {
  ctx: Context
  session: Session
  values(): Record<string, unknown>
}

/**
 * Mount a minimal host with optional web-networking.
 * @param withNetworking - whether to register the controller.
 */
async function harness(withNetworking: boolean): Promise<Bench> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionProjectionRegistry)
  if (withNetworking) await ctx.plugin(WebNetworkingController)
  const session = ctx.sessions.create()
  ctx.agents.register({ id: session.id, session, status: 'idle', ctx } as Agent)
  return {
    ctx,
    session,
    values: () => ctx.sessionProjections.snapshot(session).values,
  }
}

describe('foldWebNetworking', () => {
  it('defaults to enabled before any event', () => {
    expect(foldWebNetworking([])).toBe(true)
  })

  it('last web/networking event wins', () => {
    const events = [
      { type: 'web/networking', data: { enabled: false } },
      { type: 'web/networking', data: { enabled: true } },
    ] as SessionEvent[]
    expect(foldWebNetworking(events)).toBe(true)
  })
})

describe('webNetworking projection', () => {
  it('serves enabled for the empty log', async () => {
    const bench = await harness(true)
    expect(bench.values()).toEqual({ webNetworking: { enabled: true } })
  })

  it('flips when web/networking is appended', async () => {
    const bench = await harness(true)
    bench.session.append('web/networking', { enabled: false })
    expect(bench.values().webNetworking).toEqual({ enabled: false })
    bench.session.append('web/networking', { enabled: true })
    expect(bench.values().webNetworking).toEqual({ enabled: true })
  })

  it('omits the key when the plugin is not composed', async () => {
    const bench = await harness(false)
    expect(bench.values().webNetworking).toBeUndefined()
  })
})
