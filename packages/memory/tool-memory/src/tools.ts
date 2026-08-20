/**
 * Model-facing memory search, list, read, and inbox-note tools.
 * @module @deepseek-ai/dsh-tool-memory/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { MemoryScope } from '@deepseek-ai/dsh-memory'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, ToolCallKind } from '@deepseek-ai/dsh-tools'

const SCOPE_ENUM = ['user', 'project'] as const

/**
 * Register the four memory tools on `ctx.tools`.
 * @param ctx - context exposing the tool registry and `ctx.memory`.
 */
export function registerMemoryTools(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'memory_search',
    description: 'Search user-level or project-level memory markdown for a case-insensitive substring. Use this before answering from prior preferences or standing facts.',
    parameters: {
      query: { type: 'string', required: true, description: 'Case-insensitive substring to find.' },
      scope: {
        type: 'string',
        enum: [...SCOPE_ENUM],
        description: 'Which memory tree to search. Defaults to user. Project requires a working directory.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          hits: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                path: { type: 'string', required: true },
                line: { type: 'integer', required: true },
                text: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.hits.length === 0
          ? 'No memory matches.'
          : value.hits.map(hit => `${hit.path}:${String(hit.line)}: ${hit.text}`).join('\n'),
      }],
    },
    execute(args, exec) {
      const agent = requireAgent(exec.agent)
      const cwd = cwdOf(agent)
      const query = args.query.trim()
      if (query.length === 0) throw new Error('memory_search query must be a non-empty string')
      const scope = parseToolScope(args.scope, cwd)
      return ctx.memory.search(scope, query, cwd).then(hits => ({ hits }))
    },
    presentCall: args => presentMemoryCall('Search memory', args.query, 'search'),
  }))

  ctx.tools.register(defineTool({
    name: 'memory_list',
    description: 'List markdown files in user-level or project-level memory. Hidden host files such as state.json are not returned.',
    parameters: {
      scope: {
        type: 'string',
        enum: [...SCOPE_ENUM],
        description: 'Which memory tree to list. Defaults to user. Project requires a working directory.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          files: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                path: { type: 'string', required: true },
                bytes: { type: 'integer', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.files.length === 0
          ? 'No memory files.'
          : value.files.map(file => `${file.path} (${String(file.bytes)} bytes)`).join('\n'),
      }],
    },
    execute(args, exec) {
      const agent = requireAgent(exec.agent)
      const cwd = cwdOf(agent)
      const scope = parseToolScope(args.scope, cwd)
      return ctx.memory.list(scope, cwd).then(files => ({ files }))
    },
    presentCall: args => presentMemoryCall('List memory', args.scope ?? 'user', 'other'),
  }))

  ctx.tools.register(defineTool({
    name: 'memory_read',
    description: 'Read one memory markdown file by root-relative path. Use memory_list or memory_search to discover paths.',
    parameters: {
      path: { type: 'string', required: true, description: 'Root-relative POSIX path such as MEMORY.md or notes/….md.' },
      scope: {
        type: 'string',
        enum: [...SCOPE_ENUM],
        description: 'Which memory tree to read. Defaults to user. Project requires a working directory.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          content: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.content }],
    },
    execute(args, exec) {
      const agent = requireAgent(exec.agent)
      const cwd = cwdOf(agent)
      const relativePath = args.path.trim()
      if (relativePath.length === 0) throw new Error('memory_read path must be a non-empty relative path')
      const scope = parseToolScope(args.scope, cwd)
      return ctx.memory.read(scope, relativePath, cwd).then(content => ({ path: relativePath, content }))
    },
    presentCall: args => presentMemoryCall('Read memory', args.path, 'read'),
  }))

  ctx.tools.register(defineTool({
    name: 'memory_note',
    description: 'Write an inbox note only when the user explicitly asked to remember, forget, or change a stored fact. Do not call this for ordinary chat. A background job consolidates notes into MEMORY.md; do not edit the handbook yourself.',
    parameters: {
      content: { type: 'string', required: true, description: 'The fact to remember, or the instruction to forget or revise an existing fact.' },
      scope: {
        type: 'string',
        enum: [...SCOPE_ENUM],
        description: 'Which memory tree receives the note. Defaults to user. Project requires a working directory.',
      },
      slug: { type: 'string', description: 'Optional filename slug. Derived from content when omitted.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Recorded memory note ${value.path}.` }],
    },
    execute(args, exec) {
      const agent = requireAgent(exec.agent)
      const cwd = cwdOf(agent)
      const content = args.content.trim()
      if (content.length === 0) throw new Error('memory_note content must be a non-empty string')
      const scope = parseToolScope(args.scope, cwd)
      return ctx.memory.writeNote(scope, {
        content,
        ...args.slug !== undefined ? { slug: args.slug } : {},
      }, cwd).then(path => ({ path }))
    },
    presentCall: args => presentMemoryCall('Record memory note', args.content, 'other'),
  }))
}

/**
 * Reject a non-agent caller: memory files are scoped to the owning session cwd.
 * @param agent - execute-time agent, when any.
 * @returns the agent.
 */
function requireAgent(agent: Agent | undefined): Agent {
  if (agent === undefined) throw new Error('memory tools require an owning agent session')
  return agent
}

/**
 * Return the session working directory when it is a non-empty path.
 * @param agent - owning agent.
 * @returns cwd, or undefined.
 */
function cwdOf(agent: Agent): string | undefined {
  const cwd = agent.session.header.cwd
  return cwd !== undefined && cwd.length > 0 ? cwd : undefined
}

/**
 * Parse an optional scope argument, requiring cwd for `project`.
 * @param value - model-supplied scope, or omitted.
 * @param cwd - session working directory.
 * @returns a legal memory scope.
 */
function parseToolScope(value: string | undefined, cwd: string | undefined): MemoryScope {
  if (value === 'project') {
    if (cwd === undefined) throw new Error('memory project scope requires an agent working directory')
    return 'project'
  }
  return 'user'
}

/**
 * Pending-call card for a memory tool.
 * @param title - short card title.
 * @param rawInput - salient argument shown in the expanded view.
 * @param kind - presentation kind.
 * @returns a generic call view.
 */
function presentMemoryCall(title: string, rawInput: string, kind: ToolCallKind): GenericCallView {
  return { card: 'generic', title, kind, rawInput }
}
