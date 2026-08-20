# DeepSeek Harness Desktop

English | [中文](README.zh.md)

`DesktopApp` is a nested Electron shell for this checkout. It does not replace the Agent, session, tool, config, or Web implementations. Opening the EXE starts `dsh web` on `127.0.0.1:3080`; closing the last window stops that owned Host process tree. The Chrome side assistant and ordinary browser H5 attach to the same loopback origin.

## Development

Prerequisites: repository dependencies are installed, and Node.js matches the root engines field. Install the nested desktop dependencies once:

```powershell
cd DesktopApp
pnpm install
```

Start the desktop shell:

```powershell
pnpm start
```

Development mode prefers the already built `apps/cli/lib/bin.js`. If that file is missing, it boots `apps/cli/src/bin.ts` through the root `tsx`. The backend uses the user Documents directory as cwd and keeps the default `DSH_HOME`, so CLI, H5, and desktop share sessions, settings, and credentials. If `http://127.0.0.1:3080` is already healthy, `pnpm start` reuses that Host and does not kill it.

## Verification

```powershell
pnpm test
```

Tests cover ready-URL parsing, chunked output, owned-port takeover, packaged versus development lifecycle, and start/stop of a fake backend. They do not call model APIs and they do not touch the running `3080` Host.

## Build the Windows portable zip

From the repository root:

```powershell
pnpm dist:win
```

Run `pnpm run build` first if you invoke `DesktopApp` scripts directly. The root command then:

1. Builds this checkout (CLI, libraries, Web UI, and the side-assistant assets).
2. Builds and runs the desktop-shell tests.
3. Downloads a pinned Windows x64 Node 24 ZIP from the official Node.js dist and checks SHA-256 against `SHASUMS256.txt`.
4. Packs the current DSH, vendored Cordis, and Landlock entry as npm tarballs.
5. Installs that production closure from local tarballs, then checks `dsh --version` and the packed Web frontend.
6. Smoke-tests the staged Web profile on an ephemeral port so packaging does not take over a developer `3080` Host.
7. Copies the existing companion uninstall script, generates the app icon, and builds a Windows x64 portable zip.
8. Smoke-tests the unpacked extraResources layout, then zips `packages/client/browser-extension/extension` to `DesktopApp/release/dsh-side-assistant.zip`.

Artifacts land in `DesktopApp/release/`. The default shippable file is `DeepSeek-Harness-<version>-win-x64.zip`: unzip it and run `DeepSeek Harness.exe`. The zip embeds Node.js and this checkout's Host; the target machine does not need Node.js, pnpm, or a source clone. Staged Node and Harness files stay in ignored `DesktopApp/.runtime/`.

## Lifecycle and security

- The packaged EXE always binds `http://127.0.0.1:3080`. If that port is occupied, it stops the occupants and starts its own Host. It never attaches to an external Host. Closing the window asks whether to hide to the tray (Host keeps running) or exit (stops the owned Host). An intentional stop does not show the backend-crash dialog.
- Packaged launches refresh the desktop and Start Menu shortcuts and register an Add/Remove Programs entry for the current user. Uninstall removes the app folder and shortcuts, and does not delete `~/.dsh`.
- The first packaged launch runs `packages/client/browser-extension/windows/uninstall.ps1` to remove the login scheduled task, Native Messaging host, and `%LOCALAPPDATA%\DeepSeekHarness\BrowserCompanion`.
- Renderer uses Chromium sandbox and context isolation, with Node integration disabled.
- The desktop window rejects navigation away from the backend origin; ordinary HTTP(S) links open in the system browser.
- Closing the window asks whether to hide to the tray or exit. Choosing exit ends the owned backend process tree with `taskkill /T /F` on Windows.
- The shell does not set `DSH_HOME`, so it uses Harness's default user-data location.
- The Chrome extension zip is a sibling artifact. Load the unpacked `extension` folder from the zip; do not embed the extension inside the asar.

## v1 limits

- Windows x64 portable zip only. There is no install wizard; shortcuts and an Add/Remove Programs entry appear after the first launch of the EXE.
- No code signing, auto-update, file associations, or custom title bar.
- Native Messaging "open the plugin to start the EXE" is deferred. Without the EXE, the side assistant has no Host, which is expected.
- This is a compatibility shell over the browser HTTP surface, not a `file://` plus IPC Electron client.
- Packaging uses the current checkout and requires `package.json` `desktopRuntime.harnessVersion` to match the repository version.
