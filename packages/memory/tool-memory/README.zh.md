# @deepseek-ai/dsh-tool-memory

[English](README.md) | 中文

面向模型的记忆工具、常驻 HOWTO 注入，以及运行在 [`@deepseek-ai/dsh-memory`](../memory/README.md) 之上的后台抽取后巩固流水线。

## 导出形态

函数/命名空间插件：导出 `name` / `inject` / `apply`，且没有 default。多余的 `export default` 会经 Loader 的 `unwrapExports` 折叠模块并丢掉 `inject`（见 [docs/postmortem/0001](../../../docs/postmortem/0001-acp-default-export-drops-inject.md)）。`inject` 为 `['memory', 'tools', 'systemPrompt']`。流水线通过 `ctx.inject` 等待 `llm` 和 `agents`，以便 schema 收割可以在不挂载这些服务的情况下注册工具。

## 工具

`memory_search`、`memory_list` 和 `memory_read` 检查用户级或项目级 markdown。`memory_note` 仅在用户明确要求记住、忘掉或修改已存事实时写入收件箱笔记。非 agent（智能体）调用方会被拒绝。项目范围需要会话 cwd。模型不写 `MEMORY.md`；宿主根据 Phase-2 JSON 写入手册文件。

## 提示词注入

`tool:memory` 段落（order 108）即使还没有记忆文件，也会注入下面的 HOWTO。随后是已有的 `memory_summary.md` 正文，按 `maxSummaryChars` 截断。

```
Persistent memory lives in markdown files on this machine. The thin summaries below are always in context; open a handbook or note with the memory tools when you need detail.
Use memory_search, memory_list, and memory_read to inspect user or project memory. Call memory_note only when the user explicitly asks to remember, forget, or change a stored fact. Do not write MEMORY.md yourself; a background job consolidates notes into the handbook.
AGENTS.md and other repository instruction files are not memory.
```

## 后台流水线

在 `reason.kind === 'completed'` 的持久 `turn/end` 上，以及 `agent/session-start` 补抽时，插件会抽取并在需要时巩固。subagent 会话和 `delegationDepth > 0` 会被跳过。未完成的回合只推进水印，不抽取。中止时不改水印。失败只写入 `ctx.logger`，不会中止 agent。

仅当本回合含记住/忘掉类措辞或含工具调用时才运行 Phase 1。当 Phase 1 写出内容或存在待处理笔记时才运行 Phase 2。辅助调用使用 `GenerateOptions.purpose: 'memory'` 和独立系统提示词，而不是对话提示词。插件写入的 `user/message` 不会进入抽取转录。

### Phase 1 系统提示词

```
You extract durable personal or project facts from one completed assistant turn.
Return ONLY a JSON object with keys scope, raw_memory, rollout_summary, rollout_slug.
scope is "user" or "project". Use project only when the fact is tied to this working directory.
raw_memory is a short markdown fact, or an empty string when there is nothing to store.
rollout_summary is a short recap of this turn for later consolidation, or empty.
rollout_slug is a kebab-case filename slug, or empty.
Idle chat, secrets, one-off task details, and AGENTS.md instructions are not memory.
If nothing durable happened, return empty strings for the three text fields.
```

### Phase 2 系统提示词

```
You consolidate memory notes and raw extractions into a durable markdown handbook.
Return ONLY a JSON object with keys noop, memory_md, memory_summary_md, skills.
noop is true when the handbook should not change.
memory_md is the complete MEMORY.md body when noop is false.
memory_summary_md is a thin always-in-context summary; the host stamps a v1 first line.
skills is an array of {name, content} SKILL.md files to write, or an empty array.
Preserve still-true facts, drop stale ones, and never copy secrets or one-off task noise.
```

## 配置

| 键 | 约定 |
|---|---|
| `enabled` | 注册工具、注入提示词并运行抽取。默认 true。 |
| `timeoutMs` | 一次辅助调用的正数端到端截止时间；默认 60000，不超过运行时定时器上限。 |
| `maxTranscriptChars` | 一个回合抽取转录的正数字符上限。默认 80000。 |
| `maxSummaryChars` | 每份注入摘要的正数字符上限。默认 8000。 |
| `maxOutputTokens` | 辅助生成的正数 token 上限。默认 4000。 |
| `provider`, `model` | 可选显式路由；必须成对且为非空字符串。否则使用最近的 `request/header` 或 `AgentOptions` 对。 |

## 模型体验

### 工具 schema

#### 模型看到什么

模型看到生成的 [`memory_search`](../../../docs/tool-catalog.md#deepseek-aidsh-tool-memory)、`memory_list`、`memory_read` 和 `memory_note` schema。

#### Token 影响

工具可见时，每次请求都有固定 schema 成本。

#### KV Cache 影响

定义和可见性不变时前缀稳定。插件生命周期或作用域限制可能使这些 schema 无法复用。

### 请求上下文与条件

#### 模型看到什么

常驻 HOWTO，加上任何被截断的用户/项目 `memory_summary.md`。辅助抽取/巩固调用只看到各自的独立系统提示词和 JSON 用户载荷；它们不是对话回合。

#### Token 影响

摘要注入随文件大小增长，每棵树不超过 `maxSummaryChars`。辅助调用按转录或手册输入以及 `maxOutputTokens` 消耗 token。DeepSeek 的记忆调用会禁用思考；主对话保留其配置的思考模式。

#### KV Cache 影响

摘要不变时 HOWTO 前缀可复用。辅助缓存复用取决于提供方，且与主请求分离。

### 工具调用历史与结果

#### 模型看到什么

搜索返回匹配的 `path:line: text` 行或 `No memory matches.` 列举返回 `path (N bytes)` 行或 `No memory files.` 读取返回文件正文。笔记成功返回 `Recorded memory note <path>.` 稳定失败包括 `Error: memory tools require an owning agent session`、空 query/path/content 错误，以及 `Error: memory project scope requires an agent working directory`。

#### Token 影响

结果大小跟随已列出的文件、grep 命中或文件正文，且均已被存储层封顶。

#### KV Cache 影响

只追加；新可见内容接在可复用请求前缀之后，不会使已有 KV-cache 条目失效。

## 已知限制与延后工作

- **主对话模型不编辑 `MEMORY.md`** — 手册写入只通过宿主应用 Phase-2 JSON。
- **没有 git 工作区、巩固子 agent、citation XML 或向量索引** — 这些都被本能力明确排除。
- **侧边助手仍依赖会话内 `turn/end` 和 `agent/session-start` 补抽** — 没有单独的记忆 UI 或设置页。
