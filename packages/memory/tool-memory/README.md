# @deepseek-ai/dsh-tool-memory

English | [中文](README.zh.md)

Model-facing memory tools, standing HOWTO injection, and a background extract-then-consolidate pipeline over [`@deepseek-ai/dsh-memory`](../memory/README.md).

## Export shape

A function/namespace plugin: it exports `name` / `inject` / `apply` and NO default. A stray `export default` would collapse the module via the Loader's `unwrapExports` and drop `inject` (see [docs/postmortem/0001](../../../docs/postmortem/0001-acp-default-export-drops-inject.md)). `inject` is `['memory', 'tools', 'systemPrompt']`. The pipeline waits on `llm` and `agents` through `ctx.inject` so schema harvest can mount the tools without those services.

## Tools

`memory_search`, `memory_list`, and `memory_read` inspect user-level or project-level markdown. `memory_note` writes an inbox note only when the user explicitly asked to remember, forget, or change a stored fact. A non-agent caller is rejected. Project scope requires a session cwd. The model does not write `MEMORY.md`; the host writes handbook files from Phase-2 JSON.

## Prompt injection

Section `tool:memory` (order 108) always injects the HOWTO below, even when no memory files exist. Present `memory_summary.md` bodies follow, truncated per `maxSummaryChars`.

```
Persistent memory lives in markdown files on this machine. The thin summaries below are always in context; open a handbook or note with the memory tools when you need detail.
Use memory_search, memory_list, and memory_read to inspect user or project memory. Call memory_note only when the user explicitly asks to remember, forget, or change a stored fact. Do not write MEMORY.md yourself; a background job consolidates notes into the handbook.
AGENTS.md and other repository instruction files are not memory.
```

## Background pipeline

On a durable `turn/end` with `reason.kind === 'completed'`, and on `agent/session-start` catch-up, the plugin extracts then maybe consolidates. Subagent sessions and `delegationDepth > 0` are skipped. Non-completed turns advance the watermark without extraction. Abort leaves the watermark unchanged. Failures log on `ctx.logger` and do not abort the agent.

Phase 1 runs only when the turn has a remember/forget phrase or a tool call. Phase 2 runs when Phase 1 wrote content or pending notes exist. Auxiliary calls use `GenerateOptions.purpose: 'memory'` and independent system prompts, not the conversation prompt. Plugin-authored `user/message` events are omitted from the extraction transcript.

### Phase 1 system prompt

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

### Phase 2 system prompt

```
You consolidate memory notes and raw extractions into a durable markdown handbook.
Return ONLY a JSON object with keys noop, memory_md, memory_summary_md, skills.
noop is true when the handbook should not change.
memory_md is the complete MEMORY.md body when noop is false.
memory_summary_md is a thin always-in-context summary; the host stamps a v1 first line.
skills is an array of {name, content} SKILL.md files to write, or an empty array.
Preserve still-true facts, drop stale ones, and never copy secrets or one-off task noise.
```

## Configuration

| Key | Contract |
|---|---|
| `enabled` | Register tools, inject the prompt, and run extraction. Defaults to true. |
| `timeoutMs` | Positive end-to-end deadline for one auxiliary call; default 60000, capped by the runtime timer limit. |
| `maxTranscriptChars` | Positive character cap on one turn's extraction transcript. Default 80000. |
| `maxSummaryChars` | Positive character cap on each injected summary. Default 8000. |
| `maxOutputTokens` | Positive auxiliary generation token cap. Default 4000. |
| `provider`, `model` | Optional explicit route; both or neither as non-empty strings. Otherwise the last `request/header` or `AgentOptions` pair. |

## Model Experience

### Tool schema

#### What the model sees

The model sees the generated [`memory_search`](../../../docs/tool-catalog.md#deepseek-aidsh-tool-memory), `memory_list`, `memory_read`, and `memory_note` schemas.

#### Token effect

Fixed schema cost on every request where the tools are visible.

#### KV Cache effect

Prefix-stable while the definitions and visibility are unchanged. Plugin lifecycle or scoped restrictions may invalidate reuse from these schemas.

### Request context and condition

#### What the model sees

The standing HOWTO plus any truncated user/project `memory_summary.md`. Auxiliary extract/consolidate calls see only their independent system prompts and a JSON user payload; they are not conversation turns.

#### Token effect

Summary injection scales with file size up to `maxSummaryChars` per tree. Auxiliary calls consume tokens according to transcript or handbook input and `maxOutputTokens`. DeepSeek memory calls disable thinking; the main conversation retains its configured thinking mode.

#### KV Cache effect

The HOWTO prefix is reusable while summaries are unchanged. Auxiliary cache reuse is provider-specific and separate from the main request.

### Tool-call history and result

#### What the model sees

Search returns matching `path:line: text` lines or `No memory matches.` List returns `path (N bytes)` lines or `No memory files.` Read returns file text. Note success returns `Recorded memory note <path>.` Stable failures include `Error: memory tools require an owning agent session`, empty query/path/content errors, and `Error: memory project scope requires an agent working directory`.

#### Token effect

Result size follows the listed files, grep hits, or file body, each already capped by the store.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **The main conversation model does not edit `MEMORY.md`** — handbook writes are host-applied Phase-2 JSON only.
- **There is no git workspace, consolidator subagent, citation XML, or vector index** — those were rejected for this capability.
- **Side-panel sessions still rely on in-session `turn/end` and `agent/session-start` catch-up** — there is no separate memory UI or settings page.
