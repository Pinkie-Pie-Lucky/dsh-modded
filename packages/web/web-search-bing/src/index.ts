/**
 * Bing HTML search provider plugin. It contributes the `bing` search provider
 * to the `ctx.web` registry without owning the service, and needs no credential:
 * one search is an ordinary GET of Bing's public results page. Select it with
 * `searchProvider: bing` on the web service, or by prefs when it is the only
 * registered search provider.
 * @module @deepseek-ai/dsh-web-search-bing
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-web'
import {
  BingSearchProvider,
  isFetchableUrl,
  BING_DEFAULT_SEARCH_URL,
  BING_DEFAULT_TIMEOUT_MS,
  BING_DEFAULT_USER_AGENT,
} from './provider.ts'

export {
  BingSearchProvider,
  isFetchableUrl,
  BING_DEFAULT_SEARCH_URL,
  BING_DEFAULT_TIMEOUT_MS,
  BING_DEFAULT_USER_AGENT,
  BING_MAX_COUNT,
  BING_MAX_REDIRECTS,
  BING_MAX_RESPONSE_CHARS,
  BING_PROVIDER_ID,
  BING_TIMEOUT_CODE,
} from './provider.ts'
export type { BingSearchOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-bing'

/** The web seam this provider registers into. */
export const inject = ['web']

/** Plugin config: the results page, its deadline, the agent, and an optional market (all defaulted but `market`). */
export interface Config {
  /** Absolute results-page URL; defaults to `https://cn.bing.com/search`. */
  searchURL?: string
  /** Search deadline in milliseconds, within Node's timer range. */
  timeoutMs?: number
  /** `User-Agent` header sent on every request. */
  userAgent?: string
  /** Bing market (`mkt`) parameter such as `en-US`; omitted sends none. */
  market?: string
}

export const Config: z<Config> = z.object({
  searchURL: z.string().default(BING_DEFAULT_SEARCH_URL),
  timeoutMs: z.number().default(BING_DEFAULT_TIMEOUT_MS),
  userAgent: z.string().default(BING_DEFAULT_USER_AGENT),
  market: z.string(),
})

/** Complete config after schemastery applies every defaulted field. */
type ResolvedConfig = Required<Omit<Config, 'market'>> & { readonly market?: string | undefined }

/** Largest delay Node schedules without clamping it to one millisecond. */
const MAX_NODE_TIMER_DELAY_MS = 2_147_483_647

/**
 * Reject a deadline Node would silently clamp, so a misconfiguration fails at
 * mount instead of as a search that returns in a millisecond.
 * @param timeoutMs - the configured deadline.
 * @throws When it is not a positive finite number within Node's timer range.
 */
function assertTimeoutMs(timeoutMs: number): void {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('web-search-bing: timeoutMs must be a positive finite number')
  }
  if (timeoutMs > MAX_NODE_TIMER_DELAY_MS) {
    throw new Error(`web-search-bing: timeoutMs must be no greater than ${MAX_NODE_TIMER_DELAY_MS}`)
  }
}

/**
 * Reject an endpoint this provider could never fetch from, so an unusable
 * `searchURL` fails at mount rather than on the first search.
 * @param searchURL - the configured results-page URL.
 * @throws When it is not an absolute HTTP(S) URL.
 */
function assertSearchUrl(searchURL: string): void {
  if (!isFetchableUrl(searchURL)) {
    throw new Error(`web-search-bing: searchURL must be an absolute http(s) URL, received ${JSON.stringify(searchURL)}`)
  }
}

/** Register the Bing search provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  // schemastery (Config) has already filled every defaulted field.
  const resolved = config as ResolvedConfig
  assertTimeoutMs(resolved.timeoutMs)
  assertSearchUrl(resolved.searchURL)
  const market = resolved.market
  ctx.web.registerSearchProvider(new BingSearchProvider({
    searchURL: resolved.searchURL,
    timeoutMs: resolved.timeoutMs,
    userAgent: resolved.userAgent,
    ...market === undefined || market.length === 0 ? {} : { market },
  }))
}
