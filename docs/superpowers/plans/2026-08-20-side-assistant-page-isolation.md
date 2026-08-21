# Side Assistant Page Isolation Implementation Plan

English | [中文](2026-08-20-side-assistant-page-isolation.zh.md)

> **For agentic workers:** Execute this plan in the current worktree because it already contains the page-probe exception regression fix that this work preserves.

**Goal:** Keep ordinary HTTP(S) pages free of Side Assistant runtime hooks until a browser operation targets that tab, and release expensive observation after inspection or document-change detection.

**Architecture:** The MV3 manifest statically injects only the loopback Web Client bridge. The Service Worker independently ensures the isolated-world page reader and the dormant MAIN-world probe controller. `browser_inspect` uses an explicit `start` / `snapshot` / `stop` capture lifecycle; only an active capture wraps console and network APIs. Page snapshots arm a one-change document revision observer, while stability waits own and dispose their observer.

**Tech Stack:** TypeScript, Chromium MV3 APIs, Vitest, tsdown, Markdown bilingual documentation.

---

### Task 1: Pin lazy injection and capture protocol

**Files:**
- Modify: `packages/client/browser-extension/tests/extension-runtime.client.spec.ts`
- Modify: `packages/client/browser-extension/tests/page-content-runtime.client.spec.ts`
- Modify: `packages/web/browser/tests/browser.spec.ts`
- Modify: `packages/web/tool-browser/tests/tool-browser.spec.ts`

- [ ] Add failing tests proving the manifest has no ordinary-page content scripts, read/action recovery injects only `page-content.js`, inspect injects `page-probe.js` even when the reader already exists, and inspect mode crosses every protocol layer.
- [ ] Run only those test files and confirm failures identify the missing lifecycle.

### Task 2: Implement independent injection and explicit inspection lifecycle

**Files:**
- Modify: `packages/web/browser/src/types.ts`
- Modify: `packages/web/browser/src/index.ts`
- Modify: `packages/web/tool-browser/src/index.ts`
- Modify: `packages/client/browser-extension/src/protocol.ts`
- Modify: `packages/client/browser-extension/src/extension/runtime.ts`
- Modify: `packages/client/browser-extension/src/extension/page-content-runtime.ts`
- Modify: `packages/client/browser-extension/src/extension/page-probe-protocol.ts`
- Modify: `packages/client/browser-extension/src/extension/page-probe-collector.ts`
- Modify: `packages/client/browser-extension/extension/manifest.json`

- [ ] Define `BrowserInspectMode` as `start | snapshot | stop`, require it on inspect requests, render the selected lifecycle state, and bump the extension wire protocol.
- [ ] Replace the combined injector with reader-only recovery plus an inspect-owned MAIN-world probe injection.
- [ ] Make the model tool explain and enforce start → reproduce → stop, while allowing intermediate snapshots.
- [ ] Re-run the Task 1 tests and confirm they pass before changing probe internals.

### Task 3: Make the probe dormant, cheap, and disposable

**Files:**
- Modify: `packages/client/browser-extension/tests/page-probe.client.spec.ts`
- Modify: `packages/client/browser-extension/src/extension/page-probe.ts`

- [ ] Add failing tests proving install is dormant, start captures, snapshot preserves capture, stop disables capture, arbitrary objects are never traversed, original console calls always continue, and reused XHR instances record once per send.
- [ ] Implement a document-lifetime controller whose active capture owns wrappers and listeners; stop restores methods only when the controller still owns the installed wrapper and otherwise leaves an inactive forwarding link.
- [ ] Render strings and primitives directly, render guarded Error details, and use fixed tokens for objects, arrays, and functions without `JSON.stringify`.
- [ ] Register XHR completion listeners with one-request ownership.
- [ ] Run the focused probe test file and confirm it passes.

### Task 4: Bound document revision observation

**Files:**
- Modify: `packages/client/browser-extension/tests/page-reader.client.spec.ts`
- Modify: `packages/client/browser-extension/src/extension/page-document.ts`
- Modify: `packages/client/browser-extension/src/extension/page-reader.ts`
- Modify: `packages/client/browser-extension/src/extension/page-waiter.ts`

- [ ] Add failing tests proving each page snapshot observes only the first external mutation and stability waiting disconnects its observer after completion or timeout.
- [ ] Rearm a one-change revision observer after each read, ignore `data-dsh-*` mutations, and disconnect after the first relevant mutation.
- [ ] Give each stability wait its own observer and dispose it in `finally`.
- [ ] Run the focused page-reader test file and confirm it passes.

### Task 5: Synchronize artifacts, documentation, and decision records

**Files:**
- Modify: `packages/client/browser-extension/README.md`
- Modify: `packages/client/browser-extension/README.zh.md`
- Modify: `.agents/notes/implemented/bug-fix/2026-08-20-page-probe-console-inspect.md`
- Modify: `.agents/notes/implemented/bug-fix/2026-08-20-page-probe-console-inspect.zh.md`
- Create: `.agents/notes/implemented/bug-fix/2026-08-20-side-assistant-on-demand-page-observation.md`
- Create: `.agents/notes/implemented/bug-fix/2026-08-20-side-assistant-on-demand-page-observation.zh.md`
- Generate: package bundles and translation-pair sidecars owned by these sources.

- [ ] Document current lazy injection, capture timing, loss of pre-capture history, and observer lifetime without implementation narration.
- [ ] Record why permanent document-start observation, formatter-only optimization, and debugger attachment were rejected.
- [ ] Regenerate the browser-extension bundles from source and re-record only the affected bilingual pairs.

### Task 6: Perform risk-matched verification

**Files:**
- Verify only the affected browser service, tool, extension, documentation, and generated artifacts.

- [ ] Run the four focused Vitest files plus protocol/tool tests touched by failures.
- [ ] Run the smallest package-scoped type checks or source build needed to prove the shared inspect type compiles and to regenerate extension artifacts; this public cross-package operation change justifies checking the three affected packages, not the repository.
- [ ] Run targeted documentation pairing/format checks for the changed README and Agent Notes.
- [ ] Run `git diff --check` and inspect the final diff, excluding `vendor/`.
