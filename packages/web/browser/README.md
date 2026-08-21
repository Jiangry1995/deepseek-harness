# @deepseek-ai/dsh-browser

English | [中文](README.zh.md)

`BrowserService` (`ctx.browser`) is the Host broker for browser-tab operations executed by an installed Chromium extension. The service owns provider leases, provider selection, request identity, cancellation, timeouts, result validation, and stable `BrowserError` codes; it never calls Chromium APIs directly.

The browser-tab capability has three roles:

| Package | Role |
|---|---|
| `@deepseek-ai/dsh-browser` | Service Definition and Host broker (`ctx.browser`) |
| `@deepseek-ai/dsh-client-browser-extension` | Service Provider that connects the Web Client to the MV3 extension |
| `@deepseek-ai/dsh-tool-browser` | Consumer that exposes model-facing browser tools |

The [browser-tab Agent Note](../../../.agents/notes/implemented/feature/2026-08-14-browser-tab-extension.md) records the cross-process ownership decision. The [page-control Agent Note](../../../.agents/notes/implemented/feature/2026-08-16-browser-side-assistant-page-control.md) records document-bound interaction and companion lifecycle decisions. The [semantic automation Agent Note](../../../.agents/notes/implemented/feature/2026-08-16-semantic-browser-automation.md) records document identity, wait, scroll, focus, and bounded keyboard operations.

## Service behavior

Web Clients register generated provider identities through the Typert Remote methods `connect`, `heartbeat`, `disconnect`, and `complete`. A registration is a lease rather than a permanent capability claim. `BrowserService` removes expired leases and rejects every request owned by a disconnected or expired provider.

Each operation selects the most recently seen live provider, emits one `browser/command` Remote event addressed to that provider, and retains the request until the provider completes it, the caller aborts, the configured timeout elapses, the provider disconnects, or the service is disposed. Completion is accepted only from the selected provider and only when its result discriminant matches the operation.

`openTab` accepts absolute credential-free HTTP(S) URLs and defaults `active` to `true`. `listTabs` returns tabs from the extension's current browser window. `readPage` returns the requested or current web tab, rendered text, current visible non-secret form values and focus state, clickable elements, scroll targets, viewport metrics, a snapshot `pageId`, a stable `documentId`, a document `revision`, element refs, and a truncation marker. `inspectPage` requires `start`, `snapshot`, or `stop`: capture begins only after `start`, `snapshot` leaves it active, and `stop` returns the final bounded fetch/XHR and console observations while releasing page hooks. It cannot open native DevTools or return request or response bodies. `clickPage`, `fillPage`, `selectPage`, `scrollPage`, `focusPage`, and `pressPage` accept a `pageId/ref` pair from the latest read; the Host requires the completion receipt to echo the same pair. Fill defaults `submit` to `false` and the provider must verify the control's actual value. `pressPage` accepts named keys and, with Control, Alt, or Meta, letter and digit page shortcuts. `waitPage` accepts the latest `pageId`, or a tab id when no snapshot exists, waits for document change, text, URL, or load stability, and returns a fresh snapshot. `activateTab` and `closeTab` accept non-negative safe-integer tab ids returned by the browser.

## Configuration

| Field | Default | Meaning |
|---|---:|---|
| `requestTimeoutMs` | `15000` | Maximum Host wait for one extension completion. `wait-page` uses `max(requestTimeoutMs, timeoutMs + 1500)`. |
| `clientLeaseMs` | `300000` | Provider lease duration since the last successful registration or heartbeat. Long enough to survive Chromium throttling hidden iframe timers to about one tick per minute. |

The Client receives both values in its lease. It renews at half the advertised lease duration and retains each page-to-extension request for the Host timeout minus 1000ms of slack. `wait-page` uses the same Host formula as this service before subtracting slack, so the in-page wait can finish first.

## Errors

`BrowserError extends HarnessError`. Callers can branch on its stable codes for invalid provider ids, missing providers, invalid URLs, tab ids, or page references, cancellation, timeout, disconnect, mismatched results, extension validation failures, missing tabs, stale documents, missing, disabled, or incompatible elements, absent select options, unavailable current-page authority, and Chromium API failures. An unavailable extension is an execution failure; the service and model-facing schemas remain registered so configuration problems are visible rather than silently removing tools.

## Model Experience

Indirectly, through `dsh-tool-browser`, which owns the browser prompt, tool schemas, approvals, and rendered results while this service contributes no model context itself.

#### KV Cache effect

No direct invalidation; the Consumer owns every request-prefix change.

## Known Limitations and Deferred Work

- **One automatically selected browser window** — multiple connected Web Clients are not user-selectable; the newest live provider wins, and `listTabs` is limited to that provider's current window.
- **Bounded page action set** — the service can click, fill, select, scroll, focus, and press returned refs, and wait for page change. It cannot query arbitrary selectors, execute caller JavaScript, read cross-origin frames, manage downloads, expose cookies, or perform unrestricted keyboard and pointer automation.
- **No durable provider state** — leases and pending requests live in memory and are lost when the Host or Web page stops.
