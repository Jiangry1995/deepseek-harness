# 使用 Web UI

[English](index.md) | 中文

先按照[根 README](../../../README.md#run)启动 Web UI；命令会打印其访问地址。本指南从服务器已经运行的状态开始。`dsh` 进程会把调用目录作为默认文件系统位置，但新的 Web UI 在添加工作区前不会选中任何工作区。

## 配置模型

打开**设置 → 模型**，输入 DeepSeek API 密钥并保存。模型路由会立即可用，不需要重启服务器。

[模型配置指南](./providers.md)介绍其他提供方和自定义 OpenAI 兼容端点。

## 选择工作区

点击**选择工作区**，添加启动 `dsh` 时所在的项目目录，然后选中它。选中工作区前，会话输入框不可用。

## 使用浏览器侧边助手（可选）

可选 Chromium 扩展会在当前网页旁打开完整 Harness UI，并让 agent 打开、列出、激活和关闭当前浏览器窗口中的标签页。从本仓库运行时执行以下步骤：

1. 运行 `pnpm --filter @deepseek-ai/dsh-client-browser-extension bundle`。
2. 打开 `chrome://extensions`，启用**开发者模式**，选择**加载已解压的扩展程序**，然后选择 `packages/client/browser-extension/extension`。
3. 点击扩展工具栏按钮。Harness 会在浏览器侧栏中打开，默认连接 `http://127.0.0.1:3080`；如果运行中的 Web profile 使用另一个回环端口，请通过侧栏设置按钮修改。
4. 在侧栏中让 agent 列出当前标签页并批准该请求。返回标签页列表即表示侧栏 Web Client、扩展桥与 Host 代理已连接。

重新构建扩展后，要先在其 `chrome://extensions` 卡片上点击**重新加载**，再打开侧栏。

[扩展包 README](../../../packages/client/browser-extension/README.md)记录其权限、支持的 origin 和失败行为。

## 运行任务

启动一个会话并发送：

> Summarize this repository and identify its main packages.

agent 可以读取和编辑工作区文件、运行命令、委派工作并维护计划。当操作在当前权限策略下需要审批时，Web UI 会先询问你。

## 继续使用

- [配置模型](./providers.md)
- [使用 Python SDK](./python-sdk.md)
- [使用其他 CLI 模式](../../../apps/cli/README.md)
- [开发插件](../develop/basic/)
- [了解浏览器标签页路由](../../subsystems/browser.md)
