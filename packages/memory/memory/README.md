# @deepseek-ai/dsh-memory

English | [中文](README.zh.md)

The **`MemoryStore`** (`ctx.memory`) owns local markdown memory trees: a user-level root and an optional project-level directory under the agent working directory. Every relative path is resolved inside the selected root. Watermark, lock, and temp siblings stay invisible to tools.

This package is the file store. Model-facing tools, prompt injection, and the extract/consolidate job live in [`@deepseek-ai/dsh-tool-memory`](../tool-memory/README.md).

## Configuration

`userRoot` is required and must be a non-empty path. The shipped composition sets it to `$DSH_HOME/memory`. `projectDir` defaults to `.dsh/memory` and is resolved against the session cwd.

## Disk layout

Each root may contain `memory_summary.md` (first line `v1`), `MEMORY.md`, `raw_memories.md`, `session_summaries/`, `notes/`, `notes/processed/`, and `skills/<name>/SKILL.md`. `state.json` holds per-session watermarks and is not returned by list/search/read. Files are written `0o600` and directories `0o700` on platforms that honor mode.

## Service API (`ctx.memory`)

| Member | Semantics |
|---|---|
| `rootFor(scope, cwd?)` | Absolute root for `user` or `project`. Project requires a non-empty cwd. |
| `list(scope, cwd?)` | Visible files; a missing tree is empty. |
| `search(scope, query, cwd?)` | Case-insensitive substring grep with hit and line caps. |
| `read(scope, relativePath, cwd?)` | One visible file, truncated at the read cap. |
| `writeNote(scope, input, cwd?)` | Inbox note after secret redaction. |
| `listPendingNotes(scope, cwd?)` | Inbox paths not yet moved to `notes/processed`. |
| `markNotesProcessed(scope, relativePaths, cwd?)` | Archive inbox notes after a successful consolidate. |
| `appendRawMemory(scope, text, cwd?)` | Append one Phase-1 extraction block. |
| `writeSessionSummary(scope, slug, text, cwd?)` | Write `session_summaries/<slug>.md`. |
| `writeHandbook(scope, handbook, cwd?)` | Replace `MEMORY.md`, `memory_summary.md`, and optional skill files. |
| `readSummary(scope, cwd?)` | Async summary read; missing is empty. |
| `promptSummary(scope, cwd?)` | Synchronous summary read for prompt assembly. |
| `lastTurn(sessionId)` / `setLastTurn(sessionId, turn)` | User-root watermark for background extraction. |

Relative paths that are empty, contain NUL, name the root, or escape the root are rejected. Secret-shaped spans are replaced with `[redacted]` before write.

## Model Experience

Indirectly, through `dsh-tool-memory`.

#### KV Cache effect

No direct invalidation; the tool consumer owns prompt-section and schema prefix changes.

## Known Limitations and Deferred Work

- **There is no vector index or embedding search** — `search` is substring grep over markdown files.
- **Watermarks live only on the user root** — project trees do not carry `state.json`.
- **File modes are best-effort on Windows** — the store requests `0o600`/`0o700` and does not assert the resulting ACL.
