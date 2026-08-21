# Agent Note: Side Assistant observes browser pages only on demand

Status: implemented

English | [中文](2026-08-20-side-assistant-on-demand-page-observation.zh.md)

## Problem

The Side Assistant manifest injected a MAIN-world fetch/XHR/console probe and a 70 KiB isolated-world reader into every ordinary HTTP(S) page. The probe serialized console arguments and sanitized every request URL on the page's synchronous hot paths even when no browser tool targeted that tab. A first page read also installed a full-subtree MutationObserver for the rest of the document lifetime. Vue and Element Plus applications with frequent warnings and DOM mutations therefore paid extension CPU cost during unrelated form work.

## Decision

The manifest statically injects only the loopback Web Client bridge. A read, action, or wait injects `page-content.js` into the selected tab only when its current document has no compatible reader. An inspect operation independently injects the idempotent `page-probe.js` controller into the MAIN world; reader availability never implies probe availability.

`inspect-page` requires a `start`, `snapshot`, or `stop` mode. `start` clears prior observations and installs wrappers around the tab's current fetch, XHR, and console methods. `snapshot` reads the bounded buffers without ending capture. `stop` returns the final buffers, disables recording, removes capture-only error listeners, and restores a method only when that method still equals the controller's wrapper. A later page wrapper therefore remains intact; a retained probe wrapper only forwards while inactive. Navigation destroys both controllers with the document.

Console capture records strings and primitives plus fixed object-category tokens; it never enumerates page-owned objects. Each XHR send owns a one-shot `loadend` listener, so reusing an XHR object does not accumulate completion handlers. Network and console buffers retain forty entries each and five hundred characters per text field.

Each page read arms one full-subtree observer that disconnects after the first non-`data-dsh-*` mutation and increments the document revision once. A stability wait owns a separate observer and disconnects it on success or failure. A fresh page read rearms the next-change observation.

## Alternatives considered

**Keep document-start injection and optimize only console rendering.** Rejected because untouched pages would still run extension wrappers for every fetch, XHR, and console call and would still load the reader bundle.

**Inject on first use and keep every hook until navigation.** Rejected because a single inspect or read would restore the same long-lived cost while the user continued working in that tab.

**Attach through `chrome.debugger`.** Rejected because it adds debugger authority and browser UI, conflicts with DevTools attachment, and still observes only events after attachment.

**Use `chrome.webRequest` instead of a page probe.** Rejected because it cannot provide page console messages and would split one inspect result across unrelated observation mechanisms.

## Consequences

Untouched HTTP(S) tabs run no Side Assistant page code. DOM operations pay one reader injection for the current document; a snapshot observer stops after the first relevant change. Network and console inspection sees only events after `start`, so the model must reproduce the behavior and finish with `stop`. Active capture still adds deliberate diagnostic overhead to the selected tab, but stopping it restores owned hooks without changing later page patches.

## Testing

Extension runtime tests pin the manifest, reader-only recovery, independent MAIN-world probe injection, and the three inspect modes. Page-probe tests pin dormant installation, start/snapshot/stop behavior, non-enumerating console rendering, original-console forwarding, and XHR listener ownership. Page-reader tests pin one-change revision observation and stability-observer disposal.

## Related

- [Console rendering](2026-08-20-page-probe-console-inspect.md) — owns diagnostic value conversion during an active capture.
- [Browser tab extension](../feature/2026-08-14-browser-tab-extension.md) — owns the extension provider and browser operation set.
- [Semantic browser automation](../feature/2026-08-16-semantic-browser-automation.md) — owns document identity, revision, and wait semantics.
