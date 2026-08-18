// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  BROWSER_EXTENSION_CHANNEL,
  BROWSER_EXTENSION_PROTOCOL_VERSION,
  type BridgeRequest,
} from '../src/protocol.ts'
import { PageExtensionBridge } from '../src/client/bridge.ts'
import { installContentBridge } from '../src/extension/content-runtime.ts'
import { apply, inject } from '../src/client/index.ts'

interface PostedMessage {
  readonly message: unknown
  readonly targetOrigin: string
}

/** Deterministic same-window message target used by both page bridge halves. */
class TestWindow extends EventTarget {
  readonly location = { origin: 'http://127.0.0.1:3080' } as Location
  readonly messages: PostedMessage[] = []

  /** Record one postMessage call without recursively dispatching it. */
  postMessage(message: unknown, targetOrigin: string): void {
    this.messages.push({ message, targetOrigin })
  }

  /** Use jsdom's numeric browser timers. */
  setTimeout(handler: () => void, timeout?: number): number {
    return window.setTimeout(handler, timeout)
  }

  /** Clear a timer created by {@link setTimeout}. */
  clearTimeout(timer: number): void {
    window.clearTimeout(timer)
  }

  /** Dispatch one message event with an explicit source. */
  emit(message: unknown, source: Window | null = this as unknown as Window): void {
    this.dispatchEvent(new MessageEvent('message', { data: message, source }))
  }
}

/** Create one protocol envelope for an operation request. */
function bridgeRequest(requestId: string): BridgeRequest {
  return {
    channel: BROWSER_EXTENSION_CHANNEL,
    version: BROWSER_EXTENSION_PROTOCOL_VERSION,
    direction: 'request',
    requestId,
    operation: { kind: 'list-tabs' },
  }
}

/** Dispatch a protocol message to the real jsdom window as same-window traffic. */
function emitWindow(message: unknown): void {
  window.dispatchEvent(new MessageEvent('message', { data: message, source: window }))
}

/** Build a successful generated Remote result. */
function ok<T>(value: T): { readonly ok: true; readonly value: T } {
  return { ok: true, value }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('PageExtensionBridge', () => {
  it('asks the side-panel parent to relay when this page is an embedded iframe', () => {
    const parent = new TestWindow()
    const target = new TestWindow()
    Object.defineProperty(target, 'parent', { value: parent })
    Object.defineProperty(target.location, 'ancestorOrigins', {
      value: { 0: 'chrome-extension://extension-id', length: 1 },
    })

    const bridge = new PageExtensionBridge(target as unknown as Window)
    expect(target.messages).toEqual([])
    expect(parent.messages).toEqual([{
      message: {
        channel: BROWSER_EXTENSION_CHANNEL,
        version: BROWSER_EXTENSION_PROTOCOL_VERSION,
        direction: 'probe',
      },
      targetOrigin: 'chrome-extension://extension-id',
    }])
    bridge.dispose()
  })

  it('probes, becomes ready once, and resolves a matching response', async () => {
    const target = new TestWindow()
    const bridge = new PageExtensionBridge(target as unknown as Window)
    expect(target.messages).toEqual([{
      message: {
        channel: BROWSER_EXTENSION_CHANNEL,
        version: BROWSER_EXTENSION_PROTOCOL_VERSION,
        direction: 'probe',
      },
      targetOrigin: target.location.origin,
    }])

    const ready = vi.fn()
    const offReady = bridge.onReady(ready)
    target.emit({ channel: BROWSER_EXTENSION_CHANNEL, version: BROWSER_EXTENSION_PROTOCOL_VERSION, direction: 'ready' })
    target.emit({ channel: BROWSER_EXTENSION_CHANNEL, version: BROWSER_EXTENSION_PROTOCOL_VERSION, direction: 'ready' })
    expect(bridge.isReady).toBe(true)
    expect(ready).toHaveBeenCalledTimes(1)

    const pending = bridge.request('bridge-1', { kind: 'list-tabs' }, 1_000)
    expect(target.messages.at(-1)?.message).toEqual(bridgeRequest('bridge-1'))
    await expect(bridge.request('bridge-1', { kind: 'list-tabs' }, 1_000))
      .rejects.toThrow('request id is already pending')
    target.emit({
      channel: BROWSER_EXTENSION_CHANNEL,
      version: BROWSER_EXTENSION_PROTOCOL_VERSION,
      direction: 'response',
      requestId: 'bridge-1',
      response: { ok: true, value: { kind: 'list-tabs', tabs: [] } },
    }, null)
    target.emit({
      channel: BROWSER_EXTENSION_CHANNEL,
      version: BROWSER_EXTENSION_PROTOCOL_VERSION,
      direction: 'response',
      requestId: 'bridge-1',
      response: { ok: true, value: { kind: 'list-tabs', tabs: [] } },
    })
    await expect(pending).resolves.toEqual({ ok: true, value: { kind: 'list-tabs', tabs: [] } })

    offReady()
    bridge.onReady(ready)()
    expect(ready).toHaveBeenCalledTimes(2)
    bridge.dispose()
  })

  it('rejects not-ready, timed-out, and disposed requests and settles pending work on disposal', async () => {
    vi.useFakeTimers()
    const target = new TestWindow()
    const bridge = new PageExtensionBridge(target as unknown as Window)
    await expect(bridge.request('early', { kind: 'list-tabs' }, 20)).rejects.toThrow('not ready')
    target.emit({ channel: BROWSER_EXTENSION_CHANNEL, version: BROWSER_EXTENSION_PROTOCOL_VERSION, direction: 'ready' })

    const timedOut = bridge.request('timeout', { kind: 'list-tabs' }, 20)
    const timedOutResult = expect(timedOut).rejects.toThrow('response timed out')
    await vi.advanceTimersByTimeAsync(21)
    await timedOutResult

    const disposed = bridge.request('disposed', { kind: 'list-tabs' }, 20)
    const disposedResult = expect(disposed).rejects.toThrow('bridge was disposed')
    bridge.dispose()
    bridge.dispose()
    await disposedResult
    await expect(bridge.request('late', { kind: 'list-tabs' }, 20)).rejects.toThrow('bridge is disposed')
  })
})

describe('content-script bridge', () => {
  it('announces readiness and validates Service Worker responses', async () => {
    const target = new TestWindow()
    const sendMessage = vi.fn()
    const dispose = installContentBridge(target as unknown as Window, { sendMessage })
    expect(target.messages[0]?.message).toMatchObject({ direction: 'ready' })

    target.emit({ channel: BROWSER_EXTENSION_CHANNEL, version: BROWSER_EXTENSION_PROTOCOL_VERSION, direction: 'probe' })
    expect(target.messages[1]?.message).toMatchObject({ direction: 'ready' })

    sendMessage.mockResolvedValueOnce({ ok: true, value: { kind: 'list-tabs', tabs: [] } })
    target.emit(bridgeRequest('content-success'))
    await vi.waitFor(() => {
      expect(target.messages.at(-1)?.message).toMatchObject({
        direction: 'response',
        requestId: 'content-success',
        response: { ok: true, value: { kind: 'list-tabs', tabs: [] } },
      })
    })

    sendMessage.mockResolvedValueOnce({ unexpected: true })
    target.emit(bridgeRequest('content-invalid'))
    await vi.waitFor(() => {
      expect(target.messages.at(-1)?.message).toMatchObject({
        requestId: 'content-invalid',
        response: { ok: false, error: { code: 'BROWSER_INVALID_REQUEST' } },
      })
    })

    sendMessage.mockRejectedValueOnce(new Error('worker stopped'))
    target.emit(bridgeRequest('content-failed'))
    await vi.waitFor(() => {
      expect(target.messages.at(-1)?.message).toMatchObject({
        requestId: 'content-failed',
        response: { ok: false, error: { code: 'BROWSER_API_FAILED', message: 'worker stopped' } },
      })
    })

    dispose()
    target.emit(bridgeRequest('after-dispose'))
    expect(sendMessage).toHaveBeenCalledTimes(3)
  })
})

describe('Client extension provider lifecycle', () => {
  it('connects after readiness, completes commands, and disconnects', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000001')
    const lease = { clientId: 'web-client-1', leaseMs: 100_000, requestTimeoutMs: 500 }
    const browser = {
      connect: vi.fn().mockResolvedValue(ok(lease)),
      heartbeat: vi.fn().mockResolvedValue(ok(lease)),
      complete: vi.fn().mockResolvedValue(ok({ accepted: true })),
      disconnect: vi.fn().mockResolvedValue(ok({ disconnected: true })),
    }
    let commandListener!: (command: unknown) => void
    const remote = {
      browser,
      $on: vi.fn((_event: string, listener: (command: unknown) => void) => { commandListener = listener }),
    }
    const ctx = new Context()
    const lifecycleError = vi.spyOn(ctx.logger, 'error')
    ctx.provide('remote', remote as never)
    ctx.provide('remote.browser', browser as never)
    const postMessage = vi.spyOn(window, 'postMessage').mockImplementation(() => {})
    const removeEventListener = vi.spyOn(window, 'removeEventListener')
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    emitWindow({ channel: BROWSER_EXTENSION_CHANNEL, version: BROWSER_EXTENSION_PROTOCOL_VERSION, direction: 'ready' })
    await vi.waitFor(() => {
      expect(browser.connect).toHaveBeenCalledWith('web-00000000-0000-4000-8000-000000000001', true)
    })

    commandListener({
      requestId: 'host-request-1',
      clientId: lease.clientId,
      operation: { kind: 'list-tabs' },
    })
    await vi.waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith(bridgeRequest('host-request-1'), window.location.origin)
    })
    emitWindow({
      channel: BROWSER_EXTENSION_CHANNEL,
      version: BROWSER_EXTENSION_PROTOCOL_VERSION,
      direction: 'response',
      requestId: 'host-request-1',
      response: { ok: true, value: { kind: 'list-tabs', tabs: [] } },
    })
    await vi.waitFor(() => {
      expect(browser.complete).toHaveBeenCalledWith({
        requestId: 'host-request-1',
        clientId: lease.clientId,
        response: { ok: true, value: { kind: 'list-tabs', tabs: [] } },
      })
    })

    await fiber.dispose()
    expect(lifecycleError).not.toHaveBeenCalled()
    expect(removeEventListener).toHaveBeenCalledWith('message', expect.any(Function))
    expect(browser.disconnect).toHaveBeenCalledWith(lease.clientId)
  })

  it('renews the active provider lease at half the advertised duration', async () => {
    vi.useFakeTimers()
    const lease = { clientId: 'heartbeat-client', leaseMs: 100, requestTimeoutMs: 500 }
    const browser = {
      connect: vi.fn().mockResolvedValue(ok(lease)),
      heartbeat: vi.fn().mockResolvedValue(ok(lease)),
      complete: vi.fn(),
      disconnect: vi.fn().mockResolvedValue(ok({ disconnected: true })),
    }
    const remote = { browser, $on: vi.fn() }
    const ctx = new Context()
    ctx.provide('remote', remote as never)
    ctx.provide('remote.browser', browser as never)
    vi.spyOn(window, 'postMessage').mockImplementation(() => {})
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    emitWindow({ channel: BROWSER_EXTENSION_CHANNEL, version: BROWSER_EXTENSION_PROTOCOL_VERSION, direction: 'ready' })
    await vi.advanceTimersByTimeAsync(0)
    expect(browser.connect).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(50)
    expect(browser.heartbeat).toHaveBeenCalledWith(lease.clientId, true)

    await fiber.dispose()
  })

  it('renews or re-registers when the side-panel parent wakes a throttled iframe', async () => {
    const lease = { clientId: 'wakeup-client', leaseMs: 100_000, requestTimeoutMs: 500 }
    const browser = {
      connect: vi.fn()
        .mockRejectedValueOnce(new Error('host unavailable'))
        .mockResolvedValue(ok(lease)),
      heartbeat: vi.fn().mockResolvedValue(ok(lease)),
      complete: vi.fn(),
      disconnect: vi.fn().mockResolvedValue(ok({ disconnected: true })),
    }
    const remote = { browser, $on: vi.fn() }
    const ctx = new Context()
    ctx.provide('remote', remote as never)
    ctx.provide('remote.browser', browser as never)
    vi.spyOn(window, 'postMessage').mockImplementation(() => {})
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    emitWindow({ channel: BROWSER_EXTENSION_CHANNEL, version: BROWSER_EXTENSION_PROTOCOL_VERSION, direction: 'ready' })
    await vi.waitFor(() => { expect(browser.connect).toHaveBeenCalledOnce() })
    await vi.waitFor(() => { expect(warn).toHaveBeenCalled() })

    const wakeup = {
      channel: BROWSER_EXTENSION_CHANNEL,
      version: BROWSER_EXTENSION_PROTOCOL_VERSION,
      direction: 'lease-wakeup',
    }
    window.dispatchEvent(new MessageEvent('message', { data: wakeup, source: window.parent }))
    await vi.waitFor(() => { expect(browser.connect).toHaveBeenCalledTimes(2) })
    expect(browser.heartbeat).not.toHaveBeenCalled()

    window.dispatchEvent(new MessageEvent('message', { data: wakeup, source: window.parent }))
    await vi.waitFor(() => {
      expect(browser.heartbeat).toHaveBeenCalledWith(lease.clientId, true)
    })

    expect(warn).toHaveBeenCalled()
    await fiber.dispose()
  })

  it('reports itself hidden as soon as the renderer hides the page', async () => {
    const lease = { clientId: 'visibility-client', leaseMs: 100_000, requestTimeoutMs: 500 }
    const browser = {
      connect: vi.fn().mockResolvedValue(ok(lease)),
      heartbeat: vi.fn().mockResolvedValue(ok(lease)),
      complete: vi.fn(),
      disconnect: vi.fn().mockResolvedValue(ok({ disconnected: true })),
    }
    const remote = { browser, $on: vi.fn() }
    const ctx = new Context()
    ctx.provide('remote', remote as never)
    ctx.provide('remote.browser', browser as never)
    vi.spyOn(window, 'postMessage').mockImplementation(() => {})
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    emitWindow({ channel: BROWSER_EXTENSION_CHANNEL, version: BROWSER_EXTENSION_PROTOCOL_VERSION, direction: 'ready' })
    await vi.waitFor(() => {
      expect(browser.connect).toHaveBeenCalledWith(expect.any(String), true)
    })

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() => {
      expect(browser.heartbeat).toHaveBeenCalledWith(lease.clientId, false)
    })

    await fiber.dispose()
  })

  it('waits for an in-flight connection before releasing its lease on disposal', async () => {
    const lease = { clientId: 'late-client', leaseMs: 100, requestTimeoutMs: 500 }
    type ConnectResult = { readonly ok: true; readonly value: typeof lease }
    let resolveConnect!: (value: ConnectResult) => void
    const connecting = new Promise<ConnectResult>((resolve) => { resolveConnect = resolve })
    const browser = {
      connect: vi.fn().mockReturnValue(connecting),
      heartbeat: vi.fn(),
      complete: vi.fn(),
      disconnect: vi.fn().mockResolvedValue(ok({ disconnected: true })),
    }
    const remote = { browser, $on: vi.fn() }
    const ctx = new Context()
    ctx.provide('remote', remote as never)
    ctx.provide('remote.browser', browser as never)
    vi.spyOn(window, 'postMessage').mockImplementation(() => {})
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    emitWindow({ channel: BROWSER_EXTENSION_CHANNEL, version: BROWSER_EXTENSION_PROTOCOL_VERSION, direction: 'ready' })
    await vi.waitFor(() => { expect(browser.connect).toHaveBeenCalledOnce() })

    const disposed = fiber.dispose()
    resolveConnect(ok(lease))
    await disposed
    expect(browser.disconnect).toHaveBeenCalledWith(lease.clientId)
  })
})
