/** Page-to-content-script protocol owned by the browser-extension provider package. */

/** Protocol channel shared by the Web Client, content script, and Service Worker. */
export const BROWSER_EXTENSION_CHANNEL = 'dsh-browser-extension'
/** Protocol version shared by the Web Client, content script, and Service Worker. */
export const BROWSER_EXTENSION_PROTOCOL_VERSION = 6
/** Maximum serialized UTF-8 bytes accepted for one complete page-read result. */
export const BROWSER_PAGE_RESULT_MAX_BYTES = 96 * 1024
/** Maximum serialized UTF-8 bytes accepted for one page-inspect result. */
export const BROWSER_INSPECT_RESULT_MAX_BYTES = 48 * 1024
/** Maximum network entries retained for one inspect snapshot. */
export const BROWSER_INSPECT_NETWORK_MAX = 40
/** Maximum console entries retained for one inspect snapshot. */
export const BROWSER_INSPECT_CONSOLE_MAX = 40
/** Maximum characters retained for one inspect URL or console line. */
export const BROWSER_INSPECT_TEXT_MAX = 500
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

/** Rounded viewport-relative placement of one element. */
export interface BridgePageRect {
  /** Distance in CSS pixels from the viewport left edge. */
  x: number
  /** Distance in CSS pixels from the viewport top edge. */
  y: number
  /** Rendered width in CSS pixels. */
  width: number
  /** Rendered height in CSS pixels. */
  height: number
}

/** One visible element that can be clicked in the current document. */
export interface BridgePageAction {
  /** Opaque document-bound element reference used by page action tools. */
  ref: string
  /** Accessible interaction role exposed to the model. */
  role: string
  /** Visible or accessible element label. */
  label: string
  /** Placement of an unlabeled or compact control, so siblings remain distinguishable. */
  rect?: BridgePageRect
  /** Whether the control uses a saturated non-gray fill, matching primary or colored send buttons. */
  accent?: boolean
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

/** One observed page network call captured after the MAIN-world probe was installed. */
export interface BridgeNetworkEntry {
  /** Epoch milliseconds when the request finished or failed. */
  at: number
  /** Browser API that produced the observation. */
  source: 'fetch' | 'xhr'
  /** HTTP method. */
  method: string
  /** Sanitized request URL without credentials or secret query values. */
  url: string
  /** HTTP status when the call completed. */
  status?: number
  /** Whether the HTTP status was in the 2xx range. */
  ok?: boolean
  /** Elapsed milliseconds from send to completion. */
  durationMs?: number
  /** Failure text when the call did not complete with a response. */
  error?: string
}

/** One observed page console or error event. */
export interface BridgeConsoleEntry {
  /** Epoch milliseconds when the message was recorded. */
  at: number
  /** Console severity. */
  level: 'log' | 'info' | 'warn' | 'error' | 'debug'
  /** Bounded rendered message text. */
  text: string
}

/** Bounded Network/Console snapshot returned by the page probe. */
export interface BridgePageInspectContent {
  /** Whether the MAIN-world fetch/XHR/console probe answered this inspect. */
  hooked: boolean
  /** Epoch milliseconds when the probe was first installed in this document. */
  hookedAt?: number
  /** Recent page network calls. */
  network: BridgeNetworkEntry[]
  /** Recent page console messages. */
  console: BridgeConsoleEntry[]
  /** Network entries dropped because the ring buffer was full. */
  omittedNetwork: number
  /** Console entries dropped because the ring buffer was full. */
  omittedConsole: number
}

/** Active-tab metadata plus a bounded page inspect snapshot. */
export interface BridgePageInspect extends BridgePageInspectContent {
  /** Active browser tab from which the inspect was taken. */
  tab: BridgeTab
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

/** Named keys accepted without a shortcut modifier. */
export const NAMED_PRESS_KEYS = [
  'Enter', 'Escape', 'Tab', 'Space',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Home', 'End', 'PageUp', 'PageDown', 'Backspace', 'Delete',
] as const

/** Letter keys accepted only with Control, Alt, or Meta. */
export const LETTER_PRESS_KEYS = [
  'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
  'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
] as const

/** Digit keys accepted only with Control, Alt, or Meta. */
export const DIGIT_PRESS_KEYS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

/** Complete bounded keyboard allowlist. */
export const PRESS_KEY_VALUES = [...NAMED_PRESS_KEYS, ...LETTER_PRESS_KEYS, ...DIGIT_PRESS_KEYS] as const

/** Keys accepted by the bounded keyboard operation. */
export type BridgePressKey = (typeof PRESS_KEY_VALUES)[number]

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
  | { kind: 'inspect-page'; tabId?: number; reset: boolean }
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
  | { kind: 'inspect-page'; inspect: BridgePageInspect }
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
const PRESS_KEYS = new Set<BridgePressKey>(PRESS_KEY_VALUES)
const NAMED_PRESS_KEY_SET = new Set<string>(NAMED_PRESS_KEYS)
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

/** Return whether one press operation carries a page-shortcut modifier. */
function hasShortcutModifier(modifiers: { ctrl?: boolean; alt?: boolean; meta?: boolean }): boolean {
  return modifiers.ctrl === true || modifiers.alt === true || modifiers.meta === true
}

/**
 * Return whether one key is allowed for the current modifier set.
 * Named keys work alone. Letter and digit keys are page shortcuts and require Control, Alt, or Meta.
 */
function isAllowedPressKey(
  key: unknown,
  modifiers: { ctrl?: boolean; alt?: boolean; meta?: boolean },
): key is BridgePressKey {
  if (typeof key !== 'string' || !PRESS_KEYS.has(key as BridgePressKey)) return false
  return NAMED_PRESS_KEY_SET.has(key) || hasShortcutModifier(modifiers)
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

/** Validate one optional element placement. */
function isBridgePageRect(value: unknown): value is BridgePageRect {
  return isRecord(value)
    && Number.isFinite(value.x)
    && Number.isFinite(value.y)
    && isNonNegativeNumber(value.width)
    && isNonNegativeNumber(value.height)
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
    && (value.rect === undefined || isBridgePageRect(value.rect))
    && (value.accent === undefined || typeof value.accent === 'boolean')
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

/** Validate one bounded network observation. */
function isBridgeNetworkEntry(value: unknown): value is BridgeNetworkEntry {
  return isRecord(value)
    && typeof value.at === 'number'
    && Number.isSafeInteger(value.at)
    && value.at >= 0
    && (value.source === 'fetch' || value.source === 'xhr')
    && typeof value.method === 'string'
    && value.method.length > 0
    && value.method.length <= 16
    && typeof value.url === 'string'
    && value.url.length <= BROWSER_INSPECT_TEXT_MAX
    && (value.status === undefined
      || (typeof value.status === 'number' && Number.isSafeInteger(value.status) && value.status >= 0 && value.status <= 999))
    && (value.ok === undefined || typeof value.ok === 'boolean')
    && (value.durationMs === undefined
      || (typeof value.durationMs === 'number' && Number.isSafeInteger(value.durationMs) && value.durationMs >= 0))
    && (value.error === undefined || (typeof value.error === 'string' && value.error.length <= BROWSER_INSPECT_TEXT_MAX))
}

/** Validate one bounded console observation. */
function isBridgeConsoleEntry(value: unknown): value is BridgeConsoleEntry {
  return isRecord(value)
    && typeof value.at === 'number'
    && Number.isSafeInteger(value.at)
    && value.at >= 0
    && (value.level === 'log' || value.level === 'info' || value.level === 'warn' || value.level === 'error' || value.level === 'debug')
    && typeof value.text === 'string'
    && value.text.length <= BROWSER_INSPECT_TEXT_MAX
}

/**
 * Validate inspect content returned directly by the active-page script.
 * @param value - untrusted content-script result.
 * @returns whether the value is one bounded inspect snapshot.
 */
export function isBridgePageInspectContent(value: unknown): value is BridgePageInspectContent {
  return isRecord(value)
    && typeof value.hooked === 'boolean'
    && (value.hookedAt === undefined
      || (typeof value.hookedAt === 'number' && Number.isSafeInteger(value.hookedAt) && value.hookedAt >= 0))
    && Array.isArray(value.network)
    && value.network.length <= BROWSER_INSPECT_NETWORK_MAX
    && value.network.every(isBridgeNetworkEntry)
    && Array.isArray(value.console)
    && value.console.length <= BROWSER_INSPECT_CONSOLE_MAX
    && value.console.every(isBridgeConsoleEntry)
    && typeof value.omittedNetwork === 'number'
    && Number.isSafeInteger(value.omittedNetwork)
    && value.omittedNetwork >= 0
    && typeof value.omittedConsole === 'number'
    && Number.isSafeInteger(value.omittedConsole)
    && value.omittedConsole >= 0
}

/**
 * Validate one complete bounded page-inspect result.
 * @param value - untrusted extension result.
 * @returns whether the value is one complete bounded inspect result.
 */
export function isBridgePageInspect(value: unknown): value is BridgePageInspect {
  return isRecord(value)
    && isBridgeTab(value.tab)
    && isBridgePageInspectContent(value)
    && jsonByteLength(value) <= BROWSER_INSPECT_RESULT_MAX_BYTES
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
    case 'inspect-page': return (value.tabId === undefined || isSafeTabId(value.tabId))
      && typeof value.reset === 'boolean'
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
      && isRecord(value.modifiers)
      && (value.modifiers.ctrl === undefined || typeof value.modifiers.ctrl === 'boolean')
      && (value.modifiers.alt === undefined || typeof value.modifiers.alt === 'boolean')
      && (value.modifiers.shift === undefined || typeof value.modifiers.shift === 'boolean')
      && (value.modifiers.meta === undefined || typeof value.modifiers.meta === 'boolean')
      && isAllowedPressKey(value.key, {
        ctrl: value.modifiers.ctrl === true,
        alt: value.modifiers.alt === true,
        meta: value.modifiers.meta === true,
      })
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
    case 'inspect-page': return isBridgePageInspect(value.inspect)
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
