// Settled-node identity prevents stream-delta updates from rerendering this row.
// Mounted on 'conversation.composer.dock' so it sticks with the composer in the
// active conversation scrollport (see ConversationRoot data-conversation-scroll).

import { Fragment, memo, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConversationSnapshot, UseProjection } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: merges the sessionStats key into SessionProjectionMap for useProjection.
import type {} from '@deepseek-ai/dsh-session-stats/client'
import type { ContextPressureProjection, TokenUsageProjection } from '@deepseek-ai/dsh-token-meter/client'
import type { ComposerBarProps } from '../contract/slots.ts'
import { formatTokensPerSecond } from './message-chrome.ts'
import { assistantStepReading } from './turn-metrics.ts'
import css from './StatsLine.module.css'

interface WindowStats {
  turns: number
  steps: number
  /** Summed request wall time (step/start → assistant/message); 0 when no node carries timing. */
  llmMs: number
  /** Summed tool wall time (tool/call → tool/result); 0 when no pair is in-window. */
  toolMs: number
  /** Summed first-token latency over `ttftSteps`; 0 when no step records it. */
  ttftMs: number
  /** Steps carrying a recorded TTFT. */
  ttftSteps: number
  /** Summed decode wall time over steps that also report output tokens. */
  decodeMs: number
  /** Summed output tokens over the same decode-timed steps. */
  decodeTokens: number
}

/**
 * Fold assistant and tool-result nodes into window-scoped display totals —
 * the FALLBACK for assemblies without the `sessionStats` projection.
 *
 * Every displayed figure rides that durable whole-log projection (and token
 * accounting rides `tokenUsage`) because the window is paged and compaction
 * rewrites it; this fold answers "what is on screen" only when no projection
 * value is served. Its field names deliberately mirror the projection's so
 * the two swap wholesale.
 * @param nodes - snapshot nodes.
 * @returns fallback counts and summed wall times.
 */
export function deriveStats(nodes: ConversationSnapshot['nodes']): WindowStats {
  const turns = new Set<number>()
  let steps = 0
  let llmMs = 0
  let toolMs = 0
  let ttftMs = 0
  let ttftSteps = 0
  let decodeMs = 0
  let decodeTokens = 0
  for (const node of nodes) {
    if (node.kind === 'tool-result') {
      if (node.callTime !== null) toolMs += Math.max(0, node.time - node.callTime)
      continue
    }
    if (node.kind !== 'assistant') continue
    turns.add(node.turn)
    steps += 1
    if (node.timing !== undefined && node.timing.stepStartTime !== null) {
      llmMs += Math.max(0, node.timing.completedTime - node.timing.stepStartTime)
    }
    const reading = assistantStepReading(node)
    if (reading.ttftMs !== null) {
      ttftMs += reading.ttftMs
      ttftSteps += 1
    }
    if (reading.decodeMs !== null && reading.outputTokens !== null) {
      decodeMs += reading.decodeMs
      decodeTokens += reading.outputTokens
    }
  }
  return { turns: turns.size, steps, llmMs, toolMs, ttftMs, ttftSteps, decodeMs, decodeTokens }
}

/**
 * Compact token count: 517 / 12.2K / 517K / 1.2M (one decimal under three digits).
 * @param n - token count.
 * @returns display string.
 */
export function formatTokens(n: number): string {
  const scaled = (v: number): string =>
    v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10)
  if (n < 1_000) return String(n)
  if (n < 1_000_000) return `${scaled(n / 1_000)}K`
  return `${scaled(n / 1_000_000)}M`
}

/**
 * Compact duration: 45.2s under a minute, 2m42s from there on.
 * @param ms - duration in milliseconds.
 * @returns display string.
 */
export function formatDuration(ms: number): string {
  const s = ms / 1_000
  if (s < 60) return `${Math.round(s * 10) / 10}s`
  const whole = Math.round(s)
  return `${Math.floor(whole / 60)}m${whole % 60}s`
}

/**
 * Cache-hit share of prompt-side input over the whole durable log.
 * @param usage - the session's token-usage projection value.
 * @returns rounded integer percent, or null when no input was billed.
 */
export function cacheHitPercent(usage: TokenUsageProjection): number | null {
  const denominator = billedInputTokens(usage)
  return denominator === 0
    ? null
    : Math.round(usage.cacheReadTokens / denominator * 100)
}

/**
 * Sum the three disjoint prompt-side billing buckets.
 * @param usage - the session's token-usage projection value.
 * @returns billed input tokens.
 */
export function billedInputTokens(usage: TokenUsageProjection): number {
  return usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
}

interface ContextOccupancy {
  percent: number
  usedTokens: number
  contextWindow: number
}

/**
 * Approximate context occupancy, using the TUI's integer rounding and upper
 * clamp. The numerator is `projectedTokens` — the provider sample carried
 * forward over the surface's movement since — so compaction shows immediately
 * instead of waiting for the next request to report usage; it falls back to the
 * bare sample only for a log whose projection predates that field. Numerator
 * and capacity remain independent last-wins projection fields, so this is a
 * reference figure rather than an exact measurement of one request (see the
 * token-meter README).
 * @param pressure - the session's context-pressure projection value.
 * @returns occupancy with its numerator and denominator, or null until both values are known.
 */
export function contextOccupancy(
  pressure: ContextPressureProjection | undefined,
): ContextOccupancy | null {
  const usedTokens = pressure?.projectedTokens ?? pressure?.pressureTokens
  if (usedTokens === undefined || pressure?.contextWindow === undefined) return null
  return {
    percent: Math.min(100, Math.round(usedTokens / pressure.contextWindow * 100)),
    usedTokens,
    contextWindow: pressure.contextWindow,
  }
}

/** Props: the conversation-snapshot selector plus the projection read seat. */
export interface StatsLineProps {
  useSession: SnapshotSelectorHook<ConversationSnapshot>
  useProjection: UseProjection
  /** The owning dock's locale seat. */
  t: ComposerBarProps['t']
}

/**
 * True only in the Chrome side-panel iframe. Desktop stats stay a single
 * ellipsis row; the plugin collapses timings behind an expand control.
 * @returns whether the current page tagged itself as the side panel.
 */
function isSidePanelSurface(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('dsh-surface') === 'side-panel'
}

/**
 * Join pipe-separated stats groups with the same separator the desktop row uses.
 * @param items - already-localized group strings, empty groups omitted by the caller.
 * @returns inline nodes for one stats row.
 */
function renderGroups(items: readonly string[]): ReactNode {
  return items.map((group, i) => (
    <Fragment key={group}>
      {i > 0 && <><span className={css.sep} aria-hidden="true">|</span>{' '}</>}
      <span>{group}</span>
    </Fragment>
  ))
}

export const StatsLine = memo(function StatsLine({ useSession, useProjection, t }: StatsLineProps) {
  const settledNodes = useSession(s => s.chat.legacy.nodes)
  const usage = useProjection('tokenUsage')
  // Every figure rides the durable sessionStats projection, so paging and
  // compaction cannot change any of them; an assembly without the unit falls
  // back to the window-scoped fold wholesale (same field names), paid only
  // while no projection value is served.
  const projected = useProjection('sessionStats')
  const stats = useMemo(() => projected ?? deriveStats(settledNodes), [projected, settledNodes])
  const compact = isSidePanelSurface()
  let counts: string | undefined
  const extra: string[] = []
  let tokens: string | undefined
  if (stats.steps > 0) {
    counts = t('stats.counts', { turns: stats.turns, steps: stats.steps })
    const durations: string[] = []
    if (stats.llmMs > 0) durations.push(t('stats.llm', { duration: formatDuration(stats.llmMs) }))
    if (stats.toolMs > 0) durations.push(t('stats.toolCall', { duration: formatDuration(stats.toolMs) }))
    if (durations.length > 0) extra.push(durations.join(' · '))
    const speeds: string[] = []
    if (stats.ttftSteps > 0) {
      speeds.push(t('stats.ttftAverage', { duration: formatDuration(stats.ttftMs / stats.ttftSteps) }))
    }
    if (stats.decodeMs > 0) {
      speeds.push(t('stats.tokensPerSecond', {
        throughput: formatTokensPerSecond(stats.decodeTokens / (stats.decodeMs / 1_000)),
      }))
    }
    if (speeds.length > 0) extra.push(speeds.join(' · '))
  }
  // Context occupancy deliberately lives on the composer's ContextMeter ring,
  // not here — one home per fact.
  // Billing rides the durable projection, so these survive paging and
  // compaction. Gated on actual token activity: a session whose steps all
  // settled without billing (e.g. every request failed) shows its counts
  // without a zero-token group.
  if (usage !== undefined
    && (billedInputTokens(usage) > 0 || usage.outputTokens > 0)) {
    const cacheHit = cacheHitPercent(usage)
    if (cacheHit !== null) extra.push(t('stats.cacheHit', { percent: cacheHit }))
    tokens = t('stats.tokens', {
      input: formatTokens(billedInputTokens(usage)),
      output: formatTokens(usage.outputTokens),
    })
  }
  const summary = [counts, tokens].filter((group): group is string => group !== undefined)
  const groups = [counts, ...extra, tokens].filter((group): group is string => group !== undefined)
  const line = groups.join(' | ')
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [truncated, setTruncated] = useState(false)
  useLayoutEffect(() => {
    const el = rootRef.current
    if (el === null) return
    const measure = () => { setTruncated(el.scrollWidth > el.clientWidth) }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => { observer.disconnect() }
  }, [line])
  if (groups.length === 0) return null

  if (compact) {
    return (
      <Tooltip
        label={line}
        side="top"
        delayMs={500}
        disabled={extra.length === 0}
        maxWidth={320}
      >
        <div className={css.root}>
          {renderGroups(summary)}
        </div>
      </Tooltip>
    )
  }

  // The row elides with ellipsis when overlong; a delayed hover tooltip carries
  // the full line, enabled only while content is actually clipped.
  return (
    <Tooltip label={line} side="top" delayMs={500} disabled={!truncated}>
      <div ref={rootRef} className={css.root}>
        {renderGroups(groups)}
      </div>
    </Tooltip>
  )
})
