# @deepseek-ai/dsh-web-search-tavily

English | [中文](README.zh.md)

A [Tavily](https://tavily.com)-backed `WebSearchProvider` for the harness [web capability seam](../web/README.md) (`ctx.web`). It calls Tavily's `POST /search` endpoint with `include_answer` and advanced retrieval depth, maps the LLM-generated `answer` to `content`, and maps `results[]` into the seam's normalized `WebSearchResult`.

This is an **implementation** package: it registers a provider into `ctx.web`, it does not own the `ctx.web` key and it does not register a model-facing tool (that is `@deepseek-ai/dsh-tool-web`). It is a function/namespace plugin (`inject: ['web']`) that registers its backend, not a default-export service.

## Config

| Key | Default | Meaning |
|---|---|---|
| `apiKey` | (unset) | Literal Tavily API key; a secret that never enters configuration files when omitted. |
| `apiKeyEnv` | `TAVILY_API_KEY` | Credential reference resolved per search through the credentials service, then the launching environment. |
| `baseURL` | `https://api.tavily.com` | Endpoint base; `/search` is appended. An unparseable value makes the provider unavailable. |

```yaml
- id: web-search-tavily
  name: '@deepseek-ai/dsh-web-search-tavily'
  config:
    apiKeyEnv: TAVILY_API_KEY
```

## Mapping

Tavily returns a flat `results[]` plus an optional LLM-generated `answer`. The answer becomes `content`; each result maps to a `WebSearchSource`: `url` ← `url`, `title` ← `title`, `snippet` ← `content`, `publishedAt` ← `published_date`. A result without a URL is dropped. A request's `maxResults` is sent as `max_results` for a cost/latency optimization; the final bound is enforced by the seam. Provider failures surface as `WebError` `WEB_PROVIDER_ERROR`, an aborted request as `WEB_ABORTED`, and a missing credential as `WEB_PROVIDER_CREDENTIAL_MISSING`. HTTP redirects are rejected and surface as `WEB_PROVIDER_ERROR`.

## Model Experience

Indirectly, through [`dsh-tool-web`](../tool-web/README.md), which retains this provider's `maxResults`-bounded URLs, titles, snippets, publication dates, and the generated answer, or its exact failures under the consumer's error wrapper.

#### KV Cache effect

No direct invalidation; `dsh-tool-web` owns the request prefix, while provider results append after that reusable prefix.

## Known Limitations and Deferred Work

- **The answer is provider content, not a source** — it rides `content`, and sources stay citeable URLs only.
