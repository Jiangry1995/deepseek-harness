# @deepseek-ai/dsh-web-search-tavily

[English](README.md) | 中文

一个由 [Tavily](https://tavily.com) 支撑的 `WebSearchProvider`，接入 harness 的 [web 能力接缝](../web/README.zh.md)（`ctx.web`）。它调用 Tavily 的 `POST /search` 端点（`include_answer` + 高级检索深度），把 LLM 生成的 `answer` 映射为 `content`，把 `results[]` 映射为接缝规范化的 `WebSearchResult`。

这是一个**实现**包：它把 provider 注册进 `ctx.web`，但不拥有 `ctx.web` 键，也不注册面向模型的工具（那是 `@deepseek-ai/dsh-tool-web` 的职责）。它是函数/命名空间插件（`inject: ['web']`），不是默认导出的 Service。

## 配置

| 键 | 默认 | 含义 |
|---|---|---|
| `apiKey` | （未设置） | 字面 Tavily API key；省略时密钥不会进入配置文件。 |
| `apiKeyEnv` | `TAVILY_API_KEY` | 每次搜索时通过 credentials 服务（回退到启动环境）解析的凭证引用。 |
| `baseURL` | `https://api.tavily.com` | 端点前缀；拼接 `/search`。不可解析时 provider 不可用。 |

```yaml
- id: web-search-tavily
  name: '@deepseek-ai/dsh-web-search-tavily'
  config:
    apiKeyEnv: TAVILY_API_KEY
```

## 映射

Tavily 返回扁平的 `results[]` 加上可选的 LLM 生成的 `answer`。`answer` 成为 `content`；每条结果映射为一个 `WebSearchSource`：`url` ← `url`、`title` ← `title`、`snippet` ← `content`、`publishedAt` ← `published_date`。没有 URL 的结果被丢弃。请求的 `maxResults` 会作为 `max_results` 下发（节省开销/延迟），最终上限由接缝统一执行。provider 失败表现为 `WebError` `WEB_PROVIDER_ERROR`，请求中止为 `WEB_ABORTED`，缺凭证为 `WEB_PROVIDER_CREDENTIAL_MISSING`。HTTP 重定向会被拒绝并表现为 `WEB_PROVIDER_ERROR`。

## 模型体验

间接经由 [`dsh-tool-web`](../tool-web/README.zh.md)：它保留本 provider 的受 `maxResults` 约束的 URL、标题、摘要、发布日期与生成的答案，或其精确的失败信息（包在消费者的错误封装里）。

#### KV Cache 影响

不会直接导致缓存失效；`dsh-tool-web` 负责请求前缀，提供方结果追加在该可复用前缀之后。

## 已知限制与后续工作

- **answer 是提供方内容，不是来源** —— 它走 `content` 字段，`sources` 只保留可引用的 URL。
