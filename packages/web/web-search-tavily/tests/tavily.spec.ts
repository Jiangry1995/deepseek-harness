import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  mapTavilyResponse, mapTavilyResult,
  TavilySearchProvider, TAVILY_PROVIDER_ID,
} from '../src/provider.ts'

const options = { apiKey: 'tvly-key', baseURL: 'https://api.tavily.test' }

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Tavily result mapping', () => {
  it('maps a full result entry', () => {
    expect(mapTavilyResult({
      url: 'https://a.test', title: 'A', content: 'salient sentence', published_date: '2026-01-01',
    })).toEqual({ url: 'https://a.test', title: 'A', snippet: 'salient sentence', publishedAt: '2026-01-01' })
  })

  it('drops an entry without a URL', () => {
    expect(mapTavilyResult({ title: 'A' })).toBeUndefined()
    expect(mapTavilyResult({ url: '' })).toBeUndefined()
  })

  it('omits null/empty optional fields rather than emitting them', () => {
    expect(mapTavilyResult({ url: 'https://a.test', title: null, content: '', published_date: null }))
      .toEqual({ url: 'https://a.test' })
  })

  it('maps a response with an answer to content and sources', () => {
    const result = mapTavilyResponse({
      answer: 'Tavily says hello.',
      results: [
        { url: 'https://a.test', title: 'A', content: 'one' },
        { title: 'no url' },
      ],
    })
    expect(result).toEqual({
      content: 'Tavily says hello.',
      sources: [{ url: 'https://a.test', title: 'A', snippet: 'one' }],
      truncated: false,
    })
  })

  it('omits content when the answer is absent or empty', () => {
    expect(mapTavilyResponse({}).content).toBeUndefined()
    expect(mapTavilyResponse({ answer: '', results: [] }).content).toBeUndefined()
  })

  it('tolerates a missing results array', () => {
    expect(mapTavilyResponse({}).sources).toEqual([])
  })
})

describe('TavilySearchProvider availability', () => {
  it('is unavailable without a key or resolver', () => {
    expect(new TavilySearchProvider(() => ({ baseURL: options.baseURL })).available()).toBe(false)
  })

  it('is available with a literal key', () => {
    expect(new TavilySearchProvider(() => options).available()).toBe(true)
  })

  it('is available with a key resolver', () => {
    expect(new TavilySearchProvider(() => ({ baseURL: options.baseURL, resolveApiKey: async () => 'k' })).available()).toBe(true)
  })

  it('is unavailable when the base URL is unparseable', () => {
    expect(new TavilySearchProvider(() => ({ ...options, baseURL: 'not a url' })).available()).toBe(false)
  })
})

describe('TavilySearchProvider search', () => {
  it('sends query, max_results, include_answer and bearer auth', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ results: [{ url: 'https://a.test', content: 'hi' }] }))
    vi.stubGlobal('fetch', fetchMock)
    await new TavilySearchProvider(() => options).search({ query: 'hello', maxResults: 5 })
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.tavily.test/search')
    expect(init).toMatchObject({ method: 'POST', redirect: 'error' })
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer tvly-key')
    expect(JSON.parse(init.body as string)).toEqual({
      query: 'hello', max_results: 5, include_answer: true, search_depth: 'advanced',
    })
  })

  it('surfaces HTTP failures as WEB_PROVIDER_ERROR with the provider detail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'bad key' }, { status: 401 })))
    const provider = new TavilySearchProvider(() => options)
    await expect(provider.search({ query: 'q' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR', message: 'bad key' })
  })

  it('surfaces a missing credential as WEB_PROVIDER_CREDENTIAL_MISSING', async () => {
    const provider = new TavilySearchProvider(() => ({ baseURL: options.baseURL }))
    await expect(provider.search({ query: 'q' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' })
  })

  it('registers under the stable id', () => {
    expect(new TavilySearchProvider(() => options).id).toBe(TAVILY_PROVIDER_ID)
  })
})
