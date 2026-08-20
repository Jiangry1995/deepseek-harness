import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import {
  BROWSER_EXTENSION_CHANNEL,
  BROWSER_EXTENSION_PROTOCOL_VERSION,
  BROWSER_PAGE_RESULT_MAX_BYTES,
  isBridgeLeaseWakeup,
  isBridgeOperation,
  isBridgeProbe,
  isBridgeReady,
  isBridgeRequest,
  isBridgeResponse,
  type BridgeRequest,
} from '../src/protocol.ts'
import {
  answerBridgeRequest,
  executeBridgeOperation,
  installBackground,
  rememberFocusedTab,
  resetBrowserRuntimeForTests,
} from '../src/extension/runtime.ts'

const pageId = '11111111-1111-4111-8111-111111111111'
const documentId = '22222222-2222-4222-8222-222222222222'

/** Create a protocol-valid page snapshot for adapter tests. */
function pageContent(overrides: Record<string, unknown> = {}) {
  return {
    pageId,
    documentId,
    revision: 1,
    viewport: { width: 800, height: 600, scrollX: 0, scrollY: 0, documentWidth: 800, documentHeight: 1200 },
    text: 'Current case details',
    fields: [{
      ref: 'e1',
      label: 'Name',
      type: 'text',
      value: 'Example',
      disabled: false,
      readOnly: false,
      required: false,
      inViewport: true,
      focused: false,
    }],
    actions: [{
      ref: 'e2',
      role: 'button',
      label: 'Search',
      disabled: false,
      inViewport: true,
      focused: false,
    }],
    scrollTargets: [],
    truncated: false,
    ...overrides,
  }
}

/** Build a validated bridge request with one operation. */
function request(operation: BridgeRequest['operation'], requestId = 'request-1'): BridgeRequest {
  return {
    channel: BROWSER_EXTENSION_CHANNEL,
    version: BROWSER_EXTENSION_PROTOCOL_VERSION,
    direction: 'request',
    requestId,
    operation,
  }
}

/** Create a programmable Chromium tabs API for adapter tests. */
function tabsApi() {
  return {
    create: vi.fn(),
    query: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    get: vi.fn(),
    sendMessage: vi.fn(),
  }
}

/** Create a programmable Chromium scripting API for page-read tests. */
function scriptingApi() {
  return { executeScript: vi.fn() }
}

afterEach(() => {
  resetBrowserRuntimeForTests()
})

/** Create a programmable Chromium runtime API for background-listener tests. */
function runtimeApi(id = 'extension-id') {
  let listener!: (
    message: unknown,
    sender: { id?: string; url?: string; origin?: string; tab?: { url?: string } },
    sendResponse: (response?: unknown) => void,
  ) => boolean
  return {
    api: {
      id,
      getURL: vi.fn((path: string) => `chrome-extension://${id}/${path}`),
      sendNativeMessage: vi.fn(),
      onMessage: {
        addListener: vi.fn((value: typeof listener) => { listener = value }),
        removeListener: vi.fn(),
      },
    },
    listener: () => listener,
  }
}

describe('browser extension protocol guards', () => {
  it('accepts every supported operation and rejects malformed fields', () => {
    expect(isBridgeOperation({ kind: 'open-tab', url: 'https://example.test/', active: true })).toBe(true)
    expect(isBridgeOperation({ kind: 'list-tabs' })).toBe(true)
    expect(isBridgeOperation({ kind: 'read-page' })).toBe(true)
    expect(isBridgeOperation({ kind: 'read-page', tabId: 9 })).toBe(true)
    expect(isBridgeOperation({ kind: 'scroll-page', pageId, movement: 'page-down' })).toBe(true)
    expect(isBridgeOperation({ kind: 'focus-page-element', pageId, ref: 'e1' })).toBe(true)
    expect(isBridgeOperation({
      kind: 'press-page-key', pageId, ref: 'e1', key: 'Enter', modifiers: {}, repeat: 1,
    })).toBe(true)
    expect(isBridgeOperation({
      kind: 'wait-page',
      pageId,
      condition: { kind: 'ready' },
      timeoutMs: 500,
      stableMs: 0,
    })).toBe(true)
    expect(isBridgeOperation({
      kind: 'wait-page',
      condition: { kind: 'ready' },
      timeoutMs: 500,
      stableMs: 0,
    })).toBe(false)
    expect(isBridgeOperation({ kind: 'wait-page', tabId: 9, condition: { kind: 'ready' }, timeoutMs: 50, stableMs: 0 })).toBe(false)
    expect(isBridgeOperation({ kind: 'press-page-key', pageId, ref: 'e1', key: 'a', modifiers: {}, repeat: 1 })).toBe(false)
    expect(isBridgeOperation({
      kind: 'press-page-key', pageId, ref: 'e1', key: 's', modifiers: { ctrl: true }, repeat: 1,
    })).toBe(true)
    expect(isBridgeOperation({ kind: 'press-page-key', pageId, ref: 'e1', key: 'F12', modifiers: {}, repeat: 1 })).toBe(false)
    expect(isBridgeOperation({ kind: 'inspect-page', reset: false })).toBe(true)
    expect(isBridgeOperation({ kind: 'inspect-page', tabId: 9, reset: true })).toBe(true)
    expect(isBridgeOperation({ kind: 'inspect-page' })).toBe(false)
    expect(isBridgeOperation({ kind: 'click-page-element', pageId, ref: 'e1' })).toBe(true)
    expect(isBridgeOperation({ kind: 'fill-page-element', pageId, ref: 'e1', value: 'deepseek', submit: true })).toBe(true)
    expect(isBridgeOperation({ kind: 'select-page-option', pageId, ref: 'e2', value: '最新' })).toBe(true)
    expect(isBridgeOperation({ kind: 'activate-tab', tabId: 1 })).toBe(true)
    expect(isBridgeOperation({ kind: 'close-tab', tabId: 1 })).toBe(true)
    expect(isBridgeOperation({ kind: 'activate-tab', tabId: -1 })).toBe(false)
    expect(isBridgeOperation({ kind: 'open-tab', url: 'https://example.test/' })).toBe(false)
    expect(isBridgeOperation({ kind: 'click-page-element', pageId: 'old-page', ref: 'e1' })).toBe(false)
    expect(isBridgeOperation({ kind: 'fill-page-element', pageId, ref: 'e1', value: 'x' })).toBe(false)
    expect(isBridgeOperation(null)).toBe(false)
  })

  it('validates protocol envelopes, versions, results, and errors', () => {
    const probe = { channel: BROWSER_EXTENSION_CHANNEL, version: BROWSER_EXTENSION_PROTOCOL_VERSION, direction: 'probe' }
    const ready = { channel: BROWSER_EXTENSION_CHANNEL, version: BROWSER_EXTENSION_PROTOCOL_VERSION, direction: 'ready' }
    expect(isBridgeProbe(probe)).toBe(true)
    expect(isBridgeReady(ready)).toBe(true)
    expect(isBridgeLeaseWakeup({
      channel: BROWSER_EXTENSION_CHANNEL,
      version: BROWSER_EXTENSION_PROTOCOL_VERSION,
      direction: 'lease-wakeup',
    })).toBe(true)
    expect(isBridgeLeaseWakeup(ready)).toBe(false)
    expect(isBridgeProbe({ ...probe, version: BROWSER_EXTENSION_PROTOCOL_VERSION + 1 })).toBe(false)
    expect(isBridgeRequest(request({ kind: 'list-tabs' }))).toBe(true)
    expect(isBridgeRequest({ ...request({ kind: 'list-tabs' }), requestId: '' })).toBe(false)

    expect(isBridgeResponse({
      channel: BROWSER_EXTENSION_CHANNEL,
      version: BROWSER_EXTENSION_PROTOCOL_VERSION,
      direction: 'response',
      requestId: 'r1',
      response: {
        ok: true,
        value: { kind: 'open-tab', tab: { id: 1, windowId: 2, active: true, url: 'https://example.test/' } },
      },
    })).toBe(true)
    expect(isBridgeResponse({
      channel: BROWSER_EXTENSION_CHANNEL,
      version: BROWSER_EXTENSION_PROTOCOL_VERSION,
      direction: 'response',
      requestId: 'r1',
      response: { ok: false, error: { code: 'BROWSER_TAB_NOT_FOUND', message: 'missing' } },
    })).toBe(true)
    expect(isBridgeResponse({
      channel: BROWSER_EXTENSION_CHANNEL,
      version: BROWSER_EXTENSION_PROTOCOL_VERSION,
      direction: 'response',
      requestId: 'r1',
      response: { ok: true, value: { kind: 'close-tab', tabId: -1, closed: true } },
    })).toBe(false)
    expect(isBridgeResponse({
      channel: BROWSER_EXTENSION_CHANNEL,
      version: BROWSER_EXTENSION_PROTOCOL_VERSION,
      direction: 'response',
      requestId: 'r1',
      response: { ok: false, error: { code: 'UNKNOWN', message: 'bad' } },
    })).toBe(false)
  })
})

describe('Chromium tabs adapter', () => {
  it('executes and normalizes all four tab operations', async () => {
    const tabs = tabsApi()
    tabs.create.mockResolvedValue({ id: 4, windowId: 2, active: false, pendingUrl: 'https://example.test/pending' })
    tabs.query.mockResolvedValue([
      { id: 4, windowId: 2, active: true, url: 'https://example.test/4', title: 'Four' },
      { windowId: 2, active: false, url: 'https://example.test/no-id' },
    ])
    tabs.update.mockResolvedValue({ id: 5, windowId: 2, active: true, url: 'https://example.test/5' })
    tabs.remove.mockResolvedValue(undefined)

    await expect(executeBridgeOperation(tabs as never, scriptingApi() as never, {
      kind: 'open-tab', url: 'https://example.test/path', active: false,
    })).resolves.toEqual({
      kind: 'open-tab',
      tab: { id: 4, windowId: 2, active: false, url: 'https://example.test/pending' },
    })
    expect(tabs.create).toHaveBeenCalledWith({ url: 'https://example.test/path', active: false })

    await expect(executeBridgeOperation(tabs as never, scriptingApi() as never, { kind: 'list-tabs' })).resolves.toEqual({
      kind: 'list-tabs',
      tabs: [{ id: 4, windowId: 2, active: true, url: 'https://example.test/4', title: 'Four' }],
    })
    expect(tabs.query).toHaveBeenCalledWith({ lastFocusedWindow: true })

    await expect(executeBridgeOperation(tabs as never, scriptingApi() as never, { kind: 'activate-tab', tabId: 5 })).resolves.toEqual({
      kind: 'activate-tab',
      tab: { id: 5, windowId: 2, active: true, url: 'https://example.test/5' },
    })
    expect(tabs.update).toHaveBeenCalledWith(5, { active: true })

    await expect(executeBridgeOperation(tabs as never, scriptingApi() as never, { kind: 'close-tab', tabId: 5 })).resolves.toEqual({
      kind: 'close-tab', tabId: 5, closed: true,
    })
    expect(tabs.remove).toHaveBeenCalledWith(5)
  })

  it('reads the active page through the injected page content script', async () => {
    const tabs = tabsApi()
    tabs.query.mockResolvedValue([{
      id: 9,
      windowId: 3,
      active: true,
      url: 'https://example.test/case',
      title: 'Case details',
    }])
    tabs.sendMessage.mockResolvedValue({
      ok: true,
      content: pageContent(),
    })

    await expect(executeBridgeOperation(tabs as never, scriptingApi() as never, { kind: 'read-page' }))
      .resolves.toEqual({
        kind: 'read-page',
        page: {
          tab: {
            id: 9,
            windowId: 3,
            active: true,
            url: 'https://example.test/case',
            title: 'Case details',
          },
          ...pageContent(),
        },
      })
    expect(tabs.query).toHaveBeenCalledWith({ active: true, lastFocusedWindow: true })
    expect(tabs.sendMessage).toHaveBeenCalledWith(9, { kind: 'dsh-read-page' })
  })

  it('reads the tab shown in the side-panel header instead of another window\'s active tab', async () => {
    rememberFocusedTab(12)
    const tabs = tabsApi()
    tabs.get.mockResolvedValue({
      id: 12,
      windowId: 3,
      active: true,
      url: 'https://example.test/case',
      title: '类案风险详情',
    })
    tabs.query.mockResolvedValue([{
      id: 99,
      windowId: 8,
      active: true,
      url: 'https://example.test/other',
      title: 'npm',
    }])
    tabs.sendMessage.mockResolvedValue({
      ok: true,
      content: pageContent({ text: '风险正文', fields: [], actions: [] }),
    })

    const result = await executeBridgeOperation(tabs, scriptingApi(), { kind: 'read-page' })
    if (result.kind !== 'read-page') throw new Error('read-page returned another result kind')
    expect(result.page.tab).toMatchObject({ id: 12, title: '类案风险详情' })
    expect(result.page.text).toBe('风险正文')
    expect(tabs.get).toHaveBeenCalledWith(12)
    expect(tabs.query).not.toHaveBeenCalled()
    expect(tabs.sendMessage).toHaveBeenCalledWith(12, { kind: 'dsh-read-page' })
  })

  it('bounds multibyte page content across the complete serialized result', async () => {
    const tabs = tabsApi()
    tabs.query.mockResolvedValue([{ id: 9, windowId: 3, active: true }])
    tabs.sendMessage.mockResolvedValue({
      ok: true,
      content: pageContent({
        text: '页'.repeat(30_000),
        fields: Array.from({ length: 80 }, (_, index) => ({
          ref: `e${String(index + 1)}`,
          label: `字段${String(index)}`,
          type: 'text',
          value: '值'.repeat(500),
          disabled: false,
          readOnly: false,
          required: false,
          inViewport: true,
          focused: false,
        })),
        actions: Array.from({ length: 120 }, (_, index) => ({
          ref: `e${String(index + 81)}`,
          role: 'button',
          label: `操作${String(index)}`,
          disabled: false,
          inViewport: true,
          focused: false,
        })),
        scrollTargets: [],
        truncated: false,
      }),
    })

    const result = await executeBridgeOperation(tabs, scriptingApi(), { kind: 'read-page' })
    if (result.kind !== 'read-page') throw new Error('read-page returned another result kind')
    expect(new TextEncoder().encode(JSON.stringify(result.page)).byteLength)
      .toBeLessThanOrEqual(BROWSER_PAGE_RESULT_MAX_BYTES)
    expect(result.page.text.length).toBeGreaterThan(0)
    expect(result.page.fields.length).toBeGreaterThan(0)
    expect(result.page.actions.length).toBeGreaterThan(0)
    expect(result.page.truncated).toBe(true)
  })

  it('injects the reader into tabs opened before this extension generation', async () => {
    const tabs = tabsApi()
    const scripting = scriptingApi()
    tabs.query.mockResolvedValue([{ id: 9, windowId: 3, active: true, url: 'https://example.test/case' }])
    tabs.sendMessage
      .mockRejectedValueOnce(new Error('Could not establish connection. Receiving end does not exist.'))
      .mockResolvedValueOnce({ ok: true, content: pageContent({ text: '页面正文', fields: [], actions: [] }) })
    scripting.executeScript.mockResolvedValue([{ frameId: 0, result: undefined }])

    const result = await executeBridgeOperation(tabs, scripting, { kind: 'read-page' })
    if (result.kind !== 'read-page') throw new Error('read-page returned another result kind')
    expect(result.page.text).toBe('页面正文')
    expect(scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 9 },
      files: ['page-content.js'],
    })
    expect(tabs.sendMessage).toHaveBeenCalledTimes(2)
  })

  it('replaces an incompatible reader left by an older extension generation', async () => {
    const tabs = tabsApi()
    const scripting = scriptingApi()
    tabs.query.mockResolvedValue([{ id: 9, windowId: 3, active: true, url: 'https://example.test/case' }])
    tabs.sendMessage
      .mockResolvedValueOnce({ ok: true, content: { text: '旧协议页面', fields: [], truncated: false } })
      .mockResolvedValueOnce({
        ok: true,
        content: pageContent({ text: '新协议页面', fields: [], actions: [] }),
      })
    scripting.executeScript.mockResolvedValue([{ frameId: 0, result: undefined }])

    const result = await executeBridgeOperation(tabs, scripting, { kind: 'read-page' })

    if (result.kind !== 'read-page') throw new Error('read-page returned another result kind')
    expect(result.page.text).toBe('新协议页面')
    expect(scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 9 },
      files: ['page-content.js'],
    })
    expect(tabs.sendMessage).toHaveBeenCalledTimes(2)
  })

  it('routes click, fill, and select through the same focused page content script', async () => {
    rememberFocusedTab(12)
    const tabs = tabsApi()
    tabs.get.mockResolvedValue({ id: 12, windowId: 3, active: true, url: 'https://example.test/search' })
    tabs.sendMessage
      .mockResolvedValueOnce({ ok: true, receipt: { pageId, ref: 'e2', action: 'clicked' } })
      .mockResolvedValueOnce({ ok: true, receipt: { pageId, ref: 'e1', action: 'filled' } })
      .mockResolvedValueOnce({ ok: true, receipt: { pageId, ref: 'e3', action: 'selected', value: 'live' } })

    await expect(executeBridgeOperation(tabs as never, scriptingApi() as never, {
      kind: 'click-page-element', pageId, ref: 'e2',
    })).resolves.toEqual({ kind: 'click-page-element', receipt: { pageId, ref: 'e2', action: 'clicked' } })
    await expect(executeBridgeOperation(tabs as never, scriptingApi() as never, {
      kind: 'fill-page-element', pageId, ref: 'e1', value: 'deepseek', submit: true,
    })).resolves.toEqual({ kind: 'fill-page-element', receipt: { pageId, ref: 'e1', action: 'filled' } })
    await expect(executeBridgeOperation(tabs as never, scriptingApi() as never, {
      kind: 'select-page-option', pageId, ref: 'e3', value: '最新',
    })).resolves.toEqual({
      kind: 'select-page-option',
      receipt: { pageId, ref: 'e3', action: 'selected', value: 'live' },
    })
    expect(tabs.sendMessage).toHaveBeenNthCalledWith(1, 12, {
      kind: 'dsh-act-page',
      operation: { kind: 'click-page-element', pageId, ref: 'e2' },
    })
    expect(tabs.sendMessage).toHaveBeenNthCalledWith(2, 12, {
      kind: 'dsh-act-page',
      operation: { kind: 'fill-page-element', pageId, ref: 'e1', value: 'deepseek', submit: true },
    })
  })

  it('inspects recent page network and console observations from the focused tab', async () => {
    rememberFocusedTab(12)
    const tabs = tabsApi()
    tabs.get.mockResolvedValue({ id: 12, windowId: 3, active: true, url: 'https://example.test/search' })
    tabs.sendMessage.mockResolvedValueOnce({
      ok: true,
      content: {
        hooked: true,
        hookedAt: 1_700_000_000_000,
        network: [{
          at: 1_700_000_000_100,
          source: 'fetch',
          method: 'GET',
          url: 'https://example.test/api',
          status: 200,
          ok: true,
          durationMs: 12,
        }],
        console: [{ at: 1_700_000_000_200, level: 'error', text: 'submit failed' }],
        omittedNetwork: 0,
        omittedConsole: 0,
      },
    })

    await expect(executeBridgeOperation(tabs as never, scriptingApi() as never, {
      kind: 'inspect-page',
      reset: false,
    })).resolves.toMatchObject({
      kind: 'inspect-page',
      inspect: {
        tab: { id: 12 },
        hooked: true,
        network: [{ method: 'GET', url: 'https://example.test/api', status: 200 }],
        console: [{ level: 'error', text: 'submit failed' }],
      },
    })
    expect(tabs.sendMessage).toHaveBeenCalledWith(12, { kind: 'dsh-inspect-page', reset: false })
  })

  it('reads a specified tab without activating it and waits for page changes', async () => {
    const tabs = tabsApi()
    tabs.get.mockResolvedValue({
      id: 44,
      windowId: 3,
      active: false,
      url: 'https://example.test/other',
      title: 'Other',
    })
    tabs.sendMessage
      .mockResolvedValueOnce({ ok: true, content: pageContent({ text: '指定页签' }) })
      .mockResolvedValueOnce({ ok: true, content: pageContent({ text: '已变化', revision: 5 }) })

    await expect(executeBridgeOperation(tabs as never, scriptingApi() as never, { kind: 'read-page', tabId: 44 }))
      .resolves.toMatchObject({ kind: 'read-page', page: { tab: { id: 44 }, text: '指定页签' } })
    expect(tabs.get).toHaveBeenCalledWith(44)
    expect(tabs.query).not.toHaveBeenCalled()

    rememberFocusedTab(12)
    await expect(executeBridgeOperation(tabs as never, scriptingApi() as never, {
      kind: 'wait-page',
      pageId,
      condition: { kind: 'text', text: '已变化', state: 'present' },
      timeoutMs: 500,
      stableMs: 0,
    })).resolves.toMatchObject({ kind: 'wait-page', page: { text: '已变化', revision: 5 } })
    expect(tabs.sendMessage).toHaveBeenNthCalledWith(2, 44, {
      kind: 'dsh-wait-page',
      operation: { condition: { kind: 'text', text: '已变化', state: 'present' }, timeoutMs: 500, stableMs: 0 },
    })
  })

  it('waits on the focused tab when a pageId binding is missing after a Service Worker restart', async () => {
    const tabs = tabsApi()
    tabs.get.mockResolvedValue({
      id: 12,
      windowId: 3,
      active: true,
      url: 'https://example.test/12',
      title: 'Current',
    })
    tabs.sendMessage.mockResolvedValue({ ok: true, content: pageContent({ text: '稳定' }) })
    rememberFocusedTab(12)

    await expect(executeBridgeOperation(tabs as never, scriptingApi() as never, {
      kind: 'wait-page',
      pageId,
      condition: { kind: 'ready' },
      timeoutMs: 500,
      stableMs: 0,
    })).resolves.toMatchObject({ kind: 'wait-page', page: { text: '稳定' } })
    expect(tabs.sendMessage).toHaveBeenCalledWith(12, {
      kind: 'dsh-wait-page',
      operation: { condition: { kind: 'ready' }, timeoutMs: 500, stableMs: 0 },
    })
  })

  it('keeps wait-page stale when a retained pageId conflicts with an explicit tabId', async () => {
    const tabs = tabsApi()
    tabs.get.mockImplementation(async (tabId: number) => ({
      id: tabId,
      windowId: 3,
      active: tabId === 12,
      url: `https://example.test/${String(tabId)}`,
    }))
    tabs.sendMessage.mockResolvedValue({ ok: true, content: pageContent({ text: 'Tab 44' }) })

    await executeBridgeOperation(tabs as never, scriptingApi() as never, { kind: 'read-page', tabId: 44 })
    await expect(answerBridgeRequest(tabs as never, scriptingApi() as never, request({
      kind: 'wait-page',
      pageId,
      tabId: 12,
      condition: { kind: 'ready' },
      timeoutMs: 500,
      stableMs: 0,
    }))).resolves.toEqual({
      ok: false,
      error: {
        code: 'BROWSER_PAGE_STALE',
        message: 'browser extension: page snapshot belongs to another tab; read the page again',
      },
    })
  })

  it('keeps document-bound actions on the tab that produced the page id', async () => {
    const tabs = tabsApi()
    tabs.get.mockImplementation(async (tabId: number) => ({
      id: tabId,
      windowId: 3,
      active: tabId === 12,
      url: `https://example.test/${String(tabId)}`,
    }))
    tabs.sendMessage
      .mockResolvedValueOnce({ ok: true, content: pageContent({ text: 'Tab 44' }) })
      .mockResolvedValueOnce({ ok: true, receipt: { pageId, ref: 'e2', action: 'clicked' } })

    await executeBridgeOperation(tabs as never, scriptingApi() as never, { kind: 'read-page', tabId: 44 })
    rememberFocusedTab(12)
    await executeBridgeOperation(tabs as never, scriptingApi() as never, {
      kind: 'click-page-element', pageId, ref: 'e2',
    })

    expect(tabs.sendMessage).toHaveBeenLastCalledWith(44, {
      kind: 'dsh-act-page',
      operation: { kind: 'click-page-element', pageId, ref: 'e2' },
    })
  })

  it('preserves stale element failures from the in-page actor', async () => {
    const tabs = tabsApi()
    tabs.query.mockResolvedValue([{ id: 9, windowId: 3, active: true }])
    tabs.sendMessage.mockResolvedValue({
      ok: false,
      error: { code: 'BROWSER_PAGE_STALE', message: 'read the page again' },
    })

    await expect(answerBridgeRequest(tabs as never, scriptingApi() as never, request({
      kind: 'click-page-element', pageId, ref: 'e1',
    }))).resolves.toEqual({
      ok: false,
      error: { code: 'BROWSER_PAGE_STALE', message: 'read the page again' },
    })
  })

  it('maps an unscriptable page to an actionable page-access error', async () => {
    const tabs = tabsApi()
    const scripting = scriptingApi()
    tabs.query.mockResolvedValue([{ id: 9, windowId: 3, active: true }])
    tabs.sendMessage.mockRejectedValue(new Error('Could not establish connection. Receiving end does not exist.'))
    scripting.executeScript.mockRejectedValue(new Error('Cannot access contents of the page'))

    await expect(answerBridgeRequest(tabs as never, scripting as never, request({ kind: 'read-page' })))
      .resolves.toEqual({
        ok: false,
        error: {
          code: 'BROWSER_PAGE_ACCESS_DENIED',
          message: 'browser extension: this page cannot be read by extensions; open a normal http(s) page, then retry',
        },
      })
  })

  it('answers well before the Host request timeout when the page script hangs', async () => {
    vi.useFakeTimers()
    try {
      const tabs = tabsApi()
      tabs.query.mockResolvedValue([{ id: 9, windowId: 3, active: true }])
      tabs.sendMessage.mockReturnValue(new Promise(() => {}))
      const pending = answerBridgeRequest(tabs, scriptingApi(), request({ kind: 'read-page' }))
      await vi.advanceTimersByTimeAsync(5_000)
      await expect(pending).resolves.toMatchObject({
        ok: false,
        error: { code: 'BROWSER_API_FAILED', message: 'browser extension: page reader did not answer before timeout' },
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects invalid page requests with BROWSER_INVALID_REQUEST', async () => {
    const response = await answerBridgeRequest(tabsApi(), scriptingApi(), request({
      kind: 'open-tab', url: 'file:///tmp/private', active: true,
    }))
    expect(response).toEqual({
      ok: false,
      error: {
        code: 'BROWSER_INVALID_REQUEST',
        message: 'browser extension: only credential-free HTTP(S) URLs are allowed',
      },
    })
  })

  it('maps missing tabs separately from browser API failures', async () => {
    const missing = tabsApi()
    missing.update.mockRejectedValue(new Error('No tab with id: 99'))
    await expect(answerBridgeRequest(missing as never, scriptingApi() as never, request({ kind: 'activate-tab', tabId: 99 })))
      .resolves.toMatchObject({ ok: false, error: { code: 'BROWSER_TAB_NOT_FOUND' } })

    const invalidResult = tabsApi()
    invalidResult.update.mockResolvedValue(undefined)
    await expect(answerBridgeRequest(invalidResult as never, scriptingApi() as never, request({ kind: 'activate-tab', tabId: 2 })))
      .resolves.toMatchObject({ ok: false, error: { code: 'BROWSER_API_FAILED' } })
  })
})

describe('MV3 background listener', () => {
  it('configures the toolbar action to open the browser side panel', async () => {
    const runtime = runtimeApi().api
    const sidePanel = { setPanelBehavior: vi.fn().mockResolvedValue(undefined) }

    installBackground(runtime, tabsApi(), scriptingApi(), sidePanel)

    await vi.waitFor(() => {
      expect(sidePanel.setPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: true })
    })
  })

  it('accepts only this extension from a loopback page and removes its listener', async () => {
    const runtime = runtimeApi()
    const tabs = tabsApi()
    tabs.query.mockResolvedValue([])
    const sidePanel = { setPanelBehavior: vi.fn().mockResolvedValue(undefined) }
    const dispose = installBackground(runtime.api, tabs, scriptingApi(), sidePanel)
    const sendResponse = vi.fn()
    const listener = runtime.listener()

    expect(listener(request({ kind: 'list-tabs' }), { id: 'other', url: 'http://127.0.0.1:3080/' }, sendResponse)).toBe(false)
    expect(listener(request({ kind: 'list-tabs' }), { id: 'extension-id', url: 'https://example.test/' }, sendResponse)).toBe(false)
    expect(listener(request({ kind: 'list-tabs' }), { id: 'extension-id', origin: 'http://127.0.0.1:3080' }, sendResponse)).toBe(true)
    expect(listener(request({ kind: 'list-tabs' }), {
      id: 'extension-id',
      url: 'chrome-extension://extension-id/sidepanel.html',
    }, sendResponse)).toBe(true)
    expect(listener(request({ kind: 'list-tabs' }), { id: 'extension-id', url: 'http://localhost:3080/' }, sendResponse)).toBe(true)
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ ok: true, value: { kind: 'list-tabs', tabs: [] } })
    })

    dispose()
    expect(runtime.api.onMessage.removeListener).toHaveBeenCalledWith(listener)
  })

  it('lets only the extension side panel request the closed native startup operation', async () => {
    const runtime = runtimeApi()
    runtime.api.sendNativeMessage.mockResolvedValue({
      ok: true,
      state: 'started',
      origin: 'http://127.0.0.1:3080',
    })
    installBackground(runtime.api, tabsApi(), scriptingApi(), { setPanelBehavior: vi.fn().mockResolvedValue(undefined) })
    const listener = runtime.listener()
    const sendResponse = vi.fn()
    const request = { kind: 'ensure-local-harness', origin: 'http://127.0.0.1:3080' }

    expect(listener(request, {
      id: 'extension-id',
      url: 'chrome-extension://extension-id/sidepanel.html',
    }, sendResponse)).toBe(true)
    await vi.waitFor(() => {
      expect(runtime.api.sendNativeMessage).toHaveBeenCalledWith(
        'com.deepseek.dsh_browser_companion',
        { kind: 'ensure-web', origin: 'http://127.0.0.1:3080' },
      )
      expect(sendResponse).toHaveBeenCalledWith({
        ok: true,
        state: 'started',
        origin: 'http://127.0.0.1:3080',
      })
    })

    expect(listener(request, {
      id: 'extension-id',
      url: 'http://127.0.0.1:3080/',
    }, vi.fn())).toBe(false)
    expect(listener({ ...request, origin: 'http://example.test:3080' }, {
      id: 'extension-id',
      url: 'chrome-extension://extension-id/sidepanel.html',
    }, vi.fn())).toBe(true)
    await vi.waitFor(() => {
      expect(runtime.api.sendNativeMessage).toHaveBeenCalledTimes(1)
    })
  })
})

describe('MV3 extension manifest', () => {
  it('ships unpacked scripts on the current page-bridge protocol version', async () => {
    const content = await readFile(new URL('../extension/content.js', import.meta.url), 'utf8')
    const pageContent = await readFile(new URL('../extension/page-content.js', import.meta.url), 'utf8')
    const background = await readFile(new URL('../extension/background.js', import.meta.url), 'utf8')
    const versionNeedle = `value.version === ${BROWSER_EXTENSION_PROTOCOL_VERSION}`
    expect(content).toContain(versionNeedle)
    expect(content).toContain('read-page')
    expect(pageContent).toContain('dsh-read-page')
    expect(pageContent).toContain('dsh-act-page')
    expect(pageContent).toContain('dsh-wait-page')
    expect(pageContent).toContain('dsh-inspect-page')
    const pageProbe = await readFile(new URL('../extension/page-probe.js', import.meta.url), 'utf8')
    expect(pageProbe).toContain('dsh-page-probe-request')
    expect(background).toContain(versionNeedle)
    expect(background).toContain('read-page')
    expect(background).toContain('inspect-page')
    expect(background).toContain('dsh-read-page')
    expect(background).toContain('dsh-inspect-page')
    expect(background).toContain('dsh-act-page')
    expect(background).toContain('wait-page')
  })

  it('publishes the local Harness side panel and injects the bridge into its frame', async () => {
    const manifest = JSON.parse(await readFile(
      new URL('../extension/manifest.json', import.meta.url),
      'utf8',
    )) as Record<string, unknown>

    expect(manifest).toMatchObject({
      permissions: ['tabs', 'sidePanel', 'storage', 'nativeMessaging', 'activeTab', 'scripting'],
      host_permissions: ['http://*/*', 'https://*/*'],
      action: { default_title: 'Open DeepSeek Harness' },
      side_panel: { default_path: 'sidepanel.html' },
      content_scripts: [{
        matches: ['http://127.0.0.1/*', 'http://localhost/*'],
        js: ['content.js'],
        run_at: 'document_start',
        all_frames: true,
      }, {
        matches: ['http://*/*', 'https://*/*'],
        js: ['page-probe.js'],
        run_at: 'document_start',
        all_frames: false,
        world: 'MAIN',
      }, {
        matches: ['http://*/*', 'https://*/*'],
        js: ['page-content.js'],
        run_at: 'document_idle',
        all_frames: false,
      }],
    })
    expect(manifest.key).toEqual(expect.any(String))
  })
})
