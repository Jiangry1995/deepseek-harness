# Agent Note: MAIN-world page-probe console rendering never throws into the page

Status: implemented

English | [中文](2026-08-20-page-probe-console-inspect.zh.md)

## Problem

During an active `inspect-page` capture, the Side Assistant wraps `console.log` / `info` / `warn` / `error` / `debug`. Rendering arbitrary arguments with `JSON.stringify` or `String()` invokes Vue reactive proxy traps and can throw `TypeError: Cannot convert object to primitive value`. A diagnostic wrapper must not add synchronous work proportional to an object graph or prevent the page's original console method from running.

## Decision

`inspectValue` renders strings and primitive values directly, guarded Error details when available, and fixed `[Array]`, `[Object]`, or `[Function]` tokens for other values. It never enumerates an arbitrary page object. A console wrapper calls the original method before best-effort recording, so diagnostic failure cannot change page console behavior. Fetch failures and `unhandledrejection` use the same bounded conversion.

## Alternatives considered

**Disable the MAIN-world probe during an active capture.** Rejected because `inspect-page` needs page-world access to observe console and fetch/XHR calls during that explicit session. The probe remains absent from untouched tabs and dormant outside capture as recorded by [on-demand page observation](2026-08-20-side-assistant-on-demand-page-observation.md).

**Swallow the conversion error and drop the console line.** Rejected because `inspect-page` would then miss the framework warning that triggered the failure, and the original `console.warn` would still not run if the throw happened before forwarding.

**Fall back from `JSON.stringify` to `String(arg)`.** Rejected because both operations can invoke page-owned code and throw.

## Consequences

A page `console.warn` of a Vue proxy records `[Object]` and still reaches the original console. Object fields are intentionally absent from inspect output; string arguments retain the framework's diagnostic text without object traversal.

## Testing

`packages/client/browser-extension/tests/page-probe.client.spec.ts` asserts that a throwing proxy is not read, its warning reaches the original console, and inspect output carries the fixed object token. The same file pins primitive, Error, array, object, and function rendering.

## Related

- [Browser tab extension](../feature/2026-08-14-browser-tab-extension.md) — owns the Side Assistant and `inspect-page` capture path this rendering helper serves.
- [On-demand page observation](2026-08-20-side-assistant-on-demand-page-observation.md) — owns probe injection and capture lifetime.
