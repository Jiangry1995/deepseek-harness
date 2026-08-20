# memory/：本机文件记忆

[English](README.md) | 中文

第一方 markdown 记忆能力。存储包拥有磁盘文件；工具消费方拥有面向模型的工具、提示词注入，以及后台抽取/巩固任务。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`memory/`](memory/README.md) | 带路径收敛的用户级和项目级 markdown 文件。 | `ctx.memory` |
| [`tool-memory/`](tool-memory/README.md) | 搜索/列举/读取/笔记工具、常驻 HOWTO、抽取后巩固。 | （注册到 `ctx.tools`） |

这是宿主本机的过程记忆，不是第三方记忆 MCP 服务器。[`examples/mcp-memory`](../../examples/mcp-memory) 下的 overlay 示例保持默认关闭且可选。决策记录在[第一方文件记忆 Agent Note](../../.agents/notes/implemented/feature/2026-08-18-first-party-file-memory.md)。
