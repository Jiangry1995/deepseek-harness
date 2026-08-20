import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox, agentEvents } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import LlmRuntime, { LlmAdapter, CallId, createMessage, createUserMessage, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import MemoryStore from '@deepseek-ai/dsh-memory'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { resolveMemoryToolConfig } from '../src/config.ts'
import { completeMemoryJson } from '../src/llm.ts'
import { completedTurnsAfter, startMemoryPipeline } from '../src/pipeline.ts'
import * as tool from '../src/index.ts'

let roots: string[] = []
let contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts) await ctx.fiber.dispose()
  contexts = []
  await Promise.all(roots.map(root => rm(root, { recursive: true, force: true })))
  roots = []
})

/**
 * Create an isolated directory.
 * @returns absolute temp path.
 */
async function tempDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-memory-pipe-'))
  roots.push(root)
  return root
}

/** Scripted LLM adapter that yields one JSON object per call. */
class ScriptAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  constructor(private readonly scripts: readonly (readonly StreamChunk[])[]) {
    super()
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const script = this.scripts[this.requests.length - 1]
    if (script === undefined) throw new Error('unexpected extra LLM call')
    yield * script
  }
}

/** Adapter that waits until the request signal aborts. */
class HangAdapter extends LlmAdapter {
  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const signal = options.signal
    if (signal === undefined) throw new Error('expected signal')
    await new Promise<never>((_resolve, reject) => {
      const fail = (): void => {
        reject(signal.reason)
      }
      if (signal.aborted) {
        fail()
        return
      }
      signal.addEventListener('abort', fail, { once: true })
    })
  }
}

/**
 * Wrap a JSON value as a successful text stream.
 * @param value - object to serialize.
 * @returns stream chunks.
 */
function jsonScript(value: unknown): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: JSON.stringify(value) },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/**
 * Build a stub agent over a live session.
 * @param ctx - root context.
 * @param session - live session.
 * @returns the registered agent.
 */
function registerAgent(ctx: Context, session: Session): Agent {
  const scoped = ctx.plugin(() => {})
  const agent: Agent = {
    id: session.id,
    options: { provider: 'mock', model: 'mock-model' },
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    ctx: scoped.ctx,
    followup: () => {},
    steer: () => {},
    inject: () => {},
    send: () => {},
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  ctx.agents.register(agent)
  return agent
}

/**
 * Mount store, session, agent, and llm without starting the pipeline.
 * @param adapter - scripted model.
 * @returns harness pieces.
 */
async function baseHarness(adapter: LlmAdapter, meta?: { cwd?: string; origin?: 'subagent'; delegationDepth?: number }): Promise<{
  ctx: Context
  userRoot: string
  session: Session
  agent: Agent
}> {
  const userRoot = await tempDir()
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(MemoryStore, { userRoot })
  ctx.llm.registerAdapter(['mock'], adapter)
  const session = ctx.sessions.create(SessionId(`mem-${String(roots.length)}`), {
    meta: {
      ...meta?.cwd !== undefined ? { cwd: meta.cwd } : {},
      ...meta?.origin !== undefined ? { origin: meta.origin } : {},
      ...meta?.delegationDepth !== undefined ? { delegationDepth: meta.delegationDepth } : {},
    },
  })
  const agent = registerAgent(ctx, session)
  return { ctx, userRoot, session, agent }
}

/**
 * Mount the background pipeline on a live harness.
 * @param adapter - scripted model.
 * @returns harness plus pipeline.
 */
async function pipelineHarness(adapter: LlmAdapter, meta?: { cwd?: string; origin?: 'subagent'; delegationDepth?: number }): Promise<{
  ctx: Context
  userRoot: string
  session: Session
  agent: Agent
  pipeline: ReturnType<typeof startMemoryPipeline>
}> {
  const base = await baseHarness(adapter, meta)
  const pipeline = startMemoryPipeline(base.ctx, resolveMemoryToolConfig({
    provider: 'mock',
    model: 'mock-model',
  }))
  return { ...base, pipeline }
}

/**
 * Append one completed user/assistant turn, optionally with a tool call.
 * @param session - live session.
 * @param turn - turn number.
 * @param user - user text.
 * @param withTool - whether to log a tool call.
 */
function appendTurn(session: Session, turn: number, user: string, withTool = false): void {
  session.append('turn/start', { turn })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: user }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('step/start', { turn, step: 1 })
  session.append('assistant/message', {
    turn,
    step: 1,
    message: createMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'ok' }],
      source: { kind: 'model', provider: 'mock', model: 'mock-model' },
    }),
  }, { surfaceOp: 'append' })
  if (withTool) {
    session.append('tool/call', {
      turn, step: 1, callId: CallId(`c-${String(turn)}`), name: 'memory_search', arguments: '{}',
    })
    session.append('tool/result', {
      turn,
      step: 1,
      message: createToolResultMessage({
        callId: CallId(`c-${String(turn)}`),
        content: [{ type: 'text', text: 'none' }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
  }
  session.append('step/end', { turn, step: 1 })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

describe('memory pipeline', () => {
  it('skips the LLM when a completed turn has no remember phrase and no tool call', async () => {
    const adapter = new ScriptAdapter([jsonScript({ raw_memory: 'should not write' })])
    const { ctx, pipeline, session } = await pipelineHarness(adapter)
    appendTurn(session, 1, 'hello there')
    await pipeline.whenIdle()
    expect(adapter.requests).toHaveLength(0)
    expect(await ctx.memory.lastTurn(String(session.id))).toBe(1)
    expect(await ctx.memory.list('user')).toEqual([])
  })

  it('advances the watermark on a non-completed turn without extracting', async () => {
    const adapter = new ScriptAdapter([jsonScript({ raw_memory: 'should not write' })])
    const { ctx, pipeline, session } = await pipelineHarness(adapter)
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '记住 abort 也不抽' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } })
    await pipeline.whenIdle()
    expect(adapter.requests).toHaveLength(0)
    expect(await ctx.memory.lastTurn(String(session.id))).toBe(1)
  })

  it('does not write the handbook when extraction returns empty strings', async () => {
    const adapter = new ScriptAdapter([jsonScript({
      scope: 'user', raw_memory: '', rollout_summary: '', rollout_slug: '',
    })])
    const { ctx, pipeline, session } = await pipelineHarness(adapter)
    appendTurn(session, 1, 'please remember this later', true)
    await pipeline.whenIdle()
    expect(adapter.requests).toHaveLength(1)
    expect(adapter.requests[0]?.purpose).toBe('memory')
    expect(await ctx.memory.list('user')).toEqual([])
  })

  it('writes raw memory, a session summary, and consolidates into the handbook', async () => {
    const adapter = new ScriptAdapter([
      jsonScript({
        scope: 'user',
        raw_memory: 'User drinks oolong.',
        rollout_summary: 'Noted tea preference.',
        rollout_slug: 'tea',
      }),
      jsonScript({
        noop: false,
        memory_md: 'User drinks oolong tea.',
        memory_summary_md: 'drinks oolong',
        skills: [{ name: 'tea-order', content: 'Order oolong.' }],
      }),
    ])
    const { ctx, pipeline, session } = await pipelineHarness(adapter)
    appendTurn(session, 1, '记住我喝乌龙茶')
    await pipeline.whenIdle()
    expect(adapter.requests).toHaveLength(2)
    expect(await ctx.memory.read('user', 'raw_memories.md')).toContain('oolong')
    expect(await ctx.memory.read('user', 'session_summaries/tea.md')).toContain('Noted tea')
    expect(await ctx.memory.read('user', 'MEMORY.md')).toContain('oolong tea')
    expect(await ctx.memory.readSummary('user')).toContain('drinks oolong')
    expect(await ctx.memory.read('user', 'skills/tea-order/SKILL.md')).toContain('Order oolong')
  })

  it('falls back to the user tree when extraction asks for project without a cwd', async () => {
    const adapter = new ScriptAdapter([
      jsonScript({
        scope: 'project',
        raw_memory: 'User-level fallback.',
        rollout_summary: '',
        rollout_slug: '',
      }),
      jsonScript({ noop: true }),
    ])
    const { ctx, pipeline, session } = await pipelineHarness(adapter)
    appendTurn(session, 1, 'remember this fallback')
    await pipeline.whenIdle()
    expect(await ctx.memory.read('user', 'raw_memories.md')).toContain('fallback')
  })

  it('writes project memory when the session has a cwd and extraction selects project', async () => {
    const project = await tempDir()
    const adapter = new ScriptAdapter([
      jsonScript({
        scope: 'project',
        raw_memory: 'Repo uses pnpm.',
        rollout_summary: 'pnpm recap',
        rollout_slug: '',
      }),
      jsonScript({
        noop: false,
        memory_md: 'This repo uses pnpm.',
        memory_summary_md: 'uses pnpm',
        skills: [],
      }),
    ])
    const { ctx, pipeline, session } = await pipelineHarness(adapter, { cwd: project })
    appendTurn(session, 1, '记住这个仓库用 pnpm')
    await pipeline.whenIdle()
    expect(await ctx.memory.read('project', 'raw_memories.md', project)).toContain('pnpm')
    expect(await ctx.memory.read('project', 'session_summaries/turn.md', project)).toContain('pnpm recap')
    expect(await ctx.memory.read('project', 'MEMORY.md', project)).toContain('uses pnpm')
  })

  it('skips subagent sessions', async () => {
    const adapter = new ScriptAdapter([jsonScript({ raw_memory: 'nope' })])
    const { pipeline, session, agent } = await pipelineHarness(adapter, {
      origin: 'subagent',
      delegationDepth: 1,
      cwd: await tempDir(),
    })
    appendTurn(session, 1, '记住子代理不要记')
    await pipeline.whenIdle()
    expect(adapter.requests).toHaveLength(0)
    expect(pipeline.skipAgent(agent)).toBe(true)
  })

  it('skips nested-delegation sessions without a subagent origin', async () => {
    const adapter = new ScriptAdapter([jsonScript({ raw_memory: 'nope' })])
    const { pipeline, session } = await pipelineHarness(adapter, { delegationDepth: 1 })
    appendTurn(session, 1, 'remember this nested')
    await pipeline.whenIdle()
    expect(adapter.requests).toHaveLength(0)
  })

  it('logs LLM failures without throwing and still advances the watermark', async () => {
    const adapter = new ScriptAdapter([{
      type: 'finish',
      reason: { kind: 'error', failure: { message: 'boom', code: 'PROVIDER' } },
    }])
    const { ctx, pipeline, session } = await pipelineHarness(adapter)
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)
    appendTurn(session, 1, 'remember this badge color')
    await pipeline.whenIdle()
    expect(warn).toHaveBeenCalled()
    expect(await ctx.memory.lastTurn(String(session.id))).toBe(1)
  })

  it('logs malformed extraction fields without aborting the agent', async () => {
    const adapter = new ScriptAdapter([jsonScript({ raw_memory: 1 })])
    const { ctx, pipeline, session } = await pipelineHarness(adapter)
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)
    appendTurn(session, 1, 'remember this numeric junk')
    await pipeline.whenIdle()
    expect(warn).toHaveBeenCalled()
    expect(await ctx.memory.lastTurn(String(session.id))).toBe(1)
  })

  it('runs Phase 2 for pending notes without a Phase 1 signal', async () => {
    const adapter = new ScriptAdapter([
      jsonScript({
        noop: false,
        memory_md: 'From a note.',
        memory_summary_md: 'from note',
        skills: [],
      }),
    ])
    const { ctx, pipeline, session } = await pipelineHarness(adapter)
    await ctx.memory.writeNote('user', { content: 'remember the badge is blue' })
    appendTurn(session, 1, 'hello there')
    await pipeline.whenIdle()
    expect(adapter.requests).toHaveLength(1)
    expect(await ctx.memory.read('user', 'MEMORY.md')).toContain('From a note')
    expect(await ctx.memory.listPendingNotes('user')).toEqual([])
  })

  it('does not move notes when consolidation no-ops', async () => {
    const adapter = new ScriptAdapter([jsonScript({ noop: true })])
    const { ctx, pipeline, session } = await pipelineHarness(adapter)
    const path = await ctx.memory.writeNote('user', { content: 'keep me pending' })
    appendTurn(session, 1, 'hello there')
    await pipeline.whenIdle()
    expect(await ctx.memory.listPendingNotes('user')).toEqual([path])
  })

  it('leaves the handbook unchanged when consolidation omits handbook bodies', async () => {
    const adapter = new ScriptAdapter([jsonScript({
      noop: false,
      memory_md: '',
      memory_summary_md: 'ignored',
    })])
    const { ctx, pipeline, session } = await pipelineHarness(adapter)
    await ctx.memory.writeNote('user', { content: 'remember empty handbook' })
    appendTurn(session, 1, 'hello there')
    await pipeline.whenIdle()
    expect(await ctx.memory.list('user').then(files => files.some(file => file.path === 'MEMORY.md'))).toBe(false)
  })

  it('rejects malformed skills without writing the handbook', async () => {
    const adapter = new ScriptAdapter([jsonScript({
      noop: false,
      memory_md: 'Handbook.',
      memory_summary_md: 'summary',
      skills: 'nope',
    })])
    const { ctx, pipeline, session } = await pipelineHarness(adapter)
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)
    await ctx.memory.writeNote('user', { content: 'remember bad skills' })
    appendTurn(session, 1, 'hello there')
    await pipeline.whenIdle()
    expect(warn).toHaveBeenCalled()
    expect(await ctx.memory.list('user').then(files => files.some(file => file.path === 'MEMORY.md'))).toBe(false)
  })

  it('rejects a skill entry that is not an object', async () => {
    const adapter = new ScriptAdapter([jsonScript({
      noop: false,
      memory_md: 'Handbook.',
      memory_summary_md: 'summary',
      skills: [null],
    })])
    const { ctx, pipeline, session } = await pipelineHarness(adapter)
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)
    await ctx.memory.writeNote('user', { content: 'remember null skill' })
    appendTurn(session, 1, 'hello there')
    await pipeline.whenIdle()
    expect(warn).toHaveBeenCalled()
  })

  it('rejects a skill entry missing string fields', async () => {
    const adapter = new ScriptAdapter([jsonScript({
      noop: false,
      memory_md: 'Handbook.',
      memory_summary_md: 'summary',
      skills: [{ name: 1, content: 'x' }],
    })])
    const { ctx, pipeline, session } = await pipelineHarness(adapter)
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)
    await ctx.memory.writeNote('user', { content: 'remember typed skill' })
    appendTurn(session, 1, 'hello there')
    await pipeline.whenIdle()
    expect(warn).toHaveBeenCalled()
  })

  it('catches up completed turns after the pipeline starts', async () => {
    const adapter = new ScriptAdapter([
      jsonScript({ scope: 'user', raw_memory: 'fact', rollout_summary: '', rollout_slug: '' }),
      jsonScript({ noop: true }),
    ])
    const { ctx, session, agent } = await baseHarness(adapter)
    appendTurn(session, 1, '记住 catch-up')
    expect(adapter.requests).toHaveLength(0)
    const pipeline = startMemoryPipeline(ctx, resolveMemoryToolConfig({ provider: 'mock', model: 'mock-model' }))
    pipeline.catchUp(agent)
    await pipeline.whenIdle()
    expect(adapter.requests).toHaveLength(2)
    expect(await ctx.memory.read('user', 'raw_memories.md')).toContain('fact')
    pipeline.catchUp(agent)
    await pipeline.whenIdle()
    expect(adapter.requests).toHaveLength(2)
    pipeline.onTurnEnd(agent, 1, { kind: 'completed' })
    pipeline.catchUp(agent)
    await pipeline.whenIdle()
    expect(adapter.requests).toHaveLength(2)
  })

  it('catches up from agent/session-start', async () => {
    const adapter = new ScriptAdapter([
      jsonScript({ scope: 'user', raw_memory: 'started', rollout_summary: '', rollout_slug: '' }),
      jsonScript({ noop: true }),
    ])
    const { ctx, session, agent } = await baseHarness(adapter)
    appendTurn(session, 1, 'remember this on start')
    const pipeline = startMemoryPipeline(ctx, resolveMemoryToolConfig({ provider: 'mock', model: 'mock-model' }))
    agentEvents(ctx, agent).emit('agent/session-start', { source: 'startup' })
    await pipeline.whenIdle()
    expect(adapter.requests).toHaveLength(2)
  })

  it('ignores turn/end when no agent is registered', async () => {
    const adapter = new ScriptAdapter([jsonScript({ raw_memory: 'nope' })])
    const userRoot = await tempDir()
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(MemoryStore, { userRoot })
    ctx.llm.registerAdapter(['mock'], adapter)
    const pipeline = startMemoryPipeline(ctx, resolveMemoryToolConfig({ provider: 'mock', model: 'mock-model' }))
    const session = ctx.sessions.create(SessionId('orphan'))
    appendTurn(session, 1, 'remember this orphan')
    await pipeline.whenIdle()
    expect(adapter.requests).toHaveLength(0)
  })

  it('aborts in-flight work when the plugin fiber disposes', async () => {
    const userRoot = await tempDir()
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(MemoryStore, { userRoot })
    ctx.llm.registerAdapter(['mock'], new HangAdapter())
    const session = ctx.sessions.create(SessionId('abort-mem'))
    registerAgent(ctx, session)
    const fiber = await ctx.plugin(tool, { provider: 'mock', model: 'mock-model' })
    appendTurn(session, 1, 'remember this abort')
    await fiber.dispose()
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(await ctx.memory.lastTurn(String(session.id))).toBe(0)
  })

  it('skips catch-up for nested-delegation sessions', async () => {
    const adapter = new ScriptAdapter([jsonScript({ raw_memory: 'nope' })])
    const { pipeline, agent } = await pipelineHarness(adapter, { delegationDepth: 2 })
    pipeline.catchUp(agent)
    await pipeline.whenIdle()
    expect(adapter.requests).toHaveLength(0)
  })

  it('treats missing extraction fields as empty and skips Phase 2', async () => {
    const adapter = new ScriptAdapter([jsonScript({ scope: 'user' })])
    const { ctx, pipeline, session } = await pipelineHarness(adapter)
    appendTurn(session, 1, 'remember this empty extraction')
    await pipeline.whenIdle()
    expect(adapter.requests).toHaveLength(1)
    expect(await ctx.memory.list('user')).toEqual([])
  })

  it('writes a session summary when extraction returns recap without raw memory', async () => {
    const adapter = new ScriptAdapter([
      jsonScript({
        scope: 'user',
        raw_memory: null,
        rollout_summary: 'Turn recap only.',
        rollout_slug: '',
      }),
      jsonScript({
        noop: false,
        memory_md: 'From recap.',
        memory_summary_md: 'recap',
      }),
    ])
    const { ctx, pipeline, session } = await pipelineHarness(adapter)
    appendTurn(session, 1, 'remember this recap')
    await pipeline.whenIdle()
    expect(await ctx.memory.read('user', 'session_summaries/turn.md')).toContain('Turn recap only')
    expect(await ctx.memory.read('user', 'MEMORY.md')).toContain('From recap')
  })

  it('falls back to user scope for an unknown extraction scope', async () => {
    const adapter = new ScriptAdapter([
      jsonScript({
        scope: 'galaxy',
        raw_memory: 'Still user-level.',
        rollout_summary: '',
        rollout_slug: '',
      }),
      jsonScript({ noop: true, skills: [] }),
    ])
    const { ctx, pipeline, session } = await pipelineHarness(adapter)
    appendTurn(session, 1, 'remember this unknown scope')
    await pipeline.whenIdle()
    expect(await ctx.memory.read('user', 'raw_memories.md')).toContain('Still user-level')
  })

  it('propagates a handbook path that is a directory during consolidation', async () => {
    const adapter = new ScriptAdapter([jsonScript({ noop: true })])
    const { ctx, pipeline, session, userRoot } = await pipelineHarness(adapter)
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)
    await mkdir(join(userRoot, 'MEMORY.md'))
    await ctx.memory.writeNote('user', { content: 'remember this directory handbook' })
    appendTurn(session, 1, 'hello there')
    await pipeline.whenIdle()
    expect(warn).toHaveBeenCalled()
  })

  it('runs a later turn after an earlier extraction failure', async () => {
    const adapter = new ScriptAdapter([
      {
        type: 'finish',
        reason: { kind: 'error', failure: { message: 'first boom', code: 'PROVIDER' } },
      },
      jsonScript({
        scope: 'user',
        raw_memory: 'Recovered fact.',
        rollout_summary: '',
        rollout_slug: '',
      }),
      jsonScript({ noop: true }),
    ])
    const { ctx, pipeline, session } = await pipelineHarness(adapter)
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)
    appendTurn(session, 1, 'remember this first failure')
    appendTurn(session, 2, 'remember this recovery')
    await pipeline.whenIdle()
    expect(warn).toHaveBeenCalled()
    expect(await ctx.memory.read('user', 'raw_memories.md')).toContain('Recovered fact')
    expect(await ctx.memory.lastTurn(String(session.id))).toBe(2)
  })
})

describe('completeMemoryJson finish reasons', () => {
  /**
   * Mount llm + a store session for one-shot JSON completion.
   * @param script - stream chunks.
   * @returns context, session, and a stub agent.
   */
  async function jsonHarness(script: readonly StreamChunk[]): Promise<{
    ctx: Context
    agent: Agent
  }> {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SessionStore)
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['mock'], new ScriptAdapter([script]))
    const session = ctx.sessions.create(SessionId(`json-${String(contexts.length)}`))
    const agent = { session, options: { provider: 'mock', model: 'mock-model' } } as unknown as Agent
    return { ctx, agent }
  }

  it('parses a fenced JSON object when the stream omits finish', async () => {
    const { ctx, agent } = await jsonHarness([
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'reasoning-delta', index: 0, text: 'ignore me' },
      { type: 'block-start', index: 1, blockType: 'text' },
      { type: 'text-delta', index: 1, text: 'prefix ```json\n{"ok":true}\n```' },
    ])
    await expect(completeMemoryJson(
      ctx,
      resolveMemoryToolConfig({ provider: 'mock', model: 'mock-model' }),
      agent,
      'sys',
      '{}',
      new AbortController().signal,
    )).resolves.toEqual({ ok: true })
  })

  it('rejects max-tokens, tool-calls, and aborted finishes', async () => {
    const maxTokens = await jsonHarness([{ type: 'finish', reason: { kind: 'max-tokens' } }])
    await expect(completeMemoryJson(
      maxTokens.ctx,
      resolveMemoryToolConfig({ provider: 'mock', model: 'mock-model' }),
      maxTokens.agent,
      'sys',
      '{}',
      new AbortController().signal,
    )).rejects.toThrow(/maxOutputTokens/)

    const toolCalls = await jsonHarness([{ type: 'finish', reason: { kind: 'tool-calls' } }])
    await expect(completeMemoryJson(
      toolCalls.ctx,
      resolveMemoryToolConfig({ provider: 'mock', model: 'mock-model' }),
      toolCalls.agent,
      'sys',
      '{}',
      new AbortController().signal,
    )).rejects.toThrow(/requested a tool/)

    const aborted = await jsonHarness([{
      type: 'finish',
      reason: { kind: 'aborted', failure: { message: 'stopped', code: 'ABORTED' } },
    }])
    await expect(completeMemoryJson(
      aborted.ctx,
      resolveMemoryToolConfig({ provider: 'mock', model: 'mock-model' }),
      aborted.agent,
      'sys',
      '{}',
      new AbortController().signal,
    )).rejects.toMatchObject({ message: 'stopped', code: 'ABORTED' })

    const future = await jsonHarness([{ type: 'finish', reason: { kind: 'future-finish' } as never }])
    await expect(completeMemoryJson(
      future.ctx,
      resolveMemoryToolConfig({ provider: 'mock', model: 'mock-model' }),
      future.agent,
      'sys',
      '{}',
      new AbortController().signal,
    )).rejects.toThrow(/unsupported finish reason "future-finish"/)
  })
})

describe('completedTurnsAfter', () => {
  it('returns completed turns newer than the watermark', () => {
    const session = Session.create(SessionId('turns'))
    session.append('turn/start', { turn: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } })
    session.append('turn/start', { turn: 2 })
    session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
    expect(completedTurnsAfter(session, 0)).toEqual([2])
    expect(completedTurnsAfter(session, 2)).toEqual([])
  })
})
