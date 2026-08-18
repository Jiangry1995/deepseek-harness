import { describe, expect, it, vi } from 'vitest'
import { stubSettingsScope, type StubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import {
  VisionFallbackSettingsController,
  type VisionFallbackSettings,
} from '../src/client/controller.ts'

/** Make the settings stub publish every accepted field write. */
function acceptWrites(host: StubSettingsScope<VisionFallbackSettings>): void {
  host.set.mockImplementation((field: string, value: unknown) => {
    const snapshot = host.scope.getSnapshot()
    host.publish({
      value: { ...snapshot.value, [field]: value },
      user: { ...snapshot.user as object, [field]: value },
    })
  })
  host.unset.mockImplementation((field: string) => {
    const snapshot = host.scope.getSnapshot()
    const value = Object.fromEntries(
      Object.entries(snapshot.value ?? {}).filter(([key]) => key !== field),
    )
    host.publish({ value, user: {} })
  })
}

/** Host catalog with two visual models and one explicitly text-only model. */
function catalogApi() {
  const models = vi.fn(() => Promise.resolve({
    rpcId: 'models' as never,
    result: {
      ok: true as const,
      value: {
        groups: [{
          id: 'visual-a',
          name: 'Visual A',
          models: [
            { id: 'vision-a', name: 'Vision A', inputModalities: ['text', 'image'] as const },
            { id: 'text-a', name: 'Text A', inputModalities: ['text'] as const },
          ],
        }, {
          id: 'visual-b',
          name: 'Visual B',
          models: [{ id: 'vision-b', name: 'Vision B', inputModalities: ['image'] as const }],
        }],
        failures: [{ id: 'broken', name: 'Broken', message: 'offline' }],
      },
    },
  }))
  return { api: { llm: { models } } as never, models }
}

/** Ready settings scope with the schema-resolved defaults materialized. */
function readyScope() {
  const host = stubSettingsScope<VisionFallbackSettings>()
  host.publish({
    status: 'ready',
    writable: true,
    value: {
      provider: 'visual-a',
      model: 'vision-a',
      maxTokens: 4096,
      timeoutMs: 120_000,
      prompt: 'Describe the image.',
    },
    base: { maxTokens: 4096, timeoutMs: 120_000, prompt: 'Describe the image.' },
    user: { provider: 'visual-a', model: 'vision-a' },
  })
  return host
}

describe('VisionFallbackSettingsController', () => {
  it('filters the catalog to explicit visual models and retains provider failures', async () => {
    const host = readyScope()
    const api = catalogApi()
    const controller = new VisionFallbackSettingsController(host.scope, api.api)

    await controller.loadCatalog()

    expect(controller.store.getSnapshot()).toMatchObject({
      catalogStatus: 'ready',
      provider: 'visual-a',
      model: 'vision-a',
      configured: true,
      providers: [{
        id: 'visual-a',
        models: [{ id: 'vision-a', name: 'Vision A' }],
      }, {
        id: 'visual-b',
        models: [{ id: 'vision-b', name: 'Vision B' }],
      }],
      failures: [{ id: 'broken', name: 'Broken', message: 'offline' }],
    })
    expect(api.models).toHaveBeenCalledOnce()
  })

  it('refetches a previously loaded catalog and ignores invalidations before first load', async () => {
    const host = readyScope()
    const api = catalogApi()
    const controller = new VisionFallbackSettingsController(host.scope, api.api)

    controller.refreshCatalogIfLoaded()
    expect(api.models).not.toHaveBeenCalled()

    await controller.loadCatalog()
    expect(api.models).toHaveBeenCalledOnce()
    controller.refreshCatalogIfLoaded()
    await vi.waitFor(() => { expect(api.models).toHaveBeenCalledTimes(2) })
  })

  it('resets the model when provider changes and saves the complete staged route', async () => {
    const host = readyScope()
    acceptWrites(host)
    const controller = new VisionFallbackSettingsController(host.scope, catalogApi().api)

    controller.edit('provider', 'visual-b')
    expect(controller.store.getSnapshot()).toMatchObject({ model: '', dirty: true, invalid: true })
    controller.edit('model', 'vision-b')
    await controller.save()

    expect(host.set.mock.calls).toEqual([
      ['provider', 'visual-b'],
      ['model', 'vision-b'],
    ])
    expect(controller.store.getSnapshot()).toMatchObject({
      provider: 'visual-b',
      model: 'vision-b',
      dirty: false,
      invalid: false,
      saveFailed: false,
    })
  })

  it('blocks malformed numeric drafts and restores the Host snapshot on discard', () => {
    const host = readyScope()
    const controller = new VisionFallbackSettingsController(host.scope, catalogApi().api)

    controller.edit('timeoutMs', '999')
    expect(controller.store.getSnapshot()).toMatchObject({ dirty: true, invalid: true })
    controller.discard()

    expect(controller.store.getSnapshot()).toMatchObject({
      timeoutMs: '120000',
      dirty: false,
      invalid: false,
    })
  })
})
