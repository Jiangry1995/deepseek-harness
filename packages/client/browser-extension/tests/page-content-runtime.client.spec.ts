import { describe, expect, it, vi } from 'vitest'
import { PageActionError } from '../src/extension/page-actor.ts'
import { PageWaitError } from '../src/extension/page-waiter.ts'
import type { BridgePageActionOperation, BridgePageActionReceipt, BridgePageContent } from '../src/protocol.ts'
import {
  installPageReader,
  isActPageDomRequest,
  isReadPageDomRequest,
  isWaitPageDomRequest,
} from '../src/extension/page-content-runtime.ts'

const pageId = '11111111-1111-4111-8111-111111111111'
const documentId = '22222222-2222-4222-8222-222222222222'

/** Create a protocol-valid page snapshot for content-script tests. */
function pageContent(overrides: Partial<BridgePageContent> = {}): BridgePageContent {
  return {
    pageId,
    documentId,
    revision: 1,
    viewport: { width: 800, height: 600, scrollX: 0, scrollY: 0, documentWidth: 800, documentHeight: 600 },
    text: '信访正文',
    fields: [{
      ref: 'e1',
      label: '概况信息',
      type: 'textarea',
      value: '来信内容',
      disabled: false,
      readOnly: false,
      required: false,
      inViewport: true,
      focused: false,
    }],
    actions: [],
    scrollTargets: [],
    truncated: false,
    ...overrides,
  }
}

/** Create a programmable content-script runtime for page-reader tests. */
function runtimeApi() {
  let listener!: (
    message: unknown,
    sender: unknown,
    sendResponse: (response?: unknown) => void,
  ) => boolean | undefined
  return {
    api: {
      onMessage: {
        addListener: vi.fn((value: typeof listener) => { listener = value }),
        removeListener: vi.fn(),
      },
    },
    listener: () => listener,
  }
}

describe('page content reader', () => {
  it('accepts only the dedicated page-read message kind', () => {
    expect(isReadPageDomRequest({ kind: 'dsh-read-page' })).toBe(true)
    expect(isReadPageDomRequest({ kind: 'read-page' })).toBe(false)
    expect(isReadPageDomRequest(null)).toBe(false)
    expect(isActPageDomRequest({
      kind: 'dsh-act-page',
      operation: { kind: 'click-page-element', pageId, ref: 'e1' },
    })).toBe(true)
    expect(isActPageDomRequest({
      kind: 'dsh-act-page',
      operation: { kind: 'scroll-page', pageId, movement: 'page-down' },
    })).toBe(true)
    expect(isActPageDomRequest({
      kind: 'dsh-act-page',
      operation: { kind: 'click-page-element', pageId: 'stale', ref: 'e1' },
    })).toBe(false)
    expect(isWaitPageDomRequest({
      kind: 'dsh-wait-page',
      operation: { condition: { kind: 'ready' }, timeoutMs: 200, stableMs: 0 },
    })).toBe(true)
    expect(isWaitPageDomRequest({
      kind: 'dsh-wait-page',
      operation: { condition: { kind: 'ready' }, timeoutMs: 50, stableMs: 0 },
    })).toBe(false)
  })

  it('answers page-read requests synchronously and ignores other messages', () => {
    const runtime = runtimeApi()
    const content = pageContent()
    const readPage = vi.fn(() => content)
    const dispose = installPageReader(runtime.api, readPage)
    const listener = runtime.listener()
    const sendResponse = vi.fn()

    expect(listener({ kind: 'list-tabs' }, {}, sendResponse)).toBeUndefined()
    expect(readPage).not.toHaveBeenCalled()
    expect(sendResponse).not.toHaveBeenCalled()

    expect(listener({ kind: 'dsh-read-page' }, {}, sendResponse)).toBe(false)
    expect(readPage).toHaveBeenCalledTimes(1)
    expect(sendResponse).toHaveBeenCalledWith({ ok: true, content })

    dispose()
    expect(runtime.api.onMessage.removeListener).toHaveBeenCalledWith(listener)
  })

  it('returns a failure payload when page extraction throws', () => {
    const runtime = runtimeApi()
    installPageReader(runtime.api, () => {
      throw new Error('document is not ready')
    })
    const sendResponse = vi.fn()
    expect(runtime.listener()({ kind: 'dsh-read-page' }, {}, sendResponse)).toBe(false)
    expect(sendResponse).toHaveBeenCalledWith({
      ok: false,
      error: { code: 'BROWSER_API_FAILED', message: 'document is not ready' },
    })
  })

  it('executes validated page actions and preserves stale-reference errors', () => {
    const runtime = runtimeApi()
    const actPage = vi.fn((operation: BridgePageActionOperation): BridgePageActionReceipt => {
      if (operation.kind === 'scroll-page') {
        throw new Error('this test only fills a field')
      }
      return {
        pageId: operation.pageId,
        ref: operation.ref,
        action: 'filled',
      }
    })
    installPageReader(runtime.api, vi.fn(), actPage)
    const sendResponse = vi.fn()
    const operation = { kind: 'fill-page-element' as const, pageId, ref: 'e1', value: 'deepseek', submit: true }

    expect(runtime.listener()({ kind: 'dsh-act-page', operation }, {}, sendResponse)).toBe(false)
    expect(actPage).toHaveBeenCalledWith(operation)
    expect(sendResponse).toHaveBeenCalledWith({
      ok: true,
      receipt: { pageId, ref: 'e1', action: 'filled' },
    })

    actPage.mockImplementationOnce(() => {
      throw new PageActionError('BROWSER_PAGE_STALE', 'read the page again')
    })
    runtime.listener()({ kind: 'dsh-act-page', operation }, {}, sendResponse)
    expect(sendResponse).toHaveBeenLastCalledWith({
      ok: false,
      error: {
        code: 'BROWSER_PAGE_STALE',
        message: 'BROWSER_PAGE_STALE: read the page again',
      },
    })
  })

  it('answers wait requests asynchronously and maps wait timeouts', async () => {
    const runtime = runtimeApi()
    const content = pageContent({ revision: 4 })
    const waitPage = vi.fn(async () => content)
    installPageReader(runtime.api, vi.fn(), vi.fn(), waitPage)
    const sendResponse = vi.fn()
    const operation = { condition: { kind: 'ready' as const }, timeoutMs: 200, stableMs: 0 }

    expect(runtime.listener()({ kind: 'dsh-wait-page', operation }, {}, sendResponse)).toBe(true)
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ ok: true, content })
    })

    waitPage.mockRejectedValueOnce(new PageWaitError('https://example.test/', documentId, 4))
    runtime.listener()({ kind: 'dsh-wait-page', operation }, {}, sendResponse)
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenLastCalledWith({
        ok: false,
        error: {
          code: 'BROWSER_WAIT_TIMEOUT',
          message: `BROWSER_WAIT_TIMEOUT: url=https://example.test/ documentId=${documentId} revision=4`,
        },
      })
    })
  })
})
