// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { stubSettingsScope, TestRemote, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { apply, inject, NS } from '../src/client/index.ts'
import { VisionFallbackSettingsTab } from '../src/client/VisionFallbackSettingsTab.tsx'
import type { VisionFallbackSettingsTabInjected } from '../src/client/VisionFallbackSettingsTab.tsx'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)

/** Build the minimal client services the browser plugin injects. */
async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  new TestRemote(ctx)
  const settings = stubSettingsScope()
  settings.publish({ status: 'ready', writable: true, value: {}, base: {}, user: {} })
  ctx.provide('settingsScope', { bind: () => settings.scope } as never)
  const models = vi.fn(() => Promise.resolve({
    rpcId: 'models' as never,
    result: { ok: true as const, value: { groups: [], failures: [] } },
  }))
  ctx.provide('connection', { api: { llm: { models } } } as never)
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, models }
}

/** Read the vision-fallback tab's injected controller. */
function injectedOf(slots: SlotRegistry): VisionFallbackSettingsTabInjected {
  const entry = slots.entries('settings.plugins.tab')[0]!
  return (entry.inject as unknown as () => VisionFallbackSettingsTabInjected)()
}

/** Declare the root Plugins tab list. */
function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.plugins.tab': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('ui-settings-vision-fallback browser plugin', () => {
  it('registers one localized, disposable Plugins tab without loading the catalog eagerly', async () => {
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    const entry = b.slots.entries('settings.plugins.tab')[0]!
    expect(entry.component).toBe(VisionFallbackSettingsTab)
    expect(entry.options).toMatchObject({ id: 'vision-fallback', order: 20 })
    expect(entry.locale).toBe(NS)
    expect(resolveSlotLabel(entry.options.label)).toBe('自动识图')
    expect(b.models).not.toHaveBeenCalled()

    b.locale.setLocale('en')
    expect(resolveSlotLabel(entry.options.label)).toBe('Automatic vision')
    await fiber.dispose()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)
    await b.ctx.fiber.dispose()
  })

  it('does not fetch the catalog on background invalidations before the tab loads', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    b.ctx.remote.$dispatch('settings/document-updated', ['llm-pi-ai', 1])
    b.ctx.remote.$dispatch('llm/adapters-updated', [])
    b.ctx.emit('connection/reset')
    expect(b.models).not.toHaveBeenCalled()
    await b.ctx.fiber.dispose()
  })

  it('refetches a loaded catalog when model profiles or adapters change', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    await injectedOf(b.slots).controller.loadCatalog()
    expect(b.models).toHaveBeenCalledOnce()

    b.ctx.remote.$dispatch('settings/document-updated', ['llm-pi-ai', 1])
    await vi.waitFor(() => { expect(b.models).toHaveBeenCalledTimes(2) })
    b.ctx.remote.$dispatch('llm/adapters-updated', [])
    await vi.waitFor(() => { expect(b.models).toHaveBeenCalledTimes(3) })
    b.ctx.emit('connection/reset')
    await vi.waitFor(() => { expect(b.models).toHaveBeenCalledTimes(4) })
    await b.ctx.fiber.dispose()
  })
})
