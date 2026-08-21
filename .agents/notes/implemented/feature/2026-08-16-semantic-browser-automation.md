# Agent Note: Semantic browser automation

Status: implemented

English | [中文](2026-08-16-semantic-browser-automation.zh.md)

This note extends [browser side-assistant page control](2026-08-16-browser-side-assistant-page-control.md). The earlier note remains authority for read-before-action, opaque refs, secret exclusion, and companion startup. This note records the additional document identity, wait, scroll, focus, and bounded keyboard surface.

## Problem

The first page-control delivery could read a snapshot and click, fill, or select one referenced element. It could not wait for asynchronous updates, scroll a long page or inner container, focus a control, press a bounded key, or read a specified tab without activating it. The model therefore could look once and click once, but could not close an observe-act-wait-verify loop against a live page.

## Decision

Page snapshots now carry three identities:

- `pageId` is still regenerated on every read. Element refs are valid only for that snapshot.
- `documentId` is an opaque random UUID that stays stable for the current document lifetime and changes after refresh, navigation, or document replacement. It is never a URL.
- `revision` is a monotonic document-change counter. Each read arms one MutationObserver that increments it for the first subsequent non-protocol mutation and then disconnects; stability waits own a separate observer for their request lifetime.

`read-page` accepts an optional `tabId`. When omitted, the extension still reads the current active web tab, preferring the side-panel header tab. Chrome-internal, extension, and unscriptable pages return `BROWSER_PAGE_ACCESS_DENIED`.

Every returned snapshot records its originating tab in the Service Worker. Document-bound actions resolve that retained `pageId` before consulting the current side-panel tab, so switching tabs between read and action cannot redirect an operation. `wait-page` accepts the latest `pageId` as its preferred target. A retained binding that conflicts with an explicit `tabId` is `BROWSER_PAGE_STALE`. A missing in-memory binding falls back to the focused or active tab, matching fill, because a Service Worker restart drops the map while the page and side panel remain; [composer send and wait recovery](../bug-fix/2026-08-19-browser-composer-send-and-wait-recovery.md) owns that correction. The side-panel tab projection uses a monotonic generation so a slower lookup for an older activation cannot overwrite the latest title or focused-tab report.

Fields and actions report whether they own `document.activeElement`. The model-visible page rendering includes the browser tab id, focus state, native options, link hrefs, and checked, selected, expanded, and pressed states that the reader already collected.

The closed operation set grows by generic primitives, not site adapters:

- `scroll-page` moves the document viewport or a `scrollTargets` ref from the latest read. Discrete movements only; no selectors, XPath, or coordinates. An unchanged offset returns `atBoundary: true` instead of claiming a move.
- `focus-page-element` focuses a returned field or focusable action and checks `document.activeElement`.
- `press-page-key` accepts a closed key list and optional modifiers, with `repeat` in 1–20. Success requires an observable page response. Arbitrary key names are `BROWSER_KEY_UNSUPPORTED`. If only a synthetic event can be dispatched and the page does not respond, the result is `BROWSER_CAPABILITY_UNAVAILABLE` rather than a fake success. Debugger-backed real keyboard input remains out of this delivery.
- `wait-page` waits for document change, text presence or absence, URL match, or load stability, then returns a fresh `BrowserPage`. Timeouts are 100–30000 ms; `stableMs` is 0–2000 ms. `BROWSER_WAIT_TIMEOUT` includes the last URL, `documentId`, and `revision`, not the page body. URL waits observe `location.href`, so History API, hash, popstate, and real navigation are covered; navigation that destroys the content script is retried by the Service Worker.

Fill still uses native prototype setters plus `input`/`change` for input and textarea, and Chromium editing commands for contenteditable. After filling, the actor reads the actual control value and fails when it does not match. When submit is requested, or Enter is pressed outside a native form, the actor clicks a nearby send or submit control instead of treating a synthetic Enter as a completed send. Password, OTP, payment, file, hidden, disabled, and read-only controls remain unreadable and unfillable.

The page-bridge protocol version is 6. Service Worker, content script, page script, and Web Client share that version. Result `kind` must match the request `kind`.

Model tools add `browser_scroll`, `browser_wait_for`, `browser_focus`, and `browser_press`. A separate `browser_type` tool is not added because fill already replaces text and verifies the result. The browser prompt requires: when the user asks to read, summarize, or operate the current tab, call `browser_list_tabs` or `browser_read_page` first; do not start with a skill, web search, or a fetch of the Harness page; choose later actions from returned page semantics; diagnose provider, permission, or stale-ref failures instead of silently switching to a skill. The recommended loop is read → act by ref → wait → read again → verify. No site names or phrase-to-action scripts are included.

## Alternatives considered

**Keep one identity for both snapshot refs and document change.** Rejected because regenerating `pageId` on every read is what makes stale refs explicit, while wait-for-change needs a stable document lifetime. Splitting `pageId` from `documentId` plus `revision` preserves both properties.

**Let the model pass CSS selectors, XPath, or JavaScript.** Rejected because those are persistent or unrestricted handles. Opaque short-lived refs remain the only operation target.

**Add a second fill/type implementation for incremental editor input.** Rejected until a real editor requires append-only input that fill cannot cover. Duplicate write paths would hide verification failures.

**Report keyboard success after dispatching synthetic events.** Rejected because an event that the page ignores is not a completed action. Unavailable real-input capability is an explicit error, not a silent fallback.

**Require the model to copy a tab id after every read.** Rejected because document-bound work already carries `pageId`, and routing that identity inside the Service Worker avoids invented ids and tab-switch races. Explicit `tabId` remains available before a snapshot exists.

## Consequences

The model can compose generic browser tools against the current page without site-specific adapters. Wait, scroll, and bounded keys increase the automation surface, so result verification and stale-ref rejection become more important. Snapshot-to-tab routing is in-memory; a Service Worker restart forgets `pageId` bindings, and wait then uses the focused or active tab rather than failing stale. Conflicting `pageId` and `tabId` remain stale. Screenshots, coordinate clicks, debugger permission, and moving the Browser Provider into the Service Worker remain later deliveries. Protocol 6 is the shared page-bridge version; source changes must regenerate `extension/*.js` and the aggregated Remote Client before reload.
