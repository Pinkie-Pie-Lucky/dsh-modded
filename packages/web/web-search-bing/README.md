---
description: "The Bing results-page search provider for ctx.web: how deployments mount keyless HTML search that fetches and parses Bing's public results page, what it reports, and what it cannot guarantee."
kind: "package-reference"
---

# @deepseek-ai/dsh-web-search-bing

English | [中文](README.zh.md)

## Summary

With `dsh-web-search-bing`, the harness searches the web through Bing's public results page: the provider fetches that page from this machine, reduces its `li.b_algo` blocks to titles, URLs, excerpts, and dates, and reports only what the page contained. Choose it when no search API works and a third party's HTML is acceptable as the source. Nothing is invented — a page that cannot be reduced fails instead of yielding results — and nothing is executed: no JavaScript, no cookies, and no instructions are taken from the markup. One search is one bounded HTTP GET registered as the `bing` search provider.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the provider in a composition that already loads the web service; it registers as the `bing` search provider, so `ctx.web.search()` resolves it automatically when it is the only usable search backend — or pin it with `searchProvider: bing`. Pin it explicitly whenever another search provider is also usable, because two usable providers make the seam report `WEB_PROVIDER_AMBIGUOUS` rather than choose.

### When to choose it

Choose this backend when a deployment has no working search API and can accept Bing's public results page as the only source of results. It needs no credential at all, so it also works where an API key is unavailable. Avoid it when result completeness, availability, or stability matters more than a working search: the provider depends on a page it does not control, and every limit in [Known Limitations and Deferred Work](#known-limitations-and-deferred-work) follows from that dependency.

### Minimal configuration

Load the web service and the provider. The endpoint defaults to `https://cn.bing.com/search`, the regional host that answers directly on machines where `www.bing.com` replies with a cross-origin redirect; point `searchURL` at whichever results host answers directly for the deployment.

```yaml
- name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: bing
- name: '@deepseek-ai/dsh-web-search-bing'
  config:
    searchURL: https://cn.bing.com/search
```

| Field | Default | Meaning |
|---|---|---|
| `searchURL` | `https://cn.bing.com/search` | Absolute results-page URL; `q`, an optional `mkt`, and a `count` hint are merged into the parameters it already carries. A value that is not an absolute HTTP(S) URL fails the mount |
| `timeoutMs` | `30000` | Positive deadline in milliseconds for one search, within Node's timer range; the timeout fails as `WEB_SEARCH_TIMEOUT` |
| `userAgent` | `deepseek-harness/0.0.1 (+https://github.com/deepseek-ai)` | `User-Agent` header sent on every request. The default is sent deliberately: this endpoint answered it with the same results as a browser agent |
| `market` | omitted | Bing market (`mkt`) parameter such as `en-US`; omitted sends none, and an empty value is treated as omitted |

### What a search returns

`content` is always omitted: this provider has no answer text and will not synthesize one. `sources[]` comes from the page's `li.b_algo` blocks — `title` from the block heading, `url` from that heading's anchor, `snippet` from the excerpt paragraph, and `publishedAt` from the date stamp Bing prints before the excerpt, rendered as an ISO-8601 date at the day precision the page exposes. A result block whose heading carries no absolute HTTP(S) link is dropped, duplicates are reported once, and `maxResults` is applied twice: `count` at the request layer as a hint, and truncation by the seam on the way back.

### Failures and recovery

Failures are `WebError` values with a machine-routable code. Cancellation is `WEB_ABORTED` and the provider's own deadline is `WEB_SEARCH_TIMEOUT`; a non-2xx answer, an unusable page, and a page that yields no result are `WEB_PROVIDER_ERROR`. A page that yields nothing is never turned into results: the message says that it observed no recognizable Bing result block, gives the status and length it saw, and names the verification marker when the page carries one, because a query with no results and a changed page layout look alike from the provider's side. A redirect that would leave the configured origin is refused with the origin it points at, so a search never follows the endpoint away from the deployment's choice.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the provider; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

The provider is built on three commitments:

- **Report, never invent.** Only fields the page actually carries become sources. A block without a usable heading link is skipped rather than filled from the block's display domain, and a page the parser cannot reduce fails with what was observed instead of returning an empty success.
- **Markup is data.** The fetched body is never executed and never read as instructions: inline scripts and styles are dropped before any candidate text is examined, and nothing in the page can change what the provider does next.
- **The transport is the machine's, not this package's.** Requests go through the process-wide `fetch`, which resolves the dispatcher `@deepseek-ai/dsh-http-proxy` installs, so a configured proxy applies with no code here. Because only workspace packages and no third-party module are imported, the plugin has no runtime dependency beyond the harness itself.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Config schema, mount-time validation, and provider registration |
| [`src/provider.ts`](src/provider.ts) | `BingSearchProvider`: URL construction, bounded GET, redirect policy, page size cap, and error classification |
| [`src/parse.ts`](src/parse.ts) | Pure reduction of page markup: non-content removal, entity decoding, block scanning, and date stamps |

### Request flow

One search captures the resolved options, builds the results URL by merging `q`, an optional `mkt`, and a clamped `count` into the configured page, and issues one GET with the fused deadline signal. Same-origin redirects are followed up to the hop cap and a cross-origin one is refused; a declared over-cap `Content-Length` is rejected before the body is read and an undeclared over-cap body is cut at the cap. The body then goes to the pure parser, which strips non-content, scans balanced `li.b_algo` blocks, and reduces each to the source fields. Zero sources is a failure naming what the provider saw, not an empty result.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the shared vocabulary to the service and the model-facing tool.

- [Web subsystem](../../../docs/subsystems/web.md) — the exhaustive search request/result vocabulary and error codes.
- [Web package map](../README.md) — the web package family and each role.
- [dsh-web](../web/README.md) — the web service this provider registers into, including its provider-selection rules.
- [dsh-tool-web](../tool-web/README.md) — the model-facing `web_search` tool that renders this provider's sources.
- [dsh-web-fetch-http](../web-fetch-http/README.md) — the sibling backend whose bounded-HTTP conventions this provider follows.
- [Web capability seam decision](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md) — why search and fetch share one provider-selection service.

-----

<a id="model-experience"></a>
## Model Experience

### Conversation tool result, indirectly

#### What the model sees

Through `dsh-tool-web`, the conversation model sees each source's URL, title, excerpt, and date, plus this provider's exact failures. Those include `Bing search timed out`, `Bing search aborted`, `Bing search <url> answered HTTP <status>`, the rate-limiting wording appended for HTTP 429 and 403, the no-result failure naming the status, length, and verification marker it observed, and the cross-origin redirect refusal. The consumer owns the error wrapper and the untrusted-content notice.

#### Token effect

Zero direct conversation tokens from registration. Result tokens scale with the returned sources and their excerpts, and the seam truncates `sources[]` to the request's `maxResults` before the tool renders them.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Fetched page markup

#### What the model sees

Nothing from the fetched page itself. The raw markup never reaches a model request: only the reduced source fields do, and inline scripts, styles, and comments are dropped before any text is examined. Page text that looks like an instruction is therefore data the model may read as an excerpt, never something the provider acts on.

#### Token effect

No page bytes are forwarded; only the reduced fields count, so a 130 KB page and a 90 KB page cost the same when they yield the same sources.

#### KV Cache effect

None of its own: the reduction happens before the tool result is written, so the cache behavior is the one the tool result already has.

### Conversation tool list, indirectly

#### What the model sees

Nothing from this package directly. The provider declares no `ready()`, so the seam counts it as ready and `dsh-tool-web` keeps offering `web_search` with its own schema and prompt guidance; this plugin contributes no prompt section and no tool definition of its own.

#### Token effect

Zero: registering a provider adds no schema and no guidance text to a request.

#### KV Cache effect

None: the declared tool set is unchanged by mounting this provider.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the provider is incomplete or unavailable. They are current package constraints, and every one of them is measured or directly implied by how the provider works.

- **The source of results is a page this package does not control** — Bing can change its markup at any time, and a changed page fails as `WEB_PROVIDER_ERROR` rather than degrading to partial results.
- **Only the first results page is read** — `count` is a hint the endpoint answered without honoring on every recorded query, and the seam truncates what came back, so requesting more results does not fetch a second page.
- **Rate limiting and human checks are reported, not worked around** — an interstitial or a 429 fails the search; the provider sends no cookies, solves no challenge, and retries nothing.
- **Results are region-, language-, and session-dependent** — the same query answered differently across markets in testing, `market` selects the `mkt` parameter, and the provider sends no cookies or sign-in state.
- **`publishedAt` is day-precision and often absent** — it is the date stamp Bing prints before an excerpt, and a page without one yields a source without a date; the display domain Bing shows has no field in the source shape, so it is not reported separately from the URL.
- **`summary` is never set** — the source shape's longer excerpt is not populated, because the page provides only the one excerpt shown.
- **One search is one page fetch with no ranking signal** — the provider reports the page's order and does not re-rank, deduplicates only by URL, and cannot merge several pages.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior, limits, and rationale live in the sections above and the linked Agent Notes.

#### Generated artifacts that a new package still needs

The recorded fixture under [`tests/fixtures/`](tests/fixtures/bing-deepseek-harness.html) is pinned to the live page at the time of writing and is refreshed by [`tests/fixtures/refresh-fixture.ts`](tests/fixtures/refresh-fixture.ts), which is a manual tool and not part of any suite. The repository's generated catalogs (the `tsconfig.base.json` alias region, the configuration catalog, and the doc graphs) gain this package only when their generators are run, which is why the profile layer must resolve the package by another route until then.

</details>
