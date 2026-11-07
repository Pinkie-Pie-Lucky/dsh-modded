/**
 * Pure reduction of a Bing HTML results page to the seam's citeable sources:
 * entity decoding, non-content removal, and per-block title, link, excerpt, and
 * date extraction. No network, clock, or module state, so a saved page pins it.
 *
 * The fetched markup is UNTRUSTED DATA. It is only ever reduced to text here —
 * never executed, and never interpreted as instructions — and a block that
 * carries no usable title and absolute HTTP(S) link is dropped rather than
 * filled in from a guess: a wrong result is worse than a missing one.
 * @module @deepseek-ai/dsh-web-search-bing/parse
 */

import type { WebSearchSource } from '@deepseek-ai/dsh-web'

/**
 * Elements whose content is never result text. Each is replaced by a single
 * space so the surrounding text cannot fuse into one token, and the
 * unterminated forms are dropped too, because a truncated page would otherwise
 * leave a script body in the candidate text.
 */
const NON_CONTENT_PATTERNS: readonly RegExp[] = [
  /<!--[\s\S]*?-->/gu,
  /<script\b[^>]*>[\s\S]*?<\/script>/giu,
  /<style\b[^>]*>[\s\S]*?<\/style>/giu,
  /<noscript\b[^>]*>[\s\S]*?<\/noscript>/giu,
  /<script\b[^>]*>[\s\S]*$/iu,
  /<style\b[^>]*>[\s\S]*$/iu,
]

/** One organic result block: Bing renders each as `<li class="b_algo">…</li>`. */
const BLOCK_START = /<li\b[^>]*\bclass="b_algo"[^>]*>/giu

/** One `li` open or close tag; `<link …>` cannot match because `li` needs a word boundary. */
const LIST_TOKENS = /<\/?li\b[^>]*>/giu

/** The block's heading, which carries the result link. */
const TITLE = /<h2\b[^>]*>([\s\S]*?)<\/h2>/iu

/** The first anchor of the heading; only its `href` is read. */
const ANCHOR_HREF = /<a\b[^>]*\bhref="([^"]*)"/iu

/** The excerpt container Bing renders under a result's heading. */
const CAPTION = /<div\b[^>]*\bclass="b_caption"[^>]*>/iu

/** One paragraph; the excerpt's text lives here. */
const PARAGRAPH = /<p\b[^>]*>([\s\S]*?)<\/p>/iu

/**
 * A leading `YYYY年M月D日` stamp, which Bing prints immediately before an
 * excerpt it dates. A trailing CJK comma deliberately does not match: that is
 * prose whose first sentence happens to start with a date, not a page stamp.
 */
const CJK_DATE = /^(\d{4})年(\d{1,2})月(\d{1,2})日(?=[\s\u00b7\u2022\u2013-]|$)/u

/** English month names in calendar order; {@link EN_DATE} is built from this list. */
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

/** A leading English stamp such as `Oct 29, 2026`. */
const EN_DATE = new RegExp(`^(${EN_MONTHS.join('|')}) (\\d{1,2}), (\\d{4})(?=[\\s\\u00b7\\u2022\\u2013-]|$)`, 'u')

/** Separators Bing places between a date stamp and the excerpt that follows it. */
const DATE_SEPARATOR = /^[\s\u00b7\u2022\u2013\u2014-]+/u

/** Named entities Bing emits in titles and excerpts, keyed by their lowercase name. */
const NAMED_ENTITIES: ReadonlyMap<string, string> = new Map([
  ['amp', '&'], ['lt', '<'], ['gt', '>'], ['quot', '"'], ['apos', "'"],
  ['nbsp', '\u00a0'], ['ensp', '\u2002'], ['emsp', '\u2003'], ['thinsp', '\u2009'],
  ['middot', '\u00b7'], ['bull', '\u2022'], ['hellip', '\u2026'], ['mdash', '\u2014'],
  ['ndash', '\u2013'], ['lsquo', '\u2018'], ['rsquo', '\u2019'], ['ldquo', '\u201c'],
  ['rdquo', '\u201d'], ['laquo', '\u00ab'], ['raquo', '\u00bb'], ['copy', '\u00a9'],
  ['reg', '\u00ae'], ['trade', '\u2122'], ['deg', '\u00b0'], ['times', '\u00d7'],
  ['divide', '\u00f7'], ['plusmn', '\u00b1'], ['frac12', '\u00bd'], ['euro', '\u20ac'],
  ['pound', '\u00a3'], ['yen', '\u00a5'], ['cent', '\u00a2'], ['sect', '\u00a7'],
  ['para', '\u00b6'], ['prime', '\u2032'], ['Prime', '\u2033'], ['larr', '\u2190'],
  ['rarr', '\u2192'], ['harr', '\u2194'],
])

/** One entity reference: decimal, hexadecimal, or named. */
const ENTITY = /&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/giu

/** Phrases served by an interstitial instead of results; matched case-insensitively. */
const BLOCK_PAGE_MARKERS: readonly string[] = [
  'unusual traffic',
  'verify you are human',
  'are you a robot',
  'g-recaptcha',
  'b_captcha',
  '验证你是人类',
  '请输入验证码',
]

/** Decode a caret-free entity body, or `undefined` when this table does not know it. */
function decodeEntity(body: string): string | undefined {
  if (body.startsWith('#')) {
    const hexadecimal = body[1] === 'x' || body[1] === 'X'
    const code = Number.parseInt(hexadecimal ? body.slice(2) : body.slice(1), hexadecimal ? 16 : 10)
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : undefined
  }
  return NAMED_ENTITIES.get(body) ?? NAMED_ENTITIES.get(body.toLowerCase())
}

/**
 * Decode the HTML entity references Bing writes into titles, excerpts, and
 * links. An entity this table does not know is left verbatim: guessing a
 * meaning would corrupt the text, and dropping it would lose characters.
 * @param text - text possibly carrying entity references.
 * @returns the text with every known reference replaced by its character.
 */
export function decodeEntities(text: string): string {
  return text.replace(ENTITY, (match, body: string) => decodeEntity(body) ?? match)
}

/**
 * Reduce one markup fragment to displayable text: a line break becomes a space,
 * other tags are dropped, known entities are decoded, and whitespace runs
 * collapse to one space. Tags are dropped rather than turned into spaces because
 * Bing highlights inside words (`<strong>deepseek</strong>-ai` must read
 * `deepseek-ai`), and tags are removed before decoding so text that merely
 * spells a tag cannot become one.
 * @param fragment - markup fragment such as a heading's or paragraph's inner HTML.
 * @returns the collapsed plain text, without surrounding whitespace.
 */
export function textOf(fragment: string): string {
  const spaced = fragment.replace(/<br\b[^>]*>/giu, ' ')
  return decodeEntities(spaced.replace(/<[^>]*>/gu, '')).replace(/\s+/gu, ' ').trim()
}

/**
 * Drop elements that are never result text, so inline JavaScript and CSS cannot
 * reach the text reduction or the block scan.
 * @param html - the raw response body.
 * @returns the body without comments, scripts, styles, or noscript content.
 */
export function stripNonContent(html: string): string {
  let stripped = html
  for (const pattern of NON_CONTENT_PATTERNS) stripped = stripped.replace(pattern, ' ')
  return stripped
}

/**
 * Report the verification phrase a page carries, if any. Callers consult this
 * only for a page that yielded no results, where such a phrase explains the
 * outcome instead of leaving a bare parse failure.
 * @param html - the raw response body.
 * @returns the matched phrase, or `undefined` for a page carrying none.
 */
export function blockPageMarker(html: string): string | undefined {
  const lowered = html.toLowerCase()
  return BLOCK_PAGE_MARKERS.find(marker => lowered.includes(marker))
}

/**
 * Find the end index of the result block opened at `from`, by balancing `li`
 * tags so a nested list (Bing's sitelinks) cannot end the block early.
 * @param content - non-content-stripped page markup.
 * @param from - index just past the block's opening tag.
 * @returns the index of the block's closing tag, or the end of the document when it is unterminated.
 */
function blockEnd(content: string, from: number): number {
  LIST_TOKENS.lastIndex = from
  let depth = 1
  for (let token = LIST_TOKENS.exec(content); token !== null; token = LIST_TOKENS.exec(content)) {
    depth += token[0].startsWith('</') ? -1 : 1
    if (depth === 0) return token.index
  }
  return content.length
}

/** Resolve a block's `href` against the page, admitting only absolute HTTP(S) links. */
function resultUrl(href: string, pageUrl: string): string | undefined {
  let url: URL
  try {
    url = new URL(decodeEntities(href), pageUrl)
  } catch (_unusableHref) {
    return undefined
  }
  return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined
}

/** The excerpt paragraph of one block: the caption's when there is one, else the block's first. */
function excerptParagraph(block: string): string | undefined {
  const caption = CAPTION.exec(block)
  const source = caption === null ? block : block.slice(caption.index)
  return PARAGRAPH.exec(source)?.[1]
}

/** Render a day-precision date stamp as the ISO-8601 date the seam's sources carry. */
function isoDate(year: string, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * Split a date stamp off the start of an excerpt. Bing prints the page's date
 * before the excerpt itself; the stamp is reported as `publishedAt` at the
 * day precision Bing exposes, and removed from the excerpt text.
 * @param excerpt - the collapsed excerpt text.
 * @returns the excerpt without its stamp, and the stamp as an ISO-8601 date when one was present.
 */
function splitDate(excerpt: string): { readonly excerpt: string; readonly publishedAt?: string } {
  const cjk = CJK_DATE.exec(excerpt)
  if (cjk !== null) {
    return {
      excerpt: excerpt.slice(cjk[0].length).replace(DATE_SEPARATOR, ''),
      publishedAt: isoDate(cjk[1] as string, Number(cjk[2]), Number(cjk[3])),
    }
  }
  const english = EN_DATE.exec(excerpt)
  if (english === null) return { excerpt }
  const month = EN_MONTHS.indexOf(english[1] as (typeof EN_MONTHS)[number]) + 1
  return {
    excerpt: excerpt.slice(english[0].length).replace(DATE_SEPARATOR, ''),
    publishedAt: isoDate(english[3] as string, month, Number(english[2])),
  }
}

/**
 * Reduce one result block to a source, or `undefined` when it carries no usable
 * result. A block is usable when it has a heading whose anchor resolves to an
 * absolute HTTP(S) URL; every other field is optional, exactly as
 * `WebSearchSource` declares, so an absent excerpt or date is omitted.
 * @param block - the block's inner markup.
 * @param pageUrl - the page URL relative links resolve against.
 * @returns the source, or `undefined` for a block with no usable heading link.
 */
function reduceBlock(block: string, pageUrl: string): WebSearchSource | undefined {
  const heading = TITLE.exec(block)
  if (heading === null) return undefined
  const href = ANCHOR_HREF.exec(heading[1] as string)
  if (href === null) return undefined
  const url = resultUrl(href[1] as string, pageUrl)
  if (url === undefined) return undefined
  const title = textOf(heading[1] as string)
  const paragraph = excerptParagraph(block)
  const excerpt = splitDate(paragraph === undefined ? '' : textOf(paragraph))
  return {
    url,
    ...title.length > 0 ? { title } : {},
    ...excerpt.excerpt.length > 0 ? { snippet: excerpt.excerpt } : {},
    ...excerpt.publishedAt === undefined ? {} : { publishedAt: excerpt.publishedAt },
  }
}

/**
 * Parse one Bing results page. Blocks that carry no usable heading link are
 * skipped (Bing's own filled-in blocks have none), duplicate URLs are reported
 * once, and nothing is invented: an unrecognized page yields an empty list,
 * which the caller reports instead of turning into results.
 * @param html - the raw response body.
 * @param pageUrl - the URL the body was fetched from, used to resolve relative links.
 * @returns the sources in page order, deduplicated by URL.
 */
export function parseBingResults(html: string, pageUrl: string): WebSearchSource[] {
  const content = stripNonContent(html)
  const sources: WebSearchSource[] = []
  const seen = new Set<string>()
  let cursor = 0
  for (;;) {
    BLOCK_START.lastIndex = cursor
    const start = BLOCK_START.exec(content)
    if (start === null) break
    const end = blockEnd(content, BLOCK_START.lastIndex)
    cursor = end
    const source = reduceBlock(content.slice(BLOCK_START.lastIndex, end), pageUrl)
    if (source === undefined || seen.has(source.url)) continue
    seen.add(source.url)
    sources.push(source)
  }
  return sources
}
