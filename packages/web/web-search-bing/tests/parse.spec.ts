import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { blockPageMarker, decodeEntities, parseBingResults, stripNonContent, textOf } from '../src/parse.ts'

/** Verbatim `li.b_algo` blocks recorded from the live results page. */
const PAGE = readFileSync(new URL('./fixtures/bing-deepseek-harness.html', import.meta.url), 'utf8')

/** The URL the fixture was recorded from; relative links resolve against it. */
const PAGE_URL = 'https://cn.bing.com/search?q=DeepSeek+Harness+github&count=10'

/** Wrap one block's markup in the page shell the parser expects. */
function pageWith(blocks: string, shell = ''): string {
  return `<html><body>${shell}<ol id="b_results">${blocks}</ol></body></html>`
}

/** One realistic block with the fields the parser reads, overridable per case. */
function block(
  options: { href?: string; title?: string; excerpt?: string; nested?: boolean } = {},
): string {
  const {
    href = 'https://example.test/page',
    title = 'Example title',
    excerpt = 'Example excerpt.',
    nested = false,
  } = options
  const links = nested ? '<ul class="b_sitelinks"><li><a href="https://example.test/sub">Sub page</a></li></ul>' : ''
  const body = `<p class="b_lineclamp2">${excerpt}</p>`
  return `<li class="b_algo" data-id iid=SERP.1><h2><a href="${href}">${title}</a></h2>`
    + `<div class="b_caption">${body}</div>${links}</li>`
}

describe('parseBingResults over the recorded page', () => {
  it('reduces every recorded block to a citeable source', () => {
    const sources = parseBingResults(PAGE, PAGE_URL)
    expect(sources.length).toBe(4)
    for (const source of sources) {
      expect(source.url).toMatch(/^https:\/\//u)
      expect(source.title).toBeTruthy()
      expect(source.snippet).toBeTruthy()
    }
    expect(sources.map(source => source.url)).toEqual([
      'https://github.com/deepseek-ai/deepseek-harness/tree/master',
      'https://www.deepseek.com/harness/',
      'https://github.com/deepseek-ai',
      'https://deepseek-harness.github.io/deepseek-harness/guide/quickstart',
    ])
  })

  it('strips highlight tags and decodes entities in titles and excerpts', () => {
    const [first] = parseBingResults(PAGE, PAGE_URL)
    expect(first?.title).toBe('GitHub - deepseek-ai/deepseek-harness: DeepSeek Harness: …')
    expect(first?.snippet).toBe('DeepSeek Harness (dsh) is an open-source agent harness developed by DeepSeek AI. It is built on an everything …')
    expect(JSON.stringify(first)).not.toMatch(/<|&(?:amp|ensp|#0183);/u)
  })

  it('carries the page date as an ISO-8601 date and drops the stamp from the excerpt', () => {
    const sources = parseBingResults(PAGE, PAGE_URL)
    expect(sources[0]?.publishedAt).toBe('2026-08-13')
    expect(sources[1]?.publishedAt).toBe('2026-08-12')
    expect(sources[2]?.publishedAt).toBe('2023-10-21')
    expect(sources[3]?.publishedAt).toBe('2026-10-17')
  })

  it('ignores the recorded page shell: navigation anchors, comments, and inline script', () => {
    // The shell's own anchor and the page title must never become results.
    expect(parseBingResults(PAGE, PAGE_URL).some(source => source.url === 'https://cn.bing.com/')).toBe(false)
    expect(stripNonContent(PAGE)).not.toContain('window.si_ST')
    expect(stripNonContent(PAGE)).not.toContain('Trimmed fixture')
  })

  it('skips a result block that carries no heading, like the recorded trailing block', () => {
    const withEmptyBlock = PAGE.replace(
      '<li class="b_algo" data-id iid=SERP.9000><div class="b_hidden">&nbsp;</div></li>',
      '<li class="b_algo" data-id iid=SERP.9000><div class="b_hidden">&nbsp;</div></li><li class="b_algo"><span>no heading</span></li>',
    )
    expect(parseBingResults(withEmptyBlock, PAGE_URL)).toHaveLength(4)
  })
})

describe('parseBingResults block reduction', () => {
  it('returns an empty list for a page with no result block', () => {
    expect(parseBingResults('<html><body><h2>no results</h2></body></html>', PAGE_URL)).toEqual([])
  })

  it('returns an empty list when the result class changed', () => {
    expect(parseBingResults(pageWith(block().replace('class="b_algo"', 'class="b_algoBorder"')), PAGE_URL)).toEqual([])
  })

  it('skips a block whose heading has no anchor', () => {
    expect(parseBingResults(pageWith('<li class="b_algo"><h2>Title only</h2><p>text</p></li>'), PAGE_URL)).toEqual([])
  })

  it('skips a heading anchor that is not an absolute HTTP(S) link', () => {
    expect(parseBingResults(pageWith(block({ href: 'javascript:alert(1)' })), PAGE_URL)).toEqual([])
    expect(parseBingResults(pageWith(block({ href: 'http://[' })), PAGE_URL)).toEqual([])
  })

  it('resolves a relative anchor against the page URL', () => {
    const [source] = parseBingResults(pageWith(block({ href: '/docs/page?x=1&amp;y=2' })), PAGE_URL)
    expect(source?.url).toBe('https://cn.bing.com/docs/page?x=1&y=2')
  })

  it('omits the title when the heading carries no text', () => {
    const [source] = parseBingResults(pageWith(block({ title: '<strong> </strong>' })), PAGE_URL)
    expect(source?.url).toBe('https://example.test/page')
    expect(source).not.toHaveProperty('title')
  })

  it('reads the excerpt from the block when there is no caption container', () => {
    const markup = '<li class="b_algo"><h2><a href="https://example.test/a">A</a></h2><p>Loose excerpt</p></li>'
    expect(parseBingResults(pageWith(markup), PAGE_URL)[0]?.snippet).toBe('Loose excerpt')
  })

  it('omits the excerpt when the block has no paragraph at all', () => {
    const markup = '<li class="b_algo"><h2><a href="https://example.test/b">B</a></h2><div class="b_caption"></div></li>'
    const [source] = parseBingResults(pageWith(markup), PAGE_URL)
    expect(source).not.toHaveProperty('snippet')
    expect(source).not.toHaveProperty('publishedAt')
  })

  it('keeps a block whose closing tag is missing', () => {
    const markup = '<li class="b_algo"><h2><a href="https://example.test/c">C</a></h2><div class="b_caption"><p>Last</p></div>'
    expect(parseBingResults(`${pageWith('')}${markup}`, PAGE_URL)[0]?.snippet).toBe('Last')
  })

  it('does not end a block early at a nested result list', () => {
    const [source] = parseBingResults(pageWith(block({ nested: true })), PAGE_URL)
    expect(source?.title).toBe('Example title')
    expect(source?.snippet).toBe('Example excerpt.')
  })

  it('reports a duplicated URL once', () => {
    const sources = parseBingResults(pageWith(block() + block({ title: 'Same URL again' })), PAGE_URL)
    expect(sources).toHaveLength(1)
    expect(sources[0]?.title).toBe('Example title')
  })
})

describe('excerpt dates', () => {
  it('reads a leading English date stamp', () => {
    const [source] = parseBingResults(pageWith(block({ excerpt: 'Oct 29, 2026&ensp;&#0183;&ensp;Body text' })), PAGE_URL)
    expect(source?.publishedAt).toBe('2026-10-29')
    expect(source?.snippet).toBe('Body text')
  })

  it('reads a stamp that is the whole excerpt', () => {
    const [source] = parseBingResults(pageWith(block({ excerpt: '2026年8月13日' })), PAGE_URL)
    expect(source?.publishedAt).toBe('2026-08-13')
    expect(source).not.toHaveProperty('snippet')
  })

  it('does not treat a date opening prose as a page stamp', () => {
    const excerpt = '2026 年 8 月 13 日，DeepSeek 正式开源其首款 Agent Harness'
    const [source] = parseBingResults(pageWith(block({ excerpt })), PAGE_URL)
    expect(source).not.toHaveProperty('publishedAt')
    expect(source?.snippet).toBe(excerpt)
  })

  it('does not treat an unlisted month name as a stamp', () => {
    const [source] = parseBingResults(pageWith(block({ excerpt: 'Foo 12, 2026 bar' })), PAGE_URL)
    expect(source).not.toHaveProperty('publishedAt')
    expect(source?.snippet).toBe('Foo 12, 2026 bar')
  })
})

describe('text helpers', () => {
  it('decodes named, numeric, and uppercase entity references', () => {
    expect(decodeEntities('&amp; &lt;b&gt; &#0183; &#x2014; &AMP;')).toBe('& <b> · — &')
  })

  it('leaves unknown and out-of-range references verbatim', () => {
    expect(decodeEntities('&bogus; &#0; &#1114112;')).toBe('&bogus; &#0; &#1114112;')
  })

  it('drops inline tags without splitting words and keeps a line break as a space', () => {
    expect(textOf('  <strong>Deep</strong> <em>Seek</em>\u2002Harness  ')).toBe('Deep Seek Harness')
    expect(textOf('<strong>deepseek</strong>-ai/<strong>harness</strong>')).toBe('deepseek-ai/harness')
    expect(textOf('first<br/>second')).toBe('first second')
    expect(textOf('<span></span>')).toBe('')
  })

  it('removes scripts, styles, noscript, and comments, including unterminated ones', () => {
    const html = '<p>keep</p><script>var x = "<p>no</p>"</script><style>p{color:red}</style>'
      + '<noscript><p>no</p></noscript><!-- <p>no</p> --><script>var y = 1'
    const stripped = stripNonContent(html)
    expect(stripped).toContain('<p>keep</p>')
    for (const dropped of ['var x', 'color:red', 'noscript', 'var y']) expect(stripped).not.toContain(dropped)
  })

  it('reports the verification phrase of an interstitial page', () => {
    expect(blockPageMarker('<div id="b_captcha">g-recaptcha</div>')).toBe('g-recaptcha')
    expect(blockPageMarker('<p>请输入验证码</p>')).toBe('请输入验证码')
    expect(blockPageMarker(PAGE)).toBeUndefined()
  })
})
