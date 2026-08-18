/**
 * Provider-private wire types for Tavily's search API. The response envelope
 * carries an optional LLM-generated answer plus a flat, rank-ordered results
 * list; each result's `content` is the snippet source.
 * @module @deepseek-ai/dsh-web-search-tavily/types
 */

/** One entry of Tavily's `results[]` (only the fields this provider maps). */
export interface TavilyResultItem {
  /** Citeable URL; entries without one are dropped. */
  url?: string
  /** Result title. */
  title?: string | null
  /** Snippet text mapped to `WebSearchSource.snippet`. */
  content?: string | null
  /** ISO-8601 publication date, when Tavily reports one. */
  published_date?: string | null
}

/** The `POST /search` response envelope (only the fields this provider maps). */
export interface TavilySearchResponse {
  /** LLM-generated answer, present only when `include_answer` was requested. */
  answer?: string | null
  /** Rank-ordered results. */
  results?: TavilyResultItem[]
}

/** Tavily's error envelope (best-effort; fields vary). */
export interface TavilyError {
  detail?: { error?: string } | null
  error?: string | null
  message?: string | null
}
