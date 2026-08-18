/**
 * Browser tab operations and Host-to-extension routing payloads.
 * @module @deepseek-ai/dsh-browser/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Opaque identity of one connected browser-extension provider. */
export type BrowserClientId = Branded<'BrowserClientId'>

/** Opaque identity of one Host request routed to a browser extension. */
export type BrowserRequestId = Branded<'BrowserRequestId'>

/** Opaque identity of one current browser-page snapshot. */
export type BrowserPageId = Branded<'BrowserPageId'>

/**
 * Opaque identity of one document lifetime.
 * Stable across reads of the same document; replaced after refresh, navigation, or document swap.
 */
export type BrowserDocumentId = Branded<'BrowserDocumentId'>

/** Opaque identity of one captured viewport screenshot. Reserved for visual operations. */
export type BrowserScreenshotId = Branded<'BrowserScreenshotId'>

/** Opaque element reference valid only within one browser-page snapshot. */
export type BrowserPageElementRef = Branded<'BrowserPageElementRef'>

/** Browser tab data returned to model-facing consumers. */
export interface BrowserTab {
  /** Browser-assigned tab identifier. */
  id: number
  /** Browser-assigned window identifier. */
  windowId: number
  /** Whether the tab is active in its window. */
  active: boolean
  /** Current or pending URL when the browser exposes it. */
  url?: string
  /** Current title when the browser exposes it. */
  title?: string
}

/** Visible viewport and document scroll metrics for one page snapshot. */
export interface BrowserPageViewport {
  /** CSS pixel width of the layout viewport. */
  width: number
  /** CSS pixel height of the layout viewport. */
  height: number
  /** Horizontal document scroll offset. */
  scrollX: number
  /** Vertical document scroll offset. */
  scrollY: number
  /** Scrollable document width. */
  documentWidth: number
  /** Scrollable document height. */
  documentHeight: number
}

/** One option from a native select or listbox. */
export interface BrowserPageOption {
  /** Native option value. */
  value: string
  /** Visible option label. */
  label: string
  /** Whether the option is currently selected. */
  selected: boolean
  /** Whether the option currently rejects selection. */
  disabled: boolean
}

/** One current non-secret form value read from the active browser page. */
export interface BrowserPageField {
  /** Document-bound reference accepted by browser page action tools. */
  ref: BrowserPageElementRef
  /** User-facing form label or the best available accessible fallback. */
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
  /** Whether this control is the document's current focus target. */
  focused: boolean
  /** Short nearest dialog, form, row, or landmark title. */
  context?: string
  /** Native options when the control is a select. */
  options?: BrowserPageOption[]
}

/** One visible browser-page element that can be clicked by reference. */
export interface BrowserPageAction {
  /** Document-bound reference accepted by browser_click. */
  ref: BrowserPageElementRef
  /** Accessible interaction role. */
  role: string
  /** Visible or accessible label. */
  label: string
  /** Whether the element currently rejects activation. */
  disabled: boolean
  /** Whether the element intersects the current viewport. */
  inViewport: boolean
  /** Whether this action is the document's current focus target. */
  focused: boolean
  /** Short nearest dialog, form, row, or landmark title. */
  context?: string
  /** Absolute or page-relative href for links. */
  href?: string
  /** Current checked state for checkbox and radio actions. */
  checked?: boolean
  /** Current selected state for options and tabs. */
  selected?: boolean
  /** Current expanded state for disclosure controls. */
  expanded?: boolean
  /** Current pressed state for toggle buttons. */
  pressed?: boolean
}

/** One actually scrollable document or container returned by a page read. */
export interface BrowserPageScrollTarget {
  /** Document-bound reference accepted by browser_scroll. */
  ref: BrowserPageElementRef
  /** User-facing label for the scrollable region. */
  label: string
  /** Axes that currently have leftover scroll range. */
  axis: 'vertical' | 'horizontal' | 'both'
  /** Current vertical offset. */
  top: number
  /** Current horizontal offset. */
  left: number
  /** Maximum vertical offset. */
  maxTop: number
  /** Maximum horizontal offset. */
  maxLeft: number
}

/** Bounded visible snapshot of one browser page. */
export interface BrowserPage {
  /** Tab from which the snapshot was read. */
  tab: BrowserTab
  /** Snapshot identity regenerated by every browser_read_page call. */
  pageId: BrowserPageId
  /** Document identity that remains stable until navigation replaces the document. */
  documentId: BrowserDocumentId
  /** Monotonic DOM-change counter for the current document lifetime. */
  revision: number
  /** Current viewport and document scroll metrics. */
  viewport: BrowserPageViewport
  /** Rendered text from the top document and accessible same-origin child frames. */
  text: string
  /** Visible non-secret form controls and their current values. */
  fields: BrowserPageField[]
  /** Visible buttons, links, options, and toggles available to browser_click. */
  actions: BrowserPageAction[]
  /** Visible containers that currently have leftover scroll range. */
  scrollTargets: BrowserPageScrollTarget[]
  /** Whether text, fields, actions, or scroll targets were omitted to honor result limits. */
  truncated: boolean
}

/** Common document-bound target supplied by page action tools. */
export interface BrowserPageTarget {
  /** Page identity returned by the latest browser_read_page call. */
  pageId: BrowserPageId
  /** Element reference returned by the same browser_read_page call. */
  ref: BrowserPageElementRef
}

/** Caller request for reading one current or specified tab. */
export interface BrowserReadPageRequest {
  /** Browser-assigned tab identity; omitted to read the current active web tab. */
  tabId?: number
}

/** Caller request for filling one current page field. */
export interface BrowserFillPageRequest extends BrowserPageTarget {
  /** Complete replacement text. */
  value: string
  /** Whether to submit the owning form or dispatch Enter after filling. */
  submit?: boolean
}

/** Fully resolved fill operation sent to the extension provider. */
export interface BrowserFillPageSpec extends BrowserPageTarget {
  kind: 'fill-page-element'
  value: string
  submit: boolean
}

/** Caller request for selecting one native page option. */
export interface BrowserSelectPageRequest extends BrowserPageTarget {
  /** Exact native value or visible option text. */
  value: string
}

/** Discrete scroll movement accepted by browser_scroll. */
export type BrowserScrollMovement =
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

/** Caller request for scrolling the document viewport or one returned scroll target. */
export interface BrowserScrollPageRequest {
  /** Page identity returned by the latest browser_read_page call. */
  pageId: BrowserPageId
  /** Scroll-target reference from the same read; omitted to scroll the document viewport. */
  ref?: BrowserPageElementRef
  /** Discrete scroll movement. */
  movement: BrowserScrollMovement
}

/** Fully resolved scroll operation sent to the extension provider. */
export interface BrowserScrollPageSpec extends BrowserScrollPageRequest {
  kind: 'scroll-page'
}

/** Observed scroll offsets after one scroll operation. */
export interface BrowserScrollReceipt {
  /** Page identity supplied by the caller. */
  pageId: BrowserPageId
  /** Scroll-target reference when a container was scrolled. */
  ref?: BrowserPageElementRef
  /** Requested movement. */
  movement: BrowserScrollMovement
  /** Vertical offset after the attempt. */
  top: number
  /** Horizontal offset after the attempt. */
  left: number
  /** Maximum vertical offset. */
  maxTop: number
  /** Maximum horizontal offset. */
  maxLeft: number
  /** Whether the offset actually changed. */
  moved: boolean
  /** Whether the container was already at the requested boundary. */
  atBoundary: boolean
}

/** Keys accepted by the bounded keyboard operation. */
export type BrowserPressKey =
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

/** Optional keyboard modifiers for one bounded key press. */
export interface BrowserPressModifiers {
  ctrl?: boolean
  alt?: boolean
  shift?: boolean
  meta?: boolean
}

/** Caller request for a bounded keyboard operation against one referenced element. */
export interface BrowserPressPageRequest extends BrowserPageTarget {
  /** Allowed key name. Arbitrary key names are rejected. */
  key: BrowserPressKey
  /** Optional modifier keys. */
  modifiers?: BrowserPressModifiers
  /** Repeat count from 1 through 20. Defaults to 1. */
  repeat?: number
}

/** Fully resolved keyboard operation sent to the extension provider. */
export interface BrowserPressPageSpec extends BrowserPageTarget {
  kind: 'press-page-key'
  key: BrowserPressKey
  modifiers: BrowserPressModifiers
  repeat: number
}

/** Wait until the current document identity or revision advances. */
export interface BrowserWaitChangeCondition {
  kind: 'change'
  documentId: BrowserDocumentId
  afterRevision: number
}

/** Wait until visible page text contains or no longer contains a string. */
export interface BrowserWaitTextCondition {
  kind: 'text'
  text: string
  state: 'present' | 'absent'
}

/** Wait until the tab URL matches an exact, prefix, or substring comparison. */
export interface BrowserWaitUrlCondition {
  kind: 'url'
  value: string
  match: 'exact' | 'prefix' | 'contains'
}

/** Wait until the document finishes loading and stays unchanged for stableMs. */
export interface BrowserWaitReadyCondition {
  kind: 'ready'
}

/** Condition evaluated by wait-page. */
export type BrowserWaitCondition =
  | BrowserWaitChangeCondition
  | BrowserWaitTextCondition
  | BrowserWaitUrlCondition
  | BrowserWaitReadyCondition

/** Caller request for waiting until a page condition holds, then returning a fresh snapshot. */
export interface BrowserWaitPageRequest {
  kind: 'wait-page'
  /** Snapshot identity whose originating tab should be observed. Preferred after browser_read_page. */
  pageId?: BrowserPageId
  /** Browser-assigned tab identity to observe when no page snapshot is available. */
  tabId?: number
  /** Condition that must become true before the wait returns. */
  condition: BrowserWaitCondition
  /** Maximum wait in milliseconds. Defaults to 5000. Allowed range is 100–30000. */
  timeoutMs?: number
  /** Quiet period with no further document changes. Defaults to 150. Allowed range is 0–2000. */
  stableMs?: number
}

/** Fully resolved wait operation sent to the extension provider. */
export interface BrowserWaitPageSpec {
  kind: 'wait-page'
  pageId?: BrowserPageId
  tabId?: number
  condition: BrowserWaitCondition
  timeoutMs: number
  stableMs: number
}

/** Confirmation that one document-bound page operation completed. */
export interface BrowserPageActionReceipt extends BrowserPageTarget {
  /** Browser-side effect that completed. */
  action: 'clicked' | 'filled' | 'selected' | 'focused' | 'pressed'
  /** Resolved native option value for a select action. */
  value?: string
  /** Key that produced a pressed receipt. */
  key?: BrowserPressKey
}

/** Caller request for opening one HTTP(S) tab. */
export interface BrowserOpenTabRequest {
  /** Absolute HTTP(S) URL. Credential-bearing URLs are rejected. */
  url: string
  /** Whether the new tab becomes active; defaults to true. */
  active?: boolean
}

/** Fully resolved open-tab operation sent to the extension provider. */
export interface BrowserOpenTabSpec {
  kind: 'open-tab'
  url: string
  active: boolean
}

/** Browser operation routed from the Host to one extension provider. */
export type BrowserOperation =
  | BrowserOpenTabSpec
  | { kind: 'list-tabs' }
  | ({ kind: 'read-page' } & BrowserReadPageRequest)
  | ({ kind: 'click-page-element' } & BrowserPageTarget)
  | BrowserFillPageSpec
  | ({ kind: 'select-page-option' } & BrowserSelectPageRequest)
  | BrowserScrollPageSpec
  | ({ kind: 'focus-page-element' } & BrowserPageTarget)
  | BrowserPressPageSpec
  | BrowserWaitPageSpec
  | { kind: 'activate-tab'; tabId: number }
  | { kind: 'close-tab'; tabId: number }

/** Successful result returned by an extension provider. */
export type BrowserOperationResult =
  | { kind: 'open-tab'; tab: BrowserTab }
  | { kind: 'list-tabs'; tabs: BrowserTab[] }
  | { kind: 'read-page'; page: BrowserPage }
  | { kind: 'click-page-element'; receipt: BrowserPageActionReceipt }
  | { kind: 'fill-page-element'; receipt: BrowserPageActionReceipt }
  | { kind: 'select-page-option'; receipt: BrowserPageActionReceipt }
  | { kind: 'scroll-page'; receipt: BrowserScrollReceipt }
  | { kind: 'focus-page-element'; receipt: BrowserPageActionReceipt }
  | { kind: 'press-page-key'; receipt: BrowserPageActionReceipt }
  | { kind: 'wait-page'; page: BrowserPage }
  | { kind: 'activate-tab'; tab: BrowserTab }
  | { kind: 'close-tab'; tabId: number; closed: true }

/** Stable extension-side failure codes accepted by the Host. */
export type BrowserExtensionErrorCode =
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

/** One command broadcast to Client plugins and claimed only by its selected provider. */
export interface BrowserCommand {
  requestId: BrowserRequestId
  clientId: BrowserClientId
  operation: BrowserOperation
}

/** Extension response to one command. */
export interface BrowserCompletion {
  requestId: BrowserRequestId
  clientId: BrowserClientId
  response:
    | { ok: true; value: BrowserOperationResult }
    | { ok: false; error: { code: BrowserExtensionErrorCode; message: string } }
}

/** Lease returned when a browser extension registers through the Web Client. */
export interface BrowserClientLease {
  clientId: BrowserClientId
  /** Provider heartbeat deadline measured from the last successful registration or heartbeat. */
  leaseMs: number
  /** Maximum time the Client bridge retains one unanswered page-to-extension request. */
  requestTimeoutMs: number
}

/** Receipt for a disconnect request. */
export interface BrowserDisconnectReceipt {
  disconnected: boolean
}

/** Receipt for an extension completion. */
export type BrowserCompletionReceipt =
  | { accepted: true }
  | { accepted: false; reason: 'request-not-found' | 'wrong-client' | 'result-kind-mismatch' }

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Deliver one browser command to the selected Web Client provider.
     * @param command - request identity, provider identity, and validated operation.
     * @mode emit
     */
    'browser/command'(command: BrowserCommand): void
  }
}
