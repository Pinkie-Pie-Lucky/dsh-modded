/**
 * Live proof that a `web_search` call reaches Bing through this provider and
 * parses real results. It is a manual probe, not a gate: the offline suites own
 * correctness, and this file exists so a human can see the real page's output.
 *
 * Run it from the repository root:
 * `node --import tsx/esm packages/web/web-search-bing/tests/live-search.ts "some query"`
 */

import { Context } from '@deepseek-ai/cordis'
import WebRuntime from '@deepseek-ai/dsh-web'
import * as plugin from '../src/index.ts'
import { BING_PROVIDER_ID } from '../src/provider.ts'

/** Query this probe runs; the first argument overrides it. */
const query = process.argv[2] ?? 'DeepSeek Harness github'

/** Upper bound this probe asks the seam for. */
const maxResults = 10

const ctx = new Context()
await ctx.plugin(WebRuntime, { searchProvider: BING_PROVIDER_ID })
await ctx.plugin(plugin, {})

const started = Date.now()
const result = await ctx.web.search({ query, maxResults }, AbortSignal.timeout(30_000))
const elapsed = Date.now() - started

console.log(`query ${JSON.stringify(query)} -> ${String(result.sources.length)} source(s) in ${String(elapsed)} ms (truncated: ${String(result.truncated)})`)
for (const [index, source] of result.sources.entries()) {
  console.log(`\n${String(index + 1)}. ${source.title ?? '(no title)'}`)
  console.log(`   ${source.url}`)
  if (source.publishedAt !== undefined) console.log(`   published: ${source.publishedAt}`)
  if (source.snippet !== undefined) console.log(`   ${source.snippet}`)
}

const empty = result.sources.filter(source => (source.title ?? '').length === 0 || !/^https?:\/\//u.test(source.url))
console.log(`\nsources: ${String(result.sources.length)}, empty title or non-http url: ${String(empty.length)}`)
console.log(`json: ${JSON.stringify(result.sources.slice(0, 3), null, 2)}`)

await ctx.fiber.dispose()
