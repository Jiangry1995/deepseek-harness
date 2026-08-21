# Browser Companion Autostart Implementation Plan

English | [中文](2026-08-15-browser-companion-autostart.zh.md)

> **For agentic workers:** Execute this plan in the existing browser-extension worktree because the feature it extends is still uncommitted there. Do not stage, commit, or push without the user's request.

**Goal:** Install a Windows tray companion that starts the Harness Web profile at sign-in, lets the user open, stop, restart, and inspect it, and lets the Chromium side panel recover by starting the companion and Web service when sign-in startup did not run.

**Architecture:** `@deepseek-ai/dsh-client-browser-extension` owns one Windows companion executable beside its MV3 artifacts. A current-user scheduled task starts the tray at interactive logon; Chrome Native Messaging starts the same executable on demand and sends only `ensure-web`. The tray is the sole owner of Web processes it creates, contains them in a kill-on-close Job Object, exposes a current-user named-pipe command channel, and treats an already-listening 3080 server as external and therefore not stoppable.

**Tech Stack:** Chromium MV3 TypeScript, Vitest/jsdom, C#/.NET Framework WinForms, Windows Job Objects and named pipes, PowerShell 7 installer/build scripts, Task Scheduler, HKCU Native Messaging registration.

---

### Task 1: Pin extension startup behavior before implementation

**Files:**
- Modify: `packages/client/browser-extension/tests/extension-runtime.client.spec.ts`
- Modify: `packages/client/browser-extension/tests/sidepanel-runtime.client.spec.ts`
- Modify: `packages/client/browser-extension/extension/manifest.json`

- [ ] Add a background-listener test proving that only the extension side-panel page can request `{ kind: 'ensure-local-harness', origin: 'http://127.0.0.1:3080' }`, that the request is forwarded to `com.deepseek.dsh_browser_companion`, and that malformed origins and loopback content pages cannot reach Native Messaging.
- [ ] Add side-panel controller tests proving the initial failed probe enters `starting`, calls the injected starter exactly once, retries without a loop after a successful native response, and reports installation/start failures without hiding the original connection problem.
- [ ] Update the manifest expectation to require `nativeMessaging` and a stable development `key`.
- [ ] Run the two focused Vitest files and observe failures caused by the missing startup path.

### Task 2: Implement the extension-to-companion request path

**Files:**
- Modify: `packages/client/browser-extension/src/extension/runtime.ts`
- Modify: `packages/client/browser-extension/src/extension/background.ts`
- Modify: `packages/client/browser-extension/src/extension/sidepanel-runtime.ts`
- Modify: `packages/client/browser-extension/src/extension/sidepanel.ts`
- Modify: `packages/client/browser-extension/extension/sidepanel.html`
- Modify: `packages/client/browser-extension/extension/sidepanel.css`
- Modify: `packages/client/browser-extension/extension/manifest.json`

- [ ] Add a closed native request/response parser in the Service Worker. Accept only the exact side-panel sender URL, normalize only loopback origin-only HTTP URLs, call `runtime.sendNativeMessage`, and convert Chrome host-not-found or host-exited failures to concise Chinese UI diagnostics.
- [ ] Inject `ensureHarness(origin)` into `SidePanelController`. Attempt native startup only after a network/timeout failure, never after an HTTP response, and never more than once per connection attempt.
- [ ] Add a `starting` presentation that keeps settings available and explains that the tray companion is launching Harness.
- [ ] Run the focused Vitest files and confirm the new behavior and the existing browser-tab path pass together.

### Task 3: Build the Windows companion around explicit ownership

**Files:**
- Create: `packages/client/browser-extension/windows/DeepSeekHarness.Companion.cs`
- Create: `packages/client/browser-extension/windows/DeepSeekHarness.Companion.Tests.cs`
- Create: `packages/client/browser-extension/windows/build.ps1`

- [ ] Start with public protocol/config/command-line stubs that throw `NotImplementedException`, then add a console test executable covering UTF-8 native-message framing, the closed `ensure-web` request, origin/config validation, Chrome invocation detection, and response serialization. Run it and observe the expected failing assertions.
- [ ] Implement Native Messaging framing with 32-bit little-endian byte lengths and a one-message maximum, writing diagnostics only to the configured log or stderr.
- [ ] Implement a single-instance WinForms tray with menu rows for status, open Harness, start, restart, stop, logs, and exit. Keep the icon present even when service startup fails.
- [ ] Implement a current-user-only named-pipe command server. A Native Messaging invocation connects to the tray, starts it when absent, sends `ensure-web`, waits for readiness, and returns one framed result.
- [ ] Launch the fixed `node --import tsx/esm apps/cli/src/bin.ts --profile web` command from the installed repository root with a scrubbed environment, hidden window, bounded readiness wait, and timestamped UTF-8 logs. Reject arbitrary commands, arguments, roots, origins, and profiles.
- [ ] Put owned processes in a kill-on-close Windows Job Object. Stop/restart terminates the owned job, awaits process exit and port release, and never kills a healthy process the tray did not create.
- [ ] Run the C# console tests through `windows/build.ps1 -RunTests` and confirm all assertions pass.

### Task 4: Install, uninstall, and repair the current-user integration

**Files:**
- Create: `packages/client/browser-extension/windows/install.ps1`
- Create: `packages/client/browser-extension/windows/uninstall.ps1`
- Modify: `packages/client/browser-extension/package.json`

- [ ] Make installation compile the companion with the available .NET Framework C# compiler, copy only runtime artifacts under `%LOCALAPPDATA%\DeepSeekHarness\BrowserCompanion`, write UTF-8 config and Native Messaging manifest files, and derive the stable extension id from the manifest public key.
- [ ] Register `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.deepseek.dsh_browser_companion` and a current-user interactive-logon scheduled task named `DeepSeek Harness Browser Companion`. Configure start-when-available and bounded restart attempts, then start the task.
- [ ] Make repeated installs replace the owned task, manifest, config, and executable without deleting logs. Validate every resolved source and destination path before replacement.
- [ ] Make uninstall stop the owned task/process, unregister only the exact task and HKCU key, and remove only the exact companion install directory after path validation. Never touch Harness Web processes that are not owned by the companion.
- [ ] Add `windows:build`, `windows:test`, `windows:install`, and `windows:uninstall` package scripts and publish the Windows sources/scripts with the extension package.

### Task 5: Document the durable behavior and verify the assembled path

**Files:**
- Modify: `packages/client/browser-extension/README.md`
- Modify: `packages/client/browser-extension/README.zh.md`
- Modify: `docs/user/guide/index.md`
- Modify: `docs/user/guide/index.zh.md`
- Modify: `docs/subsystems/browser.md`
- Modify: `docs/subsystems/browser.zh.md`
- Modify: `.agents/notes/implemented/feature/2026-08-14-browser-tab-extension.md`
- Modify: `.agents/notes/implemented/feature/2026-08-14-browser-tab-extension.zh.md`
- Re-record: the matching `.i18n.yaml` files.

- [ ] Document the one-time install command, stable extension reload requirement, tray operations, login task, Native Messaging fallback, log location, external-process ownership rule, repair/reinstall command, and uninstall command in the owning package README; keep higher-level docs concise and linked.
- [ ] Update the existing browser-extension Agent Note rather than creating a competing owner. Record the native bootstrap security rule, process ownership, task/native fallback, alternatives, and current verification evidence; audit related active notes for supersession.
- [ ] Run focused Vitest, package TypeScript build, extension bundle, focused oxlint, C# tests, documentation pairing/format/budget checks, and changed-file whitespace checks.
- [ ] Install the companion on the current Windows account, verify the scheduled task and Native Messaging registry entry, stop the service, invoke the real native host framing path, and confirm the tray-owned Web profile becomes healthy on 127.0.0.1:3080.
- [ ] Load/reload the unpacked extension in headed Chromium, open the side panel with 3080 stopped, and verify it displays `正在启动`, starts the tray/Web service, embeds the Harness Web UI, and retains the existing real `list-tabs` bridge.
