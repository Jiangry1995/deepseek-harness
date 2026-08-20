# Agent Note: 第一方文件记忆

Status: implemented

[English](2026-08-18-first-party-file-memory.md) | 中文

## 问题

长运行助手需要能跨过一个回合、一次会话重启，以及一直开着的侧边栏而仍然存在的个人和项目事实。第三方记忆 MCP overlay 已经作为默认关闭的示例存在，但它们不能给 DSH 一份第一方、可检查、位于磁盘上的手册，让对话模型在不接入提供方协议的情况下搜索。把这份手册放到 MCP、向量数据库，或让对话模型直接 `memory_write` 改写 `MEMORY.md`，要么把产品外包出去，要么让主模型不受约束地改写常驻记忆。

## 决策

在 `packages/memory/` 交付第一方 Cordis 文件记忆能力：`@deepseek-ai/dsh-memory`（`ctx.memory`）负责受约束的 markdown 树，`@deepseek-ai/dsh-tool-memory` 负责 `memory_search` / `memory_list` / `memory_read` / `memory_note`、常驻 HOWTO 注入，以及后台抽取后巩固流水线。主对话模型不编辑 `MEMORY.md`。Phase 1 抽取 JSON 对象；Phase 2 巩固 JSON；由宿主写文件。辅助调用使用 `GenerateOptions.purpose: 'memory'`。DeepSeek 适配器对该 purpose 禁用思考。

用户级文件位于 `$DSH_HOME/memory`。项目级文件位于 `{cwd}/.dsh/memory`。每个根可以包含 `memory_summary.md`（首行 `v1`）、`MEMORY.md`、`raw_memories.md`、`session_summaries/`、`notes/`、`notes/processed/` 以及 `skills/<name>/SKILL.md`。`state.json` 是用户根水印，对工具隐藏。相对路径不能逃出所选根。写入会脱敏凭证形态的片段。

`memory_note` 仅在用户明确要求记住、忘掉或修改已存事实时运行。闲聊是 no-op。`AGENTS.md` 不是记忆。仅当已完成回合含记住/忘掉类措辞或含工具调用时才运行 Phase 1。当 Phase 1 写出内容或存在待处理笔记时才运行 Phase 2。同一会话已完成的 `turn/end` 立即抽取，因此从不重启的侧边栏仍会更新。`agent/session-start` 会补抽水印之后的已完成回合。subagent 会话和 `delegationDepth > 0` 会被跳过。中止不推进水印。失败只记日志，不中止 agent（智能体）。插件写入的 `user/message` 不会进入抽取转录。没有新的 `SessionEventMap` 记忆事件。

交付的 `dsh-base` bundle 挂载 `memory` 存储，`userRoot: !!js dshHomePath('memory')`，并在宿主平面挂载 TUI 用的 `tool-memory`。Web overlay 会禁用该宿主工具行；交付的 `standard` / `code` / `cordis` preset 按会话重新挂载。`examples/mcp-memory/` overlay 仍是默认关闭的互操作示例。[第三方记忆 MCP 示例 Agent Note](2026-07-31-third-party-memory-mcp-examples.md) 仍然拒绝把那些 overlay 做成官方产品；它并不拒绝这份第一方文件存储。

## 考虑过的替代方案

**把 MCP overlay 当作官方记忆产品。** 不予采纳，因为提供方 schema、账户和存储生命周期会变成 DSH 产品接口，而这正是第三方示例笔记已经拒绝的。

**由对话模型 `memory_write` 改写 `MEMORY.md`。** 不予采纳，因为主模型会在每个回合（包括闲聊）改写常驻手册，且没有宿主侧 JSON 门禁。

**向量数据库或 embedding 索引。** 不予采纳，因为产品是可检查的 markdown 手册加子串搜索，不是检索服务。

**Git 工作区、巩固子 agent、citation XML 或 SQLite lease。** 不予采纳，因为在单机上存储和召回常驻事实不需要这些额外机制。

**只有 JSONL 收件箱，手册以后再做。** 不予采纳，因为侧边栏会话需要在同一次交付中获得可读摘要和手册，而不是半成品日志。

## 后果

每个包含 `dsh-base` 的交付 profile 都会在 TUI 宿主平面注入记忆 HOWTO 和四个工具，Web 会话则从交付 preset 获得同样的工具。抽取/巩固可能在记住类回合或待处理笔记之后花费辅助 token。无密钥快照回放不会让 `purpose: 'memory'` 调用消耗对话脚本。用户可以检查并删除 `$DSH_HOME/memory` 与 `{cwd}/.dsh/memory` 下的 markdown。第三方 MCP 记忆 overlay 仍是选择启用且保持不变。没有设置页、向量搜索或对话模型手册编辑器。

## 相关

[第三方记忆 MCP 示例](2026-07-31-third-party-memory-mcp-examples.md) 负责默认关闭的提供方 overlay。本笔记负责那些 overlay 所不是的第一方文件存储。
