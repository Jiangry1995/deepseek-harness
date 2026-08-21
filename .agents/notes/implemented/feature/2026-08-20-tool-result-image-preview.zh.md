# Agent Note: Web 对话中预览工具结果里的图像块

Status: implemented

[English](2026-08-20-tool-result-image-preview.md) | 中文

## 问题

`read_image` 已在 `ToolResultNode.content` 上返回持久的 `ImageBlock`（与元数据信封并列），用户/助手消息也已通过 `ImageGallery` 渲染这些附件。工具行没有走这条路径：`resultText` 把每个非文本块都 JSON 序列化，`AssistantMarkdown` 不绘制 `tool-call` 头，也没有 keyed 的 `read_image` toolview，因此展开的 IN/OUT 卡片只显示 `<path>`/`<type>`/`<content>` XML 和附件的 JSON 倾倒，而不是像素。

## 决定

通用工具行和详情 Output 区把 `type: 'image'` 内容渲染成与聊天历史相同的、带会话授权的缩略图。`resultImages` 从冻结结果中提取附件引用；`resultText` 省略图像块，因此 Output 是信封而不是 JSON 倾倒。`ToolRow` 把画廊放在折叠区之外、作为 IN/OUT 正文的兄弟节点，因此收起时只隐藏信封，240px 长边预览也不会被 150px 文本上限裁切。`ToolDetails` 把画廊放在信封上方。字节通过 `loadImage` 解析；聊天节点 owner 原本就有它，详情 inject 现在从 `conversation.resolveImage` 转发。

`read_image` 归类为标题为 `Read image` 的 read 家族行，`file_path` 作为可打开的 Host 链接。没有新的 `card:` 标签，也没有 keyed 的 `read_image` toolview：任何 settled content 含 `ImageBlock` 的工具都会得到预览，而 `read_image` 仍保持 `presentCall` `{ card: 'generic', kind: 'read' }`。

## 考虑过的替代方案

**只给该工具使用的 keyed `read_image` toolview。** 拒绝：像素已经在 `content` 上；按名称 keyed 的行会让其他返回图像的工具看不到同样的块，并且重复 `GenericToolCard`。

**新的 `card: 'image'` render intent 和 `presentResult`。** 拒绝：附件已经是 Web 宿主和模型适配器会消费的内容块。再加 card 标签会把日志里已有的事实再持久化一份，违背“展示是已记录内容的纯函数”这条规则。

**在摘要行放缩略图，或自动展开图像行。** 拒绝：摘要行是单行 24px 裁切，其他卡片也都默认折叠，好让一串调用保持可扫读。画廊放在标题行下方、折叠区之外，截图留在对话流里，信封仍可按需展开。

## 后果

成功的 `read_image` 行在标题下显示截图，元数据信封默认收起。展开后露出信封；再收起会藏住信封并保留缩略图。在详情中打开该调用同样显示截图。缺少 `loadImage` 回调时只保留信封、没有缩略图，而不会从未经授权的路径取字节。Output 里不再出现图像块的 JSON 倾倒。

## 测试

`packages/client/ui-tool/tests/tool-row.client.spec.tsx` 钉住 `resultText` 跳过图像块、`resultImages` 收集附件，以及 `read_image` 行的标题/路径。`packages/client/ui-tool/tests/tool-image-preview.client.spec.tsx` 钉住折叠行缩略图和灯箱、信封仍在折叠区内、GenericToolCard 的 `read_image` 路径，以及详情 Output 画廊。`packages/client/ui-conversation/tests/apply-inject.client.spec.tsx` 钉住详情 inject 转发 `loadImage`。

## 相关

- [基于既有 seam 的最小 read_image 工具](2026-08-10-minimal-read-image-tool.md) — 产出本预览所渲染的 `ImageBlock`。
- [Web read 卡片前端](2026-07-30-web-read-card-frontend.md) — 本改动没有沿用的卡片消费模式；图像预览留在 generic 内容块上。
