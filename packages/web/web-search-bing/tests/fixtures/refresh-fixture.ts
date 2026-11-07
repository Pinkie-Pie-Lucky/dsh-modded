/**
 * Maintenance tool: re-record `bing-deepseek-harness.html` from the live
 * service. Run it by hand (`node --import tsx/esm
 * packages/web/web-search-bing/tests/fixtures/refresh-fixture.ts`) when Bing's
 * markup changes, then review the diff before trusting the parser again.
 * Nothing in the offline suites runs this file.
 */

import { writeFileSync } from 'node:fs'

/** Agent matching the provider default, so the recording is what the provider sees. */
const USER_AGENT = 'deepseek-harness/0.0.1 (+https://github.com/deepseek-ai)'

/** Query whose results the fixture pins. */
const QUERY = 'DeepSeek Harness github'

/** Blocks kept in the fixture, enough to cover a dated and an undated result. */
const KEPT_BLOCKS = 4

const page = `https://cn.bing.com/search?q=${encodeURIComponent(QUERY)}&count=10`
const response = await fetch(page, { headers: { 'user-agent': USER_AGENT, 'accept': 'text/html,application/xhtml+xml' } })
const body = await response.text()

const BLOCK = /<li\b[^>]*\bclass="b_algo"[^>]*>/giu
const LIST = /<\/?li\b[^>]*>/giu

/** Index of the block's closing tag, balancing nested lists. */
function blockEnd(content: string, from: number): number {
  LIST.lastIndex = from
  let depth = 1
  for (let token = LIST.exec(content); token !== null; token = LIST.exec(content)) {
    depth += token[0].startsWith('</') ? -1 : 1
    if (depth === 0) return token.index
  }
  return content.length
}

const blocks: string[] = []
let cursor = 0
for (;;) {
  BLOCK.lastIndex = cursor
  const start = BLOCK.exec(body)
  if (start === null) break
  const stop = blockEnd(body, BLOCK.lastIndex)
  blocks.push(body.slice(start.index, stop + '</li>'.length))
  cursor = stop
}

// Bing prepends a long stylesheet-link run to its first block; three links keep
// the "non-content inside a result block" case without the bulk.
const kept = blocks.slice(0, KEPT_BLOCKS).map((block, index) => index === 0
  ? block.replace(/(<link rel="stylesheet" href="\/rp\/[^"]*" type="text\/css"\/>){3,}/u, '<link rel="stylesheet" href="/rp/first.br.css" type="text/css"/>')
  : block)

const script = body.slice(body.indexOf('<script'), body.indexOf('</script>') + '</script>'.length)
const fixture = `<!-- Trimmed fixture: verbatim \`li.b_algo\` blocks from ${page}
     recorded ${new Date().toISOString()} with user-agent "${USER_AGENT}" (HTTP ${response.status}).
     The page shell keeps only the parts the parser reads; block markup is unedited. -->
<!DOCTYPE html><html dir="ltr" lang="zh" xml:lang="zh"><head><title>${QUERY} - 搜索</title>
${script}
</head><body>
<header id="b_header"><nav><a href="https://cn.bing.com/">跳至内容</a></nav></header>
<ol id="b_results">
${kept.join('\n')}
<li class="b_algo" data-id iid=SERP.9000><div class="b_hidden">&nbsp;</div></li>
</ol>
<aside id="b_context"><h2>相关搜索</h2></aside>
</body></html>
`
writeFileSync(new URL('./bing-deepseek-harness.html', import.meta.url), fixture)
console.log(`recorded ${String(blocks.length)} blocks, kept ${String(kept.length)}, ${String(fixture.length)} bytes, HTTP ${String(response.status)}`)
