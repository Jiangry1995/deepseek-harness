# Agent Note：聊天发送从快照控件发出；不完整等待按就绪处理

Status: implemented

[English](2026-08-19-browser-composer-send-and-wait-recovery.md) | 中文

## 问题

不是原生 HTML 表单的聊天输入框不会因为合成 Enter 而发出消息。`browser_press` 和带 `submit: true` 的 `fill` 在派发 `isTrusted: false` 的 KeyboardEvent 后报告成功，页面却把草稿留在输入框里，发送键仍可点。

只有图标、没有无障碍名称的发送和删除按钮在快照里会变成 `(unlabeled)`，模型分不清它们，于是默认按 Enter。

`tool:browser` 提示词要求每次页面动作后都调用 `browser_wait_for`。模型就会只传 `{kind:"change"}`，不带 `documentId` 和 `afterRevision`，Host 以 `BROWSER_INVALID_REQUEST` 拒绝。随后用同一次填写的 `pageId` 再等待时，若 Service Worker 已重启，会得到 `BROWSER_PAGE_STALE`：等待把内存绑定缺失当成致命错误，而填写已经会退回焦点页签。该对照作为现行事实记录在[语义浏览器自动化](../feature/2026-08-16-semantic-browser-automation.zh.md)。

## 决策

当已填写或已聚焦的控件不在原生 `form` 内时，提交和 Enter 会点击近邻的发送或提交控件。带发送、submit 或「发送」名称的控件优先；其次是原生 `type=submit`；最后才是该输入区域里唯一剩下的非破坏性按钮。名称匹配删除、清空、取消或新开对话的控件不会被选中，包括 Element Plus 发送簇里的第一个按钮。原生表单仍使用 `requestSubmit()`。若输入框拦截了 Enter 却没有真正发出，仍会点击该发送控件。

`resolveWaitCondition` 把缺少 `documentId` 或 `afterRevision` 的 `kind:change` 当作 `kind:ready`。字段写全但 id 或 revision 非法的 change 仍以 `BROWSER_INVALID_REQUEST` 失败。

`wait-page` 在 `pageId` 映射没有条目时走 `resolveReadTab`，与填写一致。保留绑定与显式 `tabId` 冲突时仍是 `BROWSER_PAGE_STALE`。成功的文档绑定操作会记下实际操作的页签，便于随后的等待找到同一页签。

`browser_click` 在引用节点是图标或输入区外壳时，会激活最近的按钮、链接或具名发送控件，并在原生 click 之前派发 pointer 和 mouse 事件。紧凑图标控件即使有标签也会带上 `rect`，饱和非灰色底会标 `accent`，因此「右下角蓝色发送」可以对应到快照 ref，而不依赖站点 CSS。

`tool:browser` 提示词要求模型点击最近一次快照里的发送或提交控件，动作后优先使用 `kind:ready` 或 `kind:text`，不要编造 `kind:change` 的字段。宿主页面如果用纯图标表示发送和删除，仍应提供读取器已经优先采用的 `aria-label`。

## 备选方案

**要求用户在提示词里点名每一个工具。** 否决。失败出在默认工具行为和指引上；按任务写脚本无法覆盖下一个输入框。

**为某一个信访台写死 CSS 或 XPath。** 否决。不透明 ref 和无障碍名称仍是唯一操作句柄。类名只用来圈定输入区域（`el-editor-sender`、`ch-chat-input`），不是操作目标。

**继续把缺失的等待绑定当作 `BROWSER_PAGE_STALE`。** 否决。填写在同一映射缺失时已经退回焦点页签，因此用这次填写的 `pageId` 去等待会在编辑成功后失败。冲突绑定仍视为过期，避免等待跳到快照并非来自的页签。

**点击发送簇里最后一个无标签按钮。** 否决。删除和发送常常是相邻图标按钮；只有具名发送、原生 submit，或唯一剩下的非破坏性控件才安全。

## 影响

Enter 和 fill-submit 可以在没有站点适配器的情况下发出 SPA 聊天。不完整的 `kind:change` 等待不再中断循环。Service Worker 重启不再让只带 pageId 的等待变成过期。点击图标或发送簇外壳会激活具名发送控件，而不是旁边的删除。紧凑且带 accent 的动作带有位置，颜色和方位说明才能选对 ref。仍然只提供无标签发送图标的页面，在补上无障碍名称之前仍更难按名称点击。既 preventDefault Enter 又真正发出的输入框可能会被点第二次。超过默认 Host 请求超时的 wait-page Host 与页面桥定时器由[等待页 Host 与页面桥定时器](2026-08-20-browser-wait-bridge-timeout.zh.md)负责。

## 测试

`packages/web/browser` 把 `{kind:"change"}` 当作就绪，并仍拒绝非法的完整 change。`packages/client/browser-extension` 在 fill-submit、Enter、图标节点和发送簇外壳上点击「发送」而不是「新开对话」或「删除」，记录紧凑 `rect` 和饱和 `accent` 底色，在 `pageId` 映射为空时于焦点页签等待，并保持冲突的 `pageId`/`tabId` 为过期。`packages/web/tool-browser` 钉住发送控件和等待指引的提示词条款，并渲染紧凑 `rect` 与 `accent`。
