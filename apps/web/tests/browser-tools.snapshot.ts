import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { CallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { launchWebScaffold, type WebScaffold } from './scaffold.ts'

const FIXTURE = fileURLToPath(new URL('./snapshots/minimal-preset/session.jsonl', import.meta.url))
const PROMPT = 'Reply exactly MINIMAL_PRESET_REQUEST_OK and stop.'

describe('browser tools in the shipped Web composition', () => {
  let scaffold: WebScaffold
  let agentHandle: AgentHandle

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ replayFixture: FIXTURE })
    agentHandle = await scaffold.ctx.agents.create({
      sessionId: SessionId('browser-tools-snapshot'),
      meta: { cwd: scaffold.workspaceCwd },
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      setup: agentCtx => scaffold.ctx.agentPresets.mount(agentCtx).then(() => undefined),
    })
  })

  afterAll(async () => {
    const failures: unknown[] = []
    await agentHandle?.dispose().catch((error: unknown) => failures.push(error))
    await scaffold?.close().catch((error: unknown) => failures.push(error))
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'browser tool snapshot teardown failed')
  })

  it('records the browser prompt and schemas in a real replayed model request', async () => {
    agentHandle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: PROMPT }],
      source: { kind: 'user' },
    }))
    await agentHandle.agent.whenIdle()

    const requestHeader = agentHandle.agent.session.requestHeader()
    if (requestHeader === undefined) throw new Error('the browser tool snapshot issued no model request')
    const browserPrompt = (await scaffold.ctx.systemPrompt.assemble({ scope: agentHandle.agent })).sections
      .find(section => section.name === 'tool:browser')?.text
    if (browserPrompt === undefined) throw new Error('the browser tool prompt section was not assembled')
    expect(requestHeader.system).toContain(browserPrompt)

    expect(browserPrompt).toContain('first use browser_list_tabs or browser_read_page')
    expect(browserPrompt).toContain('Do not call a skill, web search, or a fetch of the Harness page first')
    expect(browserPrompt).toContain('Recommended loop: read the page, act with a returned ref, wait for the page to change, read again, and verify the actual result')
    expect(browserPrompt).not.toContain('百度')
    expect(browserPrompt).not.toContain('政务系统')
    expect(browserPrompt).not.toContain('twitter.com')

    const browserTools = requestHeader.tools?.filter(tool => tool.name.startsWith('browser_'))
    expect(browserTools?.map(tool => tool.name)).toEqual(expect.arrayContaining([
      'browser_read_page',
      'browser_fill',
      'browser_scroll',
      'browser_wait_for',
      'browser_focus',
      'browser_press',
    ]))
    expect(browserTools?.map(tool => tool.name)).not.toContain('browser_type')

    expect({
      prompt: browserPrompt,
      tools: browserTools,
    }).toMatchSnapshot()
  })

  it('dispatches browser reads without an approval rejection in the shipped preset', async () => {
    const result = await scaffold.ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('browser-direct-read'),
      name: 'browser_read_page',
      arguments: {},
      agent: agentHandle.agent,
    })

    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: 'BROWSER_EXTENSION_UNAVAILABLE' } },
    })
  })
}, 120_000)
