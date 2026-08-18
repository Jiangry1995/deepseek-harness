# @deepseek-ai/dsh-client-browser-extension

English | [中文](README.zh.md)

Chromium side assistant and Web Client Service Provider for browser-tab control, current-page reading, and document-bound page actions. Its MV3 side panel hosts the complete loopback Harness Web UI beside the current page, its Client plugin maintains a leased Host registration, and its Service Worker executes validated tab and page operations through Chromium APIs.

## Build and load the extension

From the repository root:

1. Run `pnpm run build:lib:client`.
2. Open `chrome://extensions` in Chromium and enable **Developer mode**.
3. Choose **Load unpacked** and select `packages/client/browser-extension/extension`.
4. Start the Web profile, then click the extension's toolbar action to open Harness in the browser side panel. Reload the extension card first after rebuilding an already loaded folder.

The Client library build emits this package's TypeScript and MV3 assets together. Changes to Browser Remote operation types or result fields require `pnpm run build:lib` followed by `pnpm run build:web` before reloading the extension, so the Host schema, aggregated Client Remote schema, extension assets, and Web shell use the same protocol.

Click the toolbar action from the page the assistant should read or operate. The side-panel header ignores late results from older tab activations, and the Service Worker binds each returned `pageId` to its originating tab so a later browser action cannot silently target another tab.

The side panel connects to `http://127.0.0.1:3080` by default. Its settings button accepts another plain-HTTP `127.0.0.1` or `localhost` origin and stores that origin in extension-local storage.

The extension package publishes the manifest, background and content scripts, and side-panel HTML, CSS, and JavaScript files, so an installed distribution does not need a local TypeScript build.

### Windows login startup and tray

Run `pnpm --filter @deepseek-ai/dsh-client-browser-extension windows:install` once from the repository root. The installer registers a current-user login task and Native Messaging host, then starts the tray companion. The tray menu can open, start, restart, stop, or show logs for the managed Web profile. If login startup failed or the service was stopped, opening the side assistant asks the Native Messaging host to run the same scheduled task and waits for `http://127.0.0.1:3080` to become healthy.

## Runtime behavior

The toolbar action opens the MV3 side panel. Its small extension-owned shell probes the configured origin, embeds the complete Web UI after a successful response, and presents retry, startup, and address-editing states when the server is unavailable. The content script runs in the embedded loopback frame and in standalone loopback Harness pages, where it answers the versioned same-window bridge probe.

The Client plugin registers only after that readiness response, renews the returned lease at half its duration, listens for addressed `browser/command` events, and completes each request through the Typert Remote browser namespace. Teardown stops heartbeats, rejects page-bridge work, waits for an in-flight registration, and disconnects any lease acquired during that race.

The extension supports `open-tab`, `list-tabs`, `read-page`, `click-page-element`, `fill-page-element`, `select-page-option`, `scroll-page`, `focus-page-element`, `press-page-key`, `wait-page`, `activate-tab`, and `close-tab`. Protocol version 5 is shared by the Service Worker, content script, page script, and Web Client. `read-page` may target a specified tab or the current active web tab and returns rendered text, current visible non-secret form values, focus and ARIA state, clickable elements, scroll targets, viewport metrics, a snapshot `pageId`, a stable `documentId`, a document `revision`, and opaque refs. Click, fill, select, scroll, focus, and press accept only coordinates from that snapshot and route through the tab retained for its `pageId`. A new read or navigation invalidates the prior coordinates. Fill uses native input or textarea value setters and dispatches `input` and `change`; contenteditable hosts instead receive Chromium insert or delete editing commands so framework-managed descendants and native input events remain intact. After filling, the actor reads the actual control value and fails on mismatch. A textbox ARIA role without browser editability is not exposed as a field. Fill can submit the owning form or dispatch Enter, while select matches a native option by exact value or visible text. Scroll reports an at-boundary result when the offset does not change. Wait prefers a retained `pageId`, accepts `tabId` before a snapshot exists, and returns a fresh snapshot after document change, text, URL, or load stability. The bridge normalizes results to JSON, rejects malformed requests, bounds a complete page result to 96 KiB of serialized UTF-8, and maps missing tabs, stale references, non-editable elements, invalid scroll targets, unsupported keys, wait timeouts, unavailable page authority, and Chromium API failures to stable codes.

## Security constraints

The manifest grants `sidePanel` to open the assistant, `storage` to retain its selected origin, `nativeMessaging` for companion recovery, `tabs` for tab metadata and control, and `activeTab` plus `scripting` for page-script injection. Its HTTP(S) host permission and page content script provide the installed extension's declared read-and-operate access on ordinary sites. Extension-page `connect-src` and `frame-src` remain restricted to plain-HTTP `127.0.0.1` and `localhost`; the loopback content script uses `all_frames` so the embedded Web UI can register the provider. The Service Worker accepts Host operation messages only from this extension id and a loopback sender URL. Open-tab requests accept absolute credential-free HTTP(S) URLs; unsupported schemes and embedded credentials are rejected before `chrome.tabs.create`.

Page reading and writing exclude password, file, hidden, one-time-code, card-number, and card-security-code controls. The reader covers the top document and accessible same-origin child frames but cannot cross origin boundaries. It does not return cookies or storage. Page actions do not accept selectors or coordinates invented by the model: each target must be a reference issued by the latest read of the same document, and disabled or incompatible targets fail explicitly.

The page bridge validates the protocol version, direction, request identity, operation, response discriminant, tab fields, and error code on both sides of the isolated-world boundary. These checks do not authenticate the Harness server; they restrict which pages can reach the installed extension.

## Model Experience

None, as this package transports already-defined browser operations between the Web Client and Chromium; `dsh-tool-browser` owns all model-visible prompt, schema, approval, and result text.

#### KV Cache effect

None; provider connection and extension traffic never enter a model request.

## Known Limitations and Deferred Work

- **Chromium MV3 only** — Firefox and Safari extension formats are not packaged.
- **Loopback Web UI only** — non-loopback deployments cannot register this provider, even when the Host HTTP trust configuration permits their origin.
- **Windows companion is repository-bound** — the installed task launches this checkout's source entry with the Node path captured during installation; reinstall after moving the checkout or changing Node installations. Other operating systems still start the Web profile manually.
- **Bounded reference-based interaction only** — the extension does not expose arbitrary DOM selectors, cross-origin iframe contents, cookies, browser storage, screenshots, downloads, drag-and-drop, or unrestricted keyboard and pointer automation.
- **Fresh read required after actions** — navigation, another read, or page re-rendering can invalidate element references; callers read again after each action and retry only with newly returned coordinates.
