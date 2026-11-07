import { readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WebRuntime from '@deepseek-ai/dsh-web'
import { BingSearchProvider } from '../src/provider.ts'
import type { BingSearchOptions } from '../src/provider.ts'
import { BING_MAX_RESPONSE_CHARS, BING_PROVIDER_ID, BING_TIMEOUT_CODE } from '../src/provider.ts'
import * as plugin from '../src/index.ts'

/** Verbatim `li.b_algo` blocks recorded from the live results page. */
const FIXTURE = readFileSync(new URL('./fixtures/bing-deepseek-harness.html', import.meta.url), 'utf8')

type Handler = (req: IncomingMessage, res: ServerResponse) => void

let server: Server
let base: string
let handler: Handler
/** Paths the fixture server received, in order. */
let requested: string[]

beforeEach(async () => {
  requested = []
  handler = (req, res) => {
    requested.push(req.url ?? '/')
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(FIXTURE)
  }
  server = createServer((req, res) => { handler(req, res) })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', () => { resolve() }) })
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`
})

afterEach(async () => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
})

/** Options pointing at the fixture server, overridable per case. */
function options(overrides: Partial<BingSearchOptions> = {}): BingSearchOptions {
  return { searchURL: `${base}/search`, timeoutMs: 5_000, userAgent: 'test-agent/1.0', ...overrides }
}

describe('BingSearchProvider request shape', () => {
  it('sends the query, the agent, and the count hint to the configured page', async () => {
    let agent: string | undefined
    let accept: string | undefined
    handler = (req, res) => {
      requested.push(req.url ?? '/')
      agent = req.headers['user-agent']
      accept = req.headers.accept
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(FIXTURE)
    }
    const result = await new BingSearchProvider(options()).search({ query: 'DeepSeek Harness', maxResults: 3 })
    expect(agent).toBe('test-agent/1.0')
    expect(accept).toContain('text/html')
    expect(requested).toEqual(['/search?q=DeepSeek+Harness&count=3'])
    expect(result.truncated).toBe(false)
    expect(result.content).toBeUndefined()
    expect(result.sources.length).toBe(4)
  })

  it('omits count when the request sets no bound, and sends the configured market', async () => {
    await new BingSearchProvider(options({ market: 'en-US' })).search({ query: 'q' })
    expect(requested).toEqual(['/search?q=q&mkt=en-US'])
  })

  it('omits an empty market', async () => {
    await new BingSearchProvider(options({ market: '' })).search({ query: 'q' })
    expect(requested).toEqual(['/search?q=q'])
  })

  it.each([
    [0, 1],
    [2.7, 2],
    [10_000, 50],
  ])('clamps maxResults %s to count %i', async (maxResults, count) => {
    await new BingSearchProvider(options()).search({ query: 'q', maxResults })
    expect(requested).toEqual([`/search?q=q&count=${String(count)}`])
  })

  it('keeps the parameters the configured page already carries', async () => {
    await new BingSearchProvider(options({ searchURL: `${base}/search?form=QBLH` })).search({ query: 'a b' })
    expect(requested).toEqual(['/search?form=QBLH&q=a+b'])
  })
})

describe('BingSearchProvider parse results', () => {
  it('reduces the fixture page to real sources with titles and URLs', async () => {
    const result = await new BingSearchProvider(options()).search({ query: 'DeepSeek Harness github' })
    expect(result.sources.length).toBeGreaterThanOrEqual(3)
    for (const source of result.sources) {
      expect(source.title).toBeTruthy()
      expect(source.url).toMatch(/^https?:\/\//u)
    }
    expect(result.sources[0]).toMatchObject({
      url: 'https://github.com/deepseek-ai/deepseek-harness/tree/master',
      publishedAt: '2026-08-13',
    })
  })
})

describe('BingSearchProvider failures', () => {
  it('reports a non-2xx answer with its status', async () => {
    handler = (_req, res) => { res.writeHead(500, { 'content-type': 'text/html' }); res.end('<p>boom</p>') }
    await expect(new BingSearchProvider(options()).search({ query: 'q' })).rejects.toThrow(/HTTP 500/u)
    await expect(new BingSearchProvider(options()).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('names rate limiting on 429 and 403', async () => {
    handler = (_req, res) => { res.writeHead(429); res.end() }
    await expect(new BingSearchProvider(options()).search({ query: 'q' }))
      .rejects.toThrow(/HTTP 429 — the endpoint is rate limiting or challenging this machine/u)
    handler = (_req, res) => { res.writeHead(403); res.end() }
    await expect(new BingSearchProvider(options()).search({ query: 'q' }))
      .rejects.toThrow(/HTTP 403 — the endpoint is rate limiting/u)
  })

  it('fails a page with no recognizable result block instead of inventing results', async () => {
    handler = (_req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html><body>nothing here</body></html>') }
    await expect(new BingSearchProvider(options()).search({ query: 'q' }))
      .rejects.toThrow(/no recognizable Bing result block[\s\S]*never invents results/u)
    await expect(new BingSearchProvider(options()).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('names the verification marker of an interstitial served with HTTP 200', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<html><body><div id="b_captcha">g-recaptcha unusual traffic</div></body></html>')
    }
    await expect(new BingSearchProvider(options()).search({ query: 'q' }))
      .rejects.toThrow(/carries the "unusual traffic" verification marker/u)
  })

  it('refuses a declared over-cap body before reading it', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html', 'content-length': String(BING_MAX_RESPONSE_CHARS + 1) })
      res.write('<p>x</p>')
    }
    await expect(new BingSearchProvider(options()).search({ query: 'q' }))
      .rejects.toThrow(`Bing response exceeds the maximum of ${String(BING_MAX_RESPONSE_CHARS)} characters`)
  })

  it('cuts an undeclared over-cap body at the cap', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('x'.repeat(BING_MAX_RESPONSE_CHARS + 10))
    }
    await expect(new BingSearchProvider(options()).search({ query: 'q' }))
      .rejects.toThrow(new RegExp(`${String(BING_MAX_RESPONSE_CHARS)} characters and no recognizable`, 'u'))
  })
})

describe('BingSearchProvider redirects', () => {
  it('follows a same-origin redirect and parses the page it lands on', async () => {
    handler = (req, res) => {
      requested.push(req.url ?? '/')
      if (req.url?.startsWith('/search')) { res.writeHead(302, { location: '/results?q=x' }); res.end() }
      else { res.writeHead(200, { 'content-type': 'text/html' }); res.end(FIXTURE) }
    }
    const result = await new BingSearchProvider(options()).search({ query: 'q' })
    expect(result.sources.length).toBe(4)
    expect(requested.at(-1)).toBe('/results?q=x')
  })

  it('refuses a redirect that leaves the configured origin', async () => {
    handler = (_req, res) => { res.writeHead(302, { location: 'https://elsewhere.test/search' }); res.end() }
    await expect(new BingSearchProvider(options()).search({ query: 'q' }))
      .rejects.toThrow(/redirected search to https:\/\/elsewhere\.test, which is outside the configured origin/u)
  })

  it('refuses a redirect with no Location header', async () => {
    handler = (_req, res) => { res.writeHead(302); res.end() }
    await expect(new BingSearchProvider(options()).search({ query: 'q' }))
      .rejects.toThrow(/answered HTTP 302 without a Location header/u)
  })

  it('refuses an unusable Location value', async () => {
    handler = (_req, res) => { res.writeHead(302, { location: 'http://[' }); res.end() }
    await expect(new BingSearchProvider(options()).search({ query: 'q' }))
      .rejects.toThrow(/redirect Location "http:\/\/\[" is not a usable URL/u)
  })

  it('refuses a chain longer than the redirect budget', async () => {
    handler = (req, res) => {
      requested.push(req.url ?? '/')
      const n = Number(new URL(req.url ?? '/', base).searchParams.get('n') ?? '0')
      res.writeHead(302, { location: `/search?n=${String(n + 1)}` })
      res.end()
    }
    await expect(new BingSearchProvider(options()).search({ query: 'q' }))
      .rejects.toThrow(/exceeded the maximum of 5 redirects/u)
    expect(requested.length).toBe(6)
  })
})

describe('BingSearchProvider cancellation and transport', () => {
  it('honors a pre-aborted signal without a request', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(new BingSearchProvider(options()).search({ query: 'q' }, controller.signal))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED', message: 'Bing search aborted' }))
    expect(requested).toEqual([])
  })

  it('aborts an in-flight search through the caller signal', async () => {
    handler = (_req, _res) => { /* never responds */ }
    const controller = new AbortController()
    const pending = new BingSearchProvider(options()).search({ query: 'q' }, controller.signal)
    controller.abort()
    await expect(pending).rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('times out a search that never answers', async () => {
    handler = (_req, _res) => { /* never responds */ }
    await expect(new BingSearchProvider(options({ timeoutMs: 50 })).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: BING_TIMEOUT_CODE, message: 'Bing search timed out' }))
  })

  it('maps a connection failure to a provider error', async () => {
    await expect(new BingSearchProvider(options({ searchURL: 'http://127.0.0.1:1/search' })).search({ query: 'q' }))
      .rejects.toThrow(/Bing search request failed/u)
  })

  it('maps a mid-body connection drop to a provider error', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.write(`<html><body>${'x'.repeat(2048)}`)
      setTimeout(() => { res.socket?.destroy() }, 30)
    }
    await expect(new BingSearchProvider(options()).search({ query: 'q' }))
      .rejects.toThrow(/Bing search request failed.*terminated/u)
  })

  it('reports an unusable configured URL as a provider error', async () => {
    await expect(new BingSearchProvider(options({ searchURL: 'not a url' })).search({ query: 'q' }))
      .rejects.toThrow(/is not a usable URL/u)
  })
})

describe('BingSearchProvider availability', () => {
  it('is available for a usable URL and deadline', () => {
    expect(new BingSearchProvider(options()).available()).toBe(true)
  })

  it.each([
    ['not a url', 5_000],
    ['ftp://example.test/search', 5_000],
    ['https://cn.bing.com/search', 0],
    ['https://cn.bing.com/search', Number.NaN],
  ])('is unavailable for searchURL %s and timeoutMs %s', (searchURL, timeoutMs) => {
    expect(new BingSearchProvider(options({ searchURL, timeoutMs })).available()).toBe(false)
  })
})

describe('web-search-bing plugin', () => {
  it('registers the bing provider into ctx.web and serves a search through the seam', async () => {
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: BING_PROVIDER_ID })
    const fiber = await ctx.plugin(plugin, { searchURL: `${base}/search` })
    const result = await ctx.web.search({ query: 'DeepSeek Harness', maxResults: 2 })
    expect(result.sources.map(source => source.url)).toHaveLength(2)
    expect(result.truncated).toBe(true)
    expect(ctx.web.listProviders().search).toEqual([
      expect.objectContaining({ id: BING_PROVIDER_ID, title: 'Bing' }),
    ])
    await fiber.dispose()
    await expect(ctx.web.search({ query: 'DeepSeek Harness' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' }))
  })

  it('carries picker metadata in every shipped language', () => {
    const provider = new BingSearchProvider(options())
    expect(provider.id).toBe('bing')
    expect(provider.title).toBe('Bing')
    const { description } = provider
    if (typeof description !== 'object') throw new Error('description must be a localized record')
    for (const language of ['en', 'zh', 'ja', 'es', 'fr', 'de', 'ru', 'pt']) {
      expect(description[language]).toBeTruthy()
    }
  })

  it('has no default export (namespace plugin export shape)', () => {
    expect('default' in plugin).toBe(false)
  })

  it('passes a configured market through the plugin to the endpoint', async () => {
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: BING_PROVIDER_ID })
    await ctx.plugin(plugin, { searchURL: `${base}/search`, market: 'en-US' })
    await ctx.web.search({ query: 'q' })
    expect(requested).toEqual(['/search?q=q&mkt=en-US'])
  })

  it('treats an empty market as omitted', async () => {
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: BING_PROVIDER_ID })
    await ctx.plugin(plugin, { searchURL: `${base}/search`, market: '' })
    await ctx.web.search({ query: 'q' })
    expect(requested).toEqual(['/search?q=q'])
  })

  it('rejects a zero or negative deadline at mount', async () => {
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: BING_PROVIDER_ID })
    await expect(ctx.plugin(plugin, { timeoutMs: 0 })).rejects.toThrow(/timeoutMs must be a positive finite number/u)
  })

  it('rejects a deadline beyond Node timer range at mount', async () => {
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: BING_PROVIDER_ID })
    await expect(ctx.plugin(plugin, { timeoutMs: 2_147_483_648 }))
      .rejects.toThrow(/timeoutMs must be no greater than 2147483647/u)
  })

  it.each(['not a url', 'ftp://example.test/search'])('rejects an unusable endpoint at mount: %s', async (searchURL) => {
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: BING_PROVIDER_ID })
    await expect(ctx.plugin(plugin, { searchURL })).rejects.toThrow(/searchURL must be an absolute http\(s\) URL/u)
  })
})
