# Agent Note: First-party file memory

Status: implemented

English | [中文](2026-08-18-first-party-file-memory.zh.md)

## Problem

Long-running assistants need durable personal and project facts that survive a turn, a session restart, and a side-panel that stays open. Third-party memory MCP overlays already exist as default-off examples, but they do not give DSH a first-party, inspectable, on-disk handbook the conversation model can search without adopting a vendor protocol. Putting that handbook behind MCP, a vector database, or a conversation-model `memory_write` of `MEMORY.md` either outsources the product or lets the main model rewrite standing memory unconstrained.

## Decision

Ship a first-party Cordis file-memory capability in `packages/memory/`: `@deepseek-ai/dsh-memory` (`ctx.memory`) for contained markdown trees, and `@deepseek-ai/dsh-tool-memory` for `memory_search` / `memory_list` / `memory_read` / `memory_note`, standing HOWTO injection, and a background extract-then-consolidate pipeline. The main conversation model does not edit `MEMORY.md`. Phase 1 extracts a JSON object; Phase 2 consolidates JSON; the host writes files. Auxiliary calls use `GenerateOptions.purpose: 'memory'`. The DeepSeek adapter disables thinking for that purpose.

User-level files live under `$DSH_HOME/memory`. Project-level files live under `{cwd}/.dsh/memory`. Each root may contain `memory_summary.md` (first line `v1`), `MEMORY.md`, `raw_memories.md`, `session_summaries/`, `notes/`, `notes/processed/`, and `skills/<name>/SKILL.md`. `state.json` is the user-root watermark and is hidden from tools. Relative paths cannot escape the selected root. Writes redact credential-shaped spans.

`memory_note` runs only when the user explicitly asks to remember, forget, or change a stored fact. Idle chat is a no-op. `AGENTS.md` is not memory. Phase 1 runs only when a completed turn has a remember/forget phrase or a tool call. Phase 2 runs when Phase 1 wrote content or pending notes exist. The same session's completed `turn/end` extracts immediately so a side panel that never restarts still updates. `agent/session-start` catches up completed turns after the watermark. Subagent sessions and `delegationDepth > 0` are skipped. Abort does not advance the watermark. Failures log and do not abort the agent. Plugin-authored `user/message` events are omitted from the extraction transcript. There is no new `SessionEventMap` memory event.

The shipped `dsh-base` bundle mounts the `memory` store with `userRoot: !!js dshHomePath('memory')` and host-plane `tool-memory` for the TUI. The Web overlay disables that host tool row; shipped `standard` / `code` / `cordis` presets remount it per session. `examples/mcp-memory/` overlays remain default-off interoperability examples. [The third-party memory MCP examples Agent Note](2026-07-31-third-party-memory-mcp-examples.md) still rejects turning those overlays into an official product; it does not reject this first-party file store.

## Alternatives considered

**MCP overlay as the official memory product.** Rejected because a vendor schema, account, and storage lifecycle would become DSH product surface, which the third-party examples note already refused.

**Conversation-model `memory_write` of `MEMORY.md`.** Rejected because the main model would rewrite the standing handbook on every turn, including idle chat, with no host-side JSON gate.

**Vector database or embedding index.** Rejected because the product is an inspectable markdown handbook with substring search, not a retrieval service.

**Git-backed workspace, consolidator subagent, citation XML, or SQLite lease.** Rejected as extra machinery that is not required to store and recall standing facts on one machine.

**JSONL inbox only, with handbook later.** Rejected because a side-panel session needs a readable summary and handbook in the same delivery, not a half-finished log.

## Consequences

Every shipped profile that includes `dsh-base` injects the memory HOWTO and four tools on the TUI host plane, and Web sessions receive the same tools from the shipped presets. Extract/consolidate may spend auxiliary tokens after remember-class turns or pending notes. Keyless snapshot replay does not consume conversation scripts for `purpose: 'memory'` calls. Users can inspect and delete markdown under `$DSH_HOME/memory` and `{cwd}/.dsh/memory`. Third-party MCP memory overlays remain opt-in and unchanged. There is no settings page, vector search, or conversation-model handbook editor.

## Related

[Third-party memory MCP examples](2026-07-31-third-party-memory-mcp-examples.md) own the default-off vendor overlays. This note owns the first-party file store those overlays are not.
