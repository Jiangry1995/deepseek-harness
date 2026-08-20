import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import MemoryStore from '@deepseek-ai/dsh-memory'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as ToolMemory from '@deepseek-ai/dsh-tool-memory'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/**
 * Boot a cordis.yml carrying memory + tool-memory.
 * @param extraLines - extra YAML lines after the tool-memory name row.
 * @returns the booted context.
 */
async function boot(extraLines: readonly string[]): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-memory-loader-'))
  const userRoot = join(root, 'user-memory')
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-memory'",
    '  config:',
    `    userRoot: ${JSON.stringify(userRoot)}`,
    "- name: '@deepseek-ai/dsh-tool-memory'",
    ...extraLines,
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-memory', MemoryStore],
    ['@deepseek-ai/dsh-tool-memory', ToolMemory],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return ctx
}

describe('tool-memory real Loader composition through cordis.yml', () => {
  it('registers the four memory tools by default', async () => {
    const ctx = await boot([])
    expect(ctx.tools.schemas().map(schema => schema.name).sort()).toEqual([
      'memory_list',
      'memory_note',
      'memory_read',
      'memory_search',
    ])
    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections.some(section => section.name === 'tool:memory')).toBe(true)
  }, 30_000)

  it('registers nothing when enabled is false', async () => {
    const ctx = await boot(['  config:', '    enabled: false'])
    expect(ctx.tools.schemas()).toEqual([])
  }, 30_000)
})
