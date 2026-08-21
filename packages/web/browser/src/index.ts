/**
 * Browser capability service: leases WebExtension providers and routes validated tab operations.
 * @module @deepseek-ai/dsh-browser
 */

import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  BrowserClientId as brandBrowserClientId,
  BrowserDocumentId as brandBrowserDocumentId,
  BrowserPageElementRef as brandBrowserPageElementRef,
  BrowserPageId as brandBrowserPageId,
  BrowserRequestId as brandBrowserRequestId,
} from './ids.ts'
import { NAMED_PRESS_KEYS, PRESS_KEY_VALUES } from './types.ts'
import type {
  BrowserClientId,
  BrowserClientLease,
  BrowserCommand,
  BrowserCompletion,
  BrowserCompletionReceipt,
  BrowserDisconnectReceipt,
  BrowserOpenTabRequest,
  BrowserOpenTabSpec,
  BrowserOperation,
  BrowserOperationResult,
  BrowserFillPageRequest,
  BrowserFillPageSpec,
  BrowserInspectPageRequest,
  BrowserInspectPageSpec,
  BrowserPage,
  BrowserPageActionReceipt,
  BrowserPageInspect,
  BrowserPageTarget,
  BrowserPressKey,
  BrowserPressPageRequest,
  BrowserPressPageSpec,
  BrowserReadPageRequest,
  BrowserRequestId,
  BrowserScrollMovement,
  BrowserScrollPageRequest,
  BrowserScrollPageSpec,
  BrowserScrollReceipt,
  BrowserSelectPageRequest,
  BrowserTab,
  BrowserWaitCondition,
  BrowserWaitPageRequest,
  BrowserWaitPageSpec,
} from './types.ts'

export type * from './types.ts'
export {
  BrowserClientId,
  BrowserDocumentId,
  BrowserPageElementRef,
  BrowserPageId,
  BrowserRequestId,
  BrowserScreenshotId,
} from './ids.ts'

/** Stable browser capability failures surfaced through tool results. */
export type BrowserErrorCode =
  | 'BROWSER_CLIENT_ID_INVALID'
  | 'BROWSER_CLIENT_NOT_CONNECTED'
  | 'BROWSER_EXTENSION_UNAVAILABLE'
  | 'BROWSER_INVALID_URL'
  | 'BROWSER_INVALID_TAB_ID'
  | 'BROWSER_INVALID_PAGE_REFERENCE'
  | 'BROWSER_REQUEST_ABORTED'
  | 'BROWSER_REQUEST_TIMEOUT'
  | 'BROWSER_CLIENT_DISCONNECTED'
  | 'BROWSER_RESULT_KIND_MISMATCH'
  | 'BROWSER_INVALID_REQUEST'
  | 'BROWSER_TAB_NOT_FOUND'
  | 'BROWSER_PAGE_ACCESS_DENIED'
  | 'BROWSER_PAGE_STALE'
  | 'BROWSER_ELEMENT_NOT_FOUND'
  | 'BROWSER_ELEMENT_DISABLED'
  | 'BROWSER_ELEMENT_NOT_EDITABLE'
  | 'BROWSER_OPTION_NOT_FOUND'
  | 'BROWSER_SCROLL_TARGET_INVALID'
  | 'BROWSER_KEY_UNSUPPORTED'
  | 'BROWSER_WAIT_TIMEOUT'
  | 'BROWSER_CAPABILITY_UNAVAILABLE'
  | 'BROWSER_API_FAILED'

/** Browser capability error carrying a stable machine-readable code. */
export class BrowserError extends HarnessError {}

/** Browser service timing configuration. */
export interface Config {
  /** Maximum time in milliseconds to wait for one extension result. */
  requestTimeoutMs?: number
  /** Provider lease duration in milliseconds since its last heartbeat. Defaults to five minutes. */
  clientLeaseMs?: number
}

/** Browser service timing schema. */
export const Config: z<Config> = z.object({
  requestTimeoutMs: z.number().step(1).min(1).default(15_000),
  // Hidden Chromium renderers throttle page timers to about one tick per minute.
  // A 30s lease therefore expires while the side panel is still open.
  clientLeaseMs: z.number().step(1).min(1).default(300_000),
})

interface ResolvedConfig {
  requestTimeoutMs: number
  clientLeaseMs: number
}

/**
 * Extra Host milliseconds after a wait-page in-page timeout.
 * Keep aligned with `WAIT_PAGE_HOST_HEADROOM_MS` in `@deepseek-ai/dsh-client-browser-extension`.
 */
const WAIT_PAGE_HOST_HEADROOM_MS = 1_500

/**
 * Host retention for one provider operation.
 * wait-page outlasts the in-page wait and the Client page-bridge slack.
 * @param requestTimeoutMs - configured Host timeout for ordinary operations.
 * @param operation - dispatched provider operation.
 * @returns milliseconds the Host retains the pending request.
 */
function hostOperationTimeoutMs(requestTimeoutMs: number, operation: BrowserOperation): number {
  if (operation.kind !== 'wait-page') return requestTimeoutMs
  return Math.max(requestTimeoutMs, operation.timeoutMs + WAIT_PAGE_HOST_HEADROOM_MS)
}

interface RegisteredClient {
  readonly id: BrowserClientId
  lastSeenAt: number
  ordinal: number
  /** Whether the provider's page was renderer-visible at its last registration or heartbeat. */
  visible: boolean
}

interface PendingRequest {
  readonly requestId: BrowserRequestId
  readonly clientId: BrowserClientId
  readonly operation: BrowserOperation
  resolve(value: BrowserOperationResult): void
  reject(error: unknown): void
}

const CLIENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const PAGE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PAGE_REF_PATTERN = /^e[1-9]\d{0,3}$/
const SCROLL_MOVEMENTS = new Set<BrowserScrollMovement>([
  'line-up', 'line-down', 'line-left', 'line-right',
  'page-up', 'page-down', 'page-left', 'page-right',
  'top', 'bottom', 'left-edge', 'right-edge',
])
const PRESS_KEYS = new Set<BrowserPressKey>(PRESS_KEY_VALUES)
const NAMED_PRESS_KEY_SET = new Set<string>(NAMED_PRESS_KEYS)
const WAIT_TIMEOUT_MIN_MS = 100
const WAIT_TIMEOUT_MAX_MS = 30_000
const WAIT_STABLE_MAX_MS = 2_000
const DEFAULT_WAIT_TIMEOUT_MS = 5_000
const DEFAULT_WAIT_STABLE_MS = 150

/** Create one browser capability failure with a stable machine-readable code. */
function fail(message: string, code: BrowserErrorCode): BrowserError {
  return new BrowserError(message, code)
}

/** Reject tab identities Chromium cannot have assigned. */
function assertTabId(tabId: number): void {
  if (!Number.isSafeInteger(tabId) || tabId < 0) {
    throw fail('browser: tabId must be a non-negative safe integer', 'BROWSER_INVALID_TAB_ID')
  }
}

/** Validate and normalize an absolute credential-free HTTP(S) URL. */
function resolveHttpUrl(rawUrl: string): string {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw fail('browser: url must be an absolute HTTP(S) URL', 'BROWSER_INVALID_URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw fail('browser: only HTTP(S) URLs may be opened', 'BROWSER_INVALID_URL')
  }
  if (url.username !== '' || url.password !== '') {
    throw fail('browser: credential-bearing URLs are not allowed', 'BROWSER_INVALID_URL')
  }
  return url.href
}

/**
 * Validate a wait-page condition received at the public service boundary.
 * A change condition that omits documentId or afterRevision waits until the page
 * is stable, matching kind:ready. Model tools often send kind:change without
 * copying those snapshot fields; inventing them is worse than a ready wait.
 */
function resolveWaitCondition(condition: BrowserWaitCondition): BrowserWaitCondition {
  if (condition.kind === 'change') {
    const documentId = 'documentId' in condition ? condition.documentId : undefined
    const afterRevision = 'afterRevision' in condition ? condition.afterRevision : undefined
    if (typeof documentId !== 'string' || typeof afterRevision !== 'number') {
      return { kind: 'ready' }
    }
    if (!PAGE_ID_PATTERN.test(documentId) || !Number.isSafeInteger(afterRevision) || afterRevision < 0) {
      throw fail('browser: wait change condition requires a documentId and non-negative afterRevision', 'BROWSER_INVALID_REQUEST')
    }
    return {
      kind: 'change',
      documentId: brandBrowserDocumentId(documentId),
      afterRevision,
    }
  }
  if (condition.kind === 'text') {
    if (typeof condition.text !== 'string' || condition.text.length === 0 || condition.text.length > 1_000) {
      throw fail('browser: wait text must be 1-1000 characters', 'BROWSER_INVALID_REQUEST')
    }
    if (condition.state !== 'present' && condition.state !== 'absent') {
      throw fail('browser: wait text state must be present or absent', 'BROWSER_INVALID_REQUEST')
    }
    return { kind: 'text', text: condition.text, state: condition.state }
  }
  if (condition.kind === 'url') {
    if (typeof condition.value !== 'string' || condition.value.length === 0 || condition.value.length > 2_000) {
      throw fail('browser: wait url value must be 1-2000 characters', 'BROWSER_INVALID_REQUEST')
    }
    if (condition.match !== 'exact' && condition.match !== 'prefix' && condition.match !== 'contains') {
      throw fail('browser: wait url match must be exact, prefix, or contains', 'BROWSER_INVALID_REQUEST')
    }
    return { kind: 'url', value: condition.value, match: condition.match }
  }
  if (condition.kind === 'ready') return { kind: 'ready' }
  throw fail('browser: wait condition kind is not supported', 'BROWSER_INVALID_REQUEST')
}

/** Return whether a value is a caller AbortSignal rather than a request record. */
function isAbortSignal(value: unknown): value is AbortSignal {
  return typeof value === 'object'
    && value !== null
    && 'aborted' in value
    && typeof (value as AbortSignal).aborted === 'boolean'
    && typeof (value as AbortSignal).addEventListener === 'function'
}

/** Return whether a provider result answers the requested operation kind. */
function resultMatches(operation: BrowserOperation, result: BrowserOperationResult): boolean {
  if (operation.kind !== result.kind) return false
  if (operation.kind === 'scroll-page' && result.kind === 'scroll-page') {
    if (result.receipt.pageId !== operation.pageId || result.receipt.movement !== operation.movement) return false
    return operation.ref === undefined ? result.receipt.ref === undefined : result.receipt.ref === operation.ref
  }
  if (operation.kind !== 'click-page-element'
    && operation.kind !== 'fill-page-element'
    && operation.kind !== 'select-page-option'
    && operation.kind !== 'focus-page-element'
    && operation.kind !== 'press-page-key') return true
  if (result.kind !== operation.kind) return false
  return result.receipt.pageId === operation.pageId && result.receipt.ref === operation.ref
}

/**
 * Rank one provider against the current selection.
 * Visibility outranks recency because a hidden page is throttled by the renderer: its heartbeat
 * lags, expires, and re-registers, which would otherwise hand it the freshest lease and route
 * commands to a page that cannot answer them before the request timeout.
 * @param candidate - provider being considered.
 * @param selected - best provider found so far.
 * @returns whether the candidate should replace the current selection.
 */
function outranks(candidate: RegisteredClient, selected: RegisteredClient): boolean {
  if (candidate.visible !== selected.visible) return candidate.visible
  if (candidate.lastSeenAt !== selected.lastSeenAt) return candidate.lastSeenAt > selected.lastSeenAt
  return candidate.ordinal > selected.ordinal
}

/** Validate and brand a provider identity received through the Remote API. */
function browserClientId(rawClientId: string): BrowserClientId {
  if (!CLIENT_ID_PATTERN.test(rawClientId)) {
    throw fail('browser: client id must contain 1-128 ASCII letters, digits, dots, underscores, or hyphens', 'BROWSER_CLIENT_ID_INVALID')
  }
  return brandBrowserClientId(rawClientId)
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    browser: BrowserService
  }
}

/**
 * Routes browser operations to the most recently healthy WebExtension provider.
 * Provider registrations are leases: expiry, disconnect, service disposal, caller cancellation,
 * and request timeout all settle every affected pending operation.
 */
export class BrowserService extends TypertRemoteService {
  static inject = []
  static Config = Config

  private readonly config: ResolvedConfig
  private readonly clients = new Map<BrowserClientId, RegisteredClient>()
  private readonly pending = new Map<BrowserRequestId, PendingRequest>()
  private nextOrdinal = 0

  /**
   * Create the browser service.
   * @param ctx - Host Cordis context.
   * @param config - request timeout and client lease duration.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'browser')
    this.config = {
      requestTimeoutMs: config.requestTimeoutMs ?? 15_000,
      clientLeaseMs: config.clientLeaseMs ?? 300_000,
    }
    ctx.effect(() => () => { this.disposePending() })
  }

  /**
   * Register or renew a WebExtension provider identity.
   * @param rawClientId - untrusted candidate identity generated by the Web Client.
   * @param visible - whether the provider's page is renderer-visible and can answer promptly.
   * @returns the validated identity and timing values the Client must honor.
   */
  @Remote('connect')
  connect(rawClientId: string, visible: boolean): BrowserClientLease {
    const clientId = browserClientId(rawClientId)
    const existing = this.clients.get(clientId)
    const ordinal = existing?.ordinal ?? ++this.nextOrdinal
    this.clients.set(clientId, { id: clientId, lastSeenAt: Date.now(), ordinal, visible })
    return this.lease(clientId)
  }

  /**
   * Renew one registered provider lease.
   * @param clientId - identity returned by {@link connect}.
   * @param visible - whether the provider's page is renderer-visible and can answer promptly.
   * @returns the renewed lease timing values.
   * @throws BROWSER_CLIENT_NOT_CONNECTED when the lease is absent or expired.
   */
  @Remote('heartbeat')
  heartbeat(clientId: BrowserClientId, visible: boolean): BrowserClientLease {
    this.pruneExpiredClients()
    const client = this.clients.get(clientId)
    if (client === undefined) {
      throw fail('browser: extension provider is not connected', 'BROWSER_CLIENT_NOT_CONNECTED')
    }
    client.lastSeenAt = Date.now()
    client.visible = visible
    return this.lease(clientId)
  }

  /**
   * Remove one provider and reject its outstanding operations.
   * @param clientId - identity returned by {@link connect}.
   * @returns whether a current provider lease was removed.
   */
  @Remote('disconnect')
  disconnect(clientId: BrowserClientId): BrowserDisconnectReceipt {
    const disconnected = this.clients.delete(clientId)
    if (disconnected) this.rejectClientPending(clientId, 'browser: extension provider disconnected', 'BROWSER_CLIENT_DISCONNECTED')
    return { disconnected }
  }

  /**
   * Complete one Host request from its selected extension provider.
   * @param completion - echoed request and provider identities plus success or failure.
   * @returns whether the completion matched and settled a pending request.
   */
  @Remote('complete')
  complete(completion: BrowserCompletion): BrowserCompletionReceipt {
    const pending = this.pending.get(completion.requestId)
    if (pending === undefined) return { accepted: false, reason: 'request-not-found' }
    if (pending.clientId !== completion.clientId) return { accepted: false, reason: 'wrong-client' }
    if (!completion.response.ok) {
      pending.reject(fail(completion.response.error.message, completion.response.error.code))
      return { accepted: true }
    }
    if (!resultMatches(pending.operation, completion.response.value)) {
      pending.reject(fail('browser: extension result does not match the requested operation', 'BROWSER_RESULT_KIND_MISMATCH'))
      return { accepted: false, reason: 'result-kind-mismatch' }
    }
    pending.resolve(completion.response.value)
    return { accepted: true }
  }

  /**
   * Resolve caller defaults and validate one open-tab request.
   * @param request - URL and optional activation preference.
   * @returns a complete provider operation.
   */
  resolveOpenTab(request: BrowserOpenTabRequest): BrowserOpenTabSpec {
    return { kind: 'open-tab', url: resolveHttpUrl(request.url), active: request.active ?? true }
  }

  /**
   * Open one HTTP(S) tab through the selected extension provider.
   * @param request - URL and optional activation preference.
   * @param signal - caller cancellation.
   * @returns the created tab.
   */
  async openTab(request: BrowserOpenTabRequest, signal: AbortSignal): Promise<BrowserTab> {
    const result = await this.invoke(this.resolveOpenTab(request), signal)
    if (result.kind !== 'open-tab') throw fail('browser: internal open-tab result mismatch', 'BROWSER_RESULT_KIND_MISMATCH')
    return result.tab
  }

  /**
   * List tabs in the extension's current browser window.
   * @param signal - caller cancellation.
   * @returns tabs visible to the extension.
   */
  async listTabs(signal: AbortSignal): Promise<BrowserTab[]> {
    const result = await this.invoke({ kind: 'list-tabs' }, signal)
    if (result.kind !== 'list-tabs') throw fail('browser: internal list-tabs result mismatch', 'BROWSER_RESULT_KIND_MISMATCH')
    return result.tabs
  }

  /**
   * Read bounded visible text and non-secret form values from one browser page.
   * @param requestOrSignal - optional tab identity, or the caller AbortSignal for the active tab.
   * @param signal - caller cancellation when the first argument is a request record.
   * @returns the tab metadata and its main-frame page snapshot.
   */
  async readPage(requestOrSignal: BrowserReadPageRequest | AbortSignal, signal?: AbortSignal): Promise<BrowserPage> {
    if (isAbortSignal(requestOrSignal)) {
      return this.readPage({}, requestOrSignal)
    }
    if (signal === undefined) {
      throw fail('browser: read-page requires a cancellation signal', 'BROWSER_INVALID_REQUEST')
    }
    if (requestOrSignal.tabId !== undefined) assertTabId(requestOrSignal.tabId)
    const operation = requestOrSignal.tabId === undefined
      ? { kind: 'read-page' as const }
      : { kind: 'read-page' as const, tabId: requestOrSignal.tabId }
    const result = await this.invoke(operation, signal)
    if (result.kind !== 'read-page') throw fail('browser: internal read-page result mismatch', 'BROWSER_RESULT_KIND_MISMATCH')
    return result.page
  }

  /**
   * Start, snapshot, or stop bounded page fetch/XHR and console observation.
   * Native DevTools cannot be opened, and observations begin only after a start request.
   * @param request - observation mode and optional tab identity.
   * @param signal - caller cancellation.
   * @returns the tab metadata and bounded Network/Console snapshot.
   */
  async inspectPage(
    request: BrowserInspectPageRequest,
    signal: AbortSignal,
  ): Promise<BrowserPageInspect> {
    const spec = this.resolveInspectPage(request)
    const result = await this.invoke(spec, signal)
    if (result.kind !== 'inspect-page') throw fail('browser: internal inspect-page result mismatch', 'BROWSER_RESULT_KIND_MISMATCH')
    return result.inspect
  }

  /**
   * Validate and default one inspect-page request.
   * @param request - observation mode and optional tab identity.
   * @returns a complete provider operation.
   */
  resolveInspectPage(request: BrowserInspectPageRequest): BrowserInspectPageSpec {
    if (request.tabId !== undefined) assertTabId(request.tabId)
    return {
      kind: 'inspect-page',
      mode: request.mode,
      ...(request.tabId === undefined ? {} : { tabId: request.tabId }),
    }
  }

  /**
   * Validate and brand a document-bound target returned by the latest page read.
   * @param rawPageId - page UUID supplied at the model-tool boundary.
   * @param rawRef - element reference supplied at the model-tool boundary.
   * @returns a typed target accepted by page action methods.
   */
  resolvePageTarget(rawPageId: string, rawRef: string): BrowserPageTarget {
    if (!PAGE_ID_PATTERN.test(rawPageId) || !PAGE_REF_PATTERN.test(rawRef)) {
      throw fail('browser: pageId and ref must come from the latest browser_read_page result', 'BROWSER_INVALID_PAGE_REFERENCE')
    }
    return { pageId: brandBrowserPageId(rawPageId), ref: brandBrowserPageElementRef(rawRef) }
  }

  /**
   * Validate and brand a snapshot identity returned by the latest page read.
   * @param rawPageId - page UUID supplied at the model-tool boundary.
   * @returns the branded snapshot identity.
   */
  resolvePageId(rawPageId: string): BrowserPage['pageId'] {
    if (!PAGE_ID_PATTERN.test(rawPageId)) {
      throw fail('browser: pageId must come from the latest browser_read_page result', 'BROWSER_INVALID_PAGE_REFERENCE')
    }
    return brandBrowserPageId(rawPageId)
  }

  /**
   * Click one element referenced by the latest current-page snapshot.
   * @param target - validated page and element identities.
   * @param signal - caller cancellation.
   * @returns confirmation of the completed click.
   */
  async clickPage(target: BrowserPageTarget, signal: AbortSignal): Promise<BrowserPageActionReceipt> {
    const result = await this.invoke({ kind: 'click-page-element', ...target }, signal)
    if (result.kind !== 'click-page-element') throw fail('browser: internal click result mismatch', 'BROWSER_RESULT_KIND_MISMATCH')
    return result.receipt
  }

  /**
   * Fill one text field referenced by the latest current-page snapshot.
   * @param request - validated target, replacement value, and submit preference.
   * @param signal - caller cancellation.
   * @returns confirmation of the completed fill.
   */
  async fillPage(request: BrowserFillPageRequest, signal: AbortSignal): Promise<BrowserPageActionReceipt> {
    if (request.value.length > 10_000) {
      throw fail('browser: fill value must not exceed 10000 characters', 'BROWSER_INVALID_PAGE_REFERENCE')
    }
    const operation: BrowserFillPageSpec = { kind: 'fill-page-element', ...request, submit: request.submit ?? false }
    const result = await this.invoke(operation, signal)
    if (result.kind !== 'fill-page-element') throw fail('browser: internal fill result mismatch', 'BROWSER_RESULT_KIND_MISMATCH')
    return result.receipt
  }

  /**
   * Select one native option referenced by the latest current-page snapshot.
   * @param request - validated target and exact option value or visible text.
   * @param signal - caller cancellation.
   * @returns confirmation including the resolved native option value.
   */
  async selectPage(request: BrowserSelectPageRequest, signal: AbortSignal): Promise<BrowserPageActionReceipt> {
    if (request.value.length > 1_000) {
      throw fail('browser: select value must not exceed 1000 characters', 'BROWSER_INVALID_PAGE_REFERENCE')
    }
    const result = await this.invoke({ kind: 'select-page-option', ...request }, signal)
    if (result.kind !== 'select-page-option') throw fail('browser: internal select result mismatch', 'BROWSER_RESULT_KIND_MISMATCH')
    return result.receipt
  }

  /**
   * Scroll the document viewport or one scroll target from the latest page read.
   * @param request - validated page identity, optional scroll-target ref, and discrete movement.
   * @param signal - caller cancellation.
   * @returns observed offsets after the scroll attempt, including an at-boundary result.
   */
  async scrollPage(request: BrowserScrollPageRequest, signal: AbortSignal): Promise<BrowserScrollReceipt> {
    if (!SCROLL_MOVEMENTS.has(request.movement)) {
      throw fail('browser: scroll movement is not one of the supported discrete movements', 'BROWSER_INVALID_REQUEST')
    }
    const operation: BrowserScrollPageSpec = request.ref === undefined
      ? { kind: 'scroll-page', pageId: request.pageId, movement: request.movement }
      : { kind: 'scroll-page', pageId: request.pageId, ref: request.ref, movement: request.movement }
    const result = await this.invoke(operation, signal)
    if (result.kind !== 'scroll-page') throw fail('browser: internal scroll result mismatch', 'BROWSER_RESULT_KIND_MISMATCH')
    return result.receipt
  }

  /**
   * Focus one field or focusable action from the latest page read.
   * @param target - validated page and element identities.
   * @param signal - caller cancellation.
   * @returns confirmation that document.activeElement is the referenced element.
   */
  async focusPage(target: BrowserPageTarget, signal: AbortSignal): Promise<BrowserPageActionReceipt> {
    const result = await this.invoke({ kind: 'focus-page-element', ...target }, signal)
    if (result.kind !== 'focus-page-element') throw fail('browser: internal focus result mismatch', 'BROWSER_RESULT_KIND_MISMATCH')
    return result.receipt
  }

  /**
   * Press one allowed key against a referenced element from the latest page read.
   * @param request - validated target, allowed key, optional modifiers, and repeat count.
   * @param signal - caller cancellation.
   * @returns confirmation of the completed key effect.
   */
  async pressPage(request: BrowserPressPageRequest, signal: AbortSignal): Promise<BrowserPageActionReceipt> {
    const spec = this.resolvePressPage(request)
    const result = await this.invoke(spec, signal)
    if (result.kind !== 'press-page-key') throw fail('browser: internal press result mismatch', 'BROWSER_RESULT_KIND_MISMATCH')
    return result.receipt
  }

  /**
   * Validate and default one bounded keyboard request.
   * @param request - target, key, optional modifiers, and optional repeat count.
   * @returns a complete provider operation.
   */
  resolvePressPage(request: BrowserPressPageRequest): BrowserPressPageSpec {
    if (!PRESS_KEYS.has(request.key)) {
      throw fail('browser: key is not one of the supported keyboard operations', 'BROWSER_KEY_UNSUPPORTED')
    }
    const modifiers = {
      ...(request.modifiers?.ctrl === true ? { ctrl: true } : {}),
      ...(request.modifiers?.alt === true ? { alt: true } : {}),
      ...(request.modifiers?.shift === true ? { shift: true } : {}),
      ...(request.modifiers?.meta === true ? { meta: true } : {}),
    }
    if (!NAMED_PRESS_KEY_SET.has(request.key)
      && modifiers.ctrl !== true
      && modifiers.alt !== true
      && modifiers.meta !== true) {
      throw fail('browser: letter and digit keys require Control, Alt, or Meta', 'BROWSER_KEY_UNSUPPORTED')
    }
    const repeat = request.repeat ?? 1
    if (!Number.isSafeInteger(repeat) || repeat < 1 || repeat > 20) {
      throw fail('browser: key repeat must be an integer from 1 through 20', 'BROWSER_INVALID_REQUEST')
    }
    return {
      kind: 'press-page-key',
      pageId: request.pageId,
      ref: request.ref,
      key: request.key,
      modifiers,
      repeat,
    }
  }

  /**
   * Wait until a page condition holds, then return a fresh snapshot.
   * @param request - tab identity, condition, and optional timeout bounds.
   * @param signal - caller cancellation.
   * @returns a new page snapshot after the condition is observed.
   */
  async waitPage(request: BrowserWaitPageRequest, signal: AbortSignal): Promise<BrowserPage> {
    const spec = this.resolveWaitPage(request)
    const result = await this.invoke(spec, signal)
    if (result.kind !== 'wait-page') throw fail('browser: internal wait-page result mismatch', 'BROWSER_RESULT_KIND_MISMATCH')
    return result.page
  }

  /**
   * Validate and default one wait-page request.
   * @param request - tab identity, condition, and optional timeout bounds.
   * @returns a complete provider operation.
   */
  resolveWaitPage(request: BrowserWaitPageRequest): BrowserWaitPageSpec {
    if (request.pageId === undefined && request.tabId === undefined) {
      throw fail('browser: wait-page requires pageId from browser_read_page or a browser tab id', 'BROWSER_INVALID_REQUEST')
    }
    if (request.tabId !== undefined) assertTabId(request.tabId)
    const pageId = request.pageId === undefined ? undefined : this.resolvePageId(request.pageId)
    const timeoutMs = request.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS
    const stableMs = request.stableMs ?? DEFAULT_WAIT_STABLE_MS
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < WAIT_TIMEOUT_MIN_MS || timeoutMs > WAIT_TIMEOUT_MAX_MS) {
      throw fail('browser: wait timeoutMs must be an integer from 100 through 30000', 'BROWSER_INVALID_REQUEST')
    }
    if (!Number.isSafeInteger(stableMs) || stableMs < 0 || stableMs > WAIT_STABLE_MAX_MS) {
      throw fail('browser: wait stableMs must be an integer from 0 through 2000', 'BROWSER_INVALID_REQUEST')
    }
    return {
      kind: 'wait-page',
      ...(pageId === undefined ? {} : { pageId }),
      ...(request.tabId === undefined ? {} : { tabId: request.tabId }),
      condition: resolveWaitCondition(request.condition),
      timeoutMs,
      stableMs,
    }
  }

  /**
   * Activate one tab in its browser window.
   * @param tabId - browser-assigned tab identifier.
   * @param signal - caller cancellation.
   * @returns the activated tab.
   */
  async activateTab(tabId: number, signal: AbortSignal): Promise<BrowserTab> {
    assertTabId(tabId)
    const result = await this.invoke({ kind: 'activate-tab', tabId }, signal)
    if (result.kind !== 'activate-tab') throw fail('browser: internal activate-tab result mismatch', 'BROWSER_RESULT_KIND_MISMATCH')
    return result.tab
  }

  /**
   * Close one tab.
   * @param tabId - browser-assigned tab identifier.
   * @param signal - caller cancellation.
   * @returns the closed tab identity.
   */
  async closeTab(tabId: number, signal: AbortSignal): Promise<{ tabId: number; closed: true }> {
    assertTabId(tabId)
    const result = await this.invoke({ kind: 'close-tab', tabId }, signal)
    if (result.kind !== 'close-tab') throw fail('browser: internal close-tab result mismatch', 'BROWSER_RESULT_KIND_MISMATCH')
    return { tabId: result.tabId, closed: result.closed }
  }

  /** Return the current timing contract for a registered provider. */
  private lease(clientId: BrowserClientId): BrowserClientLease {
    return { clientId, leaseMs: this.config.clientLeaseMs, requestTimeoutMs: this.config.requestTimeoutMs }
  }

  /** Select the visible live provider, or the newest one, after expiring stale leases. */
  private selectClient(): RegisteredClient {
    this.pruneExpiredClients()
    let selected: RegisteredClient | undefined
    for (const client of this.clients.values()) {
      if (selected === undefined || outranks(client, selected)) selected = client
    }
    if (selected === undefined) {
      throw fail('browser: no browser extension is connected; load the DSH Browser Bridge extension and refresh the Web GUI', 'BROWSER_EXTENSION_UNAVAILABLE')
    }
    return selected
  }

  /** Remove expired provider leases and reject their outstanding operations. */
  private pruneExpiredClients(): void {
    const cutoff = Date.now() - this.config.clientLeaseMs
    for (const [clientId, client] of this.clients) {
      if (client.lastSeenAt > cutoff) continue
      this.clients.delete(clientId)
      this.rejectClientPending(clientId, 'browser: extension provider lease expired', 'BROWSER_CLIENT_DISCONNECTED')
    }
  }

  /** Dispatch one operation and retain it until completion, cancellation, or timeout. */
  private invoke(operation: BrowserOperation, signal: AbortSignal): Promise<BrowserOperationResult> {
    if (signal.aborted) return Promise.reject(fail('browser: request was aborted', 'BROWSER_REQUEST_ABORTED'))
    const client = this.selectClient()
    const requestId = brandBrowserRequestId(randomUUID())
    const command: BrowserCommand = { requestId, clientId: client.id, operation }
    const timeoutMs = hostOperationTimeoutMs(this.config.requestTimeoutMs, operation)

    return new Promise<BrowserOperationResult>((resolve, reject) => {
      let settled = false
      /** Release every resource retained by this pending operation exactly once. */
      const cleanup = (): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        this.pending.delete(requestId)
      }
      /** Resolve the caller after releasing pending-operation resources. */
      const finishResolve = (value: BrowserOperationResult): void => {
        cleanup()
        resolve(value)
      }
      /** Reject the caller after releasing pending-operation resources. */
      const finishReject = (error: unknown): void => {
        cleanup()
        reject(error instanceof Error ? error : new Error(String(error)))
      }
      /** Translate caller cancellation to a stable browser failure. */
      const onAbort = (): void => {
        finishReject(fail('browser: request was aborted', 'BROWSER_REQUEST_ABORTED'))
      }
      const timer = setTimeout(() => {
        finishReject(fail('browser: extension did not answer before the request timeout', 'BROWSER_REQUEST_TIMEOUT'))
      }, timeoutMs)
      timer.unref()
      signal.addEventListener('abort', onAbort, { once: true })
      const pending: PendingRequest = {
        requestId,
        clientId: client.id,
        operation,
        resolve: finishResolve,
        reject: finishReject,
      }
      this.pending.set(requestId, pending)
      try {
        this.ctx.emit('browser/command', command)
      } catch (error) {
        finishReject(error)
      }
    })
  }

  /** Reject every pending operation owned by one provider. */
  private rejectClientPending(clientId: BrowserClientId, message: string, code: BrowserErrorCode): void {
    for (const pending of [...this.pending.values()]) {
      if (pending.clientId === clientId) pending.reject(fail(message, code))
    }
  }

  /** Reject all work and remove providers when the service is disposed. */
  private disposePending(): void {
    this.clients.clear()
    for (const pending of [...this.pending.values()]) {
      pending.reject(fail('browser: service was disposed', 'BROWSER_EXTENSION_UNAVAILABLE'))
    }
  }
}

export default BrowserService
