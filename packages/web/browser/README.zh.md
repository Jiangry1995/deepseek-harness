# @deepseek-ai/dsh-browser

[English](README.md) | 中文

`BrowserService`（`ctx.browser`）是 Host 端浏览器标签页操作代理；具体操作由已安装的 Chromium 扩展执行。该服务负责提供方租约、提供方选择、请求标识、取消、超时、结果校验和稳定的 `BrowserError` 错误代码，绝不直接调用 Chromium API。

浏览器标签页能力包含三种角色：

| 包 | 角色 |
|---|---|
| `@deepseek-ai/dsh-browser` | Service Definition 与 Host 代理（`ctx.browser`） |
| `@deepseek-ai/dsh-client-browser-extension` | 连接 Web Client 与 MV3 扩展的 Service Provider |
| `@deepseek-ai/dsh-tool-browser` | 暴露面向模型的浏览器工具的 Consumer |

[浏览器标签页 Agent Note](../../../.agents/notes/implemented/feature/2026-08-14-browser-tab-extension.md)记录跨进程归属决策；[页面控制 Agent Note](../../../.agents/notes/implemented/feature/2026-08-16-browser-side-assistant-page-control.md)记录文档绑定交互和伴随程序生命周期决策；[语义自动化 Agent Note](../../../.agents/notes/implemented/feature/2026-08-16-semantic-browser-automation.md)记录文档身份、等待、滚动、聚焦和有限键盘操作。

## 服务行为

Web Client 通过 Typert Remote 方法 `connect`、`heartbeat`、`disconnect` 和 `complete` 注册生成的提供方标识。注册结果是租约，而不是永久能力声明。`BrowserService` 会移除过期租约，并拒绝断开连接或租约过期的提供方所拥有的全部请求。

每项操作都会选择最近出现的存活提供方，向该提供方发送一条 `browser/command` Remote 事件，并保留请求，直至提供方完成操作、调用方中止、配置的超时时间结束、提供方断开连接或服务被 dispose（资源释放）。服务只接受所选提供方返回的完成结果，并要求结果判别字段与操作匹配。

`openTab` 接受不含凭据的绝对 HTTP(S) URL，`active` 默认为 `true`。`listTabs` 返回扩展当前浏览器窗口中的标签页。`readPage` 返回指定或当前网页标签页、渲染文本、当前可见的非敏感表单值及焦点状态、可点击元素、滚动目标、视口度量、快照 `pageId`、稳定的 `documentId`、文档 `revision`、元素 ref 和截断标记。`inspectPage` 必须指定 `start`、`snapshot` 或 `stop`：捕获只在 `start` 后开始，`snapshot` 保持捕获有效，`stop` 返回最终有界 fetch/XHR 与 console 观察并释放页面钩子。它不能打开原生 DevTools，也不返回请求或响应体。`clickPage`、`fillPage`、`selectPage`、`scrollPage`、`focusPage` 与 `pressPage` 接受最近一次读取返回的 `pageId/ref` 对，Host 会要求完成回执回显同一对坐标。填写操作的 `submit` 默认为 `false`，提供方必须校验控件的实际值。`pressPage` 接受命名按键，以及带 Control、Alt 或 Meta 的字母和数字页内快捷键。`waitPage` 接受最近的 `pageId`，尚无快照时也可接受标签页 id；它等待文档变化、文本、URL 或加载稳定，然后返回新快照。`activateTab` 与 `closeTab` 接受浏览器返回的非负安全整数标签页 id。

## 配置

| 字段 | 默认值 | 含义 |
|---|---:|---|
| `requestTimeoutMs` | `15000` | Host 等待单次扩展完成结果的最长时间。`wait-page` 使用 `max(requestTimeoutMs, timeoutMs + 1500)`。 |
| `clientLeaseMs` | `300000` | 从最近一次成功注册或心跳开始计算的提供方租约时长。足够覆盖 Chromium 把隐藏 iframe 定时器节流到大约每分钟一次的情况。 |

Client 会在租约中收到这两个值。它会在租约时长过半时续租，并按照 Host 超时时间减去 1000ms 余量来保留每个页面到扩展的请求。`wait-page` 在减去余量之前使用与本服务相同的 Host 公式，以便页内等待先结束。

## 错误

`BrowserError extends HarnessError`。调用方可依据其稳定错误代码处理无效提供方 id、无可用提供方、无效 URL、标签页 id 或页面引用、取消、超时、断开连接、结果不匹配、扩展校验失败、标签页不存在、文档过期、元素不存在／已禁用／类型不兼容、下拉选项不存在、当前页面权限不可用和 Chromium API 失败。扩展不可用属于执行失败；服务与面向模型的 schema 仍保持注册，使配置问题明确可见，而不会静默移除工具。

## 模型体验

通过 `dsh-tool-browser` 间接影响；该消费方负责浏览器提示词、工具 schema、审批和结果渲染，本服务自身不贡献模型上下文。

#### KV Cache 影响

不会直接导致 KV Cache 失效；每次请求前缀变更都由消费方负责。

## 已知限制与暂缓事项

- **自动选择一个浏览器窗口**：用户无法在多个已连接 Web Client 之间选择；最近出现的存活提供方胜出，`listTabs` 仅限该提供方的当前窗口。
- **有界页面操作集**：服务可以点击、填写、选择、滚动、聚焦和按键操作读取结果中的 ref，并等待页面变化，但不能查询任意选择器、执行调用方 JavaScript、读取跨源 frame、管理下载、暴露 Cookie，或执行不受限制的键盘和指针自动化。
- **不持久化提供方状态**：租约和待处理请求仅存在于内存中，Host 或 Web 页面停止时即丢失。
