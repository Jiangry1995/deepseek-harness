# Agent Note: Browser-tab extension provider

Status: implemented

English | [中文](2026-08-14-browser-tab-extension.zh.md)

## Problem

An agent running in the Host process cannot control the user's existing browser window without either launching a separate automation browser or crossing into a browser extension. A separate browser uses another profile and loses the user's current tabs, while direct browser APIs do not exist in Node. The capability also handles private tab metadata and destructive close operations, so provider reachability, approval, stale-page cleanup, and result ownership need explicit rules.

## Decision

Browser tabs form a three-role capability. `@deepseek-ai/dsh-browser` owns the Host service, provider leases, request lifecycle, validation, and stable errors. `@deepseek-ai/dsh-client-browser-extension` owns the Web Client provider and a packaged Chromium MV3 extension. `@deepseek-ai/dsh-tool-browser` owns the model-facing prompt, schemas, presentation, and approval behavior.

The Web Client registers only after a versioned page probe confirms the content script. Registration returns a renewable lease with Host timeout values. The Client renews halfway through the lease, disconnects on teardown, and waits for an in-flight registration before releasing any lease acquired during that race. The Host prunes expired providers, selects the most recently seen live provider, and settles every pending operation on completion, cancellation, timeout, disconnect, expiry, or service disposal.

Host-to-Client commands use the allowlisted `ctx.remote.$on('browser/command', ...)` carrier defined by the [Remote event delivery decision](../architecture/2026-08-10-remote-event-delivery.md). Each command carries an opaque request id and selected provider id. A completion from another provider is rejected, and a result whose discriminant differs from its operation fails instead of being coerced.

The extension action opens an MV3 side panel. An extension-owned shell probes a configurable plain-HTTP loopback origin, embeds the complete Harness Web UI after a successful response, and stores the selected origin in extension-local storage. The default is `http://127.0.0.1:3080`; validation admits only `127.0.0.1` and `localhost` origins. This reuses the assembled Web Client instead of creating a second conversation implementation inside the extension.

The isolated-world bridge has a versioned request/response protocol. The page and content-script halves validate every envelope, operation, result, tab field, and error code. The content script runs in matched frames so the side-panel Web UI can answer the probe. The MV3 Service Worker accepts Host operation messages only from this extension id and a plain-HTTP loopback sender, permits only credential-free HTTP(S) open targets, and routes a closed operation union. The manifest grants side-panel, storage, Native Messaging, tab, scripting, and ordinary HTTP(S) page access; its frame/connect policy admits only `127.0.0.1` and `localhost` over plain HTTP. Current-page reads, document-bound actions, and Windows service recovery are governed by the [page-control decision](2026-08-16-browser-side-assistant-page-control.md).

The Consumer exposes the closed tab and page operation set through model-facing tools. Every operation enters the ordinary tool approval chain by default; shipped side-assistant presets explicitly disable this additional approval because the extension installation itself grants the browser capability and the embedded Web UI has no approval answerer. Listing asks in deployments that retain the default because it reveals URLs and titles from the current browser window. Missing extension state remains an execution error so the model-visible capability does not silently disappear when installation is incomplete.

## Verification

Package tests pin lease selection and expiry, wrong-provider and mismatched-result rejection, cancellation, timeouts, disposal, protocol validation, Chromium error mapping, Client registration races, heartbeat renewal, side-panel origin validation and connection states, action-click configuration, and the complete service-to-tool operation union. A keyless Web snapshot records the browser prompt and schemas from a real replayed model request. A headed persistent Chromium run loads the unpacked MV3 extension, renders the complete Web UI at side-panel width, and lists tabs through the embedded page, content script, Service Worker, and `chrome.tabs` path; the same bridge carries the other tab and page operations.

## Alternatives considered

**Launch Playwright or CDP from the Host.** Rejected because it creates or attaches to an automation browser rather than defining a permissioned provider for the user's current Web UI window. Profile discovery and debugging-port attachment also broaden the Host's authority beyond tab operations.

**Put the Host broker, model tools, and extension bridge in one package.** Rejected because Host code, model contracts, Client lifecycle, and extension artifacts build in different compilation faces and have different owners. The split keeps each role independently testable and prevents Chromium permission details from entering model schemas.

**Expose unbounded page automation.** Rejected because arbitrary selectors, downloads, cookies, screenshots, and unrestricted input require broader permissions, privacy rules, result types, and presentation. The page-control decision instead exposes a bounded set of document-bound references and operations.

**Register a provider permanently after one successful probe.** Rejected because page closure and network resets can leave a stale provider selected. Renewable leases give the Host an authoritative expiry without requiring a reliable disconnect packet.

**Build a separate lightweight chat client for the side panel.** Rejected because it would duplicate session, approval, settings, tool-result, and plugin-slot behavior. Embedding the assembled loopback Web UI keeps one conversation implementation and lets the ordinary Client provider run inside the side panel.

## Consequences

Users must explicitly load the packaged extension. The side panel itself keeps an eligible Web Client page open, while standalone loopback pages remain supported. The Host remains independent of Chromium and never receives extension authority beyond the validated closed operation union. The `tabs` permission exposes URLs and titles inside the extension, so list operations retain default approval outside the shipped side-assistant presets. Multiple connected pages are resolved automatically by visibility and recency rather than user choice, and all provider and request state is in memory.
