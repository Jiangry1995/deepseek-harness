/** LLM-backed automatic image-to-text fallback. */

import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import {
  BlockAssembler,
  createUserMessage,
  deepFreeze,
  LlmError,
} from '@deepseek-ai/dsh-llm'
import type { ContentBlock, FinishReason, GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'
import {
  foldVisionTranscriptions,
  projectImageMessages,
  renderVisionFallbackText,
  VisionFallbackRequestId,
} from './events.ts'

/** Fully resolved configuration consumed by one auxiliary request. */
export interface ResolvedVisionFallbackConfig {
  readonly provider?: string
  readonly model?: string
  readonly maxTokens: number
  readonly timeoutMs: number
  readonly prompt: string
}

/** One operation another caller owns while peers wait for its durable result. */
interface InFlightTranscription {
  readonly settled: Promise<void>
  readonly resolve: () => void
}

/** Extract every direct or nested image reference in message order. */
function imageReferences(messages: readonly Message[]): ImageAttachmentRef[] {
  const images: ImageAttachmentRef[] = []
  for (const message of messages) collectImages(message.content, images)
  return images
}

/** Walk one content list, including nested tool results. */
function collectImages(content: readonly ContentBlock[], images: ImageAttachmentRef[]): void {
  for (const block of content) {
    if (block.type === 'image') {
      images.push(block.attachment)
      continue
    }
    if (block.type === 'tool-result') collectImages(block.content, images)
  }
}

/** Convert a terminal helper response into a stable failure when it is not complete. */
function finishError(finish: FinishReason): LlmError | undefined {
  switch (finish.kind) {
    case 'stop':
      return undefined
    case 'error':
    case 'aborted':
      return new LlmError(finish.failure.message, finish.failure.code, finish.failure)
    case 'max-tokens':
      return new LlmError(
        'vision fallback output reached maxTokens before the description completed',
        'VISION_FALLBACK_MAX_TOKENS',
      )
    case 'tool-calls':
      return new LlmError(
        'vision fallback model unexpectedly requested a tool',
        'VISION_FALLBACK_UNSUPPORTED_OUTPUT',
      )
    default:
      return new LlmError(
        `vision fallback received unsupported finish reason "${String((finish as { kind?: unknown }).kind)}"`,
        'VISION_FALLBACK_UNSUPPORTED_OUTPUT',
      )
  }
}

/** Build the error used when an aborting waiter leaves another owner's operation running. */
function abortError(signal: AbortSignal): Error {
  const timeout = timeoutOf(signal)
  if (timeout !== undefined) return timeout
  const reason: unknown = signal.reason
  return reason instanceof Error ? reason : new LlmError('vision fallback request aborted', 'ABORTED')
}

/** Await owned work while allowing this caller to abandon only its wait. */
function abortable(work: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (signal === undefined) return work
  if (signal.aborted) return Promise.reject(abortError(signal))
  const canceled = Promise.withResolvers<never>()
  const onAbort = (): void => { canceled.reject(abortError(signal)) }
  signal.addEventListener('abort', onAbort, { once: true })
  return Promise.race([work, canceled.promise])
    .finally(() => { signal.removeEventListener('abort', onAbort) })
}

/** Automatic image projection backed by one configured native visual model. */
export class VisionModelFallback {
  private readonly inFlight = new Map<string, InFlightTranscription>()

  /** Construct the provider around a live settings snapshot. */
  constructor(
    private readonly ctx: Context,
    private readonly config: () => ResolvedVisionFallbackConfig,
  ) {}

  /**
   * Report whether a complete native visual route is ready.
   * @param signal - cancellation for exact helper metadata resolution.
   * @returns true for a complete route that explicitly declares image input.
   */
  async available(signal?: AbortSignal): Promise<boolean> {
    signal?.throwIfAborted()
    const config = this.config()
    if (config.provider === undefined && config.model === undefined) return false
    if (config.provider === undefined || config.model === undefined) {
      throw new LlmError(
        'vision fallback requires provider and model together',
        'VISION_FALLBACK_CONFIG_INVALID',
      )
    }
    const info = await this.ctx.llm.resolveModelInfo(config.provider, config.model, signal)
    if (info.inputModalities === undefined || !info.inputModalities.includes('image')) {
      throw new LlmError(
        `vision fallback helper "${config.provider}/${config.model}" does not declare native image input`,
        'VISION_FALLBACK_MODEL_NOT_IMAGE_CAPABLE',
      )
    }
    return true
  }

  /**
   * Persist auxiliary transcriptions and return a text-only request projection.
   * @param options - image-bearing target request with a live session id.
   * @returns target messages with every image replaced by its durable text.
   */
  async project(options: GenerateOptions): Promise<Message[]> {
    if (options.sessionId === undefined) {
      throw new LlmError(
        'vision fallback requires a session id so auxiliary input and output can be logged',
        'VISION_FALLBACK_SESSION_REQUIRED',
      )
    }
    const session = this.ctx.sessions.get(options.sessionId)
    if (session === undefined) {
      throw new LlmError(
        `vision fallback cannot resolve live session "${String(options.sessionId)}"`,
        'VISION_FALLBACK_SESSION_REQUIRED',
      )
    }
    const unique = new Map(imageReferences(options.messages).map(image => [image.attachmentId, image]))
    for (const image of unique.values()) await this.ensureTranscription(session, image, options.signal)
    return projectImageMessages(options.messages, foldVisionTranscriptions(session.events))
  }

  /** Ensure one attachment has a completed durable result, retrying after another owner fails. */
  private async ensureTranscription(
    session: Session,
    attachment: ImageAttachmentRef,
    signal?: AbortSignal,
  ): Promise<void> {
    const key = `${String(session.id)}\n${String(attachment.attachmentId)}`
    while (!foldVisionTranscriptions(session.events).has(attachment.attachmentId)) {
      signal?.throwIfAborted()
      const active = this.inFlight.get(key)
      if (active !== undefined) {
        await abortable(active.settled, signal)
        continue
      }
      const gate = Promise.withResolvers<void>()
      this.inFlight.set(key, { settled: gate.promise, resolve: gate.resolve })
      try {
        await this.transcribe(session, attachment, signal)
      } finally {
        this.inFlight.delete(key)
        gate.resolve()
      }
    }
  }

  /** Run one logged auxiliary call and commit its exact text projection. */
  private async transcribe(
    session: Session,
    attachment: ImageAttachmentRef,
    signal?: AbortSignal,
  ): Promise<void> {
    const config = this.config()
    if (config.provider === undefined || config.model === undefined) {
      throw new LlmError('vision fallback is not configured', 'VISION_FALLBACK_CONFIG_INVALID')
    }
    using callDeadline = deadline(signal, config.timeoutMs, 'VISION_FALLBACK_TIMEOUT')
    const prepared = await this.ctx.llm.prepareCall({
      provider: config.provider,
      model: config.model,
      maxTokens: config.maxTokens,
    }, callDeadline.signal)
    const messages: Message[] = [createUserMessage({
      content: [
        { type: 'text', text: config.prompt },
        { type: 'image', attachment },
      ],
      source: { kind: 'plugin', plugin: 'llm-vision-fallback' },
    })]
    const requestId = VisionFallbackRequestId(crypto.randomUUID())
    session.append('vision/fallback-request', {
      requestId,
      attachment,
      route: { provider: prepared.config.provider, model: prepared.config.model },
      messages,
      maxTokens: prepared.config.maxTokens ?? config.maxTokens,
    })
    callDeadline.signal.throwIfAborted()
    const options: GenerateOptions = deepFreeze({
      ...prepared.config,
      messages,
      sessionId: session.id,
      purpose: 'image-transcription',
      signal: callDeadline.signal,
    })
    const assembler = new BlockAssembler()
    for await (const chunk of prepared.stream(options)) assembler.push(chunk)
    const timeout = timeoutOf(callDeadline.signal, 'VISION_FALLBACK_TIMEOUT')
    if (timeout !== undefined) {
      throw new LlmError(
        `vision fallback request timed out after ${config.timeoutMs}ms`,
        'VISION_FALLBACK_TIMEOUT',
        { cause: timeout },
      )
    }
    callDeadline.signal.throwIfAborted()
    const terminalError = finishError(assembler.finish)
    if (terminalError !== undefined) throw terminalError
    const blocks = assembler.blocks()
    if (blocks.some(block => block.type !== 'text' && block.type !== 'reasoning')) {
      throw new LlmError(
        'vision fallback model must return text only',
        'VISION_FALLBACK_UNSUPPORTED_OUTPUT',
      )
    }
    const description = blocks
      .filter((block): block is Extract<(typeof blocks)[number], { type: 'text' }> => block.type === 'text')
      .map(block => block.text)
      .join('\n')
      .trim()
    if (description.length === 0) {
      throw new LlmError('vision fallback model returned no text', 'VISION_FALLBACK_EMPTY_OUTPUT')
    }
    session.append('vision/fallback-result', {
      requestId,
      text: renderVisionFallbackText(attachment, description),
    })
  }
}
