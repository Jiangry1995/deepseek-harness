# Agent Note: Wait-page Host and page-bridge timers outlast the in-page wait

Status: implemented

English | [中文](2026-08-20-browser-wait-bridge-timeout.zh.md)

## Problem

`browser_wait_for` can wait up to 30s in the page. Host already retains a wait-page request longer than `requestTimeoutMs`, but the Web Client page bridge ignores `operation.timeoutMs` and uses the advertised lease timeout minus 1000ms of slack. A 30s text-absent wait therefore dies at about 14s with `browser extension bridge response timed out`, completed as `BROWSER_API_FAILED`, while the in-page wait is still running. Composer send and incomplete-wait recovery is recorded in [chat composers send from snapshot controls](2026-08-19-browser-composer-send-and-wait-recovery.md).

## Decision

Keep three nested timers: in-page wait T, page bridge, Host.

Host retains wait-page for `max(requestTimeoutMs, timeoutMs + 1500)`. The Client uses that same Host formula, then subtracts 1000ms of slack. For T=30000 and default `requestTimeoutMs` 15000, the in-page wait is 30000ms, the page bridge is 30500ms, and Host is 31500ms. Other operations still use the advertised lease timeout minus slack. The 1500ms Host headroom is duplicated in `dsh-browser` and `dsh-client-browser-extension` so the Client package does not import the Host service.

## Alternatives considered

**Raise default `requestTimeoutMs` to 32s.** Rejected because list, click, and fill should still fail in 15s when the extension hangs; only wait-page has a caller-chosen budget.

**Keep Host at +500 and shrink slack for wait-page.** Rejected because a 500ms Host gap equals the 1000ms slack cap when Host already used +500, leaving the page bridge and in-page wait at the same instant.

**Cap slack so the bridge never drops below T, leave Host at +500.** A wait that completes at T then races the bridge timer. Headroom on Host plus slack on the bridge keeps a gap.

## Consequences

A 30s text-absent wait can finish or return `BROWSER_WAIT_TIMEOUT` instead of a 14s bridge failure. The tool's 32s ceiling still contains Host 31500ms. A hung wait still fails closed. Ordinary operations keep the 15s Host timeout.

## Testing

`packages/web/browser` keeps wait-page pending past `requestTimeoutMs` and times out at `timeoutMs + 1500`. `packages/client/browser-extension` keeps wait-page pending past the lease-only page-bridge timeout and then completes `BROWSER_API_FAILED` at Host-formula minus slack when no response arrives.
