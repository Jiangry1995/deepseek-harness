/** Browser-page endpoint of the isolated-world WebExtension bridge. */

import {
  BROWSER_EXTENSION_CHANNEL,
  BROWSER_EXTENSION_PROTOCOL_VERSION,
  isBridgeReady,
  isBridgeResponse,
} from '../protocol.ts'
import type { BridgeOperation, BridgeResponse } from '../protocol.ts'

interface PendingBridgeRequest {
  resolve(value: BridgeResponse['response']): void
  reject(error: Error): void
  timer: number
}

/**
 * Return the embedding extension-page origin when this Web Client is in a side-panel iframe.
 * Same-window content scripts cannot be the only path there: Chromium may omit tab/url on
 * that sender, so the parent document relays probes and requests instead.
 * @param target - DSH page window.
 * @returns chrome-extension origin, or undefined for a top-level loopback tab.
 */
export function parentBridgeOrigin(target: Window): string | undefined {
  if (target.parent === undefined || target.parent === target) return undefined
  const origin = target.location.ancestorOrigins?.[0]
  return typeof origin === 'string' && origin !== '' ? origin : undefined
}

/** Page-side request/response bridge over same-window postMessage. */
export class PageExtensionBridge {
  private readonly pending = new Map<string, PendingBridgeRequest>()
  private readonly readyListeners = new Set<() => void>()
  private ready = false
  private disposed = false

  /**
   * Install the page message listener and probe for a content script.
   * @param target - DSH page window.
   */
  constructor(private readonly target: Window) {
    target.addEventListener('message', this.onMessage)
    this.post({
      channel: BROWSER_EXTENSION_CHANNEL,
      version: BROWSER_EXTENSION_PROTOCOL_VERSION,
      direction: 'probe',
    })
  }

  /** Whether the content script has acknowledged this protocol version. */
  get isReady(): boolean {
    return this.ready
  }

  /**
   * Subscribe to the first readiness transition.
   * @param listener - callback invoked after the content script responds.
   * @returns listener disposer.
   */
  onReady(listener: () => void): () => void {
    this.readyListeners.add(listener)
    if (this.ready) listener()
    return () => { this.readyListeners.delete(listener) }
  }

  /**
   * Execute one browser operation through the content script.
   * @param requestId - Host request identity echoed by the response.
   * @param operation - validated browser operation.
   * @param timeoutMs - maximum time to retain the page-side request.
   * @returns the extension success or failure response.
   */
  request(requestId: string, operation: BridgeOperation, timeoutMs: number): Promise<BridgeResponse['response']> {
    if (this.disposed) return Promise.reject(new Error('browser extension bridge is disposed'))
    if (!this.ready) return Promise.reject(new Error('browser extension bridge is not ready'))
    if (this.pending.has(requestId)) return Promise.reject(new Error('browser extension bridge request id is already pending'))
    return new Promise((resolve, reject) => {
      const timer = this.target.setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error('browser extension bridge response timed out'))
      }, timeoutMs)
      this.pending.set(requestId, { resolve, reject, timer })
      this.post({
        channel: BROWSER_EXTENSION_CHANNEL,
        version: BROWSER_EXTENSION_PROTOCOL_VERSION,
        direction: 'request',
        requestId,
        operation,
      })
    })
  }

  /** Remove listeners and reject every pending request. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.target.removeEventListener('message', this.onMessage)
    for (const [requestId, pending] of this.pending) {
      this.target.clearTimeout(pending.timer)
      pending.reject(new Error('browser extension bridge was disposed'))
      this.pending.delete(requestId)
    }
    this.readyListeners.clear()
  }

  /** Accept readiness and response messages from this window or its side-panel parent. */
  private readonly onMessage = (event: MessageEvent<unknown>): void => {
    const parentOrigin = parentBridgeOrigin(this.target)
    const fromSelf = event.source === this.target
    const fromParent = parentOrigin !== undefined && event.source === this.target.parent
    if (!fromSelf && !fromParent) return
    if (isBridgeReady(event.data)) {
      if (this.ready) return
      this.ready = true
      for (const listener of [...this.readyListeners]) listener()
      return
    }
    if (!isBridgeResponse(event.data)) return
    const pending = this.pending.get(event.data.requestId)
    if (pending === undefined) return
    this.target.clearTimeout(pending.timer)
    this.pending.delete(event.data.requestId)
    pending.resolve(event.data.response)
  }

  /**
   * Post one protocol message to the side-panel parent when embedded, otherwise to this window.
   * @param message - versioned probe or request envelope.
   */
  private post(message: unknown): void {
    const parentOrigin = parentBridgeOrigin(this.target)
    if (parentOrigin !== undefined) {
      this.target.parent.postMessage(message, parentOrigin)
      return
    }
    this.target.postMessage(message, this.target.location.origin)
  }
}
