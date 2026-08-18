/** Package-owned vision fallback event invariants. */

import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type {} from './events.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-llm-vision-fallback'

/** Cordis companion plugin name. */
export const name = 'llm-vision-fallback-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Add every durable image reference nested in one block list. */
function collectImages(content: readonly ContentBlock[], images: Set<string>): void {
  for (const block of content) {
    if (block.type === 'image') {
      images.add(block.attachment.attachmentId)
      continue
    }
    if (block.type === 'tool-result') collectImages(block.content, images)
  }
}

/** Return the message carried by one core surface event. */
function eventMessage(event: SessionEvent): Message | undefined {
  switch (event.type) {
    case 'user/message':
      return event.data
    case 'assistant/message':
    case 'tool/result':
      return event.data.message
    default:
      return undefined
  }
}

/** Validate every fallback event relation in one ordered event list. */
function validateEvents(events: readonly SessionEvent[], fail: InvariantFailure): void {
  const images = new Set<string>()
  const requests = new Map<string, { attachmentId: string; completed: boolean }>()
  const completedAttachments = new Set<string>()
  for (const event of events) {
    const message = eventMessage(event)
    if (message !== undefined) collectImages(message.content, images)
    if (event.type === 'vision/fallback-request') {
      const data = event.data
      if (typeof data.requestId !== 'string' || data.requestId.length === 0) {
        fail('vision/fallback-request carries an empty requestId')
      }
      if (requests.has(data.requestId)) {
        fail(`vision/fallback-request repeats requestId "${String(data.requestId)}"`)
      }
      if (!images.has(data.attachment.attachmentId)) {
        fail(
          `vision/fallback-request attachment "${String(data.attachment.attachmentId)}" does not precede the request in model-visible history`,
        )
      }
      if (completedAttachments.has(data.attachment.attachmentId)) {
        fail(
          `vision/fallback-request attachment "${String(data.attachment.attachmentId)}" already has a completed result`,
        )
      }
      if (!Number.isSafeInteger(data.maxTokens) || data.maxTokens <= 0) {
        fail('vision/fallback-request maxTokens must be a positive safe integer')
      }
      if (data.route.provider.length === 0 || data.route.model.length === 0) {
        fail('vision/fallback-request route requires non-empty provider and model')
      }
      requests.set(data.requestId, { attachmentId: data.attachment.attachmentId, completed: false })
      continue
    }
    if (event.type !== 'vision/fallback-result') continue
    const request = requests.get(event.data.requestId)
    if (request === undefined) {
      fail(`vision/fallback-result requestId "${String(event.data.requestId)}" has no prior request`)
    }
    if (request.completed) {
      fail(`vision/fallback-result repeats completed requestId "${String(event.data.requestId)}"`)
    }
    if (completedAttachments.has(request.attachmentId)) {
      fail(`vision/fallback-result attachment "${request.attachmentId}" already has a completed result`)
    }
    if (typeof event.data.text !== 'string' || event.data.text.length === 0) {
      fail('vision/fallback-result text must be non-empty')
    }
    request.completed = true
    completedAttachments.add(request.attachmentId)
  }
}

/** Install validation for loaded sessions and every newly appended event. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  for (const session of ctx.sessions.list()) validateEvents(session.events, fail)
  ctx.on('session/created', (session) => { validateEvents(session.events, fail) }, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    const committed = session.events.at(-1) === event
      ? session.events
      : [...session.events, event]
    validateEvents(committed, fail)
  }, { global: true })
}, { inject: ['sessions'] })

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
