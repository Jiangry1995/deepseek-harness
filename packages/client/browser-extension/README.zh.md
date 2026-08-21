# @deepseek-ai/dsh-client-browser-extension

[English](README.md) | 中文

Chromium 侧边助手，以及标签页控制、当前页面读取和文档绑定页面操作能力的 Web Client Service Provider。其 MV3 侧栏会在当前网页旁承载完整的回环 Harness Web UI，Client 插件维护 Host 端租约注册，Service Worker 则通过 Chromium API 执行经过校验的标签页和页面操作。

## 构建并加载扩展

在仓库根目录执行以下步骤：

1. 运行 `pnpm run build:lib:client`。
2. 在 Chromium 中打开 `chrome://extensions` 并启用**开发者模式**。
3. 选择**加载已解压的扩展程序**，然后选择 `packages/client/browser-extension/extension`。
4. 启动 Web profile，然后点击扩展工具栏按钮，在浏览器侧栏中打开 Harness。若这个文件夹之前已经加载，重新构建后要先在扩展卡片上点击重新加载。

Client 库构建会同时生成本包的 TypeScript 和 MV3 资源。若修改 Browser Remote 操作类型或结果字段，则要先执行 `pnpm run build:lib`，再执行 `pnpm run build:web`，然后重新加载扩展，使 Host schema、聚合 Client Remote schema、扩展资源和 Web 外壳使用同一版协议。

请在需要助手读取或操作的页面上点击扩展工具栏按钮。侧栏标题会忽略较早页签激活的迟到结果；Service Worker 还会把每个返回的 `pageId` 绑定到来源页签，因此后续浏览器操作不会误落到另一个页签。

侧栏默认连接 `http://127.0.0.1:3080`。通过设置按钮可以改用另一个明文 HTTP 的 `127.0.0.1` 或 `localhost` origin，所选 origin 会保存在扩展本地存储中。

扩展包会发布 manifest、后台脚本、内容脚本以及侧栏的 HTML、CSS 与 JavaScript 文件，因此安装后的发行包不需要本地 TypeScript 构建。

### Windows 登录启动与托盘

在仓库根目录运行一次 `pnpm --filter @deepseek-ai/dsh-client-browser-extension windows:install`。安装器会注册当前用户的登录任务和 Native Messaging Host，然后启动托盘伴随程序。托盘菜单可以打开、启动、重启、停止托管的 Web profile，也可以打开日志。若登录启动失败或服务已停止，打开侧边助手时会请求 Native Messaging Host 运行同一项计划任务，并等待 `http://127.0.0.1:3080` 恢复健康。

## 运行时行为

工具栏按钮会打开 MV3 侧栏。扩展自身的小型侧栏壳会探测已配置 origin，在响应成功后嵌入完整 Web UI；服务不可用时则显示重试、启动命令和地址编辑状态。内容脚本会在嵌入的回环 frame 和独立打开的回环 Harness 页面中运行，并响应带版本的同窗口桥探测。

Client 插件仅在收到就绪响应后注册，在租约时长过半时续租，监听发给自身的 `browser/command` 事件，并通过 Typert Remote 浏览器命名空间完成每个请求。页面桥请求使用 Host 超时减去 1000ms 余量。`wait-page` 使用 `max(requestTimeoutMs, timeoutMs + 1500)` 再减去该余量，以便页内等待先结束。Teardown 会停止心跳、拒绝页面桥工作、等待正在进行的注册，并断开该竞态期间获得的任何租约。

扩展支持 `open-tab`、`list-tabs`、`read-page`、`inspect-page`、`click-page-element`、`fill-page-element`、`select-page-option`、`scroll-page`、`focus-page-element`、`press-page-key`、`wait-page`、`activate-tab` 和 `close-tab`。Service Worker、content script、页面脚本和 Web Client 共用协议版本 7。普通 HTTP(S) 页面不会收到静态侧边助手脚本。`read-page` 与文档绑定操作只向所选标签页注入隔离世界读取器，每次读取只观察后续第一次文档变更，随后断开。`inspect-page` 独立注入休眠的 MAIN 世界控制器，并要求 `start`、`snapshot` 或 `stop`；捕获只包含之后的 fetch/XHR 和 console 调用，`snapshot` 保持捕获有效，`stop` 释放自有包装和监听器。console 捕获保留字符串和原始值，但用固定标记代替对象遍历。原生 DevTools、请求体和响应体仍不可用。点击、填写、选择、滚动、聚焦和按键只接受最近快照中的坐标，并通过 `pageId` 保留的来源标签页路由；再次读取或导航会使其失效。填写操作在原生 setter 或 contenteditable 编辑事件后校验控件实际值，并可通过所属表单、近邻发送控件或 Enter 提交。选择操作按原生选项的精确值或可见文本匹配。等待操作优先使用保留的 `pageId`，Service Worker 状态丢失后才回退，并在文档变化、文本、URL 或加载稳定后返回新快照。桥接层会把结果规范化为 JSON、拒绝格式错误的请求、把完整页面结果限制在 96 KiB 序列化 UTF-8 以内，并把页面与 Chromium 失败映射为稳定错误代码。

## 安全约束

manifest（元数据清单）申请 `sidePanel` 以打开助手，申请 `storage` 以保存所选 origin，申请 `nativeMessaging` 以恢复伴随程序，申请 `tabs` 以读取标签元数据并控制标签页，并通过 `activeTab` 与 `scripting` 按需注入页面脚本。HTTP(S) host permission 声明扩展对普通站点的读取与操作权限，但只在浏览器操作选择标签页后运行代码。扩展页面的 `connect-src` 与 `frame-src` 仍只允许使用明文 HTTP 的 `127.0.0.1` 和 `localhost`；回环内容脚本启用 `all_frames`，让嵌入的 Web UI 能够注册提供方。Service Worker 只接受来自本扩展 id 且 sender URL 为回环地址的 Host 操作消息。打开标签页请求只接受不含凭据的绝对 HTTP(S) URL；不支持的协议和嵌入凭据会在调用 `chrome.tabs.create` 前被拒绝。

页面读取和写入都会排除密码、文件、隐藏字段、一次性验证码、银行卡号和安全码控件。读取范围包括顶层文档和可访问的同源子 frame，但不会跨越 origin 边界，也不返回 Cookie 或浏览器存储。页面操作不接受模型自行编造的选择器或坐标：每个目标都必须是同一文档最近一次读取签发的引用；禁用或类型不兼容的目标会明确失败。

页面桥会在隔离世界边界两侧校验协议版本、方向、请求标识、操作、响应判别字段、标签页字段和错误代码。这些校验不会认证 Harness 服务器；它们只限制哪些页面能够访问已安装扩展。

## 模型体验

无。此包只在 Web Client 与 Chromium 之间传输已经定义的浏览器操作；`dsh-tool-browser` 负责全部面向模型的提示词、schema、审批和结果文本。

#### KV Cache 影响

无；提供方连接与扩展流量不会进入模型请求。

## 已知限制与暂缓事项

- **仅支持 Chromium MV3**：不提供 Firefox 或 Safari 扩展格式。
- **仅支持回环 Web UI**：即使 Host HTTP 信任配置允许某个非回环部署的 origin，该部署也无法注册此提供方。
- **Windows 伴随程序绑定当前仓库**：登录任务会使用安装时记录的 Node 路径启动当前 checkout 的源码入口；移动 checkout 或更换 Node 后需要重新安装。其他操作系统仍需手动启动 Web profile。
- **只提供有界的引用式交互**：扩展不暴露任意 DOM 选择器、跨源 iframe 内容、Cookie、浏览器存储、截图、下载、拖放或不受限制的键盘和指针自动化。
- **操作后必须重新读取**：导航、再次读取或页面重新渲染都可能使元素引用失效；调用方会在每次操作后重新读取，并且只使用新返回的坐标重试。
