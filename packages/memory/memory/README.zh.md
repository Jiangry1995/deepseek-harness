# @deepseek-ai/dsh-memory

[English](README.md) | 中文

**`MemoryStore`**（`ctx.memory`）拥有本机 markdown 记忆树：用户级根目录，以及 agent（智能体）工作目录下可选的项目级目录。每个相对路径都解析在所选根之内。水印、锁文件和临时同级文件对工具不可见。

本包是文件存储。面向模型的工具、提示词注入和抽取/巩固任务位于 [`@deepseek-ai/dsh-tool-memory`](../tool-memory/README.zh.md)。

## 配置

`userRoot` 必填，且必须是非空路径。交付组合将其设为 `$DSH_HOME/memory`。`projectDir` 默认为 `.dsh/memory`，相对会话 cwd 解析。

## 磁盘布局

每个根可以包含 `memory_summary.md`（首行 `v1`）、`MEMORY.md`、`raw_memories.md`、`session_summaries/`、`notes/`、`notes/processed/`，以及 `skills/<name>/SKILL.md`。`state.json` 保存按会话的水印，list/search/read 不会返回它。在尊重 mode 的平台上，文件以 `0o600` 写入，目录以 `0o700` 创建。

## 服务 API（`ctx.memory`）

| 成员 | 语义 |
|---|---|
| `rootFor(scope, cwd?)` | `user` 或 `project` 的绝对根。项目范围需要非空 cwd。 |
| `list(scope, cwd?)` | 可见文件；缺失的树视为空。 |
| `search(scope, query, cwd?)` | 带命中数和行长度上限的大小写不敏感子串 grep。 |
| `read(scope, relativePath, cwd?)` | 读取一个可见文件，超出读取上限时截断。 |
| `writeNote(scope, input, cwd?)` | 经密钥脱敏后的收件箱笔记。 |
| `listPendingNotes(scope, cwd?)` | 尚未移入 `notes/processed` 的收件箱路径。 |
| `markNotesProcessed(scope, relativePaths, cwd?)` | 巩固成功后归档收件箱笔记。 |
| `appendRawMemory(scope, text, cwd?)` | 追加一块 Phase-1 抽取结果。 |
| `writeSessionSummary(scope, slug, text, cwd?)` | 写入 `session_summaries/<slug>.md`。 |
| `writeHandbook(scope, handbook, cwd?)` | 替换 `MEMORY.md`、`memory_summary.md` 和可选 skill 文件。 |
| `readSummary(scope, cwd?)` | 异步读取摘要；缺失视为空。 |
| `promptSummary(scope, cwd?)` | 供提示词组装使用的同步摘要读取。 |
| `lastTurn(sessionId)` / `setLastTurn(sessionId, turn)` | 后台抽取使用的用户根水印。 |

空路径、含 NUL、指向根本身或逃出根的相对路径会被拒绝。写入前，凭证形态的片段会被替换为 `[redacted]`。

## 模型体验

间接通过 `dsh-tool-memory`。

#### KV Cache 影响

无直接失效；工具消费方拥有提示词段落和 schema 前缀变化。

## 已知限制与延后工作

- **没有向量索引或 embedding 搜索** — `search` 是对 markdown 文件的子串 grep。
- **水印只存在于用户根** — 项目树不携带 `state.json`。
- **Windows 上的文件 mode 是尽力而为** — 存储会请求 `0o600`/`0o700`，但不断言结果 ACL。
