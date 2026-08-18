/**
 * /web command and tools.restrict sync: off masks visible web tools; on lifts
 * the mask. Unknown tools are skipped so search-only compositions stay valid.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createScope } from '@deepseek-ai/dsh-scope'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolDefinition } from '@deepseek-ai/dsh-tools'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import WebNetworkingController from '../src/index.ts'

/** Minimal tool definition for registry probes. */
function stubTool(name: string): ToolDefinition {
  return {
    name,
    description: name,
    parameters: { type: 'object', properties: {} },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value as string }],
    },
    execute: (): Promise<string> => Promise.resolve(name),
  }
}

/**
 * Host with commands, tools, and web-networking plus a scoped agent.
 * @param tools - tool names to register before the agent is created.
 * @param registration - whether tools live globally or on a preset ancestor.
 */
async function harness(
  tools: readonly string[] = ['web_search', 'web_fetch'],
  registration: 'global' | 'preset' = 'global',
) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(WebNetworkingController)
  if (registration === 'global') {
    for (const name of tools) ctx.tools.register(stubTool(name))
  }

  const session = ctx.sessions.create(SessionId('web-net-1'))
  const agent = { id: session.id, session } as Agent
  let scoped!: Context
  await ctx.plugin(Object.assign((inner: Context) => {
    if (registration === 'preset') {
      const preset = { id: 'standard' }
      const presetScope = createScope(inner, preset)
      for (const name of tools) presetScope.ctx.tools.register(stubTool(name))
      scoped = createScope(inner, agent, { parent: preset }).ctx
      return
    }
    scoped = createScope(inner, agent).ctx
  }, { inject: ['tools', 'commands'] }))
  ;(agent as { ctx?: Context }).ctx = scoped

  ctx.emit('agent/created', { agent })
  return { ctx, session, agent }
}

describe('web-networking command and restrict', () => {
  it('registers /web and masks both tools on /web off', async () => {
    const { ctx, agent, session } = await harness()
    const signal = new AbortController().signal

    const off = await ctx.commands.execute(agent, '/web off', signal)
    expect(off?.result).toEqual({
      kind: 'success',
      text: 'Web tools off. Use /web to re-enable search and fetch.',
    })
    expect(session.events.some(event => event.type === 'web/networking' && !event.data.enabled)).toBe(true)
    // Visibility is scoped through the agent key (same view the model sees).
    expect(ctx.tools.schemas(agent).map(tool => tool.name)).toEqual([])

    const on = await ctx.commands.execute(agent, '/web', signal)
    expect(on?.result).toEqual({
      kind: 'success',
      text: 'Web tools on. Use /web off to disable search and fetch.',
    })
    expect(ctx.tools.schemas(agent).map(tool => tool.name).sort()).toEqual(['web_fetch', 'web_search'])
  })

  it('masks only the tools that exist', async () => {
    const { agent, ctx } = await harness(['web_search'])
    const signal = new AbortController().signal
    await ctx.commands.execute(agent, '/web off', signal)
    expect(ctx.tools.schemas(agent).map(tool => tool.name)).toEqual([])
  })

  it('masks web tools inherited from an ancestor preset scope', async () => {
    const { agent, ctx } = await harness(['web_search', 'web_fetch'], 'preset')
    const signal = new AbortController().signal

    expect(ctx.tools.schemas(agent).map(tool => tool.name).sort()).toEqual(['web_fetch', 'web_search'])
    await ctx.commands.execute(agent, '/web off', signal)
    expect(ctx.tools.schemas(agent).map(tool => tool.name)).toEqual([])

    await ctx.commands.execute(agent, '/web', signal)
    expect(ctx.tools.schemas(agent).map(tool => tool.name).sort()).toEqual(['web_fetch', 'web_search'])
  })

  it('no-ops when the state is already the requested one', async () => {
    const { agent, ctx, session } = await harness()
    const append = vi.spyOn(session, 'append')
    const signal = new AbortController().signal
    const result = await ctx.commands.execute(agent, '/web', signal)
    expect(result?.result).toMatchObject({ kind: 'success', text: 'Web tools already on.' })
    expect(append).not.toHaveBeenCalledWith('web/networking', expect.anything())
  })
})
