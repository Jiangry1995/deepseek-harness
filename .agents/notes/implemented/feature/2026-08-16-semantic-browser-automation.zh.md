# Agent Note: 语义浏览器自动化

Status: implemented

[English](2026-08-16-semantic-browser-automation.md) | 中文

本记录扩展[浏览器侧边助手页面控制](2026-08-16-browser-side-assistant-page-control.md)。先前记录仍是先读取后操作、不透明 ref、敏感字段排除和伴随程序启动的权威说明。本记录补充文档身份、等待、滚动、聚焦和有限键盘操作。

## 问题

第一版页面控制可以读取快照，并点击、填写或选择一个已引用元素，但不能等待异步更新、滚动长页面或内部容器、聚焦控件、按有限按键，也不能在不先激活的情况下读取指定页签。因此模型只能“看一眼、点一下”，无法对实时页面形成观察—操作—等待—验证闭环。

## 决策

页面快照现在携带三种身份：

- `pageId` 仍在每次读取时重新生成。元素 ref 只对该快照有效。
- `documentId` 是不透明随机 UUID，在当前文档生命周期内保持不变；刷新、导航或文档替换后改变。不能用 URL 代替。
- `revision` 是单调递增的文档变更计数器。每次读取都会启动一个 MutationObserver，在后续第一次非协议变更时递增并断开；稳定性等待拥有仅限该请求生命周期的独立 observer。

`read-page` 接受可选 `tabId`。省略时仍读取当前活动网页页签，并优先使用侧栏标题记录的页签。Chrome 内部页、扩展页和无法注入脚本的页面返回 `BROWSER_PAGE_ACCESS_DENIED`。

Service Worker 为每份返回的快照记录来源页签。文档绑定操作先解析保留的 `pageId`，再考虑侧栏当前页签，因此读取后切换页签不会把操作重定向到别处。`wait-page` 优先接受最近的 `pageId`。保留绑定与显式 `tabId` 冲突时返回 `BROWSER_PAGE_STALE`。内存中绑定缺失时，与填写一样退回到焦点或当前活动页签，因为 Service Worker 重启会丢掉映射，而页面和侧栏仍在；该修正由[聊天发送与等待恢复](../bug-fix/2026-08-19-browser-composer-send-and-wait-recovery.md)记录。侧栏页签投影使用单调 generation，较慢返回的旧页签查询不能覆盖最新标题和焦点页签报告。

字段和操作元素会报告自己是否为 `document.activeElement`。模型可见的页面结果包含浏览器页签 id、焦点状态、原生选项、链接 href，以及读取器已经采集的 checked、selected、expanded 和 pressed 状态。

封闭操作集增加的是通用原语，而不是站点适配器：

- `scroll-page` 滚动文档主视口，或最近一次读取返回的 `scrollTargets` ref。只接受离散位移；不接受选择器、XPath 或坐标。偏移未变化时返回 `atBoundary: true`，而不是谎报成功。
- `focus-page-element` 聚焦已返回的字段或可聚焦动作，并检查 `document.activeElement`。
- `press-page-key` 接受封闭按键列表和可选修饰键，`repeat` 为 1–20。成功要求页面有可观察响应。任意键名返回 `BROWSER_KEY_UNSUPPORTED`。如果只能派发合成事件且页面没有响应，结果是 `BROWSER_CAPABILITY_UNAVAILABLE`，而不是伪造成功。依赖 debugger 的真实键盘输入不在本交付范围内。
- `wait-page` 等待文档变化、文本出现或消失、URL 匹配或加载稳定，然后返回新的 `BrowserPage`。超时 100–30000 毫秒，`stableMs` 为 0–2000 毫秒。`BROWSER_WAIT_TIMEOUT` 包含最后观察到的 URL、`documentId` 和 `revision`，不倾倒整页内容。URL 等待观察 `location.href`，因此覆盖 History API、hash、popstate 和真实导航；导航销毁内容脚本时由 Service Worker 重试。

填写仍对 input/textarea 使用原生原型 setter 并派发 `input`/`change`，对 contenteditable 使用 Chromium 编辑命令。填写后读取控件实际值，不一致则失败。请求提交，或在原生表单外按下 Enter 时，会点击近邻的发送或提交控件，而不是把合成 Enter 当作已经发出。密码、OTP、支付、文件、隐藏、禁用和只读控件仍然不可读、不可填。

页面桥协议版本为 6。Service Worker、content script、页面脚本和 Web Client 使用同一版本。结果 `kind` 必须与请求 `kind` 对应。

模型工具新增 `browser_scroll`、`browser_wait_for`、`browser_focus` 和 `browser_press`。没有单独增加 `browser_type`，因为现有 fill 已经替换文本并校验结果。浏览器提示词要求：当用户要求读取、总结或操作当前页签时，先调用 `browser_list_tabs` 或 `browser_read_page`；不要先调用 Skill、网页搜索或抓取 Harness 自己的页面；后续动作必须根据返回的页面语义动态决定；浏览器工具失败时应诊断 Provider、权限或过期引用，不要静默退回 Skill。推荐循环是读取 → 按 ref 操作 → 等待 → 再读取 → 验证。提示词不含网站名称，也不含“遇到某句话就执行某个动作”的脚本。

## 考虑过的替代方案

**用同一个身份同时表示快照引用和文档变化。** 否决。每次读取都更换 `pageId` 才能让过期 ref 变得明确，而等待变化需要稳定的文档生命周期。把 `pageId` 与 `documentId` 加 `revision` 分开，才能同时保住这两点。

**让模型传入 CSS selector、XPath 或任意 JavaScript。** 否决。那些是持久或不受限的句柄。短命不透明 ref 仍是唯一操作目标。

**再做一套增量输入的 fill/type 实现。** 否决。直到真实编辑器证明 fill 无法覆盖追加输入之前，重复写路径会掩盖校验失败。

**派发合成键盘事件后即报告成功。** 否决。页面忽略的事件不是已完成的动作。真实输入能力不可用时必须返回明确错误，而不是静默降级。

**要求模型在每次读取后复制 tabId。** 否决。文档绑定操作已经携带 `pageId`，由 Service Worker 解析这个身份可以避免模型编造 id 和页签切换竞态。尚无快照时仍可显式使用 `tabId`。

## 后果

模型可以对当前页面组合通用浏览器工具，而不需要站点特异适配器。等待、滚动和有限按键扩大了自动化面，因此结果校验和过期 ref 拒绝更重要。快照到页签的路由保存在内存中；Service Worker 重启会忘记 `pageId` 绑定，等待随后使用焦点或当前活动页签，而不是按过期失败。冲突的 `pageId` 与 `tabId` 仍视为过期。截图、坐标点击、debugger 权限，以及把 Browser Provider 迁入 Service Worker，仍属于后续交付。协议 6 是共用的页面桥版本；修改源文件后必须重新生成 `extension/*.js` 和聚合 Remote Client 再加载扩展。
