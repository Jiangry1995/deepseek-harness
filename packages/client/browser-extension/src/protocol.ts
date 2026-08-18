/** Page-to-content-script protocol owned by the browser-extension provider package. */

/** Protocol channel shared by the Web Client, content script, and Service Worker. */
export const BROWSER_EXTENSION_CHANNEL = 'dsh-browser-extension'
/** Protocol version shared by the Web Client, content script, and Service Worker. */
export const BROWSER_EXTENSION_PROTOCOL_VERSION = 5
/** Maximum serialized UTF-8 bytes accepted for one complete page-read result. */
export const BROWSER_PAGE_RESULT_MAX_BYTES = 96 * 1024
/** Maximum scroll containers returned by one page read. */
export const BROWSER_PAGE_SCROLL_TARGET_MAX = 40
/** Maximum native options returned for one select field. */
export const BROWSER_PAGE_OPTION_MAX = 40
/** Maximum characters retained for a semantic context title. */
export const BROWSER_PAGE_CONTEXT_MAX = 200

/** Tab representation crossing the isolated-world bridge. */
export interface BridgeTab {
  id: number
  windowId: number
  active: boolean
  url?: string
  title?: string
}

/** Visible viewport and document scroll metrics. */
export interface BridgePageViewport {
  width: number
  height: number
  scrollX: number
  scrollY: number
  documentWidth: number
  documentHeight: number
}

/** One option from a native select. */
export interface BridgePageOption {
  value: string
  label: string
  selected: boolean
  disabled: boolean
}

/** One current non-secret form value read from the active page. */
export interface BridgePageField {
  /** Opaque document-bound element reference used by page action tools. */
  ref: string
  /** User-facing label, aria label, placeholder, name, or id. */
  label: string
  /** Native control type or accessible text-field role. */
  type: string
  /** Current control value. */
  value: string
  /** Current checked state for checkbox and radio controls. */
  checked?: boolean
  /** Whether the control currently rejects editing. */
  disabled: boolean
  /** Whether the control is read-only. */
  readOnly: boolean
  /** Whether the control is marked required. */
  required: boolean
  /** Whether the control intersects the current viewport. */
  inViewport: boolean
  /** Whether this control is the current document focus target. */
  focused: boolean
  /** Short nearest dialog, form, row, or landmark title. */
  context?: string
  /** Native options when the control is a select. */
  options?: BridgePageOption[]
}

/** One visible element that can be clicked in the current document. */
export interface BridgePageAction {
  /** Opaque document-bound element reference used by page action tools. */
  ref: string
  /** Accessible interaction role exposed to the model. */
  role: string
  /** Visible or accessible element label. */
  label: string
  /** Whether the element currently rejects activation. */
  disabled: boolean
  /** Whether the element intersects the current viewport. */
  inViewport: boolean
  /** Whether this action is the current document focus target. */
  focused: boolean
  /** Short nearest dialog, form, row, or landmark title. */
  context?: string
  /** Href for links. */
  href?: string
  checked?: boolean
  selected?: boolean
  expanded?: boolean
  pressed?: boolean
}

/** One actually scrollable document or container. */
export interface BridgePageScrollTarget {
  ref: string
  label: string
  axis: 'vertical' | 'horizontal' | 'both'
  top: number
  left: number
  maxTop: number
  maxLeft: number
}

/** Bounded content returned directly by the script running in the page. */
export interface BridgePageContent {
  /** Opaque identity regenerated for every read and invalidated by navigation or another read. */
  pageId: string
  /** Opaque identity that remains stable until the document is replaced. */
  documentId: string
  /** Monotonic DOM-change counter for the current document lifetime. */
  revision: number
  /** Current viewport and document scroll metrics. */
  viewport: BridgePageViewport
  /** Rendered text from the top document and accessible same-origin child frames. */
  text: string
  /** Visible non-secret form controls and their current values. */
  fields: BridgePageField[]
  /** Visible buttons, links, options, and toggles that can be clicked by reference. */
  actions: BridgePageAction[]
  /** Visible containers that currently have leftover scroll range. */
  scrollTargets: BridgePageScrollTarget[]
  /** Whether text, fields, actions, or scroll targets were omitted to honor result limits. */
  truncated: boolean
}

/** Discrete scroll movement accepted across the bridge. */
export type BridgeScrollMovement =
  | 'line-up'
  | 'line-down'
  | 'line-left'
  | 'line-right'
  | 'page-up'
  | 'page-down'
  | 'page-left'
  | 'page-right'
  | 'top'
  | 'bottom'
  | 'left-edge'
  | 'right-edge'

/** Keys accepted by the bounded keyboard operation. */
export type BridgePressKey =
  | 'Enter'
  | 'Escape'
  | 'Tab'
  | 'Space'
  | 'ArrowUp'
  | 'ArrowDown'
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'Home'
  | 'End'
  | 'PageUp'
  | 'PageDown'
  | 'Backspace'
  | 'Delete'

/** Page-element operations accepted only for references from the latest page read. */
export type BridgePageActionOperation =
  | { kind: 'click-page-element'; pageId: string; ref: string }
  | { kind: 'fill-page-element'; pageId: string; ref: string; value: string; submit: boolean }
  | { kind: 'select-page-option'; pageId: string; ref: string; value: string }
  | { kind: 'scroll-page'; pageId: string; ref?: string; movement: BridgeScrollMovement }
  | { kind: 'focus-page-element'; pageId: string; ref: string }
  | {
    kind: 'press-page-key'
    pageId: string
    ref: string
    key: BridgePressKey
    modifiers: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean }
    repeat: number
  }

/** Stable confirmation returned after one page element action. */
export interface BridgePageActionReceipt {
  /** Document identity supplied by the caller. */
  pageId: string
  /** Element reference supplied by the caller. */
  ref: string
  /** Browser-side effect that completed. */
  action: 'clicked' | 'filled' | 'selected' | 'focused' | 'pressed'
  /** Resolved native option value for a select action. */
  value?: string
  /** Key that produced a pressed receipt. */
  key?: BridgePressKey
}

/** Observed scroll offsets after one scroll operation. */
export interface BridgeScrollReceipt {
  pageId: string
  ref?: string
  movement: BridgeScrollMovement
  top: number
  left: number
  maxTop: number
  maxLeft: number
  moved: boolean
  atBoundary: boolean
}

/** Wait until the current document identity or revision advances. */
export type BridgeWaitCondition =
  | { kind: 'change'; documentId: string; afterRevision: number }
  | { kind: 'text'; text: string; state: 'present' | 'absent' }
  | { kind: 'url'; value: string; match: 'exact' | 'prefix' | 'contains' }
  | { kind: 'ready' }

/** Wait request executed inside the already-resolved tab. */
export interface BridgeWaitPageDomOperation {
  condition: BridgeWaitCondition
  timeoutMs: number
  stableMs: number
}

/** Active-tab metadata and bounded page content crossing the bridge. */
export interface BridgePage extends BridgePageContent {
  /** Active browser tab from which the content was read. */
  tab: BridgeTab
}

/** Validated browser operation crossing the isolated-world bridge. */
export type BridgeOperation =
  | { kind: 'open-tab'; url: string; active: boolean }
  | { kind: 'list-tabs' }
  | { kind: 'read-page'; tabId?: number }
  | BridgePageActionOperation
  | {
    kind: 'wait-page'
    pageId?: string
    tabId?: number
    condition: BridgeWaitCondition
    timeoutMs: number
    stableMs: number
  }
  | { kind: 'activate-tab'; tabId: number }
  | { kind: 'close-tab'; tabId: number }

/** Successful browser operation result crossing the isolated-world bridge. */
export type BridgeOperationResult =
  | { kind: 'open-tab'; tab: BridgeTab }
  | { kind: 'list-tabs'; tabs: BridgeTab[] }
  | { kind: 'read-page'; page: BridgePage }
  | { kind: 'click-page-element'; receipt: BridgePageActionReceipt }
  | { kind: 'fill-page-element'; receipt: BridgePageActionReceipt }
  | { kind: 'select-page-option'; receipt: BridgePageActionReceipt }
  | { kind: 'scroll-page'; receipt: BridgeScrollReceipt }
  | { kind: 'focus-page-element'; receipt: BridgePageActionReceipt }
  | { kind: 'press-page-key'; receipt: BridgePageActionReceipt }
  | { kind: 'wait-page'; page: BridgePage }
  | { kind: 'activate-tab'; tab: BridgeTab }
  | { kind: 'close-tab'; tabId: number; closed: true }

/** Extension error sent to the Web Client. */
export interface BridgeError {
  code:
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
  message: string
}

/** Probe emitted by the Web Client after its plugin loads. */
export interface BridgeProbe {
  channel: typeof BROWSER_EXTENSION_CHANNEL
  version: typeof BROWSER_EXTENSION_PROTOCOL_VERSION
  direction: 'probe'
}

/** Readiness response emitted by the content script. */
export interface BridgeReady {
  channel: typeof BROWSER_EXTENSION_CHANNEL
  version: typeof BROWSER_EXTENSION_PROTOCOL_VERSION
  direction: 'ready'
}

/** Side-panel wakeup that asks the embedded Harness page to renew its Host lease. */
export interface BridgeLeaseWakeup {
  /** Shared page-bridge channel name. */
  channel: typeof BROWSER_EXTENSION_CHANNEL
  /** Supported protocol version. */
  version: typeof BROWSER_EXTENSION_PROTOCOL_VERSION
  /** Parent-frame wakeup discriminant. */
  direction: 'lease-wakeup'
}

/** Operation request emitted by the Web Client. */
export interface BridgeRequest {
  channel: typeof BROWSER_EXTENSION_CHANNEL
  version: typeof BROWSER_EXTENSION_PROTOCOL_VERSION
  direction: 'request'
  requestId: string
  operation: BridgeOperation
}

/** Operation response emitted by the content script. */
export interface BridgeResponse {
  channel: typeof BROWSER_EXTENSION_CHANNEL
  version: typeof BROWSER_EXTENSION_PROTOCOL_VERSION
  direction: 'response'
  requestId: string
  response:
    | { ok: true; value: BridgeOperationResult }
    | { ok: false; error: BridgeError }
}

const SCROLL_MOVEMENTS = new Set<BridgeScrollMovement>([
  'line-up', 'line-down', 'line-left', 'line-right',
  'page-up', 'page-down', 'page-left', 'page-right',
  'top', 'bottom', 'left-edge', 'right-edge',
])
const PRESS_KEYS = new Set<BridgePressKey>([
  'Enter', 'Escape', 'Tab', 'Space',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Home', 'End', 'PageUp', 'PageDown', 'Backspace', 'Delete',
])
const BRIDGE_ERROR_CODES = new Set<BridgeError['code']>([
  'BROWSER_INVALID_REQUEST',
  'BROWSER_TAB_NOT_FOUND',
  'BROWSER_PAGE_ACCESS_DENIED',
  'BROWSER_PAGE_STALE',
  'BROWSER_ELEMENT_NOT_FOUND',
  'BROWSER_ELEMENT_DISABLED',
  'BROWSER_ELEMENT_NOT_EDITABLE',
  'BROWSER_OPTION_NOT_FOUND',
  'BROWSER_SCROLL_TARGET_INVALID',
  'BROWSER_KEY_UNSUPPORTED',
  'BROWSER_WAIT_TIMEOUT',
  'BROWSER_CAPABILITY_UNAVAILABLE',
  'BROWSER_API_FAILED',
])

/** Return whether an untrusted bridge value is a plain record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Return whether an untrusted value can identify a Chromium tab. */
function isSafeTabId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** Return whether an untrusted value is a current document or page identity. */
function isPageId(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

/** Return whether an untrusted value is one bounded page element reference. */
function isPageRef(value: unknown): value is string {
  return typeof value === 'string' && /^e[1-9]\d{0,3}$/.test(value)
}

/** Return whether an untrusted value is a finite non-negative number. */
function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/** Match the shared protocol envelope and an expected message direction. */
function hasEnvelope(value: Record<string, unknown>, direction: string): boolean {
  return value.channel === BROWSER_EXTENSION_CHANNEL
    && value.version === BROWSER_EXTENSION_PROTOCOL_VERSION
    && value.direction === direction
}

/** Validate a normalized tab received across the isolated-world bridge. */
function isBridgeTab(value: unknown): value is BridgeTab {
  if (!isRecord(value)) return false
  return isSafeTabId(value.id)
    && isSafeTabId(value.windowId)
    && typeof value.active === 'boolean'
    && (value.url === undefined || typeof value.url === 'string')
    && (value.title === undefined || typeof value.title === 'string')
}

/** Return the serialized UTF-8 size of an untrusted JSON-compatible value. */
function jsonByteLength(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

/** Validate one native select option. */
function isBridgePageOption(value: unknown): value is BridgePageOption {
  return isRecord(value)
    && typeof value.value === 'string'
    && value.value.length <= 1_000
    && typeof value.label === 'string'
    && value.label.length <= 160
    && typeof value.selected === 'boolean'
    && typeof value.disabled === 'boolean'
}

/** Validate current viewport metrics. */
function isBridgePageViewport(value: unknown): value is BridgePageViewport {
  return isRecord(value)
    && isNonNegativeNumber(value.width)
    && isNonNegativeNumber(value.height)
    && isNonNegativeNumber(value.scrollX)
    && isNonNegativeNumber(value.scrollY)
    && isNonNegativeNumber(value.documentWidth)
    && isNonNegativeNumber(value.documentHeight)
}

/** Validate one bounded current form value. */
function isBridgePageField(value: unknown): value is BridgePageField {
  return isRecord(value)
    && isPageRef(value.ref)
    && typeof value.label === 'string'
    && value.label.length <= 160
    && typeof value.type === 'string'
    && value.type.length <= 64
    && typeof value.value === 'string'
    && value.value.length <= 30_000
    && (value.checked === undefined || typeof value.checked === 'boolean')
    && typeof value.disabled === 'boolean'
    && typeof value.readOnly === 'boolean'
    && typeof value.required === 'boolean'
    && typeof value.inViewport === 'boolean'
    && typeof value.focused === 'boolean'
    && (value.context === undefined || (typeof value.context === 'string' && value.context.length <= BROWSER_PAGE_CONTEXT_MAX))
    && (value.options === undefined
      || (Array.isArray(value.options)
        && value.options.length <= BROWSER_PAGE_OPTION_MAX
        && value.options.every(isBridgePageOption)))
}

/** Validate one bounded clickable element summary. */
function isBridgePageAction(value: unknown): value is BridgePageAction {
  return isRecord(value)
    && isPageRef(value.ref)
    && typeof value.role === 'string'
    && value.role.length > 0
    && value.role.length <= 32
    && typeof value.label === 'string'
    && value.label.length <= 160
    && typeof value.disabled === 'boolean'
    && typeof value.inViewport === 'boolean'
    && typeof value.focused === 'boolean'
    && (value.context === undefined || (typeof value.context === 'string' && value.context.length <= BROWSER_PAGE_CONTEXT_MAX))
    && (value.href === undefined || (typeof value.href === 'string' && value.href.length <= 2_000))
    && (value.checked === undefined || typeof value.checked === 'boolean')
    && (value.selected === undefined || typeof value.selected === 'boolean')
    && (value.expanded === undefined || typeof value.expanded === 'boolean')
    && (value.pressed === undefined || typeof value.pressed === 'boolean')
}

/** Validate one actually scrollable container summary. */
function isBridgePageScrollTarget(value: unknown): value is BridgePageScrollTarget {
  return isRecord(value)
    && isPageRef(value.ref)
    && typeof value.label === 'string'
    && value.label.length <= 160
    && (value.axis === 'vertical' || value.axis === 'horizontal' || value.axis === 'both')
    && isNonNegativeNumber(value.top)
    && isNonNegativeNumber(value.left)
    && isNonNegativeNumber(value.maxTop)
    && isNonNegativeNumber(value.maxLeft)
}

/**
 * Validate content returned directly by the active-page script.
 * @param value - untrusted content-script result.
 * @returns whether the value is one bounded page snapshot.
 */
export function isBridgePageContent(value: unknown): value is BridgePageContent {
  return isRecord(value)
    && isPageId(value.pageId)
    && isPageId(value.documentId)
    && typeof value.revision === 'number'
    && Number.isSafeInteger(value.revision)
    && value.revision >= 0
    && isBridgePageViewport(value.viewport)
    && typeof value.text === 'string'
    && value.text.length <= 30_000
    && Array.isArray(value.fields)
    && value.fields.length <= 80
    && value.fields.every(isBridgePageField)
    && Array.isArray(value.actions)
    && value.actions.length <= 120
    && value.actions.every(isBridgePageAction)
    && Array.isArray(value.scrollTargets)
    && value.scrollTargets.length <= BROWSER_PAGE_SCROLL_TARGET_MAX
    && value.scrollTargets.every(isBridgePageScrollTarget)
    && typeof value.truncated === 'boolean'
}

/**
 * Validate one page action confirmation received from the content script.
 * @param value - untrusted content-script result.
 * @returns whether the value is one bounded action receipt.
 */
export function isBridgePageActionReceipt(value: unknown): value is BridgePageActionReceipt {
  return isRecord(value)
    && isPageId(value.pageId)
    && isPageRef(value.ref)
    && (value.action === 'clicked'
      || value.action === 'filled'
      || value.action === 'selected'
      || value.action === 'focused'
      || value.action === 'pressed')
    && (value.value === undefined || (typeof value.value === 'string' && value.value.length <= 1_000))
    && (value.key === undefined || (typeof value.key === 'string' && PRESS_KEYS.has(value.key as BridgePressKey)))
}

/**
 * Validate one scroll confirmation received from the content script.
 * @param value - untrusted content-script result.
 * @returns whether the value is one bounded scroll receipt.
 */
export function isBridgeScrollReceipt(value: unknown): value is BridgeScrollReceipt {
  return isRecord(value)
    && isPageId(value.pageId)
    && (value.ref === undefined || isPageRef(value.ref))
    && typeof value.movement === 'string'
    && SCROLL_MOVEMENTS.has(value.movement as BridgeScrollMovement)
    && isNonNegativeNumber(value.top)
    && isNonNegativeNumber(value.left)
    && isNonNegativeNumber(value.maxTop)
    && isNonNegativeNumber(value.maxLeft)
    && typeof value.moved === 'boolean'
    && typeof value.atBoundary === 'boolean'
}

/**
 * Validate one complete bounded current-page result.
 * @param value - untrusted extension result.
 * @returns whether the value is one complete bounded current-page result.
 */
export function isBridgePage(value: unknown): value is BridgePage {
  return isRecord(value)
    && isBridgeTab(value.tab)
    && isBridgePageContent(value)
    && jsonByteLength(value) <= BROWSER_PAGE_RESULT_MAX_BYTES
}

/** Validate one wait condition received across the bridge. */
function isBridgeWaitCondition(value: unknown): value is BridgeWaitCondition {
  if (!isRecord(value)) return false
  if (value.kind === 'change') {
    return isPageId(value.documentId)
      && typeof value.afterRevision === 'number'
      && Number.isSafeInteger(value.afterRevision)
      && value.afterRevision >= 0
  }
  if (value.kind === 'text') {
    return typeof value.text === 'string'
      && value.text.length > 0
      && value.text.length <= 1_000
      && (value.state === 'present' || value.state === 'absent')
  }
  if (value.kind === 'url') {
    return typeof value.value === 'string'
      && value.value.length > 0
      && value.value.length <= 2_000
      && (value.match === 'exact' || value.match === 'prefix' || value.match === 'contains')
  }
  return value.kind === 'ready'
}

/**
 * Validate a wait request executed inside an already-resolved tab.
 * @param value - untrusted page-script wait payload.
 * @returns whether the payload is a supported wait request.
 */
export function isBridgeWaitPageDomOperation(value: unknown): value is BridgeWaitPageDomOperation {
  return isRecord(value)
    && isBridgeWaitCondition(value.condition)
    && typeof value.timeoutMs === 'number'
    && Number.isSafeInteger(value.timeoutMs)
    && value.timeoutMs >= 100
    && value.timeoutMs <= 30_000
    && typeof value.stableMs === 'number'
    && Number.isSafeInteger(value.stableMs)
    && value.stableMs >= 0
    && value.stableMs <= 2_000
}

/**
 * Validate one browser operation received from an isolated-world message.
 * @param value - untrusted message field.
 * @returns whether the field is a supported operation.
 */
export function isBridgeOperation(value: unknown): value is BridgeOperation {
  if (!isRecord(value)) return false
  switch (value.kind) {
    case 'open-tab': return typeof value.url === 'string' && typeof value.active === 'boolean'
    case 'list-tabs': return true
    case 'read-page': return value.tabId === undefined || isSafeTabId(value.tabId)
    case 'click-page-element':
    case 'focus-page-element': return isPageId(value.pageId) && isPageRef(value.ref)
    case 'fill-page-element': return isPageId(value.pageId)
      && isPageRef(value.ref)
      && typeof value.value === 'string'
      && value.value.length <= 10_000
      && typeof value.submit === 'boolean'
    case 'select-page-option': return isPageId(value.pageId)
      && isPageRef(value.ref)
      && typeof value.value === 'string'
      && value.value.length <= 1_000
    case 'scroll-page': return isPageId(value.pageId)
      && (value.ref === undefined || isPageRef(value.ref))
      && typeof value.movement === 'string'
      && SCROLL_MOVEMENTS.has(value.movement as BridgeScrollMovement)
    case 'press-page-key': return isPageId(value.pageId)
      && isPageRef(value.ref)
      && typeof value.key === 'string'
      && PRESS_KEYS.has(value.key as BridgePressKey)
      && isRecord(value.modifiers)
      && (value.modifiers.ctrl === undefined || typeof value.modifiers.ctrl === 'boolean')
      && (value.modifiers.alt === undefined || typeof value.modifiers.alt === 'boolean')
      && (value.modifiers.shift === undefined || typeof value.modifiers.shift === 'boolean')
      && (value.modifiers.meta === undefined || typeof value.modifiers.meta === 'boolean')
      && typeof value.repeat === 'number'
      && Number.isSafeInteger(value.repeat)
      && value.repeat >= 1
      && value.repeat <= 20
    case 'wait-page': return (isPageId(value.pageId) || isSafeTabId(value.tabId))
      && (value.pageId === undefined || isPageId(value.pageId))
      && (value.tabId === undefined || isSafeTabId(value.tabId))
      && isBridgeWaitCondition(value.condition)
      && typeof value.timeoutMs === 'number'
      && Number.isSafeInteger(value.timeoutMs)
      && value.timeoutMs >= 100
      && value.timeoutMs <= 30_000
      && typeof value.stableMs === 'number'
      && Number.isSafeInteger(value.stableMs)
      && value.stableMs >= 0
      && value.stableMs <= 2_000
    case 'activate-tab':
    case 'close-tab': return isSafeTabId(value.tabId)
    default: return false
  }
}

/** Validate an operation-specific result received from the Service Worker. */
function isBridgeOperationResult(value: unknown): value is BridgeOperationResult {
  if (!isRecord(value)) return false
  switch (value.kind) {
    case 'open-tab': return isBridgeTab(value.tab)
    case 'list-tabs': return Array.isArray(value.tabs) && value.tabs.every(isBridgeTab)
    case 'read-page':
    case 'wait-page': return isBridgePage(value.page)
    case 'click-page-element':
    case 'fill-page-element':
    case 'select-page-option':
    case 'focus-page-element':
    case 'press-page-key': return isBridgePageActionReceipt(value.receipt)
      && value.receipt.action === receiptActionFor(value.kind)
    case 'scroll-page': return isBridgeScrollReceipt(value.receipt)
    case 'activate-tab': return isBridgeTab(value.tab)
    case 'close-tab': return isSafeTabId(value.tabId) && value.closed === true
    default: return false
  }
}

/** Return the receipt action required for one page-action result kind. */
function receiptActionFor(
  kind: 'click-page-element' | 'fill-page-element' | 'select-page-option' | 'focus-page-element' | 'press-page-key',
): BridgePageActionReceipt['action'] {
  if (kind === 'click-page-element') return 'clicked'
  if (kind === 'fill-page-element') return 'filled'
  if (kind === 'select-page-option') return 'selected'
  if (kind === 'focus-page-element') return 'focused'
  return 'pressed'
}

/**
 * Validate an extension failure exposed to the Web Client.
 * @param value - untrusted Service Worker failure.
 * @returns whether the failure has one supported stable code.
 */
export function isBridgeError(value: unknown): value is BridgeError {
  if (!isRecord(value) || typeof value.message !== 'string') return false
  return typeof value.code === 'string' && BRIDGE_ERROR_CODES.has(value.code as BridgeError['code'])
}

/**
 * Validate a Web Client probe.
 * @param value - untrusted page-bridge message.
 * @returns whether the value is a supported probe envelope.
 */
export function isBridgeProbe(value: unknown): value is BridgeProbe {
  return isRecord(value) && hasEnvelope(value, 'probe')
}

/**
 * Validate a content-script readiness message.
 * @param value - untrusted page-bridge message.
 * @returns whether the value is a supported readiness envelope.
 */
export function isBridgeReady(value: unknown): value is BridgeReady {
  return isRecord(value) && hasEnvelope(value, 'ready')
}

/**
 * Validate a side-panel lease wakeup posted into the Harness iframe.
 * @param value - untrusted parent-frame message.
 * @returns whether the value is a supported wakeup envelope.
 */
export function isBridgeLeaseWakeup(value: unknown): value is BridgeLeaseWakeup {
  return isRecord(value) && hasEnvelope(value, 'lease-wakeup')
}

/**
 * Validate a Web Client operation request.
 * @param value - untrusted page-bridge message.
 * @returns whether the value is a supported operation request.
 */
export function isBridgeRequest(value: unknown): value is BridgeRequest {
  return isRecord(value)
    && hasEnvelope(value, 'request')
    && typeof value.requestId === 'string'
    && value.requestId.length > 0
    && isBridgeOperation(value.operation)
}

/**
 * Validate a content-script operation response.
 * @param value - untrusted page-bridge message.
 * @returns whether the value is a supported operation response.
 */
export function isBridgeResponse(value: unknown): value is BridgeResponse {
  if (!isRecord(value)
    || !hasEnvelope(value, 'response')
    || typeof value.requestId !== 'string'
    || value.requestId.length === 0
    || !isRecord(value.response)
    || typeof value.response.ok !== 'boolean') return false
  return value.response.ok
    ? isBridgeOperationResult(value.response.value)
    : isBridgeError(value.response.error)
}
