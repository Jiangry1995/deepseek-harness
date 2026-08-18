import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, {
  CallId,
  createUserMessage,
  LlmAdapter,
  LlmError,
} from '@deepseek-ai/dsh-llm'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { GenerateOptions, LlmResolvedModelInfo, Message, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { VisionModelFallback } from '../src/fallback.ts'
import {
  DEFAULT_VISION_FALLBACK_MAX_TOKENS,
  DEFAULT_VISION_FALLBACK_PROMPT,
  DEFAULT_VISION_FALLBACK_TIMEOUT_MS,
  resolveVisionFallbackConfig,
} from '../src/config.ts'
import {
  foldVisionTranscriptions,
  projectImageMessages,
  renderVisionFallbackText,
  VisionFallbackRequestId,
} from '../src/events.ts'

const IMAGE: ImageAttachmentRef = {
  attachmentId: `sha256:${'a'.repeat(64)}` as never,
  mediaType: 'image/png',
  bytes: 68,
  width: 1,
  height: 1,
  name: 'frame.png',
}

/** Build the required request/result pair for one durable transcription. */
function transcriptionEvents(text: string): SessionEvent[] {
  const requestId = VisionFallbackRequestId('vision-request')
  return [{
    type: 'vision/fallback-request',
    seq: 0,
    time: 1,
    data: {
      requestId,
      attachment: IMAGE,
      route: { provider: 'visual', model: 'vlm' },
      messages: [createUserMessage({
        content: [
          { type: 'text', text: 'Describe the image.' },
          { type: 'image', attachment: IMAGE },
        ],
        source: { kind: 'plugin', plugin: 'llm-vision-fallback' },
      })],
      maxTokens: 1024,
    },
  }, {
    type: 'vision/fallback-result',
    seq: 1,
    time: 2,
    data: { requestId, text },
  }] as SessionEvent[]
}

describe('vision fallback durable projection', () => {
  it('joins a completed request/result pair by request id and attachment id', () => {
    const rendered = renderVisionFallbackText(IMAGE, 'A one-pixel red square.')
    const folded = foldVisionTranscriptions(transcriptionEvents(rendered))

    expect(folded.get(IMAGE.attachmentId)).toEqual({
      requestId: VisionFallbackRequestId('vision-request'),
      text: rendered,
    })
  })

  it('replaces direct and nested image blocks without changing message identity', () => {
    const rendered = renderVisionFallbackText(IMAGE, 'A one-pixel red square.')
    const transcripts = foldVisionTranscriptions(transcriptionEvents(rendered))
    const direct = createUserMessage({
      content: [{ type: 'text', text: 'Inspect this.' }, { type: 'image', attachment: IMAGE }],
      source: { kind: 'user' },
    })
    const nested = createUserMessage({
      content: [{
        type: 'tool-result',
        toolCallId: CallId('read-image'),
        content: [{ type: 'text', text: 'frame.png' }, { type: 'image', attachment: IMAGE }],
      }],
      source: { kind: 'tool', callId: CallId('read-image') },
    })

    const projected = projectImageMessages([direct, nested], transcripts)

    expect(projected[0]).toMatchObject({
      id: direct.id,
      content: [{ type: 'text', text: 'Inspect this.' }, { type: 'text', text: rendered }],
    })
    expect(projected[1]).toMatchObject({
      id: nested.id,
      content: [{
        type: 'tool-result',
        content: [{ type: 'text', text: 'frame.png' }, { type: 'text', text: rendered }],
      }],
    })
  })

  it('fails instead of dropping an image whose durable result is missing', () => {
    const messages: Message[] = [createUserMessage({
      content: [{ type: 'image', attachment: IMAGE }],
      source: { kind: 'user' },
    })]

    expect(() => projectImageMessages(messages, new Map())).toThrow(expect.objectContaining({
      code: 'VISION_FALLBACK_RESULT_MISSING',
    } satisfies Partial<LlmError>))
  })
})

describe('vision fallback configuration', () => {
  it('materializes bounded defaults while preserving a dormant route', () => {
    expect(resolveVisionFallbackConfig({})).toEqual({
      maxTokens: DEFAULT_VISION_FALLBACK_MAX_TOKENS,
      timeoutMs: DEFAULT_VISION_FALLBACK_TIMEOUT_MS,
      prompt: DEFAULT_VISION_FALLBACK_PROMPT,
    })
  })

  it('trims configured route and prompt fields and rejects invalid limits', () => {
    expect(resolveVisionFallbackConfig({
      provider: ' visual ',
      model: ' vlm ',
      maxTokens: 2048,
      timeoutMs: 60_000,
      prompt: ' Describe every visible detail. ',
    })).toEqual({
      provider: 'visual',
      model: 'vlm',
      maxTokens: 2048,
      timeoutMs: 60_000,
      prompt: 'Describe every visible detail.',
    })
    expect(() => resolveVisionFallbackConfig({ maxTokens: 0 })).toThrow(/maxTokens/)
    expect(() => resolveVisionFallbackConfig({ timeoutMs: 999 })).toThrow(/timeoutMs/)
    expect(() => resolveVisionFallbackConfig({ prompt: '   ' })).toThrow(/prompt/)
  })
})

/** Native visual adapter whose deterministic transcript makes request logging observable. */
class VisualAdapter extends LlmAdapter {
  calls = 0
  requestEventVisible = false

  constructor(private readonly sessionEvents: () => readonly SessionEvent[]) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, inputModalities: ['text', 'image'] })
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls += 1
    this.requestEventVisible = this.sessionEvents().some(event => event.type === 'vision/fallback-request')
    expect(options.purpose).toBe('image-transcription')
    expect(options.messages[0]?.content.some(block => block.type === 'image')).toBe(true)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'A one-pixel red square.' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'A one-pixel red square.' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

describe('VisionModelFallback', () => {
  it('logs before auxiliary dispatch, records the result, and reuses it for the same attachment', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(LlmRuntime)
    const session = ctx.sessions.create()
    const message = createUserMessage({
      content: [{ type: 'text', text: 'What is shown?' }, { type: 'image', attachment: IMAGE }],
      source: { kind: 'user' },
    })
    session.append('user/message', message, { surfaceOp: 'append' })
    const adapter = new VisualAdapter(() => session.events)
    ctx.llm.registerAdapter(['visual'], adapter)
    const fallback = new VisionModelFallback(ctx, () => ({
      provider: 'visual',
      model: 'vlm',
      maxTokens: 1024,
      timeoutMs: 30_000,
      prompt: 'Describe the image.',
    }))
    const options: GenerateOptions = {
      provider: 'text',
      model: 'main',
      messages: session.deriveMessages(),
      sessionId: session.id,
    }

    await expect(fallback.available()).resolves.toBe(true)
    const first = await fallback.project(options)
    const second = await fallback.project(options)

    expect(adapter.requestEventVisible).toBe(true)
    expect(adapter.calls).toBe(1)
    expect(session.events.filter(event => event.type === 'vision/fallback-request')).toHaveLength(1)
    expect(session.events.filter(event => event.type === 'vision/fallback-result')).toHaveLength(1)
    expect(first).toEqual(second)
    expect(first[0]?.content).toEqual([
      { type: 'text', text: 'What is shown?' },
      { type: 'text', text: renderVisionFallbackText(IMAGE, 'A one-pixel red square.') },
    ])
  })

  it('stays dormant without a complete route and refuses a configured non-visual helper', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(LlmRuntime)
    const dormant = new VisionModelFallback(ctx, () => ({
      maxTokens: 1024,
      timeoutMs: 30_000,
      prompt: 'Describe the image.',
    }))
    await expect(dormant.available()).resolves.toBe(false)

    const resolveModel = vi.fn((provider: string, model: string) => Promise.resolve({
      provider, id: model, name: model, inputModalities: ['text'] as const,
    }))
    ctx.llm.registerAdapter(['text-helper'], new class extends LlmAdapter {
      override resolveModel = resolveModel
      override stream(): AsyncIterable<StreamChunk> {
        throw new Error('unreachable')
      }
    }())
    const invalid = new VisionModelFallback(ctx, () => ({
      provider: 'text-helper',
      model: 'plain',
      maxTokens: 1024,
      timeoutMs: 30_000,
      prompt: 'Describe the image.',
    }))

    await expect(invalid.available()).rejects.toMatchObject({
      code: 'VISION_FALLBACK_MODEL_NOT_IMAGE_CAPABLE',
    })
    expect(resolveModel).toHaveBeenCalledOnce()
  })

  it('lets a waiter cancel without aborting the owner of the shared attachment work', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(LlmRuntime)
    const session = ctx.sessions.create()
    const message = createUserMessage({
      content: [{ type: 'image', attachment: IMAGE }],
      source: { kind: 'user' },
    })
    session.append('user/message', message, { surfaceOp: 'append' })
    const started = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    let calls = 0
    ctx.llm.registerAdapter(['visual'], new class extends LlmAdapter {
      override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
        return Promise.resolve({ provider, id: model, name: model, inputModalities: ['image'] })
      }

      override async *stream(): AsyncIterable<StreamChunk> {
        calls += 1
        started.resolve(undefined)
        await release.promise
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: 'shared result' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: 'shared result' } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }())
    const fallback = new VisionModelFallback(ctx, () => ({
      provider: 'visual',
      model: 'vlm',
      maxTokens: 1024,
      timeoutMs: 30_000,
      prompt: 'Describe the image.',
    }))
    const owner = fallback.project({
      provider: 'text', model: 'main', messages: session.deriveMessages(), sessionId: session.id,
    })
    await started.promise
    const waiterAbort = new AbortController()
    const waiter = fallback.project({
      provider: 'text',
      model: 'main',
      messages: session.deriveMessages(),
      sessionId: session.id,
      signal: waiterAbort.signal,
    })
    const reason = new Error('waiter canceled')
    waiterAbort.abort(reason)

    await expect(waiter).rejects.toBe(reason)
    release.resolve(undefined)
    await expect(owner).resolves.toHaveLength(1)
    expect(calls).toBe(1)
    expect(session.events.filter(event => event.type === 'vision/fallback-result')).toHaveLength(1)
  })

  it('rejects durable requests for unseen attachments and results without a request', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const unseen = ctx.sessions.create()
    const requestId = VisionFallbackRequestId('unseen')
    const requestData = {
      requestId,
      attachment: IMAGE,
      route: { provider: 'visual', model: 'vlm' },
      messages: [createUserMessage({
        content: [{ type: 'text', text: 'Describe.' }, { type: 'image', attachment: IMAGE }],
        source: { kind: 'plugin', plugin: 'llm-vision-fallback' },
      })],
      maxTokens: 1024,
    }

    expect(() => unseen.append('vision/fallback-request', requestData))
      .toThrow(/attachment.*does not precede/i)

    const orphan = ctx.sessions.create()
    expect(() => orphan.append('vision/fallback-result', { requestId, text: 'orphan' }))
      .toThrow(/no prior request/i)
  })
})
