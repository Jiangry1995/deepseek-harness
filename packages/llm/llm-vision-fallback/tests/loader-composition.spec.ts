/** Real Loader composition for the installable automatic vision fallback plugin. */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime, { createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import * as VisionFallback from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

/** Native visual helper used as the only nondeterministic dependency replacement. */
class VisualAdapter extends LlmAdapter {
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, inputModalities: ['text', 'image'] })
  }

  override async *stream(): AsyncIterable<StreamChunk> {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'A red status indicator.' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'A red status indicator.' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** Explicitly text-only target that records its model-visible request. */
class TextAdapter extends LlmAdapter {
  lastOptions: GenerateOptions | undefined

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, inputModalities: ['text'] })
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.lastOptions = options
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** Boot the plugin through Loader and Include with its real export namespace. */
async function loadComposition(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-vision-fallback-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-llm'",
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-llm-vision-fallback'",
    '  config:',
    '    provider: visual',
    '    model: vlm',
    '    maxTokens: 1024',
    '    timeoutMs: 30000',
    '    prompt: Describe every visible detail.',
    '',
  ].join('\n'))
  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-llm', LlmRuntime],
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-llm-vision-fallback', VisionFallback],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await ctx.loader.await()
  return ctx
}

describe('llm-vision-fallback real Loader composition', () => {
  it('keeps the main route text-only while persisting the auxiliary request and result', async () => {
    const ctx = await loadComposition()
    expect('default' in VisionFallback).toBe(false)
    const visual = new VisualAdapter()
    const text = new TextAdapter()
    ctx.llm.registerAdapter(['visual'], visual)
    ctx.llm.registerAdapter(['text'], text)
    const session = ctx.sessions.create()
    const attachment = {
      attachmentId: `sha256:${'b'.repeat(64)}` as never,
      mediaType: 'image/png' as const,
      bytes: 68,
      width: 1,
      height: 1,
    }
    const message = createUserMessage({
      content: [{ type: 'image', attachment }],
      source: { kind: 'user' },
    })
    session.append('user/message', message, { surfaceOp: 'append' })

    for await (const _chunk of ctx.llm.stream({
      provider: 'text',
      model: 'main',
      messages: session.deriveMessages(),
      sessionId: session.id,
    })) { /* drain */ }

    expect(text.lastOptions?.messages[0]?.content).toEqual([{
      type: 'text',
      text: VisionFallback.renderVisionFallbackText(attachment, 'A red status indicator.'),
    }])
    expect(text.lastOptions?.messages.some(item => item.content.some(block => block.type === 'image'))).toBe(false)
    expect(session.events.filter(event => event.type.startsWith('vision/fallback-')).map(event => event.type))
      .toEqual(['vision/fallback-request', 'vision/fallback-result'])
  }, 60_000)
})
