/**
 * Bing search over its public results page: one bounded GET with a same-origin
 * redirect budget, then the pure reduction in `./parse.ts`. The page is read,
 * never driven — this provider runs no JavaScript and sends no cookies — and an
 * unrecognized or blocked page is reported as a failure instead of being turned
 * into results. Requests go through the process-wide fetch transport, so the
 * proxy policy `@deepseek-ai/dsh-http-proxy` installs applies unchanged.
 * @module @deepseek-ai/dsh-web-search-bing/provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web'
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'
import { blockPageMarker, parseBingResults } from './parse.ts'

/** Stable id this provider registers under. */
export const BING_PROVIDER_ID = 'bing'

/**
 * Default results-page URL. The regional host answers directly, without the
 * cross-origin redirect `www.bing.com` issues for this machine.
 */
export const BING_DEFAULT_SEARCH_URL = 'https://cn.bing.com/search'

/** Default search deadline in milliseconds. */
export const BING_DEFAULT_TIMEOUT_MS = 30_000

/** Default `User-Agent`: an explicit product agent, matching the fetch provider. */
export const BING_DEFAULT_USER_AGENT = 'deepseek-harness/0.0.1 (+https://github.com/deepseek-ai)'

/** Maximum same-origin redirect hops followed before a search fails. */
export const BING_MAX_REDIRECTS = 5

/** Maximum accepted response length in characters; longer bodies are cut before parsing. */
export const BING_MAX_RESPONSE_CHARS = 1_000_000

/** Largest `count` requested from Bing; larger `maxResults` values are clamped to it. */
export const BING_MAX_COUNT = 50

/** Timeout code this provider stamps on its deadline reason. */
export const BING_TIMEOUT_CODE = 'WEB_SEARCH_TIMEOUT'

/** Resolved provider options (the plugin's schemastery Config supplies defaults). */
export interface BingSearchOptions {
  /** Absolute results-page URL; the query is merged into its existing parameters. */
  readonly searchURL: string
  /** Deadline for one search, in milliseconds. */
  readonly timeoutMs: number
  /** `User-Agent` header sent on every request. */
  readonly userAgent: string
  /** Optional Bing market (`mkt`) parameter such as `en-US`; omitted sends none. */
  readonly market?: string | undefined
}

/** One response with the URL it was finally read from. */
interface BingResponse {
  readonly response: Response
  readonly url: URL
}

/** HTTP redirect status codes that carry a `Location`. */
function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

/**
 * Whether a configured value is an absolute HTTP(S) URL this provider can
 * fetch. The plugin rejects anything else at mount, and the provider's
 * availability check reads the same rule, so an unusable endpoint is reported
 * as an unavailable provider rather than as a failed search.
 * @param candidate - the configured results-page URL.
 * @returns true when it parses and uses the HTTP or HTTPS scheme.
 */
export function isFetchableUrl(candidate: string): boolean {
  let url: URL | undefined
  try {
    url = new URL(candidate)
  } catch (_unusableUrl) {
    url = undefined
  }
  return url !== undefined && (url.protocol === 'http:' || url.protocol === 'https:')
}

/**
 * Translate a thrown transport error into a `WebError`, classified by the
 * deadline signal rather than the thrown value: our own timeout means
 * {@link BING_TIMEOUT_CODE}, any other abort is caller cancellation, and a
 * throw with the signal still live is a transport failure.
 * @param error - the thrown value.
 * @param signal - the fused deadline signal the request ran under.
 * @returns the classified error.
 */
function transportFailure(error: unknown, signal: AbortSignal): WebError {
  const timeout = timeoutOf(signal, BING_TIMEOUT_CODE)
  if (timeout !== undefined) return new WebError('Bing search timed out', BING_TIMEOUT_CODE, { cause: timeout })
  if (signal.aborted) return new WebError('Bing search aborted', 'WEB_ABORTED', { cause: error })
  return new WebError(`Bing search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
}

/** The URL one request fetches: the configured page plus `q`, optional `mkt`, and `count`. */
function searchUrl(options: BingSearchOptions, request: WebSearchRequest): URL {
  let url: URL
  try {
    url = new URL(options.searchURL)
  } catch (error: unknown) {
    throw new WebError(`Bing search URL ${JSON.stringify(options.searchURL)} is not a usable URL`, 'WEB_PROVIDER_ERROR', { cause: error })
  }
  url.searchParams.set('q', request.query)
  if (options.market !== undefined && options.market.length > 0) url.searchParams.set('mkt', options.market)
  if (request.maxResults !== undefined) {
    const count = Math.min(Math.max(Math.trunc(request.maxResults), 1), BING_MAX_COUNT)
    url.searchParams.set('count', String(count))
  }
  return url
}

/**
 * Fetch one page through the process-wide transport, following same-origin
 * redirects up to {@link BING_MAX_REDIRECTS}. A redirect off the configured
 * origin is refused rather than silently followed, so a search never leaves the
 * endpoint the deployment chose.
 * @param initial - the results-page URL to fetch.
 * @param signal - the fused deadline signal for this search.
 * @param userAgent - `User-Agent` header value.
 * @returns the final response with the URL it came from.
 * @throws {@link WebError} on transport failure, cancellation, timeout, a missing `Location`, or a cross-origin redirect.
 */
async function fetchPage(initial: URL, signal: AbortSignal, userAgent: string): Promise<BingResponse> {
  let current = initial
  for (let hops = 0; ; hops++) {
    let response: Response
    try {
      response = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        headers: {
          'user-agent': userAgent,
          'accept': 'text/html,application/xhtml+xml,text/*;q=0.9',
        },
        signal,
      })
    } catch (error: unknown) {
      throw transportFailure(error, signal)
    }
    if (!isRedirect(response.status)) return { response, url: current }
    if (hops >= BING_MAX_REDIRECTS) {
      await response.body?.cancel()
      throw new WebError(`Bing search exceeded the maximum of ${BING_MAX_REDIRECTS} redirects`, 'WEB_PROVIDER_ERROR')
    }
    const location = response.headers.get('location')
    if (location === null) {
      await response.body?.cancel()
      throw new WebError(`Bing answered HTTP ${response.status} without a Location header`, 'WEB_PROVIDER_ERROR')
    }
    await response.body?.cancel()
    let target: URL
    try {
      target = new URL(location, current)
    } catch (error: unknown) {
      throw new WebError(`Bing redirect Location ${JSON.stringify(location)} is not a usable URL`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
    if (target.origin !== initial.origin) {
      throw new WebError(
        `Bing redirected search to ${target.origin}, which is outside the configured origin ${initial.origin}; `
        + 'set the provider searchURL to the origin that answers directly',
        'WEB_PROVIDER_ERROR',
      )
    }
    current = target
  }
}

/**
 * Read the response body within {@link BING_MAX_RESPONSE_CHARS}. A declared
 * over-cap `Content-Length` is refused before any body is read; an undeclared
 * or under-declared body is cut at the cap, which keeps the scan bounded while
 * still covering the result blocks a page places near its start.
 * @param response - the final response.
 * @param signal - the fused deadline signal for this search.
 * @returns the body text, at most {@link BING_MAX_RESPONSE_CHARS} characters.
 * @throws {@link WebError} when the declared length exceeds the cap, or on a read failure.
 */
async function readPage(response: Response, signal: AbortSignal): Promise<string> {
  const declared = response.headers.get('content-length')
  if (declared !== null && Number(declared) > BING_MAX_RESPONSE_CHARS) {
    await response.body?.cancel()
    throw new WebError(`Bing response exceeds the maximum of ${BING_MAX_RESPONSE_CHARS} characters`, 'WEB_PROVIDER_ERROR')
  }
  let body: string
  try {
    body = await response.text()
  } catch (error: unknown) {
    throw transportFailure(error, signal)
  }
  return body.length > BING_MAX_RESPONSE_CHARS ? body.slice(0, BING_MAX_RESPONSE_CHARS) : body
}

/**
 * The failure for a page that yielded no result: a verification interstitial is
 * named as such, and any other unrecognized page says only what was observed,
 * because a query with no results and a changed page layout look alike from here.
 */
function noResultsFailure(html: string, url: URL, status: number): WebError {
  const context = `${url.href} answered HTTP ${status} with ${html.length} characters and no recognizable Bing result block`
  const marker = blockPageMarker(html)
  return marker === undefined
    ? new WebError(
      `${context}. The query may have no results, or Bing's page markup changed; this provider never invents results.`,
      'WEB_PROVIDER_ERROR',
    )
    : new WebError(
      `${context}, and it carries the "${marker}" verification marker: Bing served an interstitial instead of results `
      + '(rate limiting, region gating, or a human check).',
      'WEB_PROVIDER_ERROR',
    )
}

/** The failure for a non-2xx answer, naming rate limiting when the status suggests it. */
function statusFailure(url: URL, status: number): WebError {
  const detail = status === 429 || status === 403 ? ' — the endpoint is rate limiting or challenging this machine' : ''
  return new WebError(`Bing search ${url.href} answered HTTP ${status}${detail}`, 'WEB_PROVIDER_ERROR')
}

/** The Bing results-page search provider. */
export class BingSearchProvider implements WebSearchProvider {
  readonly id = BING_PROVIDER_ID
  readonly title = 'Bing'
  /** Picker description: what this provider suits and what it costs or cannot do. */
  readonly description: NonNullable<WebSearchProvider['description']> = {
    en: 'Searches by fetching and parsing Bing\'s public results page from this machine: no API key and no charges. Results depend on Bing\'s markup and can break, be rate limited, or be region-dependent; no JavaScript runs and no cookies are sent. You can also try DeepSeek Search API.',
    zh: '本机抓取并解析 Bing 公开结果页：免 API Key、无计费。结果依赖 Bing 的页面结构，可能失效、被限流或受地区影响；不执行 JavaScript，也不带 Cookie。也可以试试 DeepSeek Search API',
    ja: 'このマシンから Bing の公開検索結果ページを取得して解析します。API キーも料金も不要です。結果は Bing のマークアップに依存し、壊れたり、レート制限されたり、地域によって変わったりします。JavaScript は実行せず、Cookie も送信しません。DeepSeek Search API も試せます。',
    es: 'Busca obteniendo y analizando la página pública de resultados de Bing desde este equipo: sin clave de API ni cargos. Los resultados dependen del marcado de Bing y pueden dejar de funcionar, sufrir límites de uso o variar por región; no se ejecuta JavaScript ni se envían cookies. También puede probar DeepSeek Search API.',
    fr: 'Recherche en récupérant et en analysant la page de résultats publique de Bing depuis cette machine : sans clé API ni frais. Les résultats dépendent du balisage de Bing et peuvent cesser de fonctionner, être limités en débit ou varier selon la région ; aucun JavaScript n\'est exécuté et aucun cookie n\'est envoyé. Vous pouvez aussi essayer DeepSeek Search API.',
    de: 'Sucht, indem die öffentliche Bing-Ergebnisseite von diesem Rechner abgerufen und ausgewertet wird: ohne API-Schlüssel und ohne Kosten. Ergebnisse hängen vom Markup von Bing ab und können ausfallen, gedrosselt werden oder regionsabhängig sein; es wird kein JavaScript ausgeführt und es werden keine Cookies gesendet. Sie können auch DeepSeek Search API ausprobieren.',
    ru: 'Поиск выполняется загрузкой и разбором общедоступной страницы результатов Bing с этого компьютера: без ключа API и оплаты. Результаты зависят от разметки Bing и могут перестать работать, ограничиваться по частоте или различаться по регионам; JavaScript не выполняется, cookie не отправляются. Можно также попробовать DeepSeek Search API.',
    pt: 'Pesquisa obtendo e analisando a página pública de resultados do Bing nesta máquina: sem chave de API e sem cobranças. Os resultados dependem da marcação do Bing e podem falhar, sofrer limitação de uso ou variar por região; nenhum JavaScript é executado e nenhum cookie é enviado. Você também pode experimentar a DeepSeek Search API.',
  }

  /** @param options - resolved search URL, deadline, agent, and optional market. */
  constructor(private readonly options: BingSearchOptions) {}

  /** Usable when the configured endpoint is fetchable and the deadline is a positive finite value. */
  available(): boolean {
    return isFetchableUrl(this.options.searchURL)
      && Number.isFinite(this.options.timeoutMs) && this.options.timeoutMs > 0
  }

  /**
   * Run one search. Resolution is the seam's: this provider returns every
   * source it parsed, deduplicated by URL, and `maxResults` only shapes the
   * `count` hint sent to Bing.
   * @param request - the query and optional result-count hint.
   * @param signal - optional caller cancellation, fused with the deadline.
   * @returns the parsed sources.
   * @throws {@link WebError} for cancellation, timeout, a non-2xx answer, an unusable page, or no recognizable result.
   */
  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    if (signal?.aborted === true) throw new WebError('Bing search aborted', 'WEB_ABORTED', { cause: signal.reason })
    using search = deadline(signal, this.options.timeoutMs, BING_TIMEOUT_CODE)
    const target = searchUrl(this.options, request)
    const { response, url } = await fetchPage(target, search.signal, this.options.userAgent)
    if (!response.ok) {
      const status = response.status
      await response.body?.cancel()
      throw statusFailure(url, status)
    }
    const html = await readPage(response, search.signal)
    const sources = parseBingResults(html, url.href)
    if (sources.length === 0) throw noResultsFailure(html, url, response.status)
    return { sources, truncated: false }
  }
}
