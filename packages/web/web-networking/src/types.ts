/**
 * Pure types of the web-networking domain: the ONE home of the
 * `webNetworking` projection-key declaration, free of this package's
 * host-side value imports.
 *
 * @module @deepseek-ai/dsh-web-networking/types
 */

/**
 * Whether inherited `web_search` / `web_fetch` are available for this session.
 * Capability absence (plugin not composed) is the key's absence, never a value.
 */
export interface WebNetworkingProjection {
  enabled: boolean
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Web tool availability folded from `web/networking` events. */
    webNetworking: WebNetworkingProjection
  }
}
