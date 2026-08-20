import { describe, expect, it } from 'vitest'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { CallId, createMessage, createUserMessage, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import { Config, resolveMemoryToolConfig } from '../src/config.ts'
import { parseJsonObject, resolveMemoryRoute } from '../src/llm.ts'
import { MEMORY_HOWTO, truncateSummary } from '../src/prompt.ts'
import { hasRememberPhrase } from '../src/signals.ts'
import { eventsForTurn, transcriptForTurn } from '../src/transcript.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'

describe('tool-memory config', () => {
  it('defaults limits and rejects invalid pairs', () => {
    const resolved = resolveMemoryToolConfig({})
    expect(resolved.enabled).toBe(true)
    expect(resolved.timeoutMs).toBe(60_000)
    expect(() => resolveMemoryToolConfig({ timeoutMs: 0 })).toThrow(/positive integer/)
    expect(() => resolveMemoryToolConfig({ timeoutMs: MAX_TIMER_DELAY_MS + 1 })).toThrow(/must not exceed/)
    expect(() => resolveMemoryToolConfig({ maxTranscriptChars: 0 })).toThrow(/positive integer/)
    expect(() => resolveMemoryToolConfig({ maxSummaryChars: 1.5 })).toThrow(/positive integer/)
    expect(() => resolveMemoryToolConfig({ provider: 'x' })).toThrow(/together/)
    expect(() => resolveMemoryToolConfig({ provider: '', model: 'm' })).toThrow(/non-empty/)
    expect(() => resolveMemoryToolConfig({ provider: 'p', model: '' })).toThrow(/non-empty/)
    expect(resolveMemoryToolConfig({ provider: 'p', model: 'm' })).toMatchObject({ provider: 'p', model: 'm' })
    expect(resolveMemoryToolConfig({ enabled: false }).enabled).toBe(false)
    expect(resolveMemoryToolConfig({
      timeoutMs: 10,
      maxTranscriptChars: 11,
      maxSummaryChars: 12,
      maxOutputTokens: 13,
    })).toMatchObject({
      timeoutMs: 10,
      maxTranscriptChars: 11,
      maxSummaryChars: 12,
      maxOutputTokens: 13,
    })
    expect(Config({ enabled: false })).toMatchObject({ enabled: false })
    expect(() => resolveMemoryToolConfig({ maxOutputTokens: 0 })).toThrow(/positive integer/)
  })
})

describe('tool-memory signals and prompt helpers', () => {
  it('detects remember/forget phrases and truncates summaries', () => {
    expect(hasRememberPhrase('请记住我喜欢绿茶')).toBe(true)
    expect(hasRememberPhrase("don't forget the badge")).toBe(true)
    expect(hasRememberPhrase('forget this later')).toBe(true)
    expect(hasRememberPhrase('from now on use pnpm')).toBe(true)
    expect(hasRememberPhrase('always use dark theme')).toBe(true)
    expect(hasRememberPhrase('remember this fallback')).toBe(true)
    expect(hasRememberPhrase('remember that badge')).toBe(true)
    expect(hasRememberPhrase('remember: tea')).toBe(true)
    expect(hasRememberPhrase('remember the fallback')).toBe(false)
    expect(hasRememberPhrase('下次用这个签名')).toBe(true)
    expect(hasRememberPhrase('hello there')).toBe(false)
    expect(truncateSummary('abcd', 10)).toBe('abcd')
    expect(truncateSummary('abcdefghij', 4)).toBe('abcd\n…(truncated)')
    expect(MEMORY_HOWTO).toContain('memory_note')
  })
})

describe('tool-memory JSON parse', () => {
  it('accepts a raw object, a fenced block, and rejects non-objects', () => {
    expect(parseJsonObject('{"a":1}')).toEqual({ a: 1 })
    expect(parseJsonObject('prefix ```json\n{"b":2}\n```')).toEqual({ b: 2 })
    expect(() => parseJsonObject('no object here')).toThrow(/did not contain a JSON object/)
    expect(() => parseJsonObject('[1]')).toThrow(/did not contain a JSON object/)
    expect(() => parseJsonObject('{nope}')).toThrow()
  })
})

describe('tool-memory route', () => {
  it('prefers config, then the request header, then agent options', () => {
    const session = Session.create(SessionId('route'))
    const agent = { session, options: {} } as unknown as Agent
    expect(() => resolveMemoryRoute({
      enabled: true, timeoutMs: 1, maxTranscriptChars: 1, maxSummaryChars: 1, maxOutputTokens: 1,
    }, agent)).toThrow(/no provider\/model/)
    const withEmpty = { session, options: { provider: '', model: '' } } as unknown as Agent
    expect(() => resolveMemoryRoute({
      enabled: true, timeoutMs: 1, maxTranscriptChars: 1, maxSummaryChars: 1, maxOutputTokens: 1,
    }, withEmpty)).toThrow(/no provider\/model/)
    const withOptions = { session, options: { provider: 'opt', model: 'om' } } as unknown as Agent
    expect(resolveMemoryRoute({
      enabled: true, timeoutMs: 1, maxTranscriptChars: 1, maxSummaryChars: 1, maxOutputTokens: 1,
    }, withOptions)).toEqual({ provider: 'opt', model: 'om' })
    session.append('request/header', {
      header: { config: { provider: 'hdr', model: 'hm' } },
      reason: 'initial',
    })
    expect(resolveMemoryRoute({
      enabled: true, timeoutMs: 1, maxTranscriptChars: 1, maxSummaryChars: 1, maxOutputTokens: 1,
    }, agent)).toEqual({ provider: 'hdr', model: 'hm' })
    expect(resolveMemoryRoute({
      enabled: true, timeoutMs: 1, maxTranscriptChars: 1, maxSummaryChars: 1, maxOutputTokens: 1,
      provider: 'cfg', model: 'cm',
    }, agent)).toEqual({ provider: 'cfg', model: 'cm' })
  })
})

describe('tool-memory transcript', () => {
  it('skips plugin injections, records tools, and truncates', () => {
    const session = Session.create(SessionId('turn'))
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'clock' }],
      source: { kind: 'plugin', plugin: 'time-context' },
    }), { surfaceOp: 'append' })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'remember my tea' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'noted' }],
        source: { kind: 'model', provider: 'mock', model: 'm' },
      }),
    }, { surfaceOp: 'append' })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '   ' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: '   ' }],
        source: { kind: 'model', provider: 'mock', model: 'm' },
      }),
    }, { surfaceOp: 'append' })
    session.append('tool/call', {
      turn: 1, step: 1, callId: CallId('c1'), name: 'memory_search', arguments: `{"query":"${'tea '.repeat(80)}"}`,
    })
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: CallId('c1'),
        content: [{ type: 'text', text: 'ok' }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: CallId('c2'),
        content: [{ type: 'text', text: '  ' }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'tool-result', toolCallId: CallId('c3') } as never],
        source: { kind: 'model', provider: 'mock', model: 'm' },
      }),
    }, { surfaceOp: 'append' })
    session.append('step/end', { turn: 1, step: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    session.append('turn/start', { turn: 2 })

    const transcript = transcriptForTurn(session, 1, 10_000)
    expect(transcript.userText).toBe('remember my tea')
    expect(transcript.hasToolCall).toBe(true)
    expect(transcript.text).toContain('user: remember my tea')
    expect(transcript.text).not.toContain('clock')
    expect(transcript.text).toMatch(/tool_call memory_search .+…/)
    expect(eventsForTurn(session.events, 9)).toEqual([])
    expect(eventsForTurn(session.events, 2)).toEqual([])
    expect(transcriptForTurn(session, 1, 12).text).toContain('truncated')
    expect(transcriptForTurn(session, 1, 10_000).text).toContain('tool_call memory_search')
    expect(transcriptForTurn(session, 1, 10_000).text).toContain('tool_result: ok')
  })
})
