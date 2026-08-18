# `@deepseek-ai/dsh-client-ui-settings-vision-fallback`

[English](README.md) | 中文

[`@deepseek-ai/dsh-llm-vision-fallback`](../../llm/llm-vision-fallback/README.md) 的 Web 设置配套包。它向 `settings.plugins.tab` 贡献本地化的**自动识图**标签，绑定 `llm-vision-fallback` settings namespace，并且只在标签挂载后才读取 `llm.models`。

提供方和模型选择器只展示目录元数据明确包含 `image` 的已注册确切模型。API Key、端点、自定义提供方和模型 profile 修改继续归“模型”页面所有；本标签只负责辅助模型选择、最大输出 Token、超时和转译提示词。目录局部失败时保留成功提供方，整体失败有重试操作，无效数字或残缺路由草稿会阻止保存，被拒写入会保留草稿。Host 推送的 `llm/adapters-updated`、`settings/document-updated` 和 `connection/reset` 只刷新已经加载过的目录，不会让插件激活产生网络读取。改模型 profile（含“支持图片输入”开关）不会重新注册适配器路由，所以要靠文档更新事件才能和“模型”页保持同步。

表单沿用现有设置 token 和标签内容列：宽度高于 640 像素时双列，低于该值时单列；使用键盘原生 label/select、焦点环、44 像素移动端操作按钮，以及明确的加载、空、错误、只读状态和双语文案。

## 模型体验

无，因为本包只编辑 Host 设置并在浏览器中渲染已注册模型目录。

#### KV Cache 影响

无；本包不组装或发送提供方请求。

## 已知限制与延期工作

- **以目录声明为准**——模型元数据未包含 `image` 的视觉端点会被隐藏，即使提供方实际能够接收；请先在“模型”页面声明该模态。
- **本标签不做连接测试**——Host 解析可用性时会检查辅助模型；凭据和端点探测继续归“模型”页面所有。
