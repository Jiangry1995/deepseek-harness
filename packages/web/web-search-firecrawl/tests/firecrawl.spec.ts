import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  firecrawlSearchItems, mapFirecrawlSearchItem, mapFirecrawlSearchResponse,
  FirecrawlFetchProvider, FirecrawlSearchProvider, FIRECRAWL_PROVIDER_ID,
} from '../src/provider.ts'

const options = { apiKey: 'fc-key', baseURL: 'https://api.firecrawl.test' }

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Firecrawl search mapping', () => {
  it('tolerates the current flat data shape', () => {
    expect(firecrawlSearchItems([{ url: 'https://a.test' }])).toHaveLength(1)
  })

  it('tolerates the legacy data.web.results shape', () => {
    expect(firecrawlSearchItems({ web: { results: [{ url: 'https://a.test' }] } })).toHaveLength(1)
  })

  it('yields none for an unrecognized shape', () => {
    expect(firecrawlSearchItems(undefined)).toEqual([])
    expect(firecrawlSearchItems({})).toEqual([])
  })

  it('maps a full item with the description snippet winning', () => {
    expect(mapFirecrawlSearchItem({
      url: 'https://a.test', title: 'A', description: 'desc', content: 'content', markdown: 'md',
    })).toEqual({ url: 'https://a.test', title: 'A', snippet: 'desc' })
  })

  it('falls back to content then markdown for the snippet', () => {
    expect(mapFirecrawlSearchItem({ url: 'https://a.test', content: 'c' })).toEqual({ url: 'https://a.test', snippet: 'c' })
    expect(mapFirecrawlSearchItem({ url: 'https://a.test', markdown: 'm' })).toEqual({ url: 'https://a.test', snippet: 'm' })
  })

  it('drops an entry without a URL', () => {
    expect(mapFirecrawlSearchItem({ title: 'A' })).toBeUndefined()
  })

  it('maps a response to a result with no content', () => {
    const result = mapFirecrawlSearchResponse({
      success: true,
      data: [{ url: 'https://a.test', title: 'A', description: 'one' }, { title: 'no url' }],
    })
    expect(result).toEqual({ sources: [{ url: 'https://a.test', title: 'A', snippet: 'one' }], truncated: false })
    expect(result.content).toBeUndefined()
  })
})

describe('Firecrawl providers', () => {
  it('registers both under the stable id', () => {
    expect(new FirecrawlSearchProvider(() => options).id).toBe(FIRECRAWL_PROVIDER_ID)
    expect(new FirecrawlFetchProvider(() => options).id).toBe(FIRECRAWL_PROVIDER_ID)
  })

  it('is unavailable without a key or resolver', () => {
    expect(new FirecrawlSearchProvider(() => ({ baseURL: options.baseURL })).available()).toBe(false)
    expect(new FirecrawlFetchProvider(() => ({ baseURL: options.baseURL })).available()).toBe(false)
  })

  it('is available with a literal key', () => {
    expect(new FirecrawlSearchProvider(() => options).available()).toBe(true)
    expect(new FirecrawlFetchProvider(() => options).available()).toBe(true)
  })

  it('sends the search request with a limit and scrape options', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await new FirecrawlSearchProvider(() => options).search({ query: 'hello', maxResults: 5 })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.firecrawl.test/v1/search')
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer fc-key')
    expect(JSON.parse(init.body as string)).toEqual({
      query: 'hello', limit: 5, scrapeOptions: { formats: ['markdown'] },
    })
  })

  it('scrapes a URL into a text body with the final URL and status', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      success: true,
      data: { markdown: '# Page', metadata: { sourceURL: 'https://a.test/final', statusCode: 200 } },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await new FirecrawlFetchProvider(() => options).fetch({ url: 'https://a.test/orig' })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.firecrawl.test/v1/scrape')
    expect(JSON.parse(init.body as string)).toEqual({ url: 'https://a.test/orig', formats: ['markdown'] })
    expect(result).toEqual({
      url: 'https://a.test/final', statusCode: 200, body: { kind: 'text', content: '# Page' }, truncated: false,
    })
  })

  it('falls back to an html body when scrape returns no markdown', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ success: true, data: { html: '<h1>Page</h1>' } })))
    const result = await new FirecrawlFetchProvider(() => options).fetch({ url: 'https://a.test' })
    expect(result.body).toEqual({ kind: 'html', content: '<h1>Page</h1>' })
    expect(result.statusCode).toBe(200)
  })

  it('fails with WEB_PROVIDER_ERROR when the API reports failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ success: false, warning: 'quota' })))
    await expect(new FirecrawlSearchProvider(() => options).search({ query: 'q' }))
      .rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR', message: 'Firecrawl search failed: quota' })
  })

  it('fails with WEB_PROVIDER_ERROR when scrape returns no content', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ success: true, data: {} })))
    await expect(new FirecrawlFetchProvider(() => options).fetch({ url: 'https://a.test' }))
      .rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
  })

  it('surfaces a missing credential as WEB_PROVIDER_CREDENTIAL_MISSING', async () => {
    const provider = new FirecrawlSearchProvider(() => ({ baseURL: options.baseURL }))
    await expect(provider.search({ query: 'q' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' })
  })
})
