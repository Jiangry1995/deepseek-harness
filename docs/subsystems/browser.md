# Browser Tabs

English | [中文](browser.zh.md)

The browser capability lets an agent control tabs and operate referenced elements in the user's current Chromium window without placing browser APIs in the Host process. Its Service Definition and Host broker are [`dsh-browser`](../../packages/web/browser), the Service Provider is [`dsh-client-browser-extension`](../../packages/client/browser-extension), and the Consumer is [`dsh-tool-browser`](../../packages/web/tool-browser). The [browser-tab Agent Note](../../.agents/notes/implemented/feature/2026-08-14-browser-tab-extension.md) owns cross-process routing; the [page-control Agent Note](../../.agents/notes/implemented/feature/2026-08-16-browser-side-assistant-page-control.md) owns document-bound interaction and local companion lifecycle.

Source: [`packages/web/browser/src/types.ts`](../../packages/web/browser/src/types.ts)

## Routing and ownership

`ctx.browser` owns provider leases and pending requests. The extension action opens a side panel whose extension-owned shell embeds the configured loopback Harness Web UI; a side-panel or standalone Web Client becomes a provider only after its page bridge detects the installed extension. The Host selects the most recently seen live provider, emits an addressed `browser/command` through the allowlisted Remote-event carrier, and accepts a completion only from that provider. The Client forwards the operation across the isolated-world page bridge; the MV3 Service Worker calls `chrome.tabs`, and the target tab's content script reads or operates its DOM.

This path keeps model-facing schemas in the Consumer, request lifecycle and errors in the Host service, Web Client connectivity in the Client plugin, and Chromium permissions in the extension.

## Operations and results

The service supports a closed set of operations: open one credential-free HTTP(S) URL, list tabs, read a current or specified page, click, fill, select, scroll, focus, or press one returned reference, wait for a page condition, activate one tab, and close one tab. A page read creates an opaque `pageId` and element refs; the extension retains the originating tab for that snapshot. A new read or navigation invalidates the preceding coordinates, and action completions must echo the requested pair. Every result repeats the operation discriminant so the Host rejects a completion for the wrong operation.

```ts type-equiv
/** Browser tab data returned to model-facing consumers. */
interface BrowserTab {
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
```

```ts type-equiv
/** Fully resolved open-tab operation sent to the extension provider. */
interface BrowserOpenTabSpec {
  kind: 'open-tab'
  url: string
  active: boolean
}
```

```ts type-equiv
/** Browser operation routed from the Host to one extension provider. */
type BrowserOperation =
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
```

```ts type-equiv
/** Successful result returned by an extension provider. */
type BrowserOperationResult =
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
```

## Provider leases

Registrations are renewable leases so a closed or disconnected Web page cannot remain the selected provider indefinitely. The lease gives the Client the Host expiry and request-retention timings; the Client renews halfway through the lease. Disconnect, expiry, request timeout, caller cancellation, and service disposal all settle affected pending requests.

```ts type-equiv
/** Lease returned when a browser extension registers through the Web Client. */
interface BrowserClientLease {
  clientId: BrowserClientId
  /** Provider heartbeat deadline measured from the last successful registration or heartbeat. */
  leaseMs: number
  /** Maximum time the Client bridge retains one unanswered page-to-extension request. */
  requestTimeoutMs: number
}
```

## Security and failure behavior

The extension manifest grants side-panel, storage, Native Messaging, tab, scripting, and ordinary HTTP(S) page access. Extension-page frame/connect policy remains loopback-only. The background listener requires this extension's sender id and a loopback sender URL before accepting Host operations. Page reads exclude password, file, hidden, one-time-code, and payment-secret controls. Page actions accept only refs from the latest read, reject disabled or incompatible elements, and never accept arbitrary selectors. Both bridge halves validate the protocol envelope and operation-specific data, while the Host independently validates URLs, tab ids, page coordinates, selected provider identity, and result discriminants.

These checks restrict reachability; they do not authenticate a non-loopback Harness deployment. The packaged provider therefore stays loopback-only even when the HTTP server trusts another authority. Browser failures are execution errors with stable `BrowserError` codes, and missing extension state never removes the model-facing schemas.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxbrowser--browserservice"></a>

### `ctx.browser` — `BrowserService`

Routes browser operations to the most recently healthy WebExtension provider. Provider registrations are leases: expiry, disconnect, service disposal, caller cancellation, and request timeout all settle every affected pending operation.

```ts cordis-catalog
/**
 * Register or renew a WebExtension provider identity.
 * @param rawClientId - untrusted candidate identity generated by the Web Client.
 * @param visible - whether the provider's page is renderer-visible and can answer promptly.
 * @returns the validated identity and timing values the Client must honor.
 */
@Remote('connect') connect(rawClientId: string, visible: boolean): BrowserClientLease

/**
 * Renew one registered provider lease.
 * @param clientId - identity returned by {@link connect}.
 * @param visible - whether the provider's page is renderer-visible and can answer promptly.
 * @returns the renewed lease timing values.
 * @throws BROWSER_CLIENT_NOT_CONNECTED when the lease is absent or expired.
 */
@Remote('heartbeat') heartbeat(clientId: BrowserClientId, visible: boolean): BrowserClientLease

/**
 * Remove one provider and reject its outstanding operations.
 * @param clientId - identity returned by {@link connect}.
 * @returns whether a current provider lease was removed.
 */
@Remote('disconnect') disconnect(clientId: BrowserClientId): BrowserDisconnectReceipt

/**
 * Complete one Host request from its selected extension provider.
 * @param completion - echoed request and provider identities plus success or failure.
 * @returns whether the completion matched and settled a pending request.
 */
@Remote('complete') complete(completion: BrowserCompletion): BrowserCompletionReceipt

/**
 * Resolve caller defaults and validate one open-tab request.
 * @param request - URL and optional activation preference.
 * @returns a complete provider operation.
 */
resolveOpenTab(request: BrowserOpenTabRequest): BrowserOpenTabSpec

/**
 * Open one HTTP(S) tab through the selected extension provider.
 * @param request - URL and optional activation preference.
 * @param signal - caller cancellation.
 * @returns the created tab.
 */
async openTab(request: BrowserOpenTabRequest, signal: AbortSignal): Promise<BrowserTab>

/**
 * List tabs in the extension's current browser window.
 * @param signal - caller cancellation.
 * @returns tabs visible to the extension.
 */
async listTabs(signal: AbortSignal): Promise<BrowserTab[]>

/**
 * Read bounded visible text and non-secret form values from one browser page.
 * @param requestOrSignal - optional tab identity, or the caller AbortSignal for the active tab.
 * @param signal - caller cancellation when the first argument is a request record.
 * @returns the tab metadata and its main-frame page snapshot.
 */
async readPage(requestOrSignal: BrowserReadPageRequest | AbortSignal, signal?: AbortSignal): Promise<BrowserPage>

/**
 * Validate and brand a document-bound target returned by the latest page read.
 * @param rawPageId - page UUID supplied at the model-tool boundary.
 * @param rawRef - element reference supplied at the model-tool boundary.
 * @returns a typed target accepted by page action methods.
 */
resolvePageTarget(rawPageId: string, rawRef: string): BrowserPageTarget

/**
 * Validate and brand a snapshot identity returned by the latest page read.
 * @param rawPageId - page UUID supplied at the model-tool boundary.
 * @returns the branded snapshot identity.
 */
resolvePageId(rawPageId: string): BrowserPage['pageId']

/**
 * Click one element referenced by the latest current-page snapshot.
 * @param target - validated page and element identities.
 * @param signal - caller cancellation.
 * @returns confirmation of the completed click.
 */
async clickPage(target: BrowserPageTarget, signal: AbortSignal): Promise<BrowserPageActionReceipt>

/**
 * Fill one text field referenced by the latest current-page snapshot.
 * @param request - validated target, replacement value, and submit preference.
 * @param signal - caller cancellation.
 * @returns confirmation of the completed fill.
 */
async fillPage(request: BrowserFillPageRequest, signal: AbortSignal): Promise<BrowserPageActionReceipt>

/**
 * Select one native option referenced by the latest current-page snapshot.
 * @param request - validated target and exact option value or visible text.
 * @param signal - caller cancellation.
 * @returns confirmation including the resolved native option value.
 */
async selectPage(request: BrowserSelectPageRequest, signal: AbortSignal): Promise<BrowserPageActionReceipt>

/**
 * Scroll the document viewport or one scroll target from the latest page read.
 * @param request - validated page identity, optional scroll-target ref, and discrete movement.
 * @param signal - caller cancellation.
 * @returns observed offsets after the scroll attempt, including an at-boundary result.
 */
async scrollPage(request: BrowserScrollPageRequest, signal: AbortSignal): Promise<BrowserScrollReceipt>

/**
 * Focus one field or focusable action from the latest page read.
 * @param target - validated page and element identities.
 * @param signal - caller cancellation.
 * @returns confirmation that document.activeElement is the referenced element.
 */
async focusPage(target: BrowserPageTarget, signal: AbortSignal): Promise<BrowserPageActionReceipt>

/**
 * Press one allowed key against a referenced element from the latest page read.
 * @param request - validated target, allowed key, optional modifiers, and repeat count.
 * @param signal - caller cancellation.
 * @returns confirmation of the completed key effect.
 */
async pressPage(request: BrowserPressPageRequest, signal: AbortSignal): Promise<BrowserPageActionReceipt>

/**
 * Validate and default one bounded keyboard request.
 * @param request - target, key, optional modifiers, and optional repeat count.
 * @returns a complete provider operation.
 */
resolvePressPage(request: BrowserPressPageRequest): BrowserPressPageSpec

/**
 * Wait until a page condition holds, then return a fresh snapshot.
 * @param request - tab identity, condition, and optional timeout bounds.
 * @param signal - caller cancellation.
 * @returns a new page snapshot after the condition is observed.
 */
async waitPage(request: BrowserWaitPageRequest, signal: AbortSignal): Promise<BrowserPage>

/**
 * Validate and default one wait-page request.
 * @param request - tab identity, condition, and optional timeout bounds.
 * @returns a complete provider operation.
 */
resolveWaitPage(request: BrowserWaitPageRequest): BrowserWaitPageSpec

/**
 * Activate one tab in its browser window.
 * @param tabId - browser-assigned tab identifier.
 * @param signal - caller cancellation.
 * @returns the activated tab.
 */
async activateTab(tabId: number, signal: AbortSignal): Promise<BrowserTab>

/**
 * Close one tab.
 * @param tabId - browser-assigned tab identifier.
 * @param signal - caller cancellation.
 * @returns the closed tab identity.
 */
async closeTab(tabId: number, signal: AbortSignal): Promise<{ tabId: number; closed: true }>
```

Source: [`packages/web/browser/src/index.ts:267`](../../packages/web/browser/src/index.ts)

<a id="browser-events"></a>

### `browser/*` events

<a id="browsercommand--emit"></a>

#### `browser/command` — emit

Deliver one browser command to the selected Web Client provider.

```ts cordis-catalog
/**
 * Deliver one browser command to the selected Web Client provider.
 * @param command - request identity, provider identity, and validated operation.
 * @mode emit
 */
'browser/command'(command: BrowserCommand): void
```

Source: [`packages/web/browser/src/types.ts:470`](../../packages/web/browser/src/types.ts)
<!-- END GENERATED cordis-surface -->
