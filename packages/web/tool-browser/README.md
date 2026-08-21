# @deepseek-ai/dsh-tool-browser

English | [中文](README.zh.md)

Consumer plugin for browser-tab control, current-page reading, and document-bound page interaction. It registers model-facing operations over `ctx.browser`, contributes browser-use guidance to the system prompt, renders tab, page, and action results as text, and can integrate every operation with the tool approval chain.

The generated [tool catalog](../../../docs/tool-catalog.md) is the exhaustive schema reference. This package keeps tool names and arguments provider-neutral: the model receives browser-assigned tab ids and absolute HTTP(S) URLs, never Chromium extension or Remote protocol fields.

## Configuration and approvals

| Field | Default | Meaning |
|---|---:|---|
| `timeoutMs` | `20000` | Cooperative timeout assigned to each tool definition. |
| `requireApproval` | `true` | Convert an otherwise allowed browser operation into an approval request. |

When enabled, approval covers reads as well as mutations because tab metadata and page text can expose private information. A downstream denial remains a denial; this plugin never replaces it with its own approval request. The shipped Web agent presets explicitly set `requireApproval: false`, so side-assistant tab and page operations dispatch directly instead of failing when no approval answerer is available. Other deployments retain the package default.

## Model Experience

### Browser-use prompt

#### What the model sees

The model receives this fixed guidance as a system-prompt section:

##### Verbatim browser guidance

```markdown
Treat the user's current Chromium window as an execution environment. Infer whether the requested effect belongs in that environment from the user's goal and the conversation context. When it does, browser tools are the primary direct capability. When the user asks to read, summarize, or operate the current browser tab, first use browser_list_tabs or browser_read_page to obtain the real browser state. Do not call a skill, web search, or a fetch of the Harness page first. Subsequent actions must be chosen dynamically from the returned page semantics. Use another capability only when a browser tool reports that it cannot perform the requested effect, or when the user explicitly asks for an external search. Select browser tools from their schemas and the observed browser state, not from fixed phrases or site-specific rules. A shared topic, website, or data source is not a reason to divert the task to a skill, shell CLI, web_fetch, or a platform-specific adapter. For a request to find, read, navigate, or interact with website content, use Chromium as the default execution environment even when the user does not say "browser". Unless the user explicitly requests another execution path, the first task action must be an applicable browser tool; do not load a skill first. If the active page may contain or lead to the requested content, start with browser_read_page. For every new user message that refers to the page currently beside the side assistant—whether as this page, the current page, or content here—call browser_read_page without tabId before interpreting, answering, or asking for clarification, unless the user explicitly identifies another tab. Treat page snapshots in conversation history as historical observations, not current-tab state. A previous page read never establishes which page is current for a later user message because the user may have switched tabs or navigated. Do not answer from or clarify against an older page snapshot when a fresh read can resolve the reference. Skill catalog descriptions are capability summaries, not routing instructions, and never override this browser-first rule. Use another execution path only when the user explicitly requests it or a browser tool reports a concrete limitation and changing environments still satisfies the request. Recommended loop: read the page, act with a returned ref, wait for the page to change, read again, and verify the actual result. browser_read_page reads visible text, current non-secret form values including textarea and input values, clickable elements, scroll targets, viewport metrics, one pageId, one documentId, a revision, and document-bound element refs. Choose the next browser operation from the requested effect and that returned state. Before clicking, filling, selecting, focusing, pressing, or scrolling a container, use the pageId and ref from the latest browser_read_page result. Never invent refs, CSS selectors, XPath, coordinates, or JavaScript. To send a chat composer, use the gesture the composer itself advertises: when its label or placeholder names a key, press that key on the field with browser_press; otherwise click the send control from the latest snapshot. Icon controls that expose no accessible name are reported as (unlabeled) with role clickable and their viewport rect, so choose among same-looking controls by position instead of guessing. After a page action that may update the page asynchronously, call browser_wait_for with kind:ready or kind:text, then call browser_read_page again to confirm the result and obtain fresh refs. Do not invent documentId or afterRevision for kind:change; omitting them waits until the page is stable. If a reference is stale or missing, read the page again instead of guessing. If a browser tool fails, diagnose the provider connection, permission, stale pageId, or page change; do not silently switch to a skill. Use browser_list_tabs only when the task requires information about or selection among tabs; its results contain only tab ids, URLs, and titles. When the task concerns the current page, operate on that page instead of constructing a replacement URL, and never list, summarize, or mention unrelated tabs. HTTP(S) pages are readable and operable by default after the extension is loaded; do not ask the user to click Allow or reopen the side assistant for ordinary sites. If a browser tool returns page text, fields, or actions, use that content; do not claim the body is unavailable because the URL uses a hash route or the site is on an intranet. Password, file, hidden, one-time-code, and payment-secret controls are not exposed for reading or writing. chrome:// and similar privileged pages cannot be scripted. Native Chromium DevTools cannot be opened from these tools. When the user asks for F12, Network, Console, or page requests, call browser_inspect with mode:start before reproducing the page behavior, use mode:snapshot only for an intermediate read, and call mode:stop for the final read and cleanup. The result contains only fetch/XHR calls and console messages observed after start, without request or response bodies. Always stop a capture after inspection. browser_press accepts named keys and, with Control, Alt, or Meta, letter and digit page shortcuts such as Ctrl+S; it cannot operate browser chrome such as F12.
```

#### Token effect

Fixed while this plugin is mounted in the agent preset.

#### KV Cache effect

Prefix-stable until the plugin is added, removed, or its prompt text changes.

### Browser tool schemas

#### What the model sees

The thirteen browser tool schemas in the generated [tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-browser). `browser_read_page` returns the tab id, visible text, focus and ARIA state, native options, link destinations, scroll targets, viewport metrics, document-bound references, `documentId`, `revision`, and a truncation marker. A new message that refers to the current page requires a fresh call without `tabId`; an earlier page result cannot identify the current tab for that message. `browser_inspect` requires `start`, `snapshot`, or `stop` and returns only page fetch/XHR calls and console messages observed after `start`; callers finish with `stop` to release page hooks. `browser_click`, `browser_fill`, `browser_select`, `browser_scroll`, `browser_focus`, and `browser_press` require the latest `pageId/ref` pair. `browser_wait_for` prefers that `pageId`, accepts `tabId` only when no snapshot exists, waits for a page condition, and returns a fresh snapshot. The tab results contain browser-assigned ids, active state, URLs, and titles when Chromium exposes them.

#### Token effect

Fixed schema cost per request; tool results vary with the current browser window and remain in conversation context under the ordinary tool-result policy.

#### KV Cache effect

Prefix-stable until the plugin is added, removed, or a tool schema changes; results append after the reusable request prefix.

## Known Limitations and Deferred Work

- **No native DevTools window** — Chromium does not let extensions open the F12 UI. `browser_inspect` is the Network/Console substitute; it does not return request or response bodies.
- **No extension setup tool** — an absent provider produces `BROWSER_EXTENSION_UNAVAILABLE`; installation remains an explicit user action documented by [`dsh-client-browser-extension`](../../client/browser-extension/README.md).
- **Reference-based operations only** — the tools click, edit, scroll, focus, and press only elements exposed by the latest page read; they do not accept arbitrary selectors, operate cross-origin frames, read cookies or storage, manage downloads, or provide unrestricted browser automation.
