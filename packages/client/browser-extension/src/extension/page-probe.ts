/** MAIN-world fetch/XHR/console probe. Installed at document_start so later page scripts are wrapped. */

import {
  PAGE_PROBE_CONSOLE_MAX,
  PAGE_PROBE_NETWORK_MAX,
  PAGE_PROBE_REQUEST_EVENT,
  PAGE_PROBE_SNAPSHOT_EVENT,
  PAGE_PROBE_TEXT_MAX,
  type PageProbeConsoleEntry,
  type PageProbeNetworkEntry,
  type PageProbeRequest,
  type PageProbeSnapshot,
} from './page-probe-protocol.ts'

const INSTALLED = '__dshPageProbeInstalled'
/** ASCII placeholder so URL encoding does not turn the redaction into `%E2%80%A6`. */
const REDACTED_QUERY_VALUE = '__redacted__'

type ProbeTarget = typeof globalThis & { [INSTALLED]?: true }

interface XhrMeta {
  method: string
  url: string
  startedAt: number
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
 * Render console arguments without throwing on cyclic values.
 * @param args - console arguments.
 * @returns one bounded line.
 */
function renderConsoleArgs(args: unknown[]): string {
  return clip(args.map((arg) => {
    if (typeof arg === 'string') return arg
    if (arg instanceof Error) return arg.message
    try {
      return JSON.stringify(arg) ?? String(arg)
    } catch {
      return String(arg)
    }
  }).join(' '))
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
    : request?.url ?? (typeof input === 'object' && input !== null && 'url' in input ? String((input as { url: unknown }).url) : String(input))
  const method = init?.method ?? request?.method ?? 'GET'
  return { method: clip(String(method).toUpperCase() || 'GET'), url: sanitizeUrl(url) }
}

/** Install the page probe once per document. */
export function installPageProbe(target: ProbeTarget = globalThis): void {
  if (target[INSTALLED] === true) return
  target[INSTALLED] = true

  const hookedAt = Date.now()
  const network: PageProbeNetworkEntry[] = []
  const consoleEntries: PageProbeConsoleEntry[] = []
  let omittedNetwork = 0
  let omittedConsole = 0
  const xhrMeta = new WeakMap<XMLHttpRequest, XhrMeta>()

  /**
   * Push one entry into a bounded ring buffer.
   * @param list - destination buffer.
   * @param entry - new observation.
   * @param max - retained count.
   * @param omitted - callback when an older entry is dropped.
   */
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

  const originalFetch = target.fetch.bind(target)
  target.fetch = async function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const described = describeFetchInput(input, init)
    const startedAt = Date.now()
    try {
      const response = await originalFetch(input, init)
      recordNetwork({
        at: Date.now(),
        source: 'fetch',
        method: described.method,
        url: described.url,
        status: response.status,
        ok: response.ok,
        durationMs: Date.now() - startedAt,
      })
      return response
    } catch (error) {
      recordNetwork({
        at: Date.now(),
        source: 'fetch',
        method: described.method,
        url: described.url,
        durationMs: Date.now() - startedAt,
        error: clip(error instanceof Error ? error.message : String(error)),
      })
      throw error
    }
  }

  const originalOpen = XMLHttpRequest.prototype.open
  const originalSend = XMLHttpRequest.prototype.send
  XMLHttpRequest.prototype.open = function patchedOpen(
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ): void {
    xhrMeta.set(this, {
      method: clip(String(method).toUpperCase() || 'GET'),
      url: sanitizeUrl(String(url)),
      startedAt: 0,
    })
    originalOpen.apply(this, [method, url, ...rest] as Parameters<XMLHttpRequest['open']>)
  }
  XMLHttpRequest.prototype.send = function patchedSend(body?: Document | XMLHttpRequestBodyInit | null): void {
    const meta = xhrMeta.get(this)
    if (meta !== undefined) meta.startedAt = Date.now()
    this.addEventListener('loadend', () => {
      if (meta === undefined) return
      const failed = this.status === 0 && this.readyState === XMLHttpRequest.DONE
      recordNetwork({
        at: Date.now(),
        source: 'xhr',
        method: meta.method,
        url: meta.url,
        ...(failed ? {} : { status: this.status, ok: this.status >= 200 && this.status < 300 }),
        durationMs: Date.now() - meta.startedAt,
        ...(failed ? { error: clip(this.statusText || 'network error') } : {}),
      })
    })
    originalSend.call(this, body)
  }

  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    const original = target.console[level].bind(target.console)
    target.console[level] = (...args: unknown[]) => {
      recordConsole(level, renderConsoleArgs(args))
      original(...args)
    }
  }

  target.addEventListener('error', (event) => {
    recordConsole('error', clip(event.message || 'uncaught error'))
  })
  target.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason instanceof Error ? event.reason.message : String(event.reason)
    recordConsole('error', clip(`unhandledrejection ${reason}`))
  })

  target.addEventListener(PAGE_PROBE_REQUEST_EVENT, (event) => {
    const detail = (event as CustomEvent<PageProbeRequest>).detail
    const snapshot: PageProbeSnapshot = {
      requestId: typeof detail?.requestId === 'string' ? detail.requestId : '',
      hooked: true,
      hookedAt,
      network: network.slice(),
      console: consoleEntries.slice(),
      omittedNetwork,
      omittedConsole,
    }
    target.dispatchEvent(new CustomEvent(PAGE_PROBE_SNAPSHOT_EVENT, { detail: snapshot }))
    if (detail?.reset === true) {
      network.length = 0
      consoleEntries.length = 0
      omittedNetwork = 0
      omittedConsole = 0
    }
  })
}

installPageProbe()
