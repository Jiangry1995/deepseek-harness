/** In-tab page reader that answers Service Worker requests without executeScript. */

import {
  isBridgeOperation,
  isBridgePageContent,
  isBridgePageInspectContent,
  isBridgeWaitPageDomOperation,
} from '../protocol.ts'
import { PageActionError } from './page-actor.ts'
import { PageWaitError } from './page-waiter.ts'
import type {
  BridgePageActionOperation,
  BridgePageActionReceipt,
  BridgePageContent,
  BridgePageInspectContent,
  BridgeScrollReceipt,
  BridgeWaitPageDomOperation,
} from '../protocol.ts'

/** Message kind sent from the Service Worker to the page content script. */
export const DSH_READ_PAGE_KIND = 'dsh-read-page'
/** Message kind sent from the Service Worker for one document-bound page action. */
export const DSH_ACT_PAGE_KIND = 'dsh-act-page'
/** Message kind sent from the Service Worker for one in-tab wait. */
export const DSH_WAIT_PAGE_KIND = 'dsh-wait-page'
/** Message kind sent from the Service Worker for one Network/Console inspect. */
export const DSH_INSPECT_PAGE_KIND = 'dsh-inspect-page'

type PageReader = () => BridgePageContent
type PageActor = (operation: BridgePageActionOperation) => BridgePageActionReceipt | BridgeScrollReceipt
type PageWaiter = (operation: BridgeWaitPageDomOperation) => Promise<BridgePageContent>
type PageInspector = (reset: boolean) => Promise<BridgePageInspectContent>

interface PageReaderRuntime {
  readonly onMessage: Pick<typeof chrome.runtime.onMessage, 'addListener' | 'removeListener'>
}

const PAGE_ACTION_KINDS = new Set([
  'click-page-element',
  'fill-page-element',
  'select-page-option',
  'scroll-page',
  'focus-page-element',
  'press-page-key',
])

/**
 * Return whether one runtime message is a page-read request.
 * @param message - untrusted content-script runtime message.
 * @returns whether the dedicated read discriminator is present.
 */
export function isReadPageDomRequest(message: unknown): message is { kind: typeof DSH_READ_PAGE_KIND } {
  return typeof message === 'object' && message !== null
    && 'kind' in message
    && message.kind === DSH_READ_PAGE_KIND
}

/**
 * Return whether one runtime message carries a validated page action.
 * @param message - untrusted content-script runtime message.
 * @returns whether the message contains one supported page action.
 */
export function isActPageDomRequest(message: unknown): message is {
  kind: typeof DSH_ACT_PAGE_KIND
  operation: BridgePageActionOperation
} {
  if (typeof message !== 'object' || message === null
    || !('kind' in message) || message.kind !== DSH_ACT_PAGE_KIND
    || !('operation' in message) || !isBridgeOperation(message.operation)) {
    return false
  }
  return PAGE_ACTION_KINDS.has(message.operation.kind)
}

/**
 * Return whether one runtime message carries a validated wait request.
 * @param message - untrusted content-script runtime message.
 * @returns whether the message contains one supported wait request.
 */
export function isWaitPageDomRequest(message: unknown): message is {
  kind: typeof DSH_WAIT_PAGE_KIND
  operation: BridgeWaitPageDomOperation
} {
  return typeof message === 'object' && message !== null
    && 'kind' in message
    && message.kind === DSH_WAIT_PAGE_KIND
    && 'operation' in message
    && isBridgeWaitPageDomOperation(message.operation)
}

/**
 * Return whether one runtime message is a page-inspect request.
 * @param message - untrusted content-script runtime message.
 * @returns whether the dedicated inspect discriminator is present.
 */
export function isInspectPageDomRequest(message: unknown): message is {
  kind: typeof DSH_INSPECT_PAGE_KIND
  reset: boolean
} {
  return typeof message === 'object' && message !== null
    && 'kind' in message
    && message.kind === DSH_INSPECT_PAGE_KIND
    && 'reset' in message
    && typeof message.reset === 'boolean'
}

/** Map a thrown page-script error onto a stable bridge failure. */
function failurePayload(error: unknown): { ok: false; error: { code: string; message: string } } {
  if (error instanceof PageWaitError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: `BROWSER_WAIT_TIMEOUT: url=${error.url} documentId=${error.documentId} revision=${String(error.revision)}`,
      },
    }
  }
  return {
    ok: false,
    error: {
      code: error instanceof PageActionError ? error.code : 'BROWSER_API_FAILED',
      message: error instanceof Error ? error.message : String(error),
    },
  }
}

/**
 * Answer page-read, action, wait, and inspect requests from the already-injected content script.
 * @param runtime - content-script runtime messaging API.
 * @param readPage - DOM extractor bound to this document.
 * @param actPage - document-bound page action executor.
 * @param waitPage - in-tab wait executor.
 * @param inspectPage - MAIN-world Network/Console collector.
 * @returns listener disposer.
 */
export function installPageReader(
  runtime: PageReaderRuntime,
  readPage: PageReader,
  actPage?: PageActor,
  waitPage?: PageWaiter,
  inspectPage?: PageInspector,
): () => void {
  /** Reply to one in-tab read, action, wait, or inspect request. */
  const listener = (
    message: unknown,
    _sender: unknown,
    sendResponse: (response?: unknown) => void,
  ): boolean | undefined => {
    if (!isReadPageDomRequest(message)
      && !isActPageDomRequest(message)
      && !isWaitPageDomRequest(message)
      && !isInspectPageDomRequest(message)) {
      return undefined
    }
    if (isWaitPageDomRequest(message)) {
      if (waitPage === undefined) {
        sendResponse(failurePayload(new Error('browser extension: page waiter is unavailable')))
        return false
      }
      void waitPage(message.operation).then((content) => {
        if (!isBridgePageContent(content)) {
          sendResponse(failurePayload(new Error('browser extension: page script returned an invalid result')))
          return
        }
        sendResponse({ ok: true, content })
      }, (error: unknown) => { sendResponse(failurePayload(error)) })
      return true
    }
    if (isInspectPageDomRequest(message)) {
      if (inspectPage === undefined) {
        sendResponse(failurePayload(new Error('browser extension: page inspector is unavailable')))
        return false
      }
      void inspectPage(message.reset).then((content) => {
        if (!isBridgePageInspectContent(content)) {
          sendResponse(failurePayload(new Error('browser extension: page script returned an invalid inspect result')))
          return
        }
        sendResponse({ ok: true, content })
      }, (error: unknown) => { sendResponse(failurePayload(error)) })
      return true
    }
    try {
      if (isReadPageDomRequest(message)) {
        const content = readPage()
        if (!isBridgePageContent(content)) throw new Error('browser extension: page script returned an invalid result')
        sendResponse({ ok: true, content })
      } else {
        if (actPage === undefined) throw new Error('browser extension: page actor is unavailable')
        sendResponse({ ok: true, receipt: actPage(message.operation) })
      }
    } catch (error) {
      sendResponse(failurePayload(error))
    }
    return false
  }
  runtime.onMessage.addListener(listener)
  return () => { runtime.onMessage.removeListener(listener) }
}
