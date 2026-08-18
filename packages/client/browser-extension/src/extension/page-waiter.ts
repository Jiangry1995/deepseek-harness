/** In-page wait conditions for document change, text, URL, and load stability. */

import type { BridgePageContent, BridgeWaitPageDomOperation } from '../protocol.ts'
import { currentDocumentIdentity } from './page-document.ts'
import { readVisiblePage } from './page-reader.ts'

/** Stable wait failure that includes the last observed document coordinates. */
export class PageWaitError extends Error {
  /** Machine-readable wait timeout code. */
  readonly code = 'BROWSER_WAIT_TIMEOUT' as const
  /** Last observed tab URL. */
  readonly url: string
  /** Last observed document identity. */
  readonly documentId: string
  /** Last observed document revision. */
  readonly revision: number

  /**
   * Create one wait-timeout failure.
   * @param url - last observed location.
   * @param documentId - last observed document identity.
   * @param revision - last observed document revision.
   */
  constructor(url: string, documentId: string, revision: number) {
    super(`${url} documentId=${documentId} revision=${String(revision)}`)
    this.name = 'PageWaitError'
    this.url = url
    this.documentId = documentId
    this.revision = revision
  }
}

/** Return whether the current URL satisfies one wait URL condition. */
function urlMatches(href: string, value: string, match: 'exact' | 'prefix' | 'contains'): boolean {
  if (match === 'exact') return href === value
  if (match === 'prefix') return href.startsWith(value)
  return href.includes(value)
}

/** Return normalized visible text used by text wait conditions. */
function visibleText(): string {
  const inner = (document.body.innerText || '').trim()
  const raw = inner === '' ? (document.body.textContent || '') : document.body.innerText
  return (raw || '').replace(/\s+/g, ' ')
}

/** Return whether one wait condition currently holds. */
function conditionHolds(operation: BridgeWaitPageDomOperation): boolean {
  const identity = currentDocumentIdentity()
  const condition = operation.condition
  if (condition.kind === 'change') {
    return identity.documentId !== condition.documentId || identity.revision > condition.afterRevision
  }
  if (condition.kind === 'text') {
    const present = visibleText().includes(condition.text)
    return condition.state === 'present' ? present : !present
  }
  if (condition.kind === 'url') {
    return urlMatches(location.href, condition.value, condition.match)
  }
  return document.readyState === 'complete'
}

/** Wait until no further document revisions occur for the requested quiet period. */
async function waitUntilStable(stableMs: number, deadline: number): Promise<void> {
  if (stableMs <= 0) return
  let lastRevision = currentDocumentIdentity().revision
  let quietSince = Date.now()
  while (Date.now() < deadline) {
    await delay(Math.min(50, Math.max(0, deadline - Date.now())))
    const current = currentDocumentIdentity().revision
    if (current !== lastRevision) {
      lastRevision = current
      quietSince = Date.now()
      continue
    }
    if (Date.now() - quietSince >= stableMs) return
  }
}

/** Yield for one bounded interval. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

/**
 * Wait until a page condition holds, then return a fresh snapshot.
 * @param operation - validated wait condition and timeout bounds.
 * @returns a new page snapshot after the condition is observed.
 */
export async function waitForPage(operation: BridgeWaitPageDomOperation): Promise<BridgePageContent> {
  const deadline = Date.now() + operation.timeoutMs
  if (operation.condition.kind === 'url') {
    window.addEventListener('hashchange', onLocationSignal)
    window.addEventListener('popstate', onLocationSignal)
  }
  try {
    while (Date.now() <= deadline) {
      if (conditionHolds(operation)) {
        if (operation.condition.kind === 'ready' || operation.stableMs > 0) {
          await waitUntilStable(operation.stableMs, deadline)
          if (operation.condition.kind !== 'ready' && !conditionHolds(operation)) continue
          if (operation.condition.kind === 'ready' && document.readyState !== 'complete') continue
        }
        return readVisiblePage()
      }
      await delay(Math.min(50, Math.max(0, deadline - Date.now())))
    }
  } finally {
    window.removeEventListener('hashchange', onLocationSignal)
    window.removeEventListener('popstate', onLocationSignal)
  }
  const identity = currentDocumentIdentity()
  throw new PageWaitError(location.href, identity.documentId, identity.revision)
}

/** Location listeners exist so History API and hash changes wake the wait loop promptly. */
function onLocationSignal(): void {
  // The wait loop polls location.href; the listener exists to keep the page active.
}
