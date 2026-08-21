# 浏览器标签页

[English](browser.md) | 中文

浏览器能力让 agent（智能体）控制用户当前 Chromium 窗口中的标签页，并操作页面读取结果所引用的元素，而不把浏览器 API 放进 Host 进程。其 Service Definition 与 Host 代理位于 [`dsh-browser`](../../packages/web/browser)，Service Provider 是 [`dsh-client-browser-extension`](../../packages/client/browser-extension)，Consumer 是 [`dsh-tool-browser`](../../packages/web/tool-browser)。跨进程路由由[浏览器标签页 Agent Note](../../.agents/notes/implemented/feature/2026-08-14-browser-tab-extension.md)负责；文档绑定交互与本机伴随程序生命周期由[页面控制 Agent Note](../../.agents/notes/implemented/feature/2026-08-16-browser-side-assistant-page-control.md)负责。

源码：[`packages/web/browser/src/types.ts`](../../packages/web/browser/src/types.ts)

## 路由与归属

`ctx.browser` 负责提供方租约和待处理请求。扩展工具栏按钮会打开侧栏，由扩展自身的壳嵌入已配置的回环 Harness Web UI；只有页面桥检测到已安装扩展后，侧栏或独立 Web Client 才会成为提供方。Host 选择最近出现的存活提供方，通过允许名单中的 Remote 事件载体发送一条定向 `browser/command`，并且只接受该提供方的完成结果。Client 通过隔离世界页面桥转发操作；MV3 Service Worker 调用 `chrome.tabs`，目标标签页的内容脚本负责读取或操作 DOM。

这条路径让 Consumer 负责面向模型的 schema、Host 服务负责请求生命周期和错误、Client 插件负责 Web Client 连接，并让扩展负责 Chromium 权限。

## 操作与结果

服务支持一组封闭操作：打开一个不含凭据的 HTTP(S) URL、列出标签页、读取当前或指定页面、检查近期页面网络请求和 console 消息、点击、填写、选择、滚动、聚焦或按键操作一个已返回引用、等待页面条件、激活一个标签页，以及关闭一个标签页。页面读取会创建不透明 `pageId` 与元素 ref，扩展会为这份快照保留来源页签；检查操作读取 MAIN 世界探针捕获的 fetch/XHR 与 console 缓冲，不能打开原生 DevTools。再次读取或发生导航后，上一组坐标立即失效，操作完成结果必须回显请求中的坐标。每个结果都会重复操作判别字段，因此 Host 会拒绝针对错误操作返回的完成结果。

```ts type-equiv
/** Browser tab data returned to model-facing consumers. */
interface BrowserTab {
  /** Browser-assigned tab identifier. */
  id: number
  /** Browser-assigned window identifier. */
  windowId: number
  /** Whether the tab is active in its window. */
  active: boolean
  /** Current or pending URL when the browser exposes it. */
  url?: string
  /** Current title when the browser exposes it. */
  title?: string
}
```

```ts type-equiv
/** Fully resolved open-tab operation sent to the extension provider. */
interface BrowserOpenTabSpec {
  kind: 'open-tab'
  url: string
  active: boolean
}
```

```ts type-equiv
/** Browser operation routed from the Host to one extension provider. */
type BrowserOperation =
  | BrowserOpenTabSpec
  | { kind: 'list-tabs' }
  | ({ kind: 'read-page' } & BrowserReadPageRequest)
  | BrowserInspectPageSpec
  | ({ kind: 'click-page-element' } & BrowserPageTarget)
  | BrowserFillPageSpec
  | ({ kind: 'select-page-option' } & BrowserSelectPageRequest)
  | BrowserScrollPageSpec
  | ({ kind: 'focus-page-element' } & BrowserPageTarget)
  | BrowserPressPageSpec
  | BrowserWaitPageSpec
  | { kind: 'activate-tab'; tabId: number }
  | { kind: 'close-tab'; tabId: number }
```

```ts type-equiv
/** Successful result returned by an extension provider. */
type BrowserOperationResult =
  | { kind: 'open-tab'; tab: BrowserTab }
  | { kind: 'list-tabs'; tabs: BrowserTab[] }
  | { kind: 'read-page'; page: BrowserPage }
  | { kind: 'inspect-page'; inspect: BrowserPageInspect }
  | { kind: 'click-page-element'; receipt: BrowserPageActionReceipt }
  | { kind: 'fill-page-element'; receipt: BrowserPageActionReceipt }
  | { kind: 'select-page-option'; receipt: BrowserPageActionReceipt }
  | { kind: 'scroll-page'; receipt: BrowserScrollReceipt }
  | { kind: 'focus-page-element'; receipt: BrowserPageActionReceipt }
  | { kind: 'press-page-key'; receipt: BrowserPageActionReceipt }
  | { kind: 'wait-page'; page: BrowserPage }
  | { kind: 'activate-tab'; tab: BrowserTab }
  | { kind: 'close-tab'; tabId: number; closed: true }
```

## 提供方租约

注册使用可续租租约，因此已关闭或断开连接的 Web 页面不会无限期保留为所选提供方。租约会把 Host 过期时间和请求保留时间交给 Client；Client 在租约时长过半时续租。断开连接、租约过期、请求超时、调用方取消和服务 dispose（资源释放）都会结算受影响的待处理请求。

```ts type-equiv
/** Lease returned when a browser extension registers through the Web Client. */
interface BrowserClientLease {
  clientId: BrowserClientId
  /** Provider heartbeat deadline measured from the last successful registration or heartbeat. */
  leaseMs: number
  /** Maximum time the Client bridge retains one unanswered page-to-extension request. */
  requestTimeoutMs: number
}
```

## 安全与失败行为

扩展 manifest（元数据清单）授予侧栏、存储、Native Messaging、标签页、脚本注入和普通 HTTP(S) 页面访问权限；扩展页面的 frame/connect 策略仍只允许回环地址。后台监听器在接受 Host 操作前会要求消息具有本扩展的 sender id 和回环 sender URL。页面读取会排除密码、文件、隐藏字段、一次性验证码与支付敏感控件。页面检查会在 MAIN 世界探针安装后捕获 fetch/XHR 元数据和 console 文本，不返回请求或响应体，也不能打开原生 DevTools。页面操作只接受最近一次读取返回的 ref，拒绝已禁用或类型不兼容的元素，并且不接受任意选择器。页面桥两侧都会校验协议封装与操作专用数据，Host 还会独立校验 URL、标签页 id、页面坐标、所选提供方标识和结果判别字段。

这些检查限制可达性，但不会认证非回环 Harness 部署。因此，即使 HTTP 服务器信任其他权威，打包的提供方仍仅限回环地址。浏览器失败属于带稳定 `BrowserError` 错误代码的执行错误，扩展状态缺失绝不会移除面向模型的 schema。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxbrowser--browserservice"></a>

### `ctx.browser` — `BrowserService`

Routes browser operations to the most recently healthy WebExtension provider. Provider registrations are leases: expiry, disconnect, service disposal, caller cancellation, and request timeout all settle every affected pending operation.

```ts cordis-catalog
/**
 * Register or renew a WebExtension provider identity.
 * @param rawClientId - untrusted candidate identity generated by the Web Client.
 * @param visible - whether the provider's page is renderer-visible and can answer promptly.
 * @returns the validated identity and timing values the Client must honor.
 */
@Remote('connect') connect(rawClientId: string, visible: boolean): BrowserClientLease

/**
 * Renew one registered provider lease.
 * @param clientId - identity returned by {@link connect}.
 * @param visible - whether the provider's page is renderer-visible and can answer promptly.
 * @returns the renewed lease timing values.
 * @throws BROWSER_CLIENT_NOT_CONNECTED when the lease is absent or expired.
 */
@Remote('heartbeat') heartbeat(clientId: BrowserClientId, visible: boolean): BrowserClientLease

/**
 * Remove one provider and reject its outstanding operations.
 * @param clientId - identity returned by {@link connect}.
 * @returns whether a current provider lease was removed.
 */
@Remote('disconnect') disconnect(clientId: BrowserClientId): BrowserDisconnectReceipt

/**
 * Complete one Host request from its selected extension provider.
 * @param completion - echoed request and provider identities plus success or failure.
 * @returns whether the completion matched and settled a pending request.
 */
@Remote('complete') complete(completion: BrowserCompletion): BrowserCompletionReceipt

/**
 * Resolve caller defaults and validate one open-tab request.
 * @param request - URL and optional activation preference.
 * @returns a complete provider operation.
 */
resolveOpenTab(request: BrowserOpenTabRequest): BrowserOpenTabSpec

/**
 * Open one HTTP(S) tab through the selected extension provider.
 * @param request - URL and optional activation preference.
 * @param signal - caller cancellation.
 * @returns the created tab.
 */
async openTab(request: BrowserOpenTabRequest, signal: AbortSignal): Promise<BrowserTab>

/**
 * List tabs in the extension's current browser window.
 * @param signal - caller cancellation.
 * @returns tabs visible to the extension.
 */
async listTabs(signal: AbortSignal): Promise<BrowserTab[]>

/**
 * Read bounded visible text and non-secret form values from one browser page.
 * @param requestOrSignal - optional tab identity, or the caller AbortSignal for the active tab.
 * @param signal - caller cancellation when the first argument is a request record.
 * @returns the tab metadata and its main-frame page snapshot.
 */
async readPage(requestOrSignal: BrowserReadPageRequest | AbortSignal, signal?: AbortSignal): Promise<BrowserPage>

/**
 * Start, snapshot, or stop bounded page fetch/XHR and console observation.
 * Native DevTools cannot be opened, and observations begin only after a start request.
 * @param request - observation mode and optional tab identity.
 * @param signal - caller cancellation.
 * @returns the tab metadata and bounded Network/Console snapshot.
 */
async inspectPage( request: BrowserInspectPageRequest, signal: AbortSignal, ): Promise<BrowserPageInspect>

/**
 * Validate and default one inspect-page request.
 * @param request - observation mode and optional tab identity.
 * @returns a complete provider operation.
 */
resolveInspectPage(request: BrowserInspectPageRequest): BrowserInspectPageSpec

/**
 * Validate and brand a document-bound target returned by the latest page read.
 * @param rawPageId - page UUID supplied at the model-tool boundary.
 * @param rawRef - element reference supplied at the model-tool boundary.
 * @returns a typed target accepted by page action methods.
 */
resolvePageTarget(rawPageId: string, rawRef: string): BrowserPageTarget

/**
 * Validate and brand a snapshot identity returned by the latest page read.
 * @param rawPageId - page UUID supplied at the model-tool boundary.
 * @returns the branded snapshot identity.
 */
resolvePageId(rawPageId: string): BrowserPage['pageId']

/**
 * Click one element referenced by the latest current-page snapshot.
 * @param target - validated page and element identities.
 * @param signal - caller cancellation.
 * @returns confirmation of the completed click.
 */
async clickPage(target: BrowserPageTarget, signal: AbortSignal): Promise<BrowserPageActionReceipt>

/**
 * Fill one text field referenced by the latest current-page snapshot.
 * @param request - validated target, replacement value, and submit preference.
 * @param signal - caller cancellation.
 * @returns confirmation of the completed fill.
 */
async fillPage(request: BrowserFillPageRequest, signal: AbortSignal): Promise<BrowserPageActionReceipt>

/**
 * Select one native option referenced by the latest current-page snapshot.
 * @param request - validated target and exact option value or visible text.
 * @param signal - caller cancellation.
 * @returns confirmation including the resolved native option value.
 */
async selectPage(request: BrowserSelectPageRequest, signal: AbortSignal): Promise<BrowserPageActionReceipt>

/**
 * Scroll the document viewport or one scroll target from the latest page read.
 * @param request - validated page identity, optional scroll-target ref, and discrete movement.
 * @param signal - caller cancellation.
 * @returns observed offsets after the scroll attempt, including an at-boundary result.
 */
async scrollPage(request: BrowserScrollPageRequest, signal: AbortSignal): Promise<BrowserScrollReceipt>

/**
 * Focus one field or focusable action from the latest page read.
 * @param target - validated page and element identities.
 * @param signal - caller cancellation.
 * @returns confirmation that document.activeElement is the referenced element.
 */
async focusPage(target: BrowserPageTarget, signal: AbortSignal): Promise<BrowserPageActionReceipt>

/**
 * Press one allowed key against a referenced element from the latest page read.
 * @param request - validated target, allowed key, optional modifiers, and repeat count.
 * @param signal - caller cancellation.
 * @returns confirmation of the completed key effect.
 */
async pressPage(request: BrowserPressPageRequest, signal: AbortSignal): Promise<BrowserPageActionReceipt>

/**
 * Validate and default one bounded keyboard request.
 * @param request - target, key, optional modifiers, and optional repeat count.
 * @returns a complete provider operation.
 */
resolvePressPage(request: BrowserPressPageRequest): BrowserPressPageSpec

/**
 * Wait until a page condition holds, then return a fresh snapshot.
 * @param request - tab identity, condition, and optional timeout bounds.
 * @param signal - caller cancellation.
 * @returns a new page snapshot after the condition is observed.
 */
async waitPage(request: BrowserWaitPageRequest, signal: AbortSignal): Promise<BrowserPage>

/**
 * Validate and default one wait-page request.
 * @param request - tab identity, condition, and optional timeout bounds.
 * @returns a complete provider operation.
 */
resolveWaitPage(request: BrowserWaitPageRequest): BrowserWaitPageSpec

/**
 * Activate one tab in its browser window.
 * @param tabId - browser-assigned tab identifier.
 * @param signal - caller cancellation.
 * @returns the activated tab.
 */
async activateTab(tabId: number, signal: AbortSignal): Promise<BrowserTab>

/**
 * Close one tab.
 * @param tabId - browser-assigned tab identifier.
 * @param signal - caller cancellation.
 * @returns the closed tab identity.
 */
async closeTab(tabId: number, signal: AbortSignal): Promise<{ tabId: number; closed: true }>
```

Source: [`packages/web/browser/src/index.ts:296`](../../packages/web/browser/src/index.ts)

<a id="browser-events"></a>

### `browser/*` events

<a id="browsercommand--emit"></a>

#### `browser/command` — emit

Deliver one browser command to the selected Web Client provider.

```ts cordis-catalog
/**
 * Deliver one browser command to the selected Web Client provider.
 * @param command - request identity, provider identity, and validated operation.
 * @mode emit
 */
'browser/command'(command: BrowserCommand): void
```

Source: [`packages/web/browser/src/types.ts:552`](../../packages/web/browser/src/types.ts)
<!-- END GENERATED cordis-surface -->
