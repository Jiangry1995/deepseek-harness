/** Isolated-world collector that asks the MAIN-world probe for a Network/Console snapshot. */

import type { BridgePageInspectContent } from '../protocol.ts'
import {
  PAGE_PROBE_REQUEST_EVENT,
  PAGE_PROBE_SNAPSHOT_EVENT,
  PAGE_PROBE_SNAPSHOT_TIMEOUT_MS,
  type PageProbeRequest,
  type PageProbeSnapshot,
} from './page-probe-protocol.ts'

/** Empty inspect payload used when the MAIN-world probe did not answer. */
const UNHOOKED: BridgePageInspectContent = {
  hooked: false,
  network: [],
  console: [],
  omittedNetwork: 0,
  omittedConsole: 0,
}

/**
 * Ask the MAIN-world probe for its current buffers.
 * @param mode - whether to start, read, or finish page observation.
 * @param target - window used for CustomEvent exchange.
 * @returns a protocol-valid inspect payload, hooked or not.
 */
export function collectPageProbe(
  mode: 'start' | 'snapshot' | 'stop',
  target: Window = window,
): Promise<BridgePageInspectContent> {
  const requestId = crypto.randomUUID()
  return new Promise((resolve) => {
    let settled = false
    /** Deliver one snapshot exactly once. */
    const finish = (content: BridgePageInspectContent) => {
      if (settled) return
      settled = true
      target.removeEventListener(PAGE_PROBE_SNAPSHOT_EVENT, onSnapshot)
      resolve(content)
    }
    /** Accept a MAIN-world snapshot that matches this request. */
    const onSnapshot = (event: Event) => {
      const detail = (event as CustomEvent<PageProbeSnapshot>).detail
      if (detail.requestId !== requestId) return
      finish({
        hooked: true,
        ...(detail.hookedAt === undefined ? {} : { hookedAt: detail.hookedAt }),
        network: detail.network,
        console: detail.console,
        omittedNetwork: detail.omittedNetwork,
        omittedConsole: detail.omittedConsole,
      })
    }
    target.addEventListener(PAGE_PROBE_SNAPSHOT_EVENT, onSnapshot)
    const request: PageProbeRequest = { requestId, mode }
    target.dispatchEvent(new CustomEvent(PAGE_PROBE_REQUEST_EVENT, { detail: request }))
    setTimeout(() => { finish(UNHOOKED) }, PAGE_PROBE_SNAPSHOT_TIMEOUT_MS)
  })
}
