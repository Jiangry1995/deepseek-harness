import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import MemoryStore from '@deepseek-ai/dsh-memory'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import * as tool from '../src/index.ts'
import type { Config as ToolMemoryConfig } from '../src/config.ts'
import { MEMORY_HOWTO } from '../src/prompt.ts'

const testSignal = new AbortController().signal
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
  const root = await mkdtemp(join(tmpdir(), 'dsh-tool-memory-'))
  roots.push(root)
  return root
}

/**
 * Build a stub agent over a real session.
 * @param session - owning session.
 * @param ctx - agent-scoped context.
 * @returns a registerable agent.
 */
function stubAgent(session: Session, ctx: Context): Agent {
  return {
    id: session.id,
    options: { provider: 'mock', model: 'mock-model' },
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    ctx,
    followup: () => {},
    steer: () => {},
    inject: () => {},
    send: () => {},
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

/**
 * Mount memory tools without the LLM pipeline.
 * @param config - optional tool-memory config.
 * @returns context, user root, and a helper to execute tools.
 */
async function setup(config: ToolMemoryConfig = {}): Promise<{
  ctx: Context
  userRoot: string
  agent: Agent
  call: (name: string, args: unknown, over?: { agent?: Agent | undefined }) => ReturnType<Context['tools']['execute']>
}> {
  const userRoot = await tempDir()
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(MemoryStore, { userRoot })
  await ctx.plugin(tool, config)
  const session = Session.create(SessionId('memory-tools'))
  const agent = stubAgent(session, ctx.plugin(() => {}).ctx)
  let calls = 0
  const call = (name: string, args: unknown, over: { agent?: Agent | undefined } = {}) => {
    const owner = 'agent' in over ? over.agent : agent
    return ctx.tools.execute({
      signal: testSignal,
      callId: CallId(`call-${String(++calls)}`),
      name,
      arguments: args,
      ...owner ? { agent: owner } : {},
    })
  }
  return { ctx, userRoot, agent, call }
}

describe('dsh-tool-memory tools', () => {
  it('injects the HOWTO even when no memory files exist', async () => {
    const { ctx } = await setup()
    const assembly = await ctx.systemPrompt.assemble()
    const text = assembly.sections.map(section => section.text).join('\n')
    expect(text).toContain(MEMORY_HOWTO)
    expect(text).not.toContain('## User memory')
  })

  it('injects user and project summaries when present', async () => {
    const { ctx, userRoot, agent } = await setup()
    await writeFile(join(userRoot, 'memory_summary.md'), 'v1\nuser likes tea\n')
    const project = await tempDir()
    const withCwd = Session.create(SessionId('with-cwd'), undefined, {
      version: SESSION_FORMAT_VERSION,
      id: SessionId('with-cwd'),
      createdAt: Date.now(),
      cwd: project,
    })
    const projectAgent = stubAgent(withCwd, agent.ctx)
    await mkdirProjectSummary(project)
    const assembly = await ctx.systemPrompt.assemble({ agent: projectAgent })
    const text = assembly.sections.map(section => section.text).join('\n')
    expect(text).toContain('user likes tea')
    expect(text).toContain('project uses pnpm')
  })

  it('lists, searches, reads, and records notes for an owning agent', async () => {
    const { call } = await setup()
    const noted = await call('memory_note', { content: 'remember I drink oolong', slug: 'tea' })
    expect(noted.isError).toBe(false)
    if (noted.isError) throw new Error('note failed')
    const path = (noted.value as { path: string }).path
    const listed = await call('memory_list', {})
    expect(listed.isError).toBe(false)
    if (listed.isError) throw new Error('list failed')
    expect((listed.value as { files: { path: string }[] }).files.map(file => file.path)).toEqual([path])
    const search = await call('memory_search', { query: 'oolong' })
    expect(search.isError).toBe(false)
    if (search.isError) throw new Error('search failed')
    expect((search.value as { hits: unknown[] }).hits).toHaveLength(1)
    const read = await call('memory_read', { path })
    expect(read.isError).toBe(false)
    if (read.isError) throw new Error('read failed')
    expect((read.value as { content: string }).content).toContain('oolong')
  })

  it('rejects a non-agent caller and empty arguments', async () => {
    const { call } = await setup()
    const noAgent = await call('memory_list', {}, { agent: undefined })
    expect(noAgent.isError).toBe(true)
    expect(textOf(noAgent)).toContain('owning agent session')
    expect(textOf(await call('memory_search', { query: '   ' }))).toMatch(/non-empty/)
    expect(textOf(await call('memory_read', { path: '  ' }))).toMatch(/non-empty/)
    expect(textOf(await call('memory_note', { content: '  ' }))).toMatch(/non-empty/)
  })

  it('rejects project scope without a working directory', async () => {
    const { call } = await setup()
    expect(textOf(await call('memory_list', { scope: 'project' }))).toMatch(/working directory/)
  })

  it('presents search as a search card and the others as generic cards', async () => {
    const { ctx } = await setup()
    expect(ctx.tools.get('memory_search')?.presentCall?.({ query: 'tea' })).toMatchObject({
      card: 'generic', kind: 'search', rawInput: 'tea',
    })
    expect(ctx.tools.get('memory_list')?.presentCall?.({})).toMatchObject({
      card: 'generic', kind: 'other', rawInput: 'user',
    })
    expect(ctx.tools.get('memory_read')?.presentCall?.({ path: 'MEMORY.md' })).toMatchObject({
      card: 'generic', kind: 'read', rawInput: 'MEMORY.md',
    })
    expect(ctx.tools.get('memory_note')?.presentCall?.({ content: 'remember tea' })).toMatchObject({
      card: 'generic', kind: 'other', rawInput: 'remember tea',
    })
  })

  it('renders empty list and search results', async () => {
    const { call } = await setup()
    expect(textOf(await call('memory_list', {}))).toContain('No memory files')
    expect(textOf(await call('memory_search', { query: 'nothing' }))).toContain('No memory matches')
  })

  it('reads and lists project memory when the session has a cwd', async () => {
    const { call, agent } = await setup()
    const project = await tempDir()
    const withCwd = Session.create(SessionId('project-tools'), undefined, {
      version: SESSION_FORMAT_VERSION,
      id: SessionId('project-tools'),
      createdAt: Date.now(),
      cwd: project,
    })
    const projectAgent = stubAgent(withCwd, agent.ctx)
    const noted = await call('memory_note', { content: 'repo uses pnpm', scope: 'project' }, { agent: projectAgent })
    expect(noted.isError).toBe(false)
    const listed = await call('memory_list', { scope: 'project' }, { agent: projectAgent })
    expect(listed.isError).toBe(false)
    if (listed.isError) throw new Error('list failed')
    expect((listed.value as { files: { path: string }[] }).files).toHaveLength(1)
  })

  it('unregisters tools when the plugin fiber disposes', async () => {
    const userRoot = await tempDir()
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(MemoryStore, { userRoot })
    const fiber = await ctx.plugin(tool, {})
    expect(ctx.tools.schemas().some(schema => schema.name === 'memory_note')).toBe(true)
    await fiber.dispose()
    expect(ctx.tools.schemas().map(schema => schema.name)).toEqual([])
  })

  it('registers nothing when enabled is false', async () => {
    const { ctx } = await setup({ enabled: false })
    expect(ctx.tools.schemas()).toEqual([])
    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections.some(section => section.name === 'tool:memory')).toBe(false)
  })

  it('omits the project summary heading when the project tree is empty', async () => {
    const { ctx, agent } = await setup()
    const project = await tempDir()
    const withCwd = Session.create(SessionId('empty-project'), undefined, {
      version: SESSION_FORMAT_VERSION,
      id: SessionId('empty-project'),
      createdAt: Date.now(),
      cwd: project,
    })
    const projectAgent = stubAgent(withCwd, agent.ctx)
    const text = (await ctx.systemPrompt.assemble({ agent: projectAgent })).sections
      .map(section => section.text)
      .join('\n')
    expect(text).toContain(MEMORY_HOWTO)
    expect(text).not.toContain('## Project memory')
  })

  it('truncates oversized injected summaries and treats an empty cwd as missing', async () => {
    const { ctx, userRoot, agent, call } = await setup({ maxSummaryChars: 8 })
    await writeFile(join(userRoot, 'memory_summary.md'), 'v1\nuser likes a very long tea order\n')
    const assembly = await ctx.systemPrompt.assemble({ agent })
    expect(assembly.sections.map(section => section.text).join('\n')).toContain('truncated')
    const emptyAgent = {
      ...agent,
      session: { header: { ...agent.session.header, cwd: '' } },
    } as Agent
    const emptyPrompt = (await ctx.systemPrompt.assemble({ agent: emptyAgent })).sections
      .map(section => section.text)
      .join('\n')
    expect(emptyPrompt).not.toContain('## Project memory')
    expect(textOf(await call('memory_list', { scope: 'project' }, { agent: emptyAgent }))).toMatch(/working directory/)
  })
})

/**
 * Join tool-result text blocks.
 * @param result - execute result.
 * @returns concatenated text.
 */
function textOf(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

/**
 * Write a project-level summary file.
 * @param project - project cwd.
 */
async function mkdirProjectSummary(project: string): Promise<void> {
  const dir = join(project, '.dsh', 'memory')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'memory_summary.md'), 'v1\nproject uses pnpm\n')
}
