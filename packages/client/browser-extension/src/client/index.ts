/** Client Cordis provider that leases the installed MV3 extension to the Host. */

import type { Context } from '@deepseek-ai/cordis'
import type {
  BrowserClientLease,
  BrowserCommand,
  BrowserCompletion,
  BrowserOperationResult,
} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-runtime/client'
import { isBridgeLeaseWakeup } from '../protocol.ts'
import { PageExtensionBridge } from './bridge.ts'

/** Required Remote service and browser namespace. */
export const inject = ['remote', 'remote.browser']

/** Convert an arbitrary failure to a stable message for the Host completion. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Finish the page-bridge wait before the Host request timer so a concrete extension
 * failure is completed instead of racing into `BROWSER_REQUEST_TIMEOUT`.
 * @param leaseTimeoutMs - Host-advertised request timeout.
 * @returns timeout used by the page-side bridge.
 */
function providerRequestTimeoutMs(leaseTimeoutMs: number): number {
  const slackMs = Math.min(1_000, Math.max(0, leaseTimeoutMs - 1))
  return Math.max(1, leaseTimeoutMs - slackMs)
}

/**
 * Apply Host-only opaque identifier brands after the extension response passes protocol validation.
 * @param response - validated bridge response from the isolated-world content script.
 * @returns response accepted by the typed Host Remote API.
 */
function hostCompletionResponse(
  response: Awaited<ReturnType<PageExtensionBridge['request']>>,
): BrowserCompletion['response'] {
  if (!response.ok) return response
  return { ok: true, value: response.value as BrowserOperationResult }
}

/** Return a generated Remote value or surface its transport failure. */
function remoteValue<T>(
  operation: string,
  result: { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } },
): T {
  if (!result.ok) throw new Error(`${operation} failed: ${result.error.code}: ${result.error.message}`)
  return result.value
}

/** Owns one page bridge, Host lease, command subscription, and heartbeat loop. */
class BrowserExtensionProvider {
  private readonly bridge = new PageExtensionBridge(window)
  private readonly rawClientId = `web-${crypto.randomUUID()}`
  private lease: BrowserClientLease | undefined
  private heartbeatTimer: number | undefined
  private connecting: Promise<void> | undefined
  private disposal: Promise<void> | undefined
  private disposed = false
  private offReady: () => void = () => {}

  /** Create a provider bound to the Client Cordis context. */
  constructor(private readonly ctx: Context) {}

  /** Push the new visibility to the Host instead of waiting for the next scheduled renewal. */
  private readonly onVisibilityChange = (): void => { void this.heartbeat() }

  /**
   * Renew or re-register when the side-panel parent pokes this throttled iframe.
   * Chromium may freeze this page's timers while the user works in the main tab;
   * the parent document stays runnable and posts a protocol wakeup instead.
   * @param event - untrusted window message.
   */
  private readonly onParentMessage = (event: MessageEvent): void => {
    if (this.disposed || event.source !== window.parent) return
    if (!isBridgeLeaseWakeup(event.data)) return
    if (this.lease === undefined) void this.connect()
    else void this.heartbeat()
  }

  /**
   * Report whether this page can answer a command before the Host request timeout.
   * A hidden page is throttled by the renderer, so the Host must be able to prefer a
   * visible provider over this one even while this lease is still live.
   * @returns whether the page is renderer-visible.
   */
  private isVisible(): boolean {
    return document.visibilityState === 'visible'
  }

  /** Subscribe to bridge, connection, visibility, and Host command events. */
  start(): void {
    this.offReady = this.bridge.onReady(() => { void this.connect() })
    this.ctx.on('connection/reset', () => { void this.connect() })
    this.ctx.remote.$on('browser/command', (command) => { this.onCommand(command) })
    document.addEventListener('visibilitychange', this.onVisibilityChange)
    window.addEventListener('message', this.onParentMessage)
  }

  /** Clear the scheduled lease renewal when present. */
  private clearHeartbeat(): void {
    if (this.heartbeatTimer === undefined) return
    window.clearTimeout(this.heartbeatTimer)
    this.heartbeatTimer = undefined
  }

  /** Schedule one renewal at half the current lease duration. */
  private scheduleHeartbeat(): void {
    this.clearHeartbeat()
    if (this.disposed || this.lease === undefined) return
    this.heartbeatTimer = window.setTimeout(
      () => { void this.heartbeat() },
      Math.max(1, Math.floor(this.lease.leaseMs / 2)),
    )
  }

  /** Coalesce concurrent registration requests onto one Remote call. */
  private async connect(): Promise<void> {
    if (this.disposed || !this.bridge.isReady) return
    if (this.connecting !== undefined) {
      await this.connecting
      return
    }
    const attempt = this.register()
    this.connecting = attempt
    try {
      await attempt
    } finally {
      if (this.connecting === attempt) this.connecting = undefined
    }
  }

  /** Register the generated provider identity and retain the returned lease. */
  private async register(): Promise<void> {
    try {
      this.lease = remoteValue('browser.connect', await this.ctx.remote.browser.connect(this.rawClientId, this.isVisible()))
      this.scheduleHeartbeat()
    } catch (error) {
      this.ctx.logger.warn('browser extension: provider registration failed')
      this.ctx.logger.warn(error)
    }
  }

  /** Renew the current lease, re-registering after a failed renewal. */
  private async heartbeat(): Promise<void> {
    if (this.disposed || this.lease === undefined) return
    try {
      this.lease = remoteValue('browser.heartbeat', await this.ctx.remote.browser.heartbeat(this.lease.clientId, this.isVisible()))
      this.scheduleHeartbeat()
    } catch (error) {
      this.ctx.logger.warn('browser extension: provider heartbeat failed; re-registering')
      this.ctx.logger.warn(error)
      this.lease = undefined
      await this.connect()
    }
  }

  /** Start one command completion and contain failures at the event callback. */
  private onCommand(command: BrowserCommand): void {
    void this.handleCommand(command).catch((error: unknown) => {
      this.ctx.logger.warn('browser extension: command completion failed')
      this.ctx.logger.warn(error)
    })
  }

  /** Route one selected Host command through the page bridge and complete it remotely. */
  private async handleCommand(command: BrowserCommand): Promise<void> {
    const currentLease = this.lease
    if (this.disposed || currentLease === undefined || command.clientId !== currentLease.clientId) return
    let response: BrowserCompletion['response']
    try {
      response = hostCompletionResponse(await this.bridge.request(
        command.requestId,
        command.operation,
        providerRequestTimeoutMs(currentLease.requestTimeoutMs),
      ))
    } catch (error) {
      response = { ok: false, error: { code: 'BROWSER_API_FAILED', message: errorMessage(error) } }
    }
    const completion = remoteValue('browser.complete', await this.ctx.remote.browser.complete({
      requestId: command.requestId,
      clientId: command.clientId,
      response,
    }))
    if (!completion.accepted && completion.reason !== 'request-not-found') {
      throw new Error(`browser.complete rejected the extension response: ${completion.reason}`)
    }
  }

  /** Return the shared asynchronous teardown for this provider. */
  dispose(): Promise<void> {
    this.disposal ??= this.disposeOnce()
    return this.disposal
  }

  /** Stop new work, join registration, and release the last acquired Host lease. */
  private async disposeOnce(): Promise<void> {
    this.disposed = true
    this.clearHeartbeat()
    document.removeEventListener('visibilitychange', this.onVisibilityChange)
    window.removeEventListener('message', this.onParentMessage)
    this.offReady()
    this.bridge.dispose()
    await this.connecting
    const currentLease = this.lease
    this.lease = undefined
    if (currentLease !== undefined) {
      remoteValue('browser.disconnect', await this.ctx.remote.browser.disconnect(currentLease.clientId))
    }
  }
}

/**
 * Register the page-to-extension provider and maintain its Host lease.
 * @param ctx - Client Cordis context carrying generated Remote namespaces.
 */
export function apply(ctx: Context): void {
  const provider = new BrowserExtensionProvider(ctx)
  ctx.effect(() => {
    provider.start()
    return () => provider.dispose()
  }, 'browser extension provider lifecycle')
}
