# @deepseek-ai/dsh-web-search-firecrawl

English | [中文](README.zh.md)

A [Firecrawl](https://firecrawl.dev)-backed package for the harness [web capability seam](../web/README.md) (`ctx.web`): a `WebSearchProvider` over `POST /v1/search` and a `WebFetchProvider` over `POST /v1/scrape`. Both register under the id `firecrawl` — the seam keeps search and fetch registries separate, so one id names one provider per capability kind. The search endpoint's two historical `data` shapes (`data: object[]` and `data.web.results`) are both tolerated.

This is an **implementation** package: it registers providers into `ctx.web`, it does not own the `ctx.web` key and it does not register a model-facing tool (that is `@deepseek-ai/dsh-tool-web`). It is a function/namespace plugin (`inject: ['web']`) that registers its backends, not a default-export service.

## Config

| Key | Default | Meaning |
|---|---|---|
| `apiKey` | (unset) | Literal Firecrawl API key; a secret that never enters configuration files when omitted. |
| `apiKeyEnv` | `FIRECRAWL_API_KEY` | Credential reference resolved per operation through the credentials service, then the launching environment. |
| `baseURL` | `https://api.firecrawl.dev` | Endpoint base; `/v1/search` and `/v1/scrape` are appended. An unparseable value makes the providers unavailable. |

```yaml
- id: web-search-firecrawl
  name: '@deepseek-ai/dsh-web-search-firecrawl'
  config:
    apiKeyEnv: FIRECRAWL_API_KEY
```

## Mapping

Search answers a flat `results[]` (or the legacy `data.web.results`). Each item maps to a `WebSearchSource`: `url` ← `url`, `title` ← `title`, `snippet` ← the first present of `description`, `content`, then `markdown`. An item without a URL is dropped. Firecrawl returns no generated answer, so `content` is omitted. Scrape maps `data.markdown` to a `text` body (falling back to `data.html` as `html`), `metadata.sourceURL` to the final URL, and `metadata.statusCode` to the status. Provider failures surface as `WebError` `WEB_PROVIDER_ERROR`, an aborted request as `WEB_ABORTED`, and a missing credential as `WEB_PROVIDER_CREDENTIAL_MISSING`. HTTP redirects are rejected and surface as `WEB_PROVIDER_ERROR`.

## Model Experience

Indirectly, through [`dsh-tool-web`](../tool-web/README.md), which retains this provider's `maxResults`-bounded URLs, titles, and snippets for search, the decoded body and final URL for fetch, or the exact failures under the consumer's error wrapper.

#### KV Cache effect

No direct invalidation; `dsh-tool-web` owns the request prefix, while provider results append after that reusable prefix.

## Known Limitations and Deferred Work

- **Search snippets favor `description`** — the current v1 shape's excerpt; legacy `content` and scraped `markdown` are fallbacks only.
