/**
 * ui-web browser half on a real SlotRegistry: the plugin occupies
 * conversation.input.left with the networking chip; the injected face
 * executes /web or /web off; teardown empties the seat (HMR safety).
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { WebChip } from '../src/client/WebNetworkingControl.tsx'
import type { WebChipInjected } from '../src/client/index.ts'
import { apply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'

const SID = 's-web' as SessionId

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: { 'conversation.input.left': { kind: 'list', scope: 'session' } },
  } as never, () => null)
  const execute = vi.fn((_sessionId: SessionId, _line: string) =>
    Promise.resolve({ ok: true, value: { commandId: 'c1', result: { kind: 'success' as const } } }))
  const commandsRemote = { execute }
  ctx.provide('remote', { commands: commandsRemote })
  ctx.provide('remote.commands', commandsRemote)
  ctx.provide('locale', new LocaleRuntime(ctx))
  return { ctx, slots, execute }
}

describe('ui-web browser apply', () => {
  it('declares every service it binds', () => {
    expect(inject).toEqual(['slots', 'remote', 'remote.commands', 'locale'])
  })

  it('node-half apply is an intentional no-op', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })

  it('registers the chip, executes /web lines, and unregisters on teardown', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const entry = b.slots.entries('conversation.input.left')[0]!
    expect(entry.component).toBe(WebChip)
    const injected = (entry.inject as unknown as (id: SessionId) => WebChipInjected)(SID)

    await expect(injected.setWebNetworking(true)).resolves.toBeNull()
    expect(b.execute).toHaveBeenLastCalledWith(SID, '/web')

    await expect(injected.setWebNetworking(false)).resolves.toBeNull()
    expect(b.execute).toHaveBeenLastCalledWith(SID, '/web off')

    b.execute.mockResolvedValueOnce({
      ok: false,
      error: { code: 'session-not-found', message: 'gone', details: {} },
    } as never)
    await expect(injected.setWebNetworking(false)).resolves.toBe('gone (session-not-found)')

    b.execute.mockResolvedValueOnce({ ok: true, value: undefined } as never)
    await expect(injected.setWebNetworking(true)).resolves.toBe('unknown command: /web')

    await fiber.dispose()
    expect(b.slots.entries('conversation.input.left')).toHaveLength(0)
  })
})
