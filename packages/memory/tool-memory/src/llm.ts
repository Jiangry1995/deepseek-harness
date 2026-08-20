/**
 * Auxiliary JSON LLM call for memory extraction and consolidation.
 * @module @deepseek-ai/dsh-tool-memory/llm
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  BlockAssembler,
  createUserMessage,
  deepFreeze,
} from '@deepseek-ai/dsh-llm'
import type { FinishReason, GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-llm'
import { deadline } from '@deepseek-ai/dsh-timeout'
import type { ResolvedMemoryToolConfig } from './config.ts'

/** Timeout classification forwarded through `deadline`. */
const MEMORY_TIMEOUT_CODE = 'MEMORY_TIMEOUT'

/**
 * Run one `purpose: 'memory'` JSON completion and parse the object.
 * @param ctx - context exposing `ctx.llm`.
 * @param config - resolved tool-memory config.
 * @param agent - supplies route fallbacks and session id.
 * @param system - independent system prompt; not the conversation prompt.
 * @param user - JSON-framed user payload.
 * @param signal - pipeline abort signal.
 * @returns the parsed JSON object.
 */
export async function completeMemoryJson(
  ctx: Context,
  config: ResolvedMemoryToolConfig,
  agent: Agent,
  system: string,
  user: string,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  const route = resolveMemoryRoute(config, agent)
  const messages: Message[] = [createUserMessage({
    content: [{ type: 'text', text: user }],
    source: { kind: 'plugin', plugin: 'dsh-tool-memory' },
  })]
  using callDeadline = deadline(signal, config.timeoutMs, MEMORY_TIMEOUT_CODE)
  const options: GenerateOptions = deepFreeze({
    provider: route.provider,
    model: route.model,
    messages,
    system,
    maxTokens: config.maxOutputTokens,
    sessionId: agent.session.id,
    purpose: 'memory',
    signal: callDeadline.signal,
  })
  const assembler = new BlockAssembler()
  for await (const chunk of ctx.llm.stream(options)) {
    callDeadline.signal.throwIfAborted()
    assembler.push(chunk)
  }
  callDeadline.signal.throwIfAborted()
  const terminalError = finishError(assembler.finish)
  if (terminalError !== undefined) throw terminalError
  let text = ''
  for (const block of assembler.blocks()) {
    if (block.type === 'text') text += block.text
  }
  return parseJsonObject(text)
}

/**
 * Choose the auxiliary route: config pair, else last request header, else agent options.
 * @param config - resolved tool-memory config.
 * @param agent - live agent.
 * @returns provider and model.
 */
export function resolveMemoryRoute(
  config: ResolvedMemoryToolConfig,
  agent: Agent,
): { provider: string; model: string } {
  if (config.provider !== undefined && config.model !== undefined) {
    return { provider: config.provider, model: config.model }
  }
  const header = agent.session.requestHeader()?.config
  if (header !== undefined) return { provider: header.provider, model: header.model }
  if (agent.options.provider !== undefined && agent.options.model !== undefined
    && agent.options.provider.length > 0 && agent.options.model.length > 0) {
    return { provider: agent.options.provider, model: agent.options.model }
  }
  throw new Error('tool-memory: no provider/model available; set both config fields, route one request, or set both AgentOptions fields')
}

/**
 * Parse a JSON object from model text, accepting an optional fenced block.
 * @param text - model output.
 * @returns the parsed object.
 */
export function parseJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = (fenced?.[1] ?? trimmed).trim()
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('tool-memory: model output did not contain a JSON object')
  const parsed: unknown = JSON.parse(candidate.slice(start, end + 1))
  /* v8 ignore next 3 -- a `{...}` slice is a JSON object; null/array are unparseable here */
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('tool-memory: model JSON must be an object')
  }
  return parsed as Record<string, unknown>
}

/**
 * Translate a terminal finish reason into a failure, or nothing on `stop`.
 * @param finish - assembler finish reason (defaults to `stop` when the stream omitted one).
 * @returns an error when the call did not complete normally.
 */
function finishError(finish: FinishReason): Error | undefined {
  switch (finish.kind) {
    case 'stop':
      return undefined
    case 'error':
    case 'aborted': {
      const error = new Error(finish.failure.message) as Error & { code?: string }
      error.code = finish.failure.code
      return error
    }
    case 'max-tokens':
      return new Error('tool-memory: output reached maxOutputTokens')
    case 'tool-calls':
      return new Error('tool-memory: memory model unexpectedly requested a tool')
    default:
      return new Error(`tool-memory: unsupported finish reason "${String((finish as { kind?: unknown }).kind)}"`)
  }
}
