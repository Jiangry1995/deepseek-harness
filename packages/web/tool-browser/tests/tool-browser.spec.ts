import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import BrowserService, {
  BrowserDocumentId,
  BrowserPageElementRef,
  BrowserPageId,
  type BrowserCommand,
  type BrowserOperation,
  type BrowserOperationResult,
  type BrowserPage,
  type BrowserTab,
} from '@deepseek-ai/dsh-browser'
import * as ToolBrowser from '../src/index.ts'
import type { Config } from '../src/index.ts'

const testSignal = new AbortController().signal
const pageId = BrowserPageId('11111111-1111-4111-8111-111111111111')
const documentId = BrowserDocumentId('22222222-2222-4222-8222-222222222222')

/** Build a stable tab result for tool execution and rendering assertions. */
function tab(id: number, active = false): BrowserTab {
  return { id, windowId: 2, active, url: `https://example.test/${String(id)}`, title: `Tab ${String(id)}` }
}

/** Create a complete page snapshot used by tool execution tests. */
function page(overrides: Partial<BrowserPage> = {}): BrowserPage {
  return {
    tab: tab(10, true),
    pageId,
    documentId,
    revision: 2,
    viewport: { width: 1024, height: 768, scrollX: 0, scrollY: 0, documentWidth: 1024, documentHeight: 2000 },
    text: 'Case details',
    fields: [{
      ref: BrowserPageElementRef('e1'),
      label: 'Name',
      type: 'text',
      value: 'Example',
      disabled: false,
      readOnly: false,
      required: false,
      inViewport: true,
      focused: true,
      options: [
        { value: 'top', label: '热门', selected: false, disabled: false },
        { value: 'live', label: '最新', selected: true, disabled: false },
      ],
    }],
    actions: [{
      ref: BrowserPageElementRef('e2'),
      role: 'button',
      label: 'Search',
      disabled: false,
      inViewport: true,
      focused: false,
      href: '/search',
      expanded: true,
    }, {
      ref: BrowserPageElementRef('e4'),
      role: 'button',
      label: '发送',
      rect: { x: 1184, y: 812, width: 32, height: 32 },
      accent: true,
      disabled: false,
      inViewport: true,
      focused: false,
    }],
    scrollTargets: [{
      ref: BrowserPageElementRef('e3'),
      label: 'Document',
      axis: 'vertical',
      top: 0,
      left: 0,
      maxTop: 1200,
      maxLeft: 0,
    }],
    truncated: false,
    ...overrides,
  }
}

/** Produce the extension result matching one emitted browser operation. */
function resultFor(operation: BrowserOperation): BrowserOperationResult {
  switch (operation.kind) {
    case 'open-tab': return { kind: 'open-tab', tab: tab(10, operation.active) }
    case 'list-tabs': return { kind: 'list-tabs', tabs: [tab(10, true), tab(11)] }
    case 'read-page': return { kind: 'read-page', page: page() }
    case 'click-page-element': return {
      kind: 'click-page-element',
      receipt: { pageId: operation.pageId, ref: operation.ref, action: 'clicked' },
    }
    case 'fill-page-element': return {
      kind: 'fill-page-element',
      receipt: { pageId: operation.pageId, ref: operation.ref, action: 'filled' },
    }
    case 'select-page-option': return {
      kind: 'select-page-option',
      receipt: { pageId: operation.pageId, ref: operation.ref, action: 'selected', value: 'live' },
    }
    case 'scroll-page': return {
      kind: 'scroll-page',
      receipt: {
        pageId: operation.pageId,
        ...(operation.ref === undefined ? {} : { ref: operation.ref }),
        movement: operation.movement,
        top: 80,
        left: 0,
        maxTop: 1200,
        maxLeft: 0,
        moved: true,
        atBoundary: false,
      },
    }
    case 'focus-page-element': return {
      kind: 'focus-page-element',
      receipt: { pageId: operation.pageId, ref: operation.ref, action: 'focused' },
    }
    case 'press-page-key': return {
      kind: 'press-page-key',
      receipt: { pageId: operation.pageId, ref: operation.ref, action: 'pressed', key: operation.key },
    }
    case 'wait-page': return { kind: 'wait-page', page: page({ revision: 4, text: 'Updated details' }) }
    case 'inspect-page': return {
      kind: 'inspect-page',
      inspect: {
        tab: tab(10, true),
        hooked: true,
        hookedAt: 1_700_000_000_000,
        network: [{
          at: 1_700_000_000_100,
          source: 'fetch',
          method: 'GET',
          url: 'https://example.test/api',
          status: 200,
          ok: true,
          durationMs: 18,
        }],
        console: [{ at: 1_700_000_000_200, level: 'error', text: 'submit failed' }],
        omittedNetwork: 0,
        omittedConsole: 0,
      },
    }
    case 'activate-tab': return { kind: 'activate-tab', tab: tab(operation.tabId, true) }
    case 'close-tab': return { kind: 'close-tab', tabId: operation.tabId, closed: true }
  }
}

/** Mount the real tool registry, browser service, and tool consumer. */
async function harness(config: Config = { requireApproval: false }) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(BrowserService)
  ctx.browser.connect('tool-test-client', true)
  const commands: BrowserCommand[] = []
  ctx.on('browser/command', (command) => {
    commands.push(command)
    ctx.browser.complete({
      requestId: command.requestId,
      clientId: command.clientId,
      response: { ok: true, value: resultFor(command.operation) },
    })
  })
  const fiber = await ctx.plugin(ToolBrowser, config)
  let callNumber = 0
  const call = (name: string, args: unknown): Promise<ToolExecutionResult> => ctx.tools.execute({
    signal: testSignal,
    callId: CallId(`browser-${String(++callNumber)}`),
    name,
    arguments: args,
  })
  return { ctx, commands, fiber, call }
}

describe('tool-browser registration and presentation', () => {
  it('registers browser tools with explicit generic call views', async () => {
    const { ctx } = await harness()
    expect(ctx.tools.schemas().map(schema => schema.name).sort()).toEqual([
      'browser_activate_tab',
      'browser_click',
      'browser_close_tab',
      'browser_fill',
      'browser_focus',
      'browser_inspect',
      'browser_list_tabs',
      'browser_open_tab',
      'browser_press',
      'browser_read_page',
      'browser_scroll',
      'browser_select',
      'browser_wait_for',
    ])

    expect(ctx.tools.get('browser_open_tab')?.presentCall?.({ url: 'https://example.test/' }))
      .toEqual({ card: 'generic', title: 'Open browser tab', kind: 'other', rawInput: 'https://example.test/' })
    expect(ctx.tools.get('browser_list_tabs')?.presentCall?.({}))
      .toEqual({ card: 'generic', title: 'List browser tabs', kind: 'read' })
    expect(ctx.tools.get('browser_read_page')?.presentCall?.({}))
      .toEqual({ card: 'generic', title: 'Read current page', kind: 'read' })
    expect(ctx.tools.get('browser_inspect')?.presentCall?.({ mode: 'start' }))
      .toEqual({ card: 'generic', title: 'Inspect page network and console', kind: 'read' })
    expect(ctx.tools.get('browser_fill')?.presentCall?.({ pageId, ref: 'e1', value: 'deepseek' }))
      .toEqual({ card: 'generic', title: 'Fill page field e1', kind: 'other' })
    expect(ctx.tools.get('browser_activate_tab')?.presentCall?.({ tabId: 7 }))
      .toEqual({ card: 'generic', title: 'Switch browser tab', kind: 'other', rawInput: 7 })
    expect(ctx.tools.get('browser_activate_tab')?.presentResult?.({ tabId: 7 }, {
      isError: false,
      content: [{ type: 'text', text: 'Tab 7 [active]: https://example.test/7 — 来信' }],
    })).toEqual({
      card: 'generic',
      title: 'Switched to 来信',
      content: [{ type: 'text', text: 'Tab 7 [active]: https://example.test/7 — 来信' }],
    })
    expect(ctx.tools.get('browser_open_tab')?.presentResult?.({ url: 'https://example.test/' }, {
      isError: false,
      content: [{ type: 'text', text: 'Tab 10 [active]: https://example.test/10 — Tab 10' }],
    })?.title).toBe('Opened Tab 10')
    expect(ctx.tools.get('browser_read_page')?.presentResult?.({}, {
      isError: false,
      content: [{ type: 'text', text: 'Current page: 来信\nURL: https://example.test/' }],
    })?.title).toBe('Current page: 来信')
    expect(ctx.tools.get('browser_close_tab')?.presentCall?.({ tabId: 7 }))
      .toEqual({ card: 'generic', title: 'Close browser tab', kind: 'other', rawInput: 7 })
  })

  it('routes browser work by execution environment instead of fixed phrases or topical matches', async () => {
    const { ctx } = await harness()
    const prompt = await ctx.systemPrompt.assemble()
    const text = prompt.sections.find(section => section.name === 'tool:browser')?.text
    expect(text).toContain("Treat the user's current Chromium window as an execution environment")
    expect(text).toContain('Infer whether the requested effect belongs in that environment')
    expect(text).toContain('Select browser tools from their schemas and the observed browser state')
    expect(text).toContain('not from fixed phrases or site-specific rules')
    expect(text).toContain('A shared topic, website, or data source is not a reason to divert the task to a skill')
    expect(text).toContain('For a request to find, read, navigate, or interact with website content')
    expect(text).toContain('the first task action must be an applicable browser tool')
    expect(text).toContain('do not load a skill first')
    expect(text).toContain('If the active page may contain or lead to the requested content, start with browser_read_page')
    expect(text).toContain('For every new user message that refers to the page currently beside the side assistant')
    expect(text).toContain('call browser_read_page without tabId before interpreting, answering, or asking for clarification')
    expect(text).toContain('Treat page snapshots in conversation history as historical observations')
    expect(text).toContain('A previous page read never establishes which page is current for a later user message')
    expect(text).toContain('Skill catalog descriptions are capability summaries, not routing instructions')
    expect(text).toContain('browser_read_page reads visible text')
    expect(text).toContain('including textarea and input values')
    expect(text).toContain('pageId and ref from the latest browser_read_page result')
    expect(text).toContain('Never invent refs')
    expect(text).toContain('then call browser_read_page again')
    expect(text).toContain('do not claim the body is unavailable')
    expect(text).toContain('never list, summarize, or mention unrelated tabs')
    expect(text).toContain('HTTP(S) pages are readable and operable by default')
    expect(text).toContain('first use browser_list_tabs or browser_read_page')
    expect(text).toContain('Native Chromium DevTools cannot be opened')
    expect(text).toContain('call browser_inspect with mode:start')
    expect(text).toContain('Always stop a capture after inspection')
    expect(text).toContain('it cannot operate browser chrome such as F12')
    expect(text).toContain('Do not call a skill, web search, or a fetch of the Harness page first')
    expect(text).toContain('Recommended loop: read the page, act with a returned ref, wait for the page to change, read again, and verify the actual result')
    expect(text).toContain('otherwise click the send control from the latest snapshot')
    expect(text).toContain('Do not invent documentId or afterRevision for kind:change')
    expect(text).toContain('do not silently switch to a skill')
    expect(text).not.toContain('百度')
    expect(text).not.toContain('政务系统')
    expect(text).not.toMatch(/open a search engine|visit a named website/i)
    expect(ctx.tools.get('browser_read_page')?.description).toContain('Every new current-page reference requires a fresh read')
  })

  it('attaches the configured timeout and removes registrations on disposal', async () => {
    const { ctx, fiber } = await harness({ requireApproval: false, timeoutMs: 1_234 })
    for (const name of [
      'browser_open_tab',
      'browser_list_tabs',
      'browser_read_page',
      'browser_inspect',
      'browser_click',
      'browser_fill',
      'browser_select',
      'browser_scroll',
      'browser_focus',
      'browser_press',
      'browser_activate_tab',
      'browser_close_tab',
    ]) {
      expect(ctx.tools.get(name)?.timeoutMs).toBe(1_234)
    }
    expect(ctx.tools.get('browser_wait_for')?.timeoutMs).toBe(32_000)
    await fiber.dispose()
    expect(ctx.tools.schemas().map(schema => schema.name)).toEqual([])
  })
})

describe('tool-browser execution and policy', () => {
  it('executes every operation through the browser service and renders stable output', async () => {
    const { ctx, commands, call } = await harness()
    const open = vi.spyOn(ctx.browser, 'openTab')

    const opened = await call('browser_open_tab', { url: 'https://example.test/', active: false })
    expect(open).toHaveBeenCalledWith({ url: 'https://example.test/', active: false }, testSignal)
    expect(opened).toMatchObject({ isError: false, value: tab(10, false) })
    expect(opened.content).toEqual([{ type: 'text', text: 'Tab 10: https://example.test/10 — Tab 10' }])

    const listed = await call('browser_list_tabs', {})
    expect(listed).toMatchObject({ isError: false, value: { tabs: [tab(10, true), tab(11)] } })
    const listedContent = listed.content[0]
    expect(listedContent?.type).toBe('text')
    if (listedContent?.type !== 'text') throw new Error('browser_list_tabs did not return text content')
    expect(listedContent.text).toContain('Tab 10 [active]')

    const read = await call('browser_read_page', {})
    expect(read).toMatchObject({
      isError: false,
      value: page(),
    })
    expect(read.content[0]).toMatchObject({ type: 'text' })
    if (read.content[0]?.type !== 'text') throw new Error('browser_read_page did not return text content')
    expect(read.content[0].text).toContain(`Page id: ${pageId}`)
    expect(read.content[0].text).toContain('Tab id: 10')
    expect(read.content[0].text).toContain(`Document id: ${documentId}`)
    expect(read.content[0].text).toContain('[focused]')
    expect(read.content[0].text).toContain('options: 热门=top; 最新=live [selected]')
    expect(read.content[0].text).toContain('href=/search')
    expect(read.content[0].text).toContain('expanded')
    expect(read.content[0].text).toContain('at 1184,812 32x32')
    expect(read.content[0].text).toContain('[accent]')
    expect(read.content[0].text).toContain('Scroll targets:')

    const specified = await call('browser_read_page', { tabId: 11 })
    expect(commands.at(-1)?.operation).toEqual({ kind: 'read-page', tabId: 11 })
    expect(specified).toMatchObject({ isError: false })

    const inspected = await call('browser_inspect', { tabId: 11, mode: 'stop' })
    expect(commands.at(-1)?.operation).toEqual({ kind: 'inspect-page', tabId: 11, mode: 'stop' })
    expect(inspected).toMatchObject({ isError: false, value: { hooked: true } })
    if (inspected.content[0]?.type !== 'text') throw new Error('browser_inspect did not return text content')
    expect(inspected.content[0].text).toContain('GET https://example.test/api -> 200')
    expect(inspected.content[0].text).toContain('error: submit failed')
    expect(inspected.content[0].text).toContain('Capture stopped')

    const clicked = await call('browser_click', { pageId, ref: 'e2' })
    expect(clicked).toMatchObject({ isError: false, value: { pageId, ref: 'e2', action: 'clicked' } })
    expect(clicked.content).toEqual([{ type: 'text', text: `clicked element e2 on page ${pageId}.` }])

    const filled = await call('browser_fill', { pageId, ref: 'e1', value: 'deepseek', submit: true })
    expect(filled).toMatchObject({ isError: false, value: { pageId, ref: 'e1', action: 'filled' } })
    expect(commands.at(-1)?.operation).toEqual({
      kind: 'fill-page-element', pageId, ref: 'e1', value: 'deepseek', submit: true,
    })

    const selected = await call('browser_select', { pageId, ref: 'e1', value: '最新' })
    expect(selected).toMatchObject({
      isError: false,
      value: { pageId, ref: 'e1', action: 'selected', value: 'live' },
    })

    const scrolled = await call('browser_scroll', { pageId, movement: 'page-down' })
    expect(scrolled).toMatchObject({ isError: false, value: { movement: 'page-down', moved: true } })
    expect(commands.at(-1)?.operation).toEqual({ kind: 'scroll-page', pageId, movement: 'page-down' })

    const focused = await call('browser_focus', { pageId, ref: 'e1' })
    expect(focused).toMatchObject({ isError: false, value: { action: 'focused' } })

    const pressed = await call('browser_press', { pageId, ref: 'e1', key: 'Enter' })
    expect(pressed).toMatchObject({ isError: false, value: { action: 'pressed', key: 'Enter' } })

    const waited = await call('browser_wait_for', {
      pageId,
      condition: { kind: 'change', documentId, afterRevision: 2 },
    })
    expect(waited).toMatchObject({ isError: false, value: { revision: 4, text: 'Updated details' } })
    expect(commands.at(-1)?.operation).toMatchObject({ kind: 'wait-page', pageId })

    const activated = await call('browser_activate_tab', { tabId: 11 })
    expect(activated).toMatchObject({ isError: false, value: tab(11, true) })

    const closed = await call('browser_close_tab', { tabId: 11 })
    expect(closed).toMatchObject({ isError: false, value: { tabId: 11, closed: true } })
    expect(closed.content).toEqual([{ type: 'text', text: 'Closed tab 11.' }])
  })

  it('asks for approval by default before dispatching browser operations', async () => {
    const { call, commands } = await harness({})
    const result = await call('browser_open_tab', { url: 'https://example.test/' })

    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: 'Error: Open a new browser tab.' }])
    expect(commands).toHaveLength(0)
  })

  it('describes the page content exposed by a read approval', async () => {
    const { call, commands } = await harness({})
    const result = await call('browser_read_page', {})

    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{
      type: 'text',
      text: 'Error: Read visible text and current non-secret form values from the active browser page.',
    }])
    expect(commands).toHaveLength(0)
  })

  it('describes page mutation effects when approval is enabled', async () => {
    const { call, commands } = await harness({})
    const result = await call('browser_fill', { pageId, ref: 'e1', value: 'deepseek' })

    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{
      type: 'text',
      text: 'Error: Replace text in one field on the active browser page.',
    }])
    expect(commands).toHaveLength(0)
  })

  it('delegates to a downstream denial without weakening it', async () => {
    const { ctx, call, commands } = await harness({ requireApproval: false })
    ctx.on('tools/pre-execute', async (_exec, _next) => ({ kind: 'deny', reason: 'deployment blocked browser access' }))

    const result = await call('browser_list_tabs', {})
    expect(result).toMatchObject({ isError: true, error: { message: 'deployment blocked browser access' } })
    expect(commands).toHaveLength(0)
  })
})
