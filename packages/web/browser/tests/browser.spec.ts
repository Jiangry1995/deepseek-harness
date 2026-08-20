import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import BrowserService, {
  BrowserClientId,
  BrowserDocumentId,
  BrowserPageElementRef,
  BrowserPageId,
  type BrowserCommand,
  type BrowserPage,
  type BrowserTab,
  type BrowserWaitCondition,
} from '../src/index.ts'

const signal = new AbortController().signal
const pageId = BrowserPageId('11111111-1111-4111-8111-111111111111')
const documentId = BrowserDocumentId('22222222-2222-4222-8222-222222222222')

/** Create a representative normalized browser tab. */
function tab(id: number, active = false): BrowserTab {
  return { id, windowId: 1, active, url: `https://example.test/${String(id)}`, title: `Tab ${String(id)}` }
}

/** Create a complete page snapshot used by Host routing tests. */
function page(overrides: Partial<BrowserPage> = {}): BrowserPage {
  return {
    tab: tab(12, true),
    pageId,
    documentId,
    revision: 3,
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
      focused: false,
    }],
    actions: [{
      ref: BrowserPageElementRef('e2'),
      role: 'button',
      label: 'Search',
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

/** Mount the browser service and record commands emitted to extension providers. */
async function harness(config: ConstructorParameters<typeof BrowserService>[1] = {}) {
  const ctx = new Context()
  const commands: BrowserCommand[] = []
  ctx.on('browser/command', (command) => { commands.push(command) })
  const fiber = ctx.plugin(BrowserService, config)
  await fiber.await()
  return { ctx, commands, fiber }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('BrowserService provider routing', () => {
  it('routes to the newest provider and returns its matching result', async () => {
    const { ctx, commands } = await harness({ requestTimeoutMs: 1_000, clientLeaseMs: 2_000 })
    ctx.browser.connect('first-client', true)
    const lease = ctx.browser.connect('newest-client', true)

    const pending = ctx.browser.listTabs(signal)
    expect(commands).toHaveLength(1)
    expect(commands[0]).toMatchObject({ clientId: lease.clientId, operation: { kind: 'list-tabs' } })

    const receipt = ctx.browser.complete({
      requestId: commands[0]!.requestId,
      clientId: commands[0]!.clientId,
      response: { ok: true, value: { kind: 'list-tabs', tabs: [tab(7, true)] } },
    })
    expect(receipt).toEqual({ accepted: true })
    await expect(pending).resolves.toEqual([tab(7, true)])
  })

  it('prefers a visible provider over a hidden one that registered later', async () => {
    const { ctx, commands } = await harness()
    const panel = ctx.browser.connect('side-panel-client', true)
    ctx.browser.connect('background-tab-client', false)

    const pending = ctx.browser.listTabs(signal)
    expect(commands[0]).toMatchObject({ clientId: panel.clientId })

    ctx.browser.complete({
      requestId: commands[0]!.requestId,
      clientId: panel.clientId,
      response: { ok: true, value: { kind: 'list-tabs', tabs: [tab(2, true)] } },
    })
    await expect(pending).resolves.toEqual([tab(2, true)])
  })

  it('follows visibility reported at heartbeat and falls back to the newest hidden provider', async () => {
    const { ctx, commands } = await harness()
    const panel = ctx.browser.connect('panel-client', true)
    const background = ctx.browser.connect('tab-client', false)

    ctx.browser.heartbeat(panel.clientId, false)
    ctx.browser.heartbeat(background.clientId, true)
    const shown = ctx.browser.listTabs(signal)
    expect(commands[0]).toMatchObject({ clientId: background.clientId })

    ctx.browser.heartbeat(background.clientId, false)
    const hidden = ctx.browser.listTabs(signal)
    expect(commands[1]).toMatchObject({ clientId: background.clientId })

    ctx.browser.disconnect(panel.clientId)
    ctx.browser.disconnect(background.clientId)
    await expect(shown).rejects.toMatchObject({ code: 'BROWSER_CLIENT_DISCONNECTED' })
    await expect(hidden).rejects.toMatchObject({ code: 'BROWSER_CLIENT_DISCONNECTED' })
  })

  it('advertises a lease long enough to survive Chromium iframe timer throttling', async () => {
    const { ctx } = await harness()
    expect(ctx.browser.connect('lease-client', true).leaseMs).toBe(300_000)
  })

  it('renews a connected lease and rejects an unknown client heartbeat', async () => {
    const { ctx } = await harness({ requestTimeoutMs: 321, clientLeaseMs: 654 })
    const lease = ctx.browser.connect('lease-client', true)

    expect(ctx.browser.heartbeat(lease.clientId, true)).toEqual({
      clientId: lease.clientId,
      leaseMs: 654,
      requestTimeoutMs: 321,
    })
    expect(() => ctx.browser.heartbeat(BrowserClientId('missing-client'), true))
      .toThrow(expect.objectContaining({ code: 'BROWSER_CLIENT_NOT_CONNECTED' }))
  })

  it('rejects a pending request when its provider disconnects', async () => {
    const { ctx } = await harness()
    const lease = ctx.browser.connect('disconnect-client', true)
    const pending = ctx.browser.listTabs(signal)

    expect(ctx.browser.disconnect(lease.clientId)).toEqual({ disconnected: true })
    expect(ctx.browser.disconnect(lease.clientId)).toEqual({ disconnected: false })
    await expect(pending).rejects.toMatchObject({ code: 'BROWSER_CLIENT_DISCONNECTED' })
  })

  it('expires stale providers and settles their pending work', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-14T00:00:00Z'))
    const { ctx } = await harness({ clientLeaseMs: 100, requestTimeoutMs: 1_000 })
    ctx.browser.connect('expiring-client', true)
    const pending = ctx.browser.listTabs(signal)

    vi.advanceTimersByTime(101)
    await expect(ctx.browser.listTabs(signal)).rejects.toMatchObject({ code: 'BROWSER_EXTENSION_UNAVAILABLE' })
    await expect(pending).rejects.toMatchObject({ code: 'BROWSER_CLIENT_DISCONNECTED' })
  })
})

describe('BrowserService operation lifecycle', () => {
  it('resolves and validates open-tab defaults before dispatch', async () => {
    const { ctx, commands } = await harness()
    ctx.browser.connect('open-client', true)
    const expected = tab(3, true)

    const pending = ctx.browser.openTab({ url: 'https://example.test/path' }, signal)
    expect(commands[0]?.operation).toEqual({
      kind: 'open-tab',
      url: 'https://example.test/path',
      active: true,
    })
    ctx.browser.complete({
      requestId: commands[0]!.requestId,
      clientId: commands[0]!.clientId,
      response: { ok: true, value: { kind: 'open-tab', tab: expected } },
    })
    await expect(pending).resolves.toEqual(expected)

    expect(() => ctx.browser.resolveOpenTab({ url: 'file:///tmp/a' }))
      .toThrow(expect.objectContaining({ code: 'BROWSER_INVALID_URL' }))
    expect(() => ctx.browser.resolveOpenTab({ url: 'https://user:secret@example.test/' }))
      .toThrow(expect.objectContaining({ code: 'BROWSER_INVALID_URL' }))
    expect(() => ctx.browser.resolveOpenTab({ url: 'not a URL' }))
      .toThrow(expect.objectContaining({ code: 'BROWSER_INVALID_URL' }))
  })

  it('routes a current-page read and returns its visible text and form values', async () => {
    const { ctx, commands } = await harness()
    const lease = ctx.browser.connect('page-reader', true)
    const pending = ctx.browser.readPage(signal)

    expect(commands[0]?.operation).toEqual({ kind: 'read-page' })
    ctx.browser.complete({
      requestId: commands[0]!.requestId,
      clientId: lease.clientId,
      response: {
        ok: true,
        value: { kind: 'read-page', page: page() },
      },
    })

    await expect(pending).resolves.toEqual(page())
  })

  it('reads a specified tab without first activating it', async () => {
    const { ctx, commands } = await harness()
    const lease = ctx.browser.connect('page-reader', true)
    const snapshot = page({ tab: tab(44, false) })
    const pending = ctx.browser.readPage({ tabId: 44 }, signal)

    expect(commands[0]?.operation).toEqual({ kind: 'read-page', tabId: 44 })
    ctx.browser.complete({
      requestId: commands[0]!.requestId,
      clientId: lease.clientId,
      response: { ok: true, value: { kind: 'read-page', page: snapshot } },
    })
    await expect(pending).resolves.toEqual(snapshot)
    await expect(ctx.browser.readPage({ tabId: -1 }, signal))
      .rejects.toMatchObject({ code: 'BROWSER_INVALID_TAB_ID' })
  })

  it('routes inspect-page and returns the matching Network/Console snapshot', async () => {
    const { ctx, commands } = await harness()
    const lease = ctx.browser.connect('inspect-client', true)
    const pending = ctx.browser.inspectPage({ tabId: 12, reset: true }, signal)
    expect(commands[0]?.operation).toEqual({ kind: 'inspect-page', tabId: 12, reset: true })
    ctx.browser.complete({
      requestId: commands[0]!.requestId,
      clientId: lease.clientId,
      response: {
        ok: true,
        value: {
          kind: 'inspect-page',
          inspect: {
            tab: tab(12, true),
            hooked: true,
            hookedAt: 1,
            network: [{
              at: 2, source: 'fetch', method: 'POST', url: 'https://example.test/save', status: 200, ok: true, durationMs: 9,
            }],
            console: [],
            omittedNetwork: 0,
            omittedConsole: 0,
          },
        },
      },
    })
    await expect(pending).resolves.toMatchObject({
      hooked: true,
      network: [{ method: 'POST', url: 'https://example.test/save', status: 200 }],
    })
  })

  it('routes document-bound click, fill, and select operations with resolved defaults', async () => {
    const { ctx, commands } = await harness()
    const lease = ctx.browser.connect('page-actor', true)
    const target = ctx.browser.resolvePageTarget(pageId, 'e1')

    const click = ctx.browser.clickPage(target, signal)
    expect(commands[0]?.operation).toEqual({ kind: 'click-page-element', pageId, ref: 'e1' })
    ctx.browser.complete({
      requestId: commands[0]!.requestId,
      clientId: lease.clientId,
      response: { ok: true, value: { kind: 'click-page-element', receipt: { ...target, action: 'clicked' } } },
    })
    await expect(click).resolves.toEqual({ ...target, action: 'clicked' })

    const fill = ctx.browser.fillPage({ ...target, value: 'deepseek' }, signal)
    expect(commands[1]?.operation).toEqual({
      kind: 'fill-page-element', pageId, ref: 'e1', value: 'deepseek', submit: false,
    })
    ctx.browser.complete({
      requestId: commands[1]!.requestId,
      clientId: lease.clientId,
      response: { ok: true, value: { kind: 'fill-page-element', receipt: { ...target, action: 'filled' } } },
    })
    await expect(fill).resolves.toEqual({ ...target, action: 'filled' })

    const select = ctx.browser.selectPage({ ...target, value: '最新' }, signal)
    expect(commands[2]?.operation).toEqual({ kind: 'select-page-option', pageId, ref: 'e1', value: '最新' })
    ctx.browser.complete({
      requestId: commands[2]!.requestId,
      clientId: lease.clientId,
      response: {
        ok: true,
        value: { kind: 'select-page-option', receipt: { ...target, action: 'selected', value: 'live' } },
      },
    })
    await expect(select).resolves.toEqual({ ...target, action: 'selected', value: 'live' })
  })

  it('routes scroll, focus, press, and wait operations and maps their errors', async () => {
    const { ctx, commands } = await harness({ requestTimeoutMs: 200 })
    const lease = ctx.browser.connect('page-actor', true)
    const target = ctx.browser.resolvePageTarget(pageId, 'e1')

    const scrolled = ctx.browser.scrollPage({ pageId, movement: 'page-down' }, signal)
    expect(commands[0]?.operation).toEqual({ kind: 'scroll-page', pageId, movement: 'page-down' })
    ctx.browser.complete({
      requestId: commands[0]!.requestId,
      clientId: lease.clientId,
      response: {
        ok: true,
        value: {
          kind: 'scroll-page',
          receipt: {
            pageId, movement: 'page-down', top: 0, left: 0, maxTop: 0, maxLeft: 0, moved: false, atBoundary: true,
          },
        },
      },
    })
    await expect(scrolled).resolves.toMatchObject({ moved: false, atBoundary: true })

    const focused = ctx.browser.focusPage(target, signal)
    ctx.browser.complete({
      requestId: commands[1]!.requestId,
      clientId: lease.clientId,
      response: { ok: true, value: { kind: 'focus-page-element', receipt: { ...target, action: 'focused' } } },
    })
    await expect(focused).resolves.toEqual({ ...target, action: 'focused' })

    const pressed = ctx.browser.pressPage({ ...target, key: 'Enter' }, signal)
    expect(commands[2]?.operation).toEqual({
      kind: 'press-page-key', pageId, ref: 'e1', key: 'Enter', modifiers: {}, repeat: 1,
    })
    ctx.browser.complete({
      requestId: commands[2]!.requestId,
      clientId: lease.clientId,
      response: { ok: true, value: { kind: 'press-page-key', receipt: { ...target, action: 'pressed', key: 'Enter' } } },
    })
    await expect(pressed).resolves.toMatchObject({ action: 'pressed', key: 'Enter' })

    expect(() => ctx.browser.resolvePressPage({ ...target, key: 'Enter', repeat: 21 }))
      .toThrow(expect.objectContaining({ code: 'BROWSER_INVALID_REQUEST' }))
    expect(() => ctx.browser.resolvePressPage({ ...target, key: 'a' as 'Enter' }))
      .toThrow(expect.objectContaining({ code: 'BROWSER_KEY_UNSUPPORTED' }))

    const waited = ctx.browser.waitPage({
      kind: 'wait-page',
      pageId,
      condition: { kind: 'change', documentId, afterRevision: 3 },
      timeoutMs: 400,
    }, signal)
    expect(commands[3]?.operation).toEqual({
      kind: 'wait-page',
      pageId,
      condition: { kind: 'change', documentId, afterRevision: 3 },
      timeoutMs: 400,
      stableMs: 150,
    })
    ctx.browser.complete({
      requestId: commands[3]!.requestId,
      clientId: lease.clientId,
      response: { ok: true, value: { kind: 'wait-page', page: page({ revision: 4 }) } },
    })
    await expect(waited).resolves.toMatchObject({ documentId, revision: 4 })

    const timedOut = ctx.browser.waitPage({
      kind: 'wait-page',
      pageId,
      condition: { kind: 'text', text: 'never', state: 'present' },
      timeoutMs: 100,
    }, signal)
    ctx.browser.complete({
      requestId: commands[4]!.requestId,
      clientId: lease.clientId,
      response: {
        ok: false,
        error: { code: 'BROWSER_WAIT_TIMEOUT', message: 'url=https://example.test/12 documentId=22222222-2222-4222-8222-222222222222 revision=3' },
      },
    })
    await expect(timedOut).rejects.toMatchObject({ code: 'BROWSER_WAIT_TIMEOUT' })

    const mismatched = ctx.browser.scrollPage({ pageId, ref: BrowserPageElementRef('e3'), movement: 'bottom' }, signal)
    ctx.browser.complete({
      requestId: commands[5]!.requestId,
      clientId: lease.clientId,
      response: { ok: true, value: { kind: 'focus-page-element', receipt: { ...target, action: 'focused' } } },
    })
    await expect(mismatched).rejects.toMatchObject({ code: 'BROWSER_RESULT_KIND_MISMATCH' })

    expect(() => ctx.browser.resolveWaitPage({
      kind: 'wait-page',
      tabId: 12,
      condition: { kind: 'ready' },
      timeoutMs: 50,
    })).toThrow(expect.objectContaining({ code: 'BROWSER_INVALID_REQUEST' }))
  })

  it('treats an incomplete change wait as ready and still rejects an invalid complete change', async () => {
    const { ctx } = await harness()
    expect(ctx.browser.resolveWaitPage({
      kind: 'wait-page',
      pageId,
      condition: { kind: 'change' } as BrowserWaitCondition,
      timeoutMs: 400,
    })).toEqual({
      kind: 'wait-page',
      pageId,
      condition: { kind: 'ready' },
      timeoutMs: 400,
      stableMs: 150,
    })
    expect(() => ctx.browser.resolveWaitPage({
      kind: 'wait-page',
      pageId,
      condition: { kind: 'change', documentId: 'not-a-uuid' as typeof documentId, afterRevision: 1 },
      timeoutMs: 400,
    })).toThrow(expect.objectContaining({ code: 'BROWSER_INVALID_REQUEST' }))
  })

  it('validates browser client and tab identifiers at their public boundaries', async () => {
    const { ctx } = await harness()
    expect(() => ctx.browser.connect('bad client', true))
      .toThrow(expect.objectContaining({ code: 'BROWSER_CLIENT_ID_INVALID' }))
    await expect(ctx.browser.activateTab(-1, signal))
      .rejects.toMatchObject({ code: 'BROWSER_INVALID_TAB_ID' })
    await expect(ctx.browser.closeTab(Number.MAX_SAFE_INTEGER + 1, signal))
      .rejects.toMatchObject({ code: 'BROWSER_INVALID_TAB_ID' })
    expect(() => ctx.browser.resolvePageTarget('not-a-page', 'e1'))
      .toThrow(expect.objectContaining({ code: 'BROWSER_INVALID_PAGE_REFERENCE' }))
    expect(() => ctx.browser.resolvePageTarget(pageId, 'search-box'))
      .toThrow(expect.objectContaining({ code: 'BROWSER_INVALID_PAGE_REFERENCE' }))
  })

  it('rejects calls when no extension provider is connected', async () => {
    const { ctx } = await harness()
    await expect(ctx.browser.listTabs(signal))
      .rejects.toMatchObject({ code: 'BROWSER_EXTENSION_UNAVAILABLE' })
  })

  it('ignores the wrong client and rejects a mismatched result kind', async () => {
    const { ctx, commands } = await harness()
    const lease = ctx.browser.connect('result-client', true)
    const pending = ctx.browser.activateTab(9, signal)
    const command = commands[0]!

    expect(ctx.browser.complete({
      requestId: command.requestId,
      clientId: BrowserClientId('other-client'),
      response: { ok: true, value: { kind: 'activate-tab', tab: tab(9, true) } },
    })).toEqual({ accepted: false, reason: 'wrong-client' })
    expect(ctx.browser.complete({
      requestId: command.requestId,
      clientId: lease.clientId,
      response: { ok: true, value: { kind: 'close-tab', tabId: 9, closed: true } },
    })).toEqual({ accepted: false, reason: 'result-kind-mismatch' })
    await expect(pending).rejects.toMatchObject({ code: 'BROWSER_RESULT_KIND_MISMATCH' })
    expect(ctx.browser.complete({
      requestId: command.requestId,
      clientId: lease.clientId,
      response: { ok: true, value: { kind: 'activate-tab', tab: tab(9, true) } },
    })).toEqual({ accepted: false, reason: 'request-not-found' })
  })

  it('propagates extension failures with their stable error codes', async () => {
    const { ctx, commands } = await harness()
    ctx.browser.connect('failure-client', true)
    const pending = ctx.browser.closeTab(4, signal)

    expect(ctx.browser.complete({
      requestId: commands[0]!.requestId,
      clientId: commands[0]!.clientId,
      response: { ok: false, error: { code: 'BROWSER_TAB_NOT_FOUND', message: 'missing tab' } },
    })).toEqual({ accepted: true })
    await expect(pending).rejects.toMatchObject({ code: 'BROWSER_TAB_NOT_FOUND', message: 'missing tab' })
  })

  it('settles requests on caller abort and request timeout', async () => {
    vi.useFakeTimers()
    const { ctx } = await harness({ requestTimeoutMs: 50 })
    ctx.browser.connect('timing-client', true)

    const controller = new AbortController()
    const aborted = ctx.browser.listTabs(controller.signal)
    controller.abort()
    await expect(aborted).rejects.toMatchObject({ code: 'BROWSER_REQUEST_ABORTED' })
    await expect(ctx.browser.listTabs(AbortSignal.abort()))
      .rejects.toMatchObject({ code: 'BROWSER_REQUEST_ABORTED' })

    const timedOut = ctx.browser.listTabs(signal)
    const timedOutResult = expect(timedOut).rejects.toMatchObject({ code: 'BROWSER_REQUEST_TIMEOUT' })
    await vi.advanceTimersByTimeAsync(51)
    await timedOutResult
  })

  it('retains wait-page past requestTimeoutMs until timeoutMs plus host headroom', async () => {
    vi.useFakeTimers()
    const { ctx } = await harness({ requestTimeoutMs: 200 })
    ctx.browser.connect('wait-timer-client', true)

    const pending = ctx.browser.waitPage({
      kind: 'wait-page',
      pageId,
      condition: { kind: 'text', text: 'never', state: 'present' },
      timeoutMs: 400,
    }, signal)
    let settled = false
    void pending.then(() => { settled = true }, () => { settled = true })

    await vi.advanceTimersByTimeAsync(201)
    expect(settled).toBe(false)

    const timedOut = expect(pending).rejects.toMatchObject({ code: 'BROWSER_REQUEST_TIMEOUT' })
    await vi.advanceTimersByTimeAsync(1_699)
    await timedOut
  })

  it('settles pending work when the service fiber is disposed', async () => {
    const { ctx, fiber } = await harness()
    ctx.browser.connect('dispose-client', true)
    const pending = ctx.browser.listTabs(signal)

    await fiber.dispose()
    await expect(pending).rejects.toMatchObject({ code: 'BROWSER_EXTENSION_UNAVAILABLE' })
  })
})
