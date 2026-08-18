# @deepseek-ai/dsh-web-search-firecrawl

[English](README.md) | 中文

一个由 [Firecrawl](https://firecrawl.dev) 支撑的包，接入 harness 的 [web 能力接缝](../web/README.md)（`ctx.web`）：`POST /v1/search` 上的 `WebSearchProvider`，加上 `POST /v1/scrape` 上的 `WebFetchProvider`。两者都以 id `firecrawl` 注册——接缝把搜索与抓取注册表分开，同一 id 在各自能力类型里各对应一个 provider。搜索端点历史上两种 `data` 形状（`data: object[]` 与 `data.web.results`）都被兼容。

这是一个**实现**包：它把 provider 注册进 `ctx.web`，但不拥有 `ctx.web` 键，也不注册面向模型的工具（那是 `@deepseek-ai/dsh-tool-web` 的职责）。它是函数/命名空间插件（`inject: ['web']`），不是默认导出的 Service。

## 配置

| 键 | 默认 | 含义 |
|---|---|---|
| `apiKey` | （未设置） | 字面 Firecrawl API key；省略时密钥不会进入配置文件。 |
| `apiKeyEnv` | `FIRECRAWL_API_KEY` | 每次操作时通过 credentials 服务（回退到启动环境）解析的凭证引用。 |
| `baseURL` | `https://api.firecrawl.dev` | 端点前缀；拼接 `/v1/search` 与 `/v1/scrape`。不可解析时 provider 不可用。 |

```yaml
- id: web-search-firecrawl
  name: '@deepseek-ai/dsh-web-search-firecrawl'
  config:
    apiKeyEnv: FIRECRAWL_API_KEY
```

## 映射

搜索返回扁平的 `results[]`（或旧版 `data.web.results`）。每条映射为一个 `WebSearchSource`：`url` ← `url`、`title` ← `title`、`snippet` ← `description`、`content`、`markdown` 中第一个存在的字段。没有 URL 的条目被丢弃。Firecrawl 不返回生成式答案，因此省略 `content`。抓取把 `data.markdown` 映射为 `text` 正文（无 markdown 时回退 `data.html` 为 `html`），`metadata.sourceURL` 映射为最终 URL，`metadata.statusCode` 映射为状态码。provider 失败表现为 `WebError` `WEB_PROVIDER_ERROR`，请求中止为 `WEB_ABORTED`，缺凭证为 `WEB_PROVIDER_CREDENTIAL_MISSING`。HTTP 重定向会被拒绝并表现为 `WEB_PROVIDER_ERROR`。

## 模型体验

间接经由 [`dsh-tool-web`](../tool-web/README.md)：搜索保留受 `maxResults` 约束的 URL、标题与摘要；抓取保留解码后的正文与最终 URL；或两者精确的失败信息（包在消费者的错误封装里）。

#### KV Cache 影响

不会直接导致缓存失效；`dsh-tool-web` 负责请求前缀，提供方结果追加在该可复用前缀之后。

## 已知限制与后续工作

- **搜索摘要优先用 `description`** —— 当前 v1 形状的摘要字段；旧版 `content` 与抓取的 `markdown` 只是回退。
