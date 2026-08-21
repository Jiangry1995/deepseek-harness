/**
 * Background extract-then-consolidate pipeline. Failures log and never abort the agent.
 * @module @deepseek-ai/dsh-tool-memory/pipeline
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-llm'
import type { MemoryScope } from '@deepseek-ai/dsh-memory'
import { SESSION_SUMMARIES_DIR } from '@deepseek-ai/dsh-memory'
import type { Session, TurnEndReason } from '@deepseek-ai/dsh-session'
import type { ResolvedMemoryToolConfig } from './config.ts'
import { completeMemoryJson } from './llm.ts'
import { hasRememberPhrase } from './signals.ts'
import { transcriptForTurn } from './transcript.ts'

/** Independent Phase-1 system prompt. Not the conversation prompt. */
export const EXTRACTION_SYSTEM_PROMPT = [
  'You extract durable personal or project facts from one completed assistant turn.',
  'Return ONLY a JSON object with keys scope, raw_memory, rollout_summary, rollout_slug.',
  'scope is "user" or "project". Use project only when the fact is tied to this working directory.',
  'raw_memory is a short markdown fact, or an empty string when there is nothing to store.',
  'rollout_summary is a short recap of this turn for later consolidation, or empty.',
  'rollout_slug is a kebab-case filename slug, or empty.',
  'Idle chat, secrets, one-off task details, and AGENTS.md instructions are not memory.',
  'If nothing durable happened, return empty strings for the three text fields.',
].join('\n')

/** Independent Phase-2 system prompt. The host writes files from the JSON. */
export const CONSOLIDATION_SYSTEM_PROMPT = [
  'You consolidate memory notes and raw extractions into a durable markdown handbook.',
  'Return ONLY a JSON object with keys noop, memory_md, memory_summary_md, skills.',
  'noop is true when the handbook should not change.',
  'memory_md is the complete MEMORY.md body when noop is false.',
  'memory_summary_md is a thin always-in-context summary; the host stamps a v1 first line.',
  'skills is an array of {name, content} SKILL.md files to write, or an empty array.',
  'Preserve still-true facts, drop stale ones, and never copy secrets or one-off task noise.',
].join('\n')

/**
 * Bind the background extract/consolidate pipeline onto a context that already
 * has `memory`, `llm`, and `agents`. Aborts in-flight work when the fiber disposes.
 * @param ctx - runtime context.
 * @param config - resolved tool-memory config.
 * @returns the pipeline instance (tests wait on `whenIdle()`).
 */
export function startMemoryPipeline(ctx: Context, config: ResolvedMemoryToolConfig): MemoryPipeline {
  const controller = new AbortController()
  const pipeline = new MemoryPipeline(ctx, config, controller.signal)
  ctx.effect(() => () =>{  controller.abort() })
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'turn/end') return
    const agent = ctx.agents.get(session.id)
    if (agent === undefined) return
    pipeline.onTurnEnd(agent, event.data.turn, event.data.reason)
  })
  ctx.on('agent/session-start', ({ agent }) => {
    pipeline.catchUp(agent)
  })
  return pipeline
}

/**
 * Serial per-session extract/consolidate runner.
 */
export class MemoryPipeline {
  private readonly tails = new Map<string, Promise<void>>()

  /**
   * @param ctx - context with memory, llm, and logger.
   * @param config - resolved tool-memory config.
   * @param signal - aborted when the plugin fiber disposes.
   */
  constructor(
    private readonly ctx: Context,
    private readonly config: ResolvedMemoryToolConfig,
    private readonly signal: AbortSignal,
  ) {}

  /**
   * Queue work for one session so overlapping turn/end and session-start jobs serialize.
   * @param sessionId - session identity.
   * @param work - async job.
   */
  enqueue(sessionId: string, work: () => Promise<void>): void {
    const previous = this.tails.get(sessionId) ?? Promise.resolve()
    const next = previous.then(work, work)
    this.tails.set(sessionId, next)
    void next.catch((error: unknown) => {
      if (this.signal.aborted) return
      this.ctx.logger.warn('tool-memory: background pipeline failed')
      this.ctx.logger.warn(error)
    })
  }

  /**
   * Handle a durable `turn/end`. Non-completed turns only advance the watermark.
   * @param agent - root agent that owns the session.
   * @param turn - turn number.
   * @param reason - turn-end reason.
   */
  onTurnEnd(agent: Agent, turn: number, reason: TurnEndReason): void {
    if (this.skipAgent(agent)) return
    this.enqueue(String(agent.session.id), () => this.processTurn(agent, turn, reason.kind === 'completed'))
  }

  /**
   * Catch up completed turns after the watermark when a session starts.
   * @param agent - newly started root agent.
   */
  catchUp(agent: Agent): void {
    if (this.skipAgent(agent)) return
    this.enqueue(String(agent.session.id), () => this.processCatchUp(agent))
  }

  /**
   * Skip subagent and nested-delegation sessions.
   * @param agent - candidate agent.
   * @returns true when this pipeline must not run.
   */
  skipAgent(agent: Agent): boolean {
    const header = agent.session.header
    return header.origin === 'subagent' || (header.delegationDepth ?? 0) > 0
  }

  /**
   * Drain queued work for tests, including jobs that logged a failure.
   * @returns a promise that settles when every known session queue is idle.
   */
  whenIdle(): Promise<void> {
    return Promise.all(
      [...this.tails.values()].map(task => task.then(() => undefined, () => undefined)),
    ).then(() => undefined)
  }

  /**
   * Process every completed turn after the stored watermark.
   * @param agent - live agent.
   */
  private async processCatchUp(agent: Agent): Promise<void> {
    const lastTurn = await this.ctx.memory.lastTurn(String(agent.session.id))
    const pending = completedTurnsAfter(agent.session, lastTurn)
    for (const turn of pending) {
      this.signal.throwIfAborted()
      await this.processTurn(agent, turn, true)
    }
  }

  /**
   * Extract and maybe consolidate one numbered turn, then advance the watermark.
   * Abort leaves the watermark unchanged so a later load can retry.
   * @param agent - live agent.
   * @param turn - turn number.
   * @param extract - whether to run Phase 1 on this turn.
   */
  private async processTurn(agent: Agent, turn: number, extract: boolean): Promise<void> {
    const lastTurn = await this.ctx.memory.lastTurn(String(agent.session.id))
    if (turn <= lastTurn) return
    try {
      if (extract) await this.extractAndConsolidate(agent, turn)
    } finally {
      if (!this.signal.aborted) await this.ctx.memory.setLastTurn(String(agent.session.id), turn)
    }
  }

  /**
   * Run the gated two-phase job for one completed turn.
   * @param agent - live agent.
   * @param turn - turn number.
   */
  private async extractAndConsolidate(agent: Agent, turn: number): Promise<void> {
    const cwd = agent.session.header.cwd
    const transcript = transcriptForTurn(agent.session, turn, this.config.maxTranscriptChars)
    const pendingUser = await this.ctx.memory.listPendingNotes('user')
    const pendingProject = cwd === undefined ? [] : await this.ctx.memory.listPendingNotes('project', cwd)
    const pending = pendingUser.length + pendingProject.length
    const shouldExtract = transcript.hasToolCall || hasRememberPhrase(transcript.userText)
    let wroteRaw = false
    if (shouldExtract) {
      wroteRaw = await this.runExtraction(agent, transcript.text, cwd)
    }
    if (wroteRaw || pending > 0) {
      await this.runConsolidation(agent, cwd)
    }
  }

  /**
   * Call Phase 1 and persist any returned raw memory / session summary.
   * @param agent - live agent.
   * @param transcript - compact turn text.
   * @param cwd - project cwd, when any.
   * @returns true when a raw memory or session summary was written.
   */
  private async runExtraction(agent: Agent, transcript: string, cwd: string | undefined): Promise<boolean> {
    const parsed = await completeMemoryJson(
      this.ctx,
      this.config,
      agent,
      EXTRACTION_SYSTEM_PROMPT,
      JSON.stringify({ transcript, hasProject: cwd !== undefined }),
      this.signal,
    )
    const rawMemory = stringField(parsed, 'raw_memory')
    const rolloutSummary = stringField(parsed, 'rollout_summary')
    const rolloutSlug = stringField(parsed, 'rollout_slug')
    const scope = parseScope(parsed.scope, cwd)
    if (rawMemory.length === 0 && rolloutSummary.length === 0) return false
    if (rawMemory.length > 0) await this.ctx.memory.appendRawMemory(scope, rawMemory, cwd)
    if (rolloutSummary.length > 0) {
      await this.ctx.memory.writeSessionSummary(scope, rolloutSlug.length > 0 ? rolloutSlug : 'turn', rolloutSummary, cwd)
    }
    return true
  }

  /**
   * Call Phase 2 and write handbook files when the model does not no-op.
   * @param agent - live agent.
   * @param cwd - project cwd, when any.
   */
  private async runConsolidation(agent: Agent, cwd: string | undefined): Promise<void> {
    const scopes: MemoryScope[] = cwd === undefined ? ['user'] : ['user', 'project']
    for (const scope of scopes) {
      const pending = await this.ctx.memory.listPendingNotes(scope, cwd)
      const handbook = await readOptionalMemoryFile(this.ctx, scope, 'MEMORY.md', cwd)
      const raw = await readOptionalMemoryFile(this.ctx, scope, 'raw_memories.md', cwd)
      const notes = []
      for (const path of pending) {
        notes.push({ path, content: await this.ctx.memory.read(scope, path, cwd) })
      }
      const summaryFiles = (await this.ctx.memory.list(scope, cwd))
        .filter(entry => entry.path.startsWith(`${SESSION_SUMMARIES_DIR}/`))
      const summaries = []
      for (const file of summaryFiles) {
        summaries.push({ path: file.path, content: await this.ctx.memory.read(scope, file.path, cwd) })
      }
      if (pending.length === 0 && raw.length === 0 && summaries.length === 0) continue
      const parsed = await completeMemoryJson(
        this.ctx,
        this.config,
        agent,
        CONSOLIDATION_SYSTEM_PROMPT,
        JSON.stringify({ scope, handbook, raw_memories: raw, notes, session_summaries: summaries }),
        this.signal,
      )
      if (parsed.noop === true) continue
      const memoryMd = stringField(parsed, 'memory_md')
      const memorySummaryMd = stringField(parsed, 'memory_summary_md')
      if (memoryMd.length === 0 || memorySummaryMd.length === 0) continue
      const skills = parseSkills(parsed.skills)
      await this.ctx.memory.writeHandbook(scope, {
        memoryMd,
        memorySummaryMd,
        ...skills !== undefined ? { skills } : {},
      }, cwd)
      if (pending.length > 0) await this.ctx.memory.markNotesProcessed(scope, pending, cwd)
    }
  }
}

/**
 * Read a visible memory file, treating a missing path as empty.
 * @param ctx - context exposing `ctx.memory`.
 * @param scope - user-level or project-level tree.
 * @param relativePath - root-relative path.
 * @param cwd - project cwd when `scope` is `project`.
 * @returns file text, or an empty string when the file is absent.
 */
async function readOptionalMemoryFile(
  ctx: Context,
  scope: MemoryScope,
  relativePath: string,
  cwd: string | undefined,
): Promise<string> {
  try {
    return await ctx.memory.read(scope, relativePath, cwd)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('memory file not found:')) return ''
    throw error
  }
}

/**
 * Completed turn numbers after `lastTurn`, in order.
 * @param session - session log.
 * @param lastTurn - watermark.
 * @returns turn numbers.
 */
export function completedTurnsAfter(session: Session, lastTurn: number): number[] {
  const turns: number[] = []
  for (const event of session.events) {
    if (event.type !== 'turn/end') continue
    if (event.data.reason.kind !== 'completed') continue
    if (event.data.turn > lastTurn) turns.push(event.data.turn)
  }
  return turns
}

/**
 * Read a string field, defaulting missing values to empty.
 * @param record - parsed JSON object.
 * @param key - field name.
 * @returns a trimmed string.
 */
function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new Error(`tool-memory: ${key} must be a string`)
  return value.trim()
}

/**
 * Parse a scope field, forcing user when no project cwd exists.
 * @param value - JSON value.
 * @param cwd - project cwd.
 * @returns a legal scope.
 */
function parseScope(value: unknown, cwd: string | undefined): MemoryScope {
  if (value === 'project') {
    if (cwd === undefined) return 'user'
    return 'project'
  }
  return 'user'
}

/**
 * Parse optional skill files from consolidation JSON.
 * @param value - JSON value.
 * @returns skill files, or undefined when absent/empty.
 */
function parseSkills(value: unknown): { name: string; content: string }[] | undefined {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) throw new Error('tool-memory: skills must be an array')
  const skills: { name: string; content: string }[] = []
  for (const item of value) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('tool-memory: each skill must be an object')
    }
    const record = item as { name?: unknown; content?: unknown }
    if (typeof record.name !== 'string' || typeof record.content !== 'string') {
      throw new Error('tool-memory: each skill needs string name and content')
    }
    skills.push({ name: record.name, content: record.content })
  }
  return skills.length > 0 ? skills : undefined
}
