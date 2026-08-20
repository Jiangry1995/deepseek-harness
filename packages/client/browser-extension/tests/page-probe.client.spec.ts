// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { collectPageProbe } from '../src/extension/page-probe-collector.ts'
import { installPageProbe } from '../src/extension/page-probe.ts'

describe('MAIN-world page probe', () => {
  it('records fetch and console events for the isolated-world collector', async () => {
    installPageProbe()
    window.console.warn('信访提交警告')
    await window.fetch('https://example.test/api/submit?token=secret-value').catch(() => undefined)

    const snapshot = await collectPageProbe(false)
    expect(snapshot.hooked).toBe(true)
    expect(snapshot.network, JSON.stringify(snapshot.network)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'fetch',
        method: 'GET',
        url: expect.stringMatching(/https:\/\/example\.test\/api\/submit.*token=__redacted__/),
      }),
    ]))
    expect(snapshot.network.some(entry => entry.url.includes('secret-value'))).toBe(false)
    expect(snapshot.console.some(entry => entry.level === 'warn' && entry.text.includes('信访提交警告'))).toBe(true)

    const reset = await collectPageProbe(true)
    expect(reset.network.length).toBeGreaterThan(0)
    const afterReset = await collectPageProbe(false)
    expect(afterReset.network).toEqual([])
    expect(afterReset.console).toEqual([])
  })
})
