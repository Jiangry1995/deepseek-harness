# 使用 Web UI

[English](index.md) | 中文

请先按照[根目录 README](../../../README.zh.md#run) 中的说明启动 Web UI；命令会打印其访问地址。本指南从服务器已经运行的状态开始。`dsh` 进程会把启动时所在的目录作为默认文件系统位置；全新的 Web UI 则不会选中任何工作区，你需要添加一个工作区。

## 配置模型

打开**设置 → 模型**，输入 [DeepSeek API 密钥](https://platform.deepseek.com/)并保存。模型路由会立即可用，不需要重启服务器。

[模型配置指南](./providers.zh.md)介绍其他提供方和自定义 OpenAI 兼容端点。

## 选择工作区

点击**选择工作区**，添加启动 `dsh` 时所在的项目目录，然后选中它。选中工作区前，会话输入框不可用。

## 使用浏览器侧边助手（可选）

可选 Chromium 扩展会在当前网页旁打开完整 Harness UI，并让 Agent（智能体）读取和操作当前浏览器窗口中的标签页。从本仓库运行时执行以下步骤：

1. 运行 `pnpm --filter @deepseek-ai/dsh-client-browser-extension bundle`。
2. 打开 `chrome://extensions`，启用**开发者模式**，选择**加载已解压的扩展程序**，然后选择 `packages/client/browser-extension/extension`。
3. 点击扩展工具栏按钮。Harness 会在浏览器侧栏中打开，默认连接 `http://127.0.0.1:3080`；如果 Web profile 使用另一个回环端口，请通过侧栏设置按钮修改。
4. 在侧栏中让 Agent 列出当前标签页。返回标签页列表即表示侧栏 Web Client、扩展桥与 Host 代理已连接。

重新构建扩展后，要先在其 `chrome://extensions` 卡片上点击**重新加载**，再打开侧栏。Windows 打包和伴随服务说明见[桌面应用 README](../../../DesktopApp/README.zh.md)；扩展权限与失败行为见[扩展 README](../../../packages/client/browser-extension/README.zh.md)。

## 运行任务

启动一个会话并发送：

> Summarize this repository and identify its main packages.

Agent（智能体）可以读取和编辑工作区文件、运行命令、委派工作并维护计划。如果根据当前权限策略，某项操作需要审批，Web UI 会先询问你。

## 继续使用

- [配置模型](./providers.zh.md)
- [使用 Python SDK](./python-sdk.zh.md)
- [使用其他 CLI 模式](../../../apps/cli/README.zh.md)
- [开发插件](../develop/basic/index.zh.md)
- [了解浏览器标签页路由](../../subsystems/browser.zh.md)
