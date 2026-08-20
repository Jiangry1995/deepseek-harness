# Agent Note: Chat composers send from snapshot controls; incomplete waits stay ready

Status: implemented

English | [中文](2026-08-19-browser-composer-send-and-wait-recovery.zh.md)

## Problem

Chat composers that are not native HTML forms do not send on a synthetic Enter. `browser_press` and `fill` with `submit: true` reported success after dispatching an untrusted KeyboardEvent, while the page left the draft in the field and the send control enabled.

Icon-only send and delete buttons without accessible names appeared in the snapshot as `(unlabeled)`, so the model could not tell them apart and defaulted to Enter.

The `tool:browser` prompt told the model to call `browser_wait_for` after every page action. Models then sent `{kind:"change"}` without `documentId` and `afterRevision`, and the Host rejected that as `BROWSER_INVALID_REQUEST`. A following wait that reused the fill `pageId` after a Service Worker restart hit `BROWSER_PAGE_STALE`, because wait treated a missing in-memory binding as fatal while fill already fell back to the focused tab. That pairing is recorded as current fact in [semantic browser automation](../feature/2026-08-16-semantic-browser-automation.md).

## Decision

When the filled or focused control is not inside a native `form`, submit and Enter click a nearby send or submit control. Named send, submit, or 发送 wins. Native `type=submit` is next. A unique remaining non-destructive button in the composer subtree is last. Names matching delete, clear, cancel, or new chat are never chosen, including the first button in an Element Plus send cluster. A native form still uses `requestSubmit()`. If the composer prevents Enter without submitting, the actor still clicks that send control.

`resolveWaitCondition` treats `kind:change` that omits `documentId` or `afterRevision` as `kind:ready`. A complete change whose id or revision is invalid still fails with `BROWSER_INVALID_REQUEST`.

`wait-page` uses `resolveReadTab` when the `pageId` map has no entry, matching fill. A retained binding that conflicts with an explicit `tabId` remains `BROWSER_PAGE_STALE`. A successful document-bound action records the tab it actually used so a later wait can find the same tab.

`browser_click` activates the nearest button, link, or named send control when the referenced node is icon markup or composer chrome, then dispatches pointer and mouse events before the native click. Compact icon controls include `rect` even when labeled, and a saturated non-gray fill is marked `accent`, so a visual "blue send at the bottom right" can be bound to a snapshot ref without site CSS.

The `tool:browser` prompt tells the model to click the send or submit control from the latest snapshot, to prefer `kind:ready` or `kind:text` after an action, and not to invent `kind:change` fields. Host pages that expose icon-only send and delete controls should still give them `aria-label` values the reader already prefers.

## Alternatives considered

**Require the user to name every tool in the prompt.** Rejected because the failure was in default tool behavior and guidance; a per-task script does not survive the next composer.

**Hard-code site CSS or XPath for one petition desk.** Rejected because opaque refs and accessible names remain the only operation handles. A class used only as a composer *scope* (`el-editor-sender`, `ch-chat-input`) is not an operation target.

**Keep missing wait bindings as `BROWSER_PAGE_STALE`.** Rejected because fill already recovered to the focused tab on the same map miss, so a wait issued with that fill's `pageId` failed after a successful edit. Conflicting bindings stay stale so a wait cannot jump to another tab the snapshot did not come from.

**Click the last unlabeled button in a send cluster.** Rejected because delete and send are often adjacent icon buttons; only a named send, a native submit, or a unique remaining non-destructive control is safe.

## Consequences

Enter and fill-submit can send SPA composers without site adapters. Incomplete `kind:change` waits no longer abort the loop. A Service Worker restart no longer makes a pageId-only wait stale. Clicking an icon or send cluster chrome activates the named send control rather than a neighboring delete control. Compact and accent-marked actions carry placement so color-and-position instructions can choose a ref. Pages that still ship unlabeled send icons remain harder to click by name until they add accessible names. A composer that both preventDefaults Enter and actually sends may receive a second click. Wait-page Host and page-bridge timers that outlast the default Host request timeout are owned by [wait-page Host and page-bridge timers](2026-08-20-browser-wait-bridge-timeout.md).

## Testing

`packages/web/browser` treats `{kind:"change"}` as ready and still rejects an invalid complete change. `packages/client/browser-extension` clicks named 发送 rather than 新开对话 or 删除 on fill-submit, Enter, icon markup, and send-cluster chrome, records compact `rect` and saturated `accent` fills, waits on the focused tab when the `pageId` map is empty, and keeps conflicting `pageId`/`tabId` stale. `packages/web/tool-browser` pins the send-control and wait-guidance prompt clauses and renders compact `rect` plus `accent`.
