import { readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { describe, expect, it, afterEach, beforeEach } from 'vitest'
import { installProxyFromEnvironment } from '@deepseek-ai/dsh-http-proxy'
import { BingSearchProvider } from '../src/provider.ts'

/** Verbatim `li.b_algo` blocks recorded from the live results page. */
const FIXTURE = readFileSync(new URL('./fixtures/bing-deepseek-harness.html', import.meta.url), 'utf8')

/**
 * The target every assertion uses. Loopback cannot serve: the policy never
 * routes loopback through a proxy. The host never resolves, so an unproxied
 * request fails and only the proxy can answer.
 */
const PROXY_TARGET = 'http://origin.test/search'

/** Absolute-form targets the fake proxy saw; a populated entry proves the hop was tunnelled. */
let proxied: string[]
let proxy: Server
let proxyUrl: string
let disposeProxy: (() => Promise<void>) | undefined

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => { resolve((server.address() as { port: number }).port) })
  })
}

beforeEach(async () => {
  proxied = []
  proxy = createServer((request: IncomingMessage, response: ServerResponse) => {
    proxied.push(request.url ?? '')
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(FIXTURE)
  })
  proxyUrl = `http://127.0.0.1:${String(await listen(proxy))}`
})

afterEach(async () => {
  await disposeProxy?.()
  disposeProxy = undefined
  await new Promise<void>((resolve) => { proxy.close(() => { resolve() }) })
})

/**
 * Install the policy of a user who exported one proxy for both schemes; the
 * fixture disposes it after every case.
 */
async function installProxy(): Promise<() => Promise<void>> {
  const env = { get: (name: string) => (name === 'HTTP_PROXY' || name === 'HTTPS_PROXY' ? { value: proxyUrl } : undefined) }
  return await installProxyFromEnvironment(env, () => undefined)
}

describe('searching through a proxy', () => {
  it('tunnels the search request through the installed proxy', async () => {
    disposeProxy = await installProxy()

    const result = await new BingSearchProvider({ searchURL: PROXY_TARGET, timeoutMs: 5_000, userAgent: 'test-agent/1.0' })
      .search({ query: 'DeepSeek Harness' })

    expect(proxied).toEqual([`${PROXY_TARGET}?q=DeepSeek+Harness`])
    expect(result.sources.length).toBe(4)
  })

  it('does not reach the endpoint when the proxy policy is disposed', async () => {
    disposeProxy = await installProxy()
    await disposeProxy()
    disposeProxy = undefined

    await expect(new BingSearchProvider({ searchURL: PROXY_TARGET, timeoutMs: 2_000, userAgent: 'test-agent/1.0' })
      .search({ query: 'q' })).rejects.toThrow(/Bing search request failed/u)
    expect(proxied).toEqual([])
  })
})
