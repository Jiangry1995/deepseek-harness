/** Dormant MAIN-world controller for short-lived fetch/XHR/console observation. */

import {
  PAGE_PROBE_CONSOLE_MAX,
  PAGE_PROBE_NETWORK_MAX,
  PAGE_PROBE_REQUEST_EVENT,
  PAGE_PROBE_SNAPSHOT_EVENT,
  PAGE_PROBE_TEXT_MAX,
  type PageProbeConsoleEntry,
  type PageProbeNetworkEntry,
  type PageProbeSnapshot,
} from './page-probe-protocol.ts'

const INSTALLED = '__dshPageProbeInstalled'
/** ASCII placeholder so URL encoding does not turn the redaction into `%E2%80%A6`. */
const REDACTED_QUERY_VALUE = '__redacted__'

type ProbeTarget = typeof globalThis & { [INSTALLED]?: true }

interface XhrMeta {
  method: string
  url: string
}

interface ConsolePatch {
  level: 'log' | 'info' | 'warn' | 'error' | 'debug'
  original: (...args: unknown[]) => void
  patched: (...args: unknown[]) => void
}

interface ProbeInstallation {
  originalFetch: typeof fetch
  patchedFetch: typeof fetch
  originalOpen: typeof XMLHttpRequest.prototype.open
  patchedOpen: typeof XMLHttpRequest.prototype.open
  originalSend: typeof XMLHttpRequest.prototype.send
  patchedSend: typeof XMLHttpRequest.prototype.send
  consolePatches: ConsolePatch[]
}

/**
 * Truncate one string to the inspect text budget.
 * @param value - raw text.
 * @returns a bounded string.
 */
function clip(value: string): string {
  return value.length <= PAGE_PROBE_TEXT_MAX ? value : value.slice(0, PAGE_PROBE_TEXT_MAX)
}

/**
 * Convert one diagnostic value without enumerating page-owned objects.
 * @param value - console argument, rejection reason, or fetch error.
 * @returns bounded primitive text or a fixed object category.
 */
function inspectValue(value: unknown): string {
  if (value === null) return 'null'
  switch (typeof value) {
    case 'string': return clip(value)
    case 'undefined': return 'undefined'
    case 'boolean': return value ? 'true' : 'false'
    case 'number': return String(value)
    case 'bigint': return `${String(value)}n`
    case 'symbol': return clip(String(value))
    case 'function': return '[Function]'
    case 'object': {
      try {
        if (value instanceof Error) {
          try {
            return clip(`${value.name || 'Error'}: ${value.message}`)
          } catch {
            return '[Error]'
          }
        }
      } catch {
        return '[Object]'
      }
      try {
        return Array.isArray(value) ? '[Array]' : '[Object]'
      } catch {
        return '[Object]'
      }
    }
  }
  return '[Unknown]'
}

/**
 * Render console arguments without retaining or traversing page-owned objects.
 * @param args - console arguments.
 * @returns one bounded line.
 */
function renderConsoleArgs(args: unknown[]): string {
  return clip(args.map(inspectValue).join(' '))
}

/**
 * Strip credentials and obvious secret query parameters from a request URL.
 * @param raw - request URL, possibly relative.
 * @returns a bounded sanitized absolute or original URL.
 */
function sanitizeUrl(raw: string): string {
  try {
    const url = new URL(raw, location.href)
    url.username = ''
    url.password = ''
    for (const key of [...url.searchParams.keys()]) {
      if (/(token|secret|password|passwd|pwd|authorization|signature|access_token)/i.test(key)) {
        url.searchParams.set(key, REDACTED_QUERY_VALUE)
      }
    }
    return clip(url.href)
  } catch {
    return clip(raw)
  }
}

/**
 * Resolve fetch() input into a method and URL without reading the body.
 * @param input - fetch resource.
 * @param init - optional fetch init.
 * @returns method and sanitized URL.
 */
function describeFetchInput(input: unknown, init: RequestInit | undefined): { method: string; url: string } {
  const request = input instanceof Request ? input : undefined
  const url = typeof input === 'string'
    ? input
    : request?.url ?? (typeof input === 'object' && input !== null && 'url' in input ? String(input.url) : String(input))
  const method = init?.method ?? request?.method ?? 'GET'
  return { method: clip(method.toUpperCase() || 'GET'), url: sanitizeUrl(url) }
}

/**
 * Install one dormant page-probe controller for the current document.
 * @param target - MAIN-world global whose page APIs are observed during an active capture.
 */
export function installPageProbe(target: ProbeTarget = globalThis): void {
  if (target[INSTALLED] === true) return
  target[INSTALLED] = true

  const network: PageProbeNetworkEntry[] = []
  const consoleEntries: PageProbeConsoleEntry[] = []
  const xhrMeta = new WeakMap<XMLHttpRequest, XhrMeta>()
  let omittedNetwork = 0
  let omittedConsole = 0
  let hookedAt: number | undefined
  let captureGeneration = 0
  let active = false
  let installation: ProbeInstallation | undefined

  /** Push one entry into a bounded ring buffer. */
  function push<T>(list: T[], entry: T, max: number, omitted: () => void): void {
    list.push(entry)
    while (list.length > max) {
      list.shift()
      omitted()
    }
  }

  /** Record one completed or failed network call. */
  function recordNetwork(entry: PageProbeNetworkEntry): void {
    push(network, entry, PAGE_PROBE_NETWORK_MAX, () => { omittedNetwork += 1 })
  }

  /** Record one console or uncaught-error line. */
  function recordConsole(level: PageProbeConsoleEntry['level'], text: string): void {
    push(consoleEntries, { at: Date.now(), level, text: clip(text) }, PAGE_PROBE_CONSOLE_MAX, () => {
      omittedConsole += 1
    })
  }

  /** Clear retained observations before a new capture session. */
  function clear(): void {
    network.length = 0
    consoleEntries.length = 0
    omittedNetwork = 0
    omittedConsole = 0
  }

  /** Record one uncaught page error while capture is active. */
  function onError(event: ErrorEvent): void {
    if (!active) return
    recordConsole('error', clip(event.message || 'uncaught error'))
  }

  /** Record one unhandled rejection while capture is active. */
  function onUnhandledRejection(event: PromiseRejectionEvent): void {
    if (!active) return
    recordConsole('error', clip(`unhandledrejection ${inspectValue(event.reason)}`))
  }

  /** Start a fresh capture and install wrappers around the methods currently owned by the page. */
  function start(): void {
    if (active) stop()
    clear()
    captureGeneration += 1
    hookedAt = Date.now()
    active = true
    const generation = captureGeneration
    const originalFetch = target.fetch
    const patchedFetch: typeof fetch = function patchedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      if (!active || generation !== captureGeneration) return Reflect.apply(originalFetch, target, [input, init])
      const described = describeFetchInput(input, init)
      const startedAt = Date.now()
      return Reflect.apply(originalFetch, target, [input, init]).then((response) => {
        if (active && generation === captureGeneration) {
          recordNetwork({
            at: Date.now(),
            source: 'fetch',
            method: described.method,
            url: described.url,
            status: response.status,
            ok: response.ok,
            durationMs: Date.now() - startedAt,
          })
        }
        return response
      }, (error: unknown) => {
        if (active && generation === captureGeneration) {
          recordNetwork({
            at: Date.now(),
            source: 'fetch',
            method: described.method,
            url: described.url,
            durationMs: Date.now() - startedAt,
            error: inspectValue(error),
          })
        }
        throw error
      })
    }

    const Xhr = target.XMLHttpRequest
    // oxlint-disable-next-line typescript/unbound-method -- the wrapper supplies the original XHR receiver explicitly.
    const originalOpen = Xhr.prototype.open
    // oxlint-disable-next-line typescript/unbound-method -- the wrapper supplies the original XHR receiver explicitly.
    const originalSend = Xhr.prototype.send
    const patchedOpen: typeof XMLHttpRequest.prototype.open = function patchedOpen(
      this: XMLHttpRequest,
      method: string,
      url: string | URL,
      ...rest: unknown[]
    ): void {
      if (active && generation === captureGeneration) {
        xhrMeta.set(this, {
          method: clip(method.toUpperCase() || 'GET'),
          url: sanitizeUrl(String(url)),
        })
      }
      originalOpen.apply(this, [method, url, ...rest] as Parameters<XMLHttpRequest['open']>)
    }
    const patchedSend: typeof XMLHttpRequest.prototype.send = function patchedSend(
      this: XMLHttpRequest,
      body?: Document | XMLHttpRequestBodyInit | null,
    ): void {
      const described = active && generation === captureGeneration ? xhrMeta.get(this) : undefined
      if (described !== undefined) {
        const startedAt = Date.now()
        this.addEventListener('loadend', () => {
          if (!active || generation !== captureGeneration) return
          const failed = this.status === 0 && this.readyState === XMLHttpRequest.DONE
          recordNetwork({
            at: Date.now(),
            source: 'xhr',
            method: described.method,
            url: described.url,
            ...(failed ? {} : { status: this.status, ok: this.status >= 200 && this.status < 300 }),
            durationMs: Date.now() - startedAt,
            ...(failed ? { error: clip(this.statusText || 'network error') } : {}),
          })
        }, { once: true })
      }
      originalSend.call(this, body)
    }

    const consolePatches: ConsolePatch[] = []
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      const original = target.console[level]
      const patched = (...args: unknown[]): void => {
        Reflect.apply(original, target.console, args)
        if (!active || generation !== captureGeneration) return
        try {
          recordConsole(level, renderConsoleArgs(args))
        } catch {
          // Diagnostic recording cannot change page console behavior.
        }
      }
      consolePatches.push({ level, original, patched })
      target.console[level] = patched
    }

    installation = {
      originalFetch,
      patchedFetch,
      originalOpen,
      patchedOpen,
      originalSend,
      patchedSend,
      consolePatches,
    }
    target.fetch = patchedFetch
    Xhr.prototype.open = patchedOpen
    Xhr.prototype.send = patchedSend
    target.addEventListener('error', onError)
    target.addEventListener('unhandledrejection', onUnhandledRejection)
  }

  /** Stop capture and restore only methods still owned by this controller. */
  function stop(): void {
    if (!active) return
    active = false
    target.removeEventListener('error', onError)
    target.removeEventListener('unhandledrejection', onUnhandledRejection)
    if (installation === undefined) return
    if (target.fetch === installation.patchedFetch) target.fetch = installation.originalFetch
    const Xhr = target.XMLHttpRequest
    if (Xhr.prototype.open === installation.patchedOpen) Xhr.prototype.open = installation.originalOpen
    if (Xhr.prototype.send === installation.patchedSend) Xhr.prototype.send = installation.originalSend
    for (const patch of installation.consolePatches) {
      if (target.console[patch.level] === patch.patched) target.console[patch.level] = patch.original
    }
    installation = undefined
  }

  /** Build one immutable response from the current observation state. */
  function snapshot(requestId: string): PageProbeSnapshot {
    return {
      requestId,
      hooked: true,
      ...(hookedAt === undefined ? {} : { hookedAt }),
      network: network.slice(),
      console: consoleEntries.slice(),
      omittedNetwork,
      omittedConsole,
    }
  }

  target.addEventListener(PAGE_PROBE_REQUEST_EVENT, (event) => {
    const detail: unknown = (event as CustomEvent<unknown>).detail
    const requestId = typeof detail === 'object' && detail !== null && 'requestId' in detail
      && typeof detail.requestId === 'string' ? detail.requestId : ''
    const mode = typeof detail === 'object' && detail !== null && 'mode' in detail ? detail.mode : undefined
    if (mode === 'start') start()
    if (mode === 'stop') stop()
    target.dispatchEvent(new CustomEvent(PAGE_PROBE_SNAPSHOT_EVENT, { detail: snapshot(requestId) }))
  })
}

installPageProbe()
