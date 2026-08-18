# @deepseek-ai/dsh-client-ui-web

English | [中文](README.zh.md)

Web Client control for session-scoped web tool availability. The plugin occupies `conversation.input.left` with a persistent **Web** chip, reads the Host-computed `webNetworking` projection, and routes changes through the existing `/web` command instead of maintaining browser-local state.

## Runtime behavior

The chip renders only when the active composition publishes the `webNetworking` projection. Its pressed state follows `projection.enabled`; clicking it executes `/web off` when enabled and `/web` when disabled. Removed sessions and an in-flight command disable the control. A failed command leaves the projected state unchanged and displays a compact status beside the chip.

The plugin registers Simplified Chinese and English accessible labels and titles. Its node entry is intentionally empty: the package is loadable from the Host plugin tree, while all visible behavior comes from the `./client` export. Slot registration, locale registration, and pending component state are released with the Client plugin lifecycle.

## Model Experience

Indirectly, through [`dsh-web-networking`](../../web/web-networking/README.md), which owns the durable preference and resulting `web_search`/`web_fetch` schema visibility; this package only exposes that choice in the Web Client.

#### KV Cache effect

Clicking the chip can invalidate reuse from the tool-schema list when the Host applies the new restriction; the UI package itself contributes no prompt or schema.

## Known Limitations and Deferred Work

- **Command round trip required** — the chip does not update optimistically; it waits for the Host projection produced after `/web` or `/web off` succeeds.
- **One combined switch** — search and fetch are enabled or disabled together; the UI does not offer per-tool controls.
- **No capability means no control** — compositions without `dsh-web-networking` publish no projection, so the chip is intentionally absent.
