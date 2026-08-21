# @deepseek-ai/dsh-client-ui-web

[English](README.md) | 中文

用于控制会话级 Web 工具可用性的 Web Client 插件。插件在 `conversation.input.left` 中放置常驻的 **Web** 按钮，读取 Host 计算出的 `webNetworking` projection，并通过现有 `/web` 命令提交变更，不在浏览器本地维护重复状态。

## 运行时行为

只有当前组合发布 `webNetworking` projection 时，按钮才会渲染。其按下状态跟随 `projection.enabled`；启用时点击执行 `/web off`，禁用时点击执行 `/web`。会话已移除或命令正在执行时，控件会被禁用。命令失败不会改变 projection 状态，并在按钮旁显示简短状态。

插件注册简体中文和英文的无障碍标签与标题。Node 入口有意保持为空：包可从 Host 插件树加载，所有可见行为都由 `./client` 导出提供。槽位注册、语言注册和组件待处理状态随 Client 插件生命周期释放。

## 模型体验

通过 [`dsh-web-networking`](../../web/web-networking/README.zh.md) 间接影响；后者负责持久化偏好以及由此产生的 `web_search`/`web_fetch` schema 可见性，本包只在 Web Client 中提供该选项。

#### KV Cache 影响

点击按钮后，Host 应用新的限制可能使工具 schema 列表之后的缓存失效；UI 包自身不贡献提示词或 schema。

## 已知限制与暂缓事项

- **需要命令往返**：按钮不会乐观更新；它会等待 `/web` 或 `/web off` 成功后由 Host 生成的新 projection。
- **只有一个组合开关**：搜索和抓取会一起启用或禁用；UI 不提供逐工具控制。
- **无能力即无控件**：未组合 `dsh-web-networking` 的部署不会发布 projection，因此按钮有意不显示。
