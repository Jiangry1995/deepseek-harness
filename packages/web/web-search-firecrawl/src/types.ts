/**
 * Provider-private wire types for Firecrawl's v1 API. Search answers either
 * the current `data: object[]` shape or the legacy `data.web.results` shape;
 * scrape answers a single `data` object. Both tolerance arms exist because
 * the upstream contract has changed shape without a version bump.
 * @module @deepseek-ai/dsh-web-search-firecrawl/types
 */

/** One entry of Firecrawl's search results (only the fields this provider maps). */
export interface FirecrawlSearchItem {
  /** Citeable URL; entries without one are dropped. */
  url?: string
  /** Result title. */
  title?: string | null
  /** Description excerpt (current v1 shape). */
  description?: string | null
  /** Content excerpt (legacy shape). */
  content?: string | null
  /** Markdown body when the search scraped the page. */
  markdown?: string | null
}

/** The two `data` shapes `/v1/search` has answered across versions. */
export type FirecrawlSearchData =
  | FirecrawlSearchItem[]
  | { web?: { results?: FirecrawlSearchItem[] } }

/** The `POST /v1/search` response envelope. */
export interface FirecrawlSearchResponse {
  success?: boolean
  data?: FirecrawlSearchData
  warning?: string | null
}

/** The `POST /v1/scrape` response envelope (only the fields this provider maps). */
export interface FirecrawlScrapeResponse {
  success?: boolean
  warning?: string | null
  data?: {
    markdown?: string | null
    html?: string | null
    metadata?: {
      sourceURL?: string | null
      statusCode?: number | null
    } | null
  }
}

/** Firecrawl's error envelope (best-effort; fields vary). */
export interface FirecrawlError {
  error?: string | null
  message?: string | null
  detail?: string | null
}
