/**
 * `TavilySearchProvider`: a `WebSearchProvider` backed by Tavily's search API
 * (`POST /search` with `include_answer` and advanced depth). It maps
 * `answer` to `content`, `results[]` to `sources[]` (`content` → `snippet`,
 * `published_date` → `publishedAt`), and reports `truncated: false` — the web
 * seam owns the final `maxResults` bound.
 * @module @deepseek-ai/dsh-web-search-tavily/provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { TavilyError, TavilyResultItem, TavilySearchResponse } from './types.ts'

/** Stable id this provider registers under. */
export const TAVILY_PROVIDER_ID = 'tavily'

/** Default Tavily search endpoint; `/search` is the operation. */
export const TAVILY_DEFAULT_BASE_URL = 'https://api.tavily.com'

/** Attribution header sent on every request. Bump with the package version. */
const USER_AGENT = 'deepseek-harness/0.0.1'

/** Resolved provider options (the plugin's `apply` supplies env-var and constant defaults). */
export interface TavilySearchProviderOptions {
  /** Literal Tavily API key; when present it wins over {@link resolveApiKey}. */
  apiKey?: string
  /** Resolve the current Tavily API key for one search operation. */
  resolveApiKey?: () => Promise<string | undefined>
  /** Credential reference named by missing-credential diagnostics. */
  apiKeyEnv?: CredentialRef
  /** Endpoint base; `/search` is appended. */
  baseURL: string
}

/**
 * Map one Tavily result to a normalized source, or `undefined` when it has no
 * URL. Tavily always returns a snippet-able `content`, but the URL is the one
 * field a citation cannot be without — inventing one would lie.
 *
 * @param item - one entry of Tavily's `results[]`.
 * @returns the normalized source, or `undefined` for an entry without a URL.
 */
export function mapTavilyResult(item: TavilyResultItem): WebSearchSource | undefined {
  if (item.url === undefined || item.url.length === 0) return undefined
  return {
    url: item.url,
    ...item.title != null && item.title.length > 0 ? { title: item.title } : {},
    ...item.content != null && item.content.length > 0 ? { snippet: item.content } : {},
    ...item.published_date != null && item.published_date.length > 0 ? { publishedAt: item.published_date } : {},
  }
}

/**
 * Map a Tavily response envelope to a normalized search result.
 *
 * @param response - the parsed `POST /search` response body.
 * @returns the normalized result; Tavily's `answer` becomes `content`.
 */
export function mapTavilyResponse(response: TavilySearchResponse): WebSearchResult {
  const sources = (response.results ?? [])
    .map(mapTavilyResult)
    .filter((source): source is WebSearchSource => source !== undefined)
  return {
    // Tavily's generated answer is provider content, not a source: it stays
    // out of `sources[]` and rides the optional `content` field the seam passes
    // through to the model-facing formatting.
    ...typeof response.answer === 'string' && response.answer.length > 0 ? { content: response.answer } : {},
    sources,
    truncated: false,
  }
}

/** The Tavily-backed search provider; HTTP redirects fail as `WEB_PROVIDER_ERROR`. */
export class TavilySearchProvider implements WebSearchProvider {
  readonly id = TAVILY_PROVIDER_ID

  constructor(private readonly resolveOptions: () => TavilySearchProviderOptions) {}

  available(): boolean {
    const options = this.resolveOptions()
    return ((options.apiKey?.length ?? 0) > 0 || options.resolveApiKey !== undefined)
      && isValidBaseUrl(options.baseURL)
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const options = this.resolveOptions()
    const apiKey = await this.resolveApiKey(options, signal)
    throwIfAborted(signal)
    let response: Response
    try {
      response = await fetch(this.endpoint(options.baseURL), {
        method: 'POST',
        redirect: 'error',
        headers: {
          'authorization': `Bearer ${apiKey}`,
          'content-type': 'application/json',
          'accept': 'application/json',
          'user-agent': USER_AGENT,
        },
        body: JSON.stringify({
          query: request.query,
          max_results: request.maxResults ?? 8,
          include_answer: true,
          search_depth: 'advanced',
        }),
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error: unknown) {
      if (isAbortError(error)) {
        throw new WebError('Tavily search aborted', 'WEB_ABORTED', { cause: error })
      }
      throw new WebError(`Tavily search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }

    if (!response.ok) {
      const status = response.status
      let message = `Tavily API error (HTTP ${status})`
      try {
        const parsed = await response.json() as TavilyError
        const detail = parsed.error ?? parsed.message ?? parsed.detail?.error
        if (detail !== undefined && detail.length > 0) message = detail
      } catch (error: unknown) {
        if (isAbortError(error)) {
          throw new WebError('Tavily search aborted', 'WEB_ABORTED', { cause: error })
        }
      }
      throw new WebError(message, 'WEB_PROVIDER_ERROR')
    }

    try {
      return mapTavilyResponse(await response.json() as TavilySearchResponse)
    } catch (error: unknown) {
      if (isAbortError(error)) {
        throw new WebError('Tavily search aborted', 'WEB_ABORTED', { cause: error })
      }
      throw new WebError(`Tavily returned an unprocessable response body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }

  private endpoint(baseURL: string): string {
    return `${baseURL}/search`
  }

  /**
   * Resolve one operation's credential without retaining it on the provider.
   * @param options - the caller's snapshot, so the key and the endpoint it is
   *   sent to come from one section.
   * @param signal - abort signal for the surrounding search.
   * @returns the resolved key.
   */
  private async resolveApiKey(options: TavilySearchProviderOptions, signal?: AbortSignal): Promise<string> {
    throwIfAborted(signal)
    if (options.apiKey !== undefined && options.apiKey.length > 0) return options.apiKey
    let resolved: string | undefined
    try {
      resolved = await options.resolveApiKey?.()
    } catch (error: unknown) {
      if (isAbortError(error)) {
        throw new WebError('Tavily search aborted', 'WEB_ABORTED', { cause: error })
      }
      throw new WebError(`Tavily search credential resolution failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
    if (resolved !== undefined && resolved.length > 0) return resolved
    throw new WebError(
      `Tavily search has no API key for "${options.apiKeyEnv ?? 'TAVILY_API_KEY'}"; store it through the credentials service, export it in the launching environment, or set a literal "apiKey" in the web-search-tavily config`,
      'WEB_PROVIDER_CREDENTIAL_MISSING',
    )
  }
}

/** Throw the provider's stable cancellation error when the caller already aborted. */
function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw new WebError('Tavily search aborted', 'WEB_ABORTED', { cause: signal.reason })
}

/** True when `baseURL` parses as an absolute URL (a cheap local config check). */
function isValidBaseUrl(baseURL: string): boolean {
  return URL.canParse(baseURL)
}

/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
