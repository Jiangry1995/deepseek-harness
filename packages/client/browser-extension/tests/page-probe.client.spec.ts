// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { collectPageProbe } from '../src/extension/page-probe-collector.ts'
import { installPageProbe } from '../src/extension/page-probe.ts'

afterEach(async () => {
  await collectPageProbe('stop')
  vi.restoreAllMocks()
})

describe('MAIN-world page probe', () => {
  it('records fetch and console events for the isolated-world collector', async () => {
    installPageProbe()
    vi.spyOn(window, 'fetch').mockRejectedValue(new Error('network unavailable'))
    const started = await collectPageProbe('start')
    expect(started.hooked).toBe(true)
    expect(started.network).toEqual([])
    expect(started.console).toEqual([])
    window.console.warn('信访提交警告')
    await window.fetch('https://example.test/api/submit?token=secret-value').catch(() => undefined)

    const snapshot = await collectPageProbe('snapshot')
    expect(snapshot.hooked).toBe(true)
    const fetchEntry = snapshot.network.find(entry => entry.source === 'fetch')
    expect(fetchEntry, JSON.stringify(snapshot.network)).toMatchObject({ source: 'fetch', method: 'GET' })
    expect(fetchEntry?.url).toMatch(/https:\/\/example\.test\/api\/submit.*token=__redacted__/)
    expect(snapshot.network.some(entry => entry.url.includes('secret-value'))).toBe(false)
    expect(snapshot.console.some(entry => entry.level === 'warn' && entry.text.includes('信访提交警告'))).toBe(true)

    const stopped = await collectPageProbe('stop')
    expect(stopped.network.length).toBeGreaterThan(0)
    window.console.warn('停止后不记录')
    const afterStop = await collectPageProbe('snapshot')
    expect(afterStop.console.some(entry => entry.text.includes('停止后不记录'))).toBe(false)
  })

  it('does not traverse arbitrary console objects or throw into the page', async () => {
    installPageProbe()
    const originalWarn = vi.spyOn(window.console, 'warn').mockImplementation(() => {})
    await collectPageProbe('start')
    let propertyReads = 0
    const opaque = new Proxy({}, {
      get() {
        propertyReads += 1
        throw new TypeError('page object must not be inspected')
      },
    })
    expect(() => { window.console.warn('vue-proxy-warn', opaque) }).not.toThrow()

    const snapshot = await collectPageProbe('stop')
    expect(propertyReads).toBe(0)
    expect(originalWarn).toHaveBeenCalledTimes(1)
    expect(snapshot.console.some(entry => (
      entry.level === 'warn'
      && entry.text.includes('vue-proxy-warn')
      && entry.text.includes('[Object]')
    ))).toBe(true)
  })

  it('renders primitive, Error, array, object, and function console arguments without JSON traversal', async () => {
    installPageProbe()
    await collectPageProbe('start')
    expect(() => {
      window.console.error(new Error('probe-error'))
      window.console.log('values', 1, true, undefined, 2n, Symbol('s'))
      window.console.debug([], {}, () => 'fn')
    }).not.toThrow()

    const snapshot = await collectPageProbe('stop')
    expect(snapshot.console.some(entry => entry.level === 'error' && entry.text.includes('probe-error'))).toBe(true)
    expect(snapshot.console.some(entry => entry.level === 'log' && entry.text.includes('values 1 true undefined 2n Symbol(s)'))).toBe(true)
    expect(snapshot.console.some(entry => entry.level === 'debug' && entry.text.includes('[Array] [Object] [Function]'))).toBe(true)
  })

  it('registers one completion listener for each send when an XHR instance is reused', async () => {
    installPageProbe()
    vi.spyOn(XMLHttpRequest.prototype, 'open').mockImplementation(() => undefined)
    vi.spyOn(XMLHttpRequest.prototype, 'send').mockImplementation(() => undefined)
    const addEventListener = vi.spyOn(XMLHttpRequest.prototype, 'addEventListener')
    await collectPageProbe('start')

    const xhr = new XMLHttpRequest()
    Object.defineProperty(xhr, 'status', { configurable: true, value: 200 })
    Object.defineProperty(xhr, 'readyState', { configurable: true, value: XMLHttpRequest.DONE })
    xhr.open('GET', 'https://example.test/first')
    xhr.send()
    xhr.dispatchEvent(new Event('loadend'))
    xhr.open('POST', 'https://example.test/second')
    xhr.send()
    xhr.dispatchEvent(new Event('loadend'))

    const snapshot = await collectPageProbe('stop')
    expect(addEventListener).toHaveBeenCalledTimes(2)
    expect(addEventListener).toHaveBeenNthCalledWith(1, 'loadend', expect.any(Function), { once: true })
    expect(snapshot.network.map(entry => entry.url)).toEqual([
      'https://example.test/first',
      'https://example.test/second',
    ])
  })
})
