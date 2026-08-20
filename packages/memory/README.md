# memory/ — local file memory

English | [中文](README.zh.md)

The first-party markdown memory capability. The store owns on-disk files; the tool consumer owns model-facing tools, prompt injection, and the background extract/consolidate job.

| Package | Role | ctx key |
|---|---|---|
| [`memory/`](memory/README.md) | User-level and project-level markdown files with path containment. | `ctx.memory` |
| [`tool-memory/`](tool-memory/README.md) | Search/list/read/note tools, standing HOWTO, extract-then-consolidate. | (registers on `ctx.tools`) |

This is host-local process memory, not a third-party memory MCP server. Overlay examples under [`examples/mcp-memory`](../../examples/mcp-memory) stay default-off and optional. The decision is recorded in [the first-party file memory Agent Note](../../.agents/notes/implemented/feature/2026-08-18-first-party-file-memory.md).
