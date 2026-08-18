# @deepseek-ai/dsh-web-networking

[English](README.md) | 中文

用于控制继承的 `web_search` 和 `web_fetch` 是否可用的会话级策略。该包负责持久化的 `web/networking` 事件、`webNetworking` Client projection、`/web` 命令，以及为单个 agent 屏蔽或恢复两个工具的实时 `tools.restrict` disposer。

## Host 行为

会话没有 `web/networking` 事件时，联网默认启用。`/web off` 追加 `{ enabled: false }`，`/web` 追加 `{ enabled: true }`。折叠规则为最后一个事件生效，因此回放无需单独的设置存储即可重建偏好。

创建 agent 或命令修改偏好时，`WebNetworkingController` 会让实时工具限制与折叠值保持一致。它在限制前检查 agent 完整的继承工具视图，因此只组合搜索工具的部署仍然有效。重新启用时调用为该会话创建的同一个 disposer。agent 销毁和插件卸载会释放进程内限制；恢复后仍以事件日志为来源。

可选的 session-projection 子插件向 Web Client 暴露 `{ enabled: boolean }`。可选的 commands 子插件负责 `/web`；无界面组合可以挂载策略而不挂载这两个表面。

## 模型体验

### Web 工具可见性

#### 模型看到的内容

联网启用时，模型会收到组合继承的 `web_search` 和/或 `web_fetch` schema。联网禁用时，这些 schema 在该会话中不可见。此策略不会添加或移除 `dsh-tool-web` 的提示词段落。

#### Token 影响

禁用联网会从每次请求中移除已启用的 Web 工具 schema；重新启用会恢复其固定 schema 成本。持久化事件属于机制状态，不会渲染成消息。

#### KV Cache 影响

修改偏好可能从第一个变化的工具 schema token 开始使缓存失效。只要折叠后的偏好和继承工具注册不变，请求前缀就保持稳定。

## 已知限制与暂缓事项

- **搜索与抓取一起切换**：事件和命令不表示独立的工具偏好。
- **继承工具名称固定**：此策略针对 `web_search` 和 `web_fetch`；其他消费方名称需要自己的策略。
- **实时限制仅存在于进程内**：创建 agent 时会从会话日志重建限制，而不是持久化运行时对象。
