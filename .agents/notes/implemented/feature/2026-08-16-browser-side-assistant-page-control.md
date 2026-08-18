# Agent Note: Browser side-assistant page control

Status: implemented

English | [中文](2026-08-16-browser-side-assistant-page-control.zh.md)

## Problem

The side assistant could open, list, activate, and close tabs, but page tasks need the rendered application state rather than tab metadata. Reading the loopback Harness UI instead of the adjacent tab answers the wrong question. Replacing an interaction with a constructed URL also fails on intranet applications, hash routes, controlled form fields, and workflows that require a real click or submission. The local Web profile was another manual prerequisite, so a failed login startup left the installed extension unable to recover itself.

## Decision

Current-page work uses a read-before-action protocol. `browser_read_page` targets the tab recorded by the side-panel header and returns rendered text, visible non-secret fields, clickable elements, a random `pageId`, and opaque sequential element refs. The reader marks the referenced elements in the top document and accessible same-origin child frames. A new read clears the previous marks and issues a new `pageId`; navigation replaces the document. Click, fill, and select require a `pageId/ref` pair from the latest read and fail with stable stale or missing-element codes rather than falling back to a selector or another tab.

The model selects capabilities from the requested effect and execution environment. Finding, reading, navigating, or interacting with website content defaults to the user's current Chromium window even when the request does not name the browser. Unless the user requests another execution path, the first task action is an applicable browser tool; when the active page may contain or lead to the requested content, that action is `browser_read_page`. Skill catalog descriptions are capability summaries rather than routing instructions, so a description's imperative wording or topical overlap cannot displace the browser path. Tool selection follows the browser schemas and observed page state rather than fixed user phrases or site-specific rules. Another execution path is eligible only when a browser tool reports a concrete limitation and changing environments still satisfies the request.

The action set is intentionally closed. Click uses the referenced enabled element. Fill accepts text-like input, textarea, and browser-editable content hosts. Native input and textarea values use prototype setters followed by bubbling `input` and `change` events. Contenteditable replacement selects the referenced editing host and invokes Chromium's `Document.execCommand` with `insertText` or `delete`; Chromium preserves framework-managed descendants and emits the native input event. An ARIA textbox role alone does not make an element writable. Optional submission uses the owning form's `requestSubmit` or an Enter keyboard sequence. Select accepts only a native select and matches an exact option value or normalized visible text. The model prompt requires another page read after each action to confirm the effect and obtain fresh refs.

Password, file, hidden, one-time-code, card-number, and card-security-code inputs are excluded from both read and write references. Page operations do not accept CSS selectors, XPath, screen coordinates, or arbitrary script. Disabled controls and incompatible action types fail explicitly. The complete page snapshot remains bounded to 96 KiB of serialized UTF-8, including tab metadata, text, fields, actions, and references.

The Windows companion is a current-user scheduled login task with a tray UI. It owns one Web-profile process generation and exposes start, restart, stop, open, and log actions. A registered Native Messaging host accepts only the closed `ensure-web` request from the extension side-panel document, starts the same scheduled task when necessary, and waits for the configured loopback origin to become healthy. Installation records the checkout and Node executable paths, so moving either requires reinstalling the companion.

The package-level approval default remains enabled for deployments that have an approval answerer. The shipped Web presets explicitly disable this extra browser-tool approval so the side assistant can dispatch the extension capability instead of receiving an automatic rejection. Extension installation and its declared HTTP(S) host permission remain the browser-side grant.

## Verification

DOM tests cover rendered text, long textarea values, secret exclusion, field and action refs, editable and role-only ARIA controls, reference replacement, native fill events, contenteditable insert and delete commands, form submission, clicks, native option selection, disabled targets, stale pages, and missing elements. A real Chromium check loads the generated content script against a nested generic contenteditable, then verifies the returned value, preserved editor block, and page-enabled submit control. Bridge tests cover protocol guards, focused-tab routing, on-demand content-script injection, result-size bounds, action receipts, stable page-action errors, request timeouts, and the generated MV3 artifacts. Host and Consumer tests cover target validation, action/result coordinate matching, service routing, all eight tool schemas, browser-first website routing ahead of skill descriptions, direct shipped-preset dispatch, approvals, and rendered results. A keyless real Web composition snapshot records the prompt and schemas. The Windows companion tests cover ownership policy, task launch, Native Messaging framing, startup coalescing, timeout behavior, and tray-managed service lifecycle.

## Alternatives considered

**Let the model construct navigation URLs for every interaction.** Rejected because it bypasses the user's rendered state and cannot represent controlled inputs, validation, toggles, or multi-step intranet workflows.

**Encode one routing rule for every user phrase, page action, or website.** Rejected because the request space and page state are open-ended. Capability selection by intended effect and execution environment lets the model use the same browser schemas across sites without maintaining a phrase or site catalog.

**Expose arbitrary selectors or JavaScript.** Rejected because a model-generated selector can silently resolve to a different element after re-rendering, while arbitrary script would turn a bounded browser capability into unrestricted page execution. Document-bound refs make stale state explicit and keep operation types reviewable.

**Treat every ARIA textbox as writable and replace its text content directly.** Rejected because the role communicates accessibility semantics but does not grant browser editability. Direct text replacement can destroy a framework-managed editor tree and produces only a synthetic event, leaving the application's value unchanged even when text appears in the DOM.

**Keep permanent refs across reads.** Rejected because modern applications replace DOM nodes without navigation. Regenerating the document identity on every read makes confirmation and stale recovery part of the ordinary model workflow.

**Launch the Web profile directly from the Service Worker.** Rejected because browser extensions cannot spawn local processes. Native Messaging is limited to one closed startup request, while service ownership, logs, and user controls remain in the tray companion.

## Consequences

The assistant can choose and combine the available browser operations for the user's current Chromium state without attaching a separate automation browser or requiring site-specific adapters. Every mutation depends on a fresh page read, so re-render-heavy sites may require more read/action turns. Cross-origin frames, privileged browser pages, arbitrary selectors, cookies, storage, screenshots, downloads, drag-and-drop, and unrestricted pointer or keyboard automation remain outside the capability. On Windows, normal use does not require manually starting the Web profile, while uninstalling or relocating the checkout requires running the companion installer workflow again.

Document identity, specified-tab reads, wait, scroll, focus, and bounded keyboard operations are recorded in the later [semantic browser automation](2026-08-16-semantic-browser-automation.md) note.
