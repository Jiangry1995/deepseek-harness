/** Isolated-world bridge between the DSH page and the extension Service Worker. */

import {
  BROWSER_EXTENSION_CHANNEL,
  BROWSER_EXTENSION_PROTOCOL_VERSION,
  isBridgeProbe,
  isBridgeRequest,
  isBridgeResponse,
} from '../protocol.ts'
import type { BridgeResponse } from '../protocol.ts'

interface MessageRuntime {
  sendMessage(message: unknown): Promise<unknown>
}

/**
 * Install the loopback page bridge.
 * @param target - loopback DSH page window.
 * @param runtime - Chromium runtime messaging API.
 * @returns listener disposer.
 */
export function installContentBridge(target: Window, runtime: MessageRuntime): () => void {
  /** Announce that the content script supports the current protocol version. */
  const postReady = (): void => {
    target.postMessage({
      channel: BROWSER_EXTENSION_CHANNEL,
      version: BROWSER_EXTENSION_PROTOCOL_VERSION,
      direction: 'ready',
    }, target.location.origin)
  }

  /** Echo one validated Service Worker response to its page request. */
  const postResponse = (requestId: string, response: BridgeResponse['response']): void => {
    target.postMessage({
      channel: BROWSER_EXTENSION_CHANNEL,
      version: BROWSER_EXTENSION_PROTOCOL_VERSION,
      direction: 'response',
      requestId,
      response,
    }, target.location.origin)
  }

  /** Forward page probes and validated requests from the same window. */
  const onMessage = (event: MessageEvent<unknown>): void => {
    if (event.source !== target) return
    if (isBridgeProbe(event.data)) {
      postReady()
      return
    }
    if (!isBridgeRequest(event.data)) return
    const request = event.data
    void runtime.sendMessage(request).then(
      (response) => {
        const candidate = {
          channel: BROWSER_EXTENSION_CHANNEL,
          version: BROWSER_EXTENSION_PROTOCOL_VERSION,
          direction: 'response',
          requestId: request.requestId,
          response,
        }
        if (isBridgeResponse(candidate)) postResponse(request.requestId, candidate.response)
        else postResponse(request.requestId, {
          ok: false,
          error: { code: 'BROWSER_INVALID_REQUEST', message: 'browser extension: invalid Service Worker response' },
        })
      },
      (error: unknown) => {
        postResponse(request.requestId, {
          ok: false,
          error: { code: 'BROWSER_API_FAILED', message: error instanceof Error ? error.message : String(error) },
        })
      },
    )
  }

  target.addEventListener('message', onMessage)
  postReady()
  return () => { target.removeEventListener('message', onMessage) }
}
