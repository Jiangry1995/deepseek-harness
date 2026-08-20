/** Shared MAIN-world probe event names and snapshot bounds. */

/** Isolated-world request asking the MAIN-world probe for its current buffers. */
export const PAGE_PROBE_REQUEST_EVENT = 'dsh-page-probe-request'
/** MAIN-world reply carrying a cloned Network/Console snapshot. */
export const PAGE_PROBE_SNAPSHOT_EVENT = 'dsh-page-probe-snapshot'
/** Maximum network entries retained in the MAIN-world ring buffer. */
export const PAGE_PROBE_NETWORK_MAX = 40
/** Maximum console entries retained in the MAIN-world ring buffer. */
export const PAGE_PROBE_CONSOLE_MAX = 40
/** Maximum characters retained for one URL or console line. */
export const PAGE_PROBE_TEXT_MAX = 500
/** How long the isolated world waits for a MAIN-world snapshot. */
export const PAGE_PROBE_SNAPSHOT_TIMEOUT_MS = 400

/** One observed page network call recorded by the MAIN-world probe. */
export interface PageProbeNetworkEntry {
  at: number
  source: 'fetch' | 'xhr'
  method: string
  url: string
  status?: number
  ok?: boolean
  durationMs?: number
  error?: string
}

/** One observed page console or error event recorded by the MAIN-world probe. */
export interface PageProbeConsoleEntry {
  at: number
  level: 'log' | 'info' | 'warn' | 'error' | 'debug'
  text: string
}

/** Snapshot posted from MAIN world to the isolated content script. */
export interface PageProbeSnapshot {
  requestId: string
  hooked: true
  hookedAt: number
  network: PageProbeNetworkEntry[]
  console: PageProbeConsoleEntry[]
  omittedNetwork: number
  omittedConsole: number
}

/** Isolated-world request posted to the MAIN-world probe. */
export interface PageProbeRequest {
  requestId: string
  reset: boolean
}
