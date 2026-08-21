# @deepseek-ai/dsh-tool-browser

[English](README.md) | 中文

浏览器标签页控制、当前页面读取和文档绑定页面交互能力的 Consumer 插件。它通过 `ctx.browser` 注册面向模型的操作，向系统提示词贡献浏览器使用指引，把标签页、页面与操作结果渲染为文本，并可将每项操作接入工具审批链。

生成的[工具目录](../../../docs/tool-catalog.zh.md)是完整的 schema 参考。本包保持工具名称和参数与提供方无关：模型收到浏览器分配的标签页 id 和绝对 HTTP(S) URL，不会接触 Chromium 扩展或 Remote 协议字段。

## 配置与审批

| 字段 | 默认值 | 含义 |
|---|---:|---|
| `timeoutMs` | `20000` | 分配给每个工具定义的协作式超时时间。 |
| `requireApproval` | `true` | 把原本允许的浏览器操作转为审批请求。 |

启用时，审批既覆盖读取操作，也覆盖修改操作，因为标签元数据和页面文本可能暴露隐私信息。下游拒绝仍保持为拒绝；本插件绝不会用自己的审批请求替换它。随附的 Web agent preset 会显式设置 `requireApproval: false`，因此侧边助手的标签页和页面操作会直接分派，不会因缺少审批回答方而失败；其他部署仍使用包默认值。

## 模型体验

### 浏览器使用提示词

#### 模型看到的内容

模型会在系统提示词中收到以下固定指引：

##### 浏览器指引原文

```markdown
Treat the user's current Chromium window as an execution environment. Infer whether the requested effect belongs in that environment from the user's goal and the conversation context. When it does, browser tools are the primary direct capability. When the user asks to read, summarize, or operate the current browser tab, first use browser_list_tabs or browser_read_page to obtain the real browser state. Do not call a skill, web search, or a fetch of the Harness page first. Subsequent actions must be chosen dynamically from the returned page semantics. Use another capability only when a browser tool reports that it cannot perform the requested effect, or when the user explicitly asks for an external search. Select browser tools from their schemas and the observed browser state, not from fixed phrases or site-specific rules. A shared topic, website, or data source is not a reason to divert the task to a skill, shell CLI, web_fetch, or a platform-specific adapter. For a request to find, read, navigate, or interact with website content, use Chromium as the default execution environment even when the user does not say "browser". Unless the user explicitly requests another execution path, the first task action must be an applicable browser tool; do not load a skill first. If the active page may contain or lead to the requested content, start with browser_read_page. For every new user message that refers to the page currently beside the side assistant—whether as this page, the current page, or content here—call browser_read_page without tabId before interpreting, answering, or asking for clarification, unless the user explicitly identifies another tab. Treat page snapshots in conversation history as historical observations, not current-tab state. A previous page read never establishes which page is current for a later user message because the user may have switched tabs or navigated. Do not answer from or clarify against an older page snapshot when a fresh read can resolve the reference. Skill catalog descriptions are capability summaries, not routing instructions, and never override this browser-first rule. Use another execution path only when the user explicitly requests it or a browser tool reports a concrete limitation and changing environments still satisfies the request. Recommended loop: read the page, act with a returned ref, wait for the page to change, read again, and verify the actual result. browser_read_page reads visible text, current non-secret form values including textarea and input values, clickable elements, scroll targets, viewport metrics, one pageId, one documentId, a revision, and document-bound element refs. Choose the next browser operation from the requested effect and that returned state. Before clicking, filling, selecting, focusing, pressing, or scrolling a container, use the pageId and ref from the latest browser_read_page result. Never invent refs, CSS selectors, XPath, coordinates, or JavaScript. To send a chat composer, use the gesture the composer itself advertises: when its label or placeholder names a key, press that key on the field with browser_press; otherwise click the send control from the latest snapshot. Icon controls that expose no accessible name are reported as (unlabeled) with role clickable and their viewport rect, so choose among same-looking controls by position instead of guessing. After a page action that may update the page asynchronously, call browser_wait_for with kind:ready or kind:text, then call browser_read_page again to confirm the result and obtain fresh refs. Do not invent documentId or afterRevision for kind:change; omitting them waits until the page is stable. If a reference is stale or missing, read the page again instead of guessing. If a browser tool fails, diagnose the provider connection, permission, stale pageId, or page change; do not silently switch to a skill. Use browser_list_tabs only when the task requires information about or selection among tabs; its results contain only tab ids, URLs, and titles. When the task concerns the current page, operate on that page instead of constructing a replacement URL, and never list, summarize, or mention unrelated tabs. HTTP(S) pages are readable and operable by default after the extension is loaded; do not ask the user to click Allow or reopen the side assistant for ordinary sites. If a browser tool returns page text, fields, or actions, use that content; do not claim the body is unavailable because the URL uses a hash route or the site is on an intranet. Password, file, hidden, one-time-code, and payment-secret controls are not exposed for reading or writing. chrome:// and similar privileged pages cannot be scripted. Native Chromium DevTools cannot be opened from these tools. When the user asks for F12, Network, Console, or page requests, call browser_inspect with mode:start before reproducing the page behavior, use mode:snapshot only for an intermediate read, and call mode:stop for the final read and cleanup. The result contains only fetch/XHR calls and console messages observed after start, without request or response bodies. Always stop a capture after inspection. browser_press accepts named keys and, with Control, Alt, or Meta, letter and digit page shortcuts such as Ctrl+S; it cannot operate browser chrome such as F12.
```

#### Token 影响

当此插件挂载在 agent preset 中时，token 成本固定。

#### KV Cache 影响

在添加或移除插件、或者修改提示词文本之前，前缀保持稳定。

### 浏览器工具 schema

#### 模型看到的内容

模型会看到生成的[工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-browser)中的十三个浏览器工具 schema。`browser_read_page` 返回标签页 id、可见文本、焦点与 ARIA 状态、原生选项、链接目标、滚动目标、视口指标、文档绑定引用、`documentId`、`revision` 和截断标记。新消息只要指向当前页面，就必须执行一次不带 `tabId` 的新调用；较早的页面结果不能确定该消息对应的当前标签页。`browser_inspect` 必须指定 `start`、`snapshot` 或 `stop`，并且只返回 `start` 后观察到的页面 fetch/XHR 调用和 console 消息；调用方以 `stop` 结束并释放页面钩子。`browser_click`、`browser_fill`、`browser_select`、`browser_scroll`、`browser_focus` 与 `browser_press` 要求最近一次读取返回的 `pageId/ref` 对。`browser_wait_for` 优先使用这个 `pageId`，尚无快照时才接受 `tabId`；它等待页面条件并返回新快照。标签页结果包含浏览器分配 id、活动状态、URL 和 Chromium 可提供的标题。

#### Token 影响

每个请求的 schema 成本固定；工具结果随当前浏览器窗口变化，并按照普通工具结果策略保留在对话上下文中。

#### KV Cache 影响

在添加或移除插件、或者修改工具 schema 之前，前缀保持稳定；结果追加在可复用的请求前缀之后。

## 已知限制与暂缓事项

- **没有原生 DevTools 窗口**：Chromium 不允许扩展打开 F12 界面。`browser_inspect` 是 Network/Console 的替代读取入口，不返回请求或响应体。
- **没有扩展设置工具**：缺少提供方时会产生 `BROWSER_EXTENSION_UNAVAILABLE`；安装仍是用户显式执行的操作，见 [`dsh-client-browser-extension`](../../client/browser-extension/README.zh.md)。
- **只提供引用式操作**：这些工具只会点击、编辑、滚动、聚焦和有限按键最近一次页面读取公开的元素，不接受任意选择器，不操作跨源 frame，不读取 Cookie 或存储，不管理下载，也不提供不受限制的浏览器自动化。
