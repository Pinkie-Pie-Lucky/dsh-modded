import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WebRuntime from '@deepseek-ai/dsh-web'
import * as plugin from '../src/index.ts'
import { BING_PROVIDER_ID } from '../src/provider.ts'

/**
 * Real-service probe, opt-in because it depends on a third party's page. Set
 * `DSH_WEB_SEARCH_BING_LIVE=1` to run it; the offline suites pin the parser and
 * every failure path against recorded markup instead.
 */
const live = process.env.DSH_WEB_SEARCH_BING_LIVE === '1' ? describe : describe.skip

live('Bing search against the live service', () => {
  it('returns citeable sources for a real query through the seam', async () => {
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: BING_PROVIDER_ID })
    await ctx.plugin(plugin, {})

    const result = await ctx.web.search({ query: 'DeepSeek Harness github', maxResults: 5 }, AbortSignal.timeout(30_000))

    expect(result.sources.length).toBeGreaterThanOrEqual(3)
    for (const source of result.sources) {
      expect(source.title ?? '').not.toBe('')
      expect(source.url).toMatch(/^https?:\/\//u)
    }
    console.log(JSON.stringify(result.sources, null, 2))
    await ctx.fiber.dispose()
  }, 60_000)
})
