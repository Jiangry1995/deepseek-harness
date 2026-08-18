/**
 * Firecrawl-backed providers for the web seam: a `WebSearchProvider` over
 * `POST /v1/search` and a `WebFetchProvider` over `POST /v1/scrape`. Both
 * register under the id `firecrawl` (one per capability kind), share one
 * API key and endpoint, and tolerate both `data` shapes the search endpoint
 * has answered across versions.
 * @module @deepseek-ai/dsh-web-search-firecrawl/provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebFetchProvider,
  WebFetchRequest,
  WebFetchResult,
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type {
  FirecrawlError,
  FirecrawlScrapeResponse,
  FirecrawlSearchData,
  FirecrawlSearchItem,
  FirecrawlSearchResponse,
} from './types.ts'

/** Stable id these providers register under (search and fetch are separate kinds). */
export const FIRECRAWL_PROVIDER_ID = 'firecrawl'

/** Default Firecrawl endpoint base; `/v1/search` and `/v1/scrape` are the operations. */
export const FIRECRAWL_DEFAULT_BASE_URL = 'https://api.firecrawl.dev'

/** Attribution header sent on every request. Bump with the package version. */
const USER_AGENT = 'deepseek-harness/0.0.1'

/** Resolved provider options (the plugin's `apply` supplies env-var and constant defaults). */
export interface FirecrawlProviderOptions {
  /** Literal Firecrawl API key; when present it wins over {@link resolveApiKey}. */
  apiKey?: string
  /** Resolve the current Firecrawl API key for one operation. */
  resolveApiKey?: () => Promise<string | undefined>
  /** Credential reference named by missing-credential diagnostics. */
  apiKeyEnv?: CredentialRef
  /** Endpoint base; `/v1/search` and `/v1/scrape` are appended. */
  baseURL: string
}

/**
 * Tolerate both search-answer shapes: the current flat `data: object[]` and
 * the legacy `data.web.results`. A shape neither arm recognizes yields none.
 *
 * @param data - the response's `data` field.
 * @returns the entries in result order.
 */
export function firecrawlSearchItems(data: FirecrawlSearchData | undefined): FirecrawlSearchItem[] {
  if (Array.isArray(data)) return data
  const nested = data?.web?.results
  return Array.isArray(nested) ? nested : []
}

/**
 * Map one search item to a normalized source, or `undefined` when it has no
 * URL. The snippet is the first present of `description`, `content`, then
 * `markdown` — the shape whose field actually carries an excerpt.
 *
 * @param item - one entry of the search answer.
 * @returns the normalized source, or `undefined` for an entry without a URL.
 */
export function mapFirecrawlSearchItem(item: FirecrawlSearchItem): WebSearchSource | undefined {
  if (item.url === undefined || item.url.length === 0) return undefined
  const snippet = item.description ?? item.content ?? item.markdown
  return {
    url: item.url,
    ...item.title != null && item.title.length > 0 ? { title: item.title } : {},
    ...snippet != null && snippet.length > 0 ? { snippet: snippet.slice(0, 600) } : {},
  }
}

/**
 * Map a search response envelope to a normalized search result.
 *
 * @param response - the parsed `POST /v1/search` response body.
 * @returns the normalized result; Firecrawl returns no generated answer,
 *   so `content` is omitted.
 * @throws {@link WebError} `WEB_PROVIDER_ERROR` when the API reports failure.
 */
export function mapFirecrawlSearchResponse(response: FirecrawlSearchResponse): WebSearchResult {
  const sources = firecrawlSearchItems(response.data)
    .map(mapFirecrawlSearchItem)
    .filter((source): source is WebSearchSource => source !== undefined)
  return { sources, truncated: false }
}

/** Shared JSON POST used by both providers; redirects fail as `WEB_PROVIDER_ERROR`. */
async function postJson(endpoint: string, body: unknown, apiKey: string, signal?: AbortSignal): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'authorization': `Bearer ${apiKey}`,
        'content-type': 'application/json',
        'accept': 'application/json',
        'user-agent': USER_AGENT,
      },
      body: JSON.stringify(body),
      ...signal !== undefined ? { signal } : {},
    })
  } catch (error: unknown) {
    if (signal?.aborted === true || isAbortError(error)) {
      throw new WebError('Firecrawl request aborted', 'WEB_ABORTED', { cause: error })
    }
    throw new WebError(`Firecrawl request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
  }
  if (!response.ok) {
    const status = response.status
    let message = `Firecrawl API error (HTTP ${status})`
    try {
      const parsed = await response.json() as FirecrawlError
      const detail = parsed.error ?? parsed.message ?? parsed.detail
      if (detail != null && detail.length > 0) message = detail
    } catch (error: unknown) {
      if (isAbortError(error)) {
        throw new WebError('Firecrawl request aborted', 'WEB_ABORTED', { cause: error })
      }
    }
    throw new WebError(message, 'WEB_PROVIDER_ERROR')
  }
  try {
    return await response.json()
  } catch (error: unknown) {
    if (signal?.aborted === true || isAbortError(error)) {
      throw new WebError('Firecrawl request aborted', 'WEB_ABORTED', { cause: error })
    }
    throw new WebError(`Firecrawl returned an unprocessable response body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
  }
}

/** Shared credential resolution: literal, then the seam, then the environment. */
async function resolveApiKey(options: FirecrawlProviderOptions, signal?: AbortSignal): Promise<string> {
  throwIfAborted(signal, 'Firecrawl request')
  if (options.apiKey !== undefined && options.apiKey.length > 0) return options.apiKey
  let resolved: string | undefined
  try {
    resolved = await options.resolveApiKey?.()
  } catch (error: unknown) {
    if (signal?.aborted === true || isAbortError(error)) {
      throw new WebError('Firecrawl request aborted', 'WEB_ABORTED', { cause: error })
    }
    throw new WebError(`Firecrawl credential resolution failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
  }
  if (resolved !== undefined && resolved.length > 0) return resolved
  throw new WebError(
    `Firecrawl has no API key for "${options.apiKeyEnv ?? 'FIRECRAWL_API_KEY'}"; store it through the credentials service, export it in the launching environment, or set a literal "apiKey" in the web-search-firecrawl config`,
    'WEB_PROVIDER_CREDENTIAL_MISSING',
  )
}

/** Return whether resolved Firecrawl options can serve an operation. */
function isFirecrawlAvailable(options: FirecrawlProviderOptions): boolean {
  return ((options.apiKey?.length ?? 0) > 0 || options.resolveApiKey !== undefined)
    && isValidBaseUrl(options.baseURL)
}

/** The Firecrawl-backed search provider. */
export class FirecrawlSearchProvider implements WebSearchProvider {
  readonly id = FIRECRAWL_PROVIDER_ID

  constructor(private readonly resolveOptions: () => FirecrawlProviderOptions) {}

  available(): boolean {
    return isFirecrawlAvailable(this.resolveOptions())
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const options = this.resolveOptions()
    const apiKey = await resolveApiKey(options, signal)
    throwIfAborted(signal, 'Firecrawl search')
    const response = await postJson(`${options.baseURL}/v1/search`, {
      query: request.query,
      limit: request.maxResults ?? 8,
      scrapeOptions: { formats: ['markdown'] },
    }, apiKey, signal) as FirecrawlSearchResponse
    throwIfAborted(signal, 'Firecrawl search')
    if (response.success === false) {
      throw new WebError(`Firecrawl search failed: ${response.warning ?? 'unknown error'}`, 'WEB_PROVIDER_ERROR')
    }
    return mapFirecrawlSearchResponse(response)
  }
}

/** The Firecrawl-backed scrape (fetch) provider. */
export class FirecrawlFetchProvider implements WebFetchProvider {
  readonly id = FIRECRAWL_PROVIDER_ID

  constructor(private readonly resolveOptions: () => FirecrawlProviderOptions) {}

  available(): boolean {
    return isFirecrawlAvailable(this.resolveOptions())
  }

  async fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    const options = this.resolveOptions()
    const apiKey = await resolveApiKey(options, signal)
    throwIfAborted(signal, 'Firecrawl scrape')
    const response = await postJson(`${options.baseURL}/v1/scrape`, {
      url: request.url,
      formats: ['markdown'],
    }, apiKey, signal) as FirecrawlScrapeResponse
    throwIfAborted(signal, 'Firecrawl scrape')
    if (response.success === false) {
      throw new WebError(`Firecrawl scrape failed: ${response.warning ?? 'unknown error'}`, 'WEB_PROVIDER_ERROR')
    }
    const data = response.data
    const markdown = data?.markdown != null && data.markdown.length > 0 ? data.markdown : undefined
    const html = data?.html != null && data.html.length > 0 ? data.html : undefined
    if (markdown === undefined && html === undefined) {
      throw new WebError('Firecrawl scrape returned no content', 'WEB_PROVIDER_ERROR')
    }
    return {
      url: data?.metadata?.sourceURL ?? request.url,
      statusCode: typeof data?.metadata?.statusCode === 'number' ? data.metadata.statusCode : 200,
      body: markdown !== undefined
        ? { kind: 'text', content: markdown }
        : { kind: 'html', content: html as string },
      truncated: false,
    }
  }
}

/** Throw the provider's stable cancellation error when the caller already aborted. */
function throwIfAborted(signal: AbortSignal | undefined, label: string): void {
  if (signal?.aborted === true) throw new WebError(`${label} aborted`, 'WEB_ABORTED', { cause: signal.reason })
}

/** True when `baseURL` parses as an absolute URL (a cheap local config check). */
function isValidBaseUrl(baseURL: string): boolean {
  return URL.canParse(baseURL)
}

/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
