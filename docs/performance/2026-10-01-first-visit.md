# First visit: public images and rich-text code

Base: `b8b53ae5abe020993ec1a393c61d32f652b4f4b3` (merged PR #426).

The requested targets are **90+ desktop / 85+ mobile**. They are acceptance
targets for a deployed measurement, not scores claimed by this change.

## Production baseline

The supplied [desktop report](https://pagespeed.web.dev/analysis/https-neweuropeanstrategies-com/vhxeeqlh29?form_factor=desktop)
and [mobile report](https://pagespeed.web.dev/analysis/https-neweuropeanstrategies-com/vhxeeqlh29?form_factor=mobile)
were captured on 2026-10-01 around 09:15 UTC with Lighthouse 13.5.0.

| Metric      | Desktop | Mobile |
| ----------- | ------: | -----: |
| Performance |      80 |     68 |
| FCP         |  0.62 s | 2.40 s |
| LCP         |  0.98 s | 5.42 s |
| TBT         |  314 ms | 175 ms |
| Speed Index |  2.41 s | 6.92 s |
| CLS         |       0 |      0 |

These headline metrics use simulated throttling. The reports' observed network
timings are a different measurement: the hero image starts around 2.5 s on
desktop and 3.3 s on mobile. Some small image variants take another 1.5–3 s.
Do not subtract observed timings from simulated LCP.

The screen recording is consistent with late media: text/layout precede the
hero image and logo. The hero already passes all three priority/discoverability
checks (initial HTML, eager loading, high fetch priority). Adding another
priority hint would not fix this cause.

A live browser visit also confirmed an HTML cache HIT, complete content and no
page errors. Absolute timings from the diagnostic environment are unsuitable
for score comparisons because it uses a network proxy.

## Changes

### Share public image responses between visitors

`/media/*` previously fetched Supabase storage for every request, even for
immutable images. Browser Cache-Control does not populate a Worker's Cache API.
The route now uses the existing per-colo Cache API adapter for full image GETs.

- Keys separate public host, storage project, tenant/path, normalized transform
  and the exact Accept header. Negotiation remains upstream-owned.
- Only successful images with a known positive Content-Length up to 5 MiB are
  stored. The production hero and logo have these headers.
- HEAD, range, conditional and explicit cache-bypass requests (no-cache,
  no-store, max-age=0 or Pragma: no-cache) retain the existing storage path.
  Partial responses, failures, video and unknown/large bodies are not stored.
- Writes run under the existing `runAfterResponse`/`waitUntil` helper; they do
  not delay the response. Read/write failures fail open.
- Existing cache lifetimes, validators and Vary headers remain intact. There is
  no application-memory image cache and no buffer before returning the body.

The cache is per Cloudflare colo. A genuinely cold variant still needs storage;
this change does not claim to eliminate that first upstream request.

### Load list normalization only for lists

`RichHtmlView` imported the universal HTML parser even for plain paragraphs.
The existing normalizer already returns immediately for HTML without UL/OL,
but its static import still downloaded the parser.

Ordinary rich text now uses a shared sanitized renderer. List content loads the
normalizer lazily in the browser; SSR retains eager list rendering. Sanitization,
footnotes and list normalization are unchanged. The existing widget Suspense
boundary retains server content while the browser module resolves.

The shared renderer also memoizes the content element: discovering footnotes
must not rewrite unchanged innerHTML and replace its descendant DOM nodes.

Production client builds confirmed that `node-html-parser` is absent from the
ordinary rich-text static dependency graph. The measured reduction in that
graph is approximately **113 kB of JavaScript / 48 kB gzip**. This is a transfer
and parsing reduction, not a promised Lighthouse point increase.

## Verification and remaining measurement

Regression tests cover cross-visitor image reuse, key isolation, normalized
transform reuse, HEAD/conditional/range and forced-refresh bypass, errors, bounded image admission,
nonblocking writes, plain-text sanitization, list loading/updates, synchronous
SSR, footnotes and hydration without replacing the server list DOM.

The 2,000 ms section SSR deadline, release/performance gates, coverage thresholds,
image quality, layout and analytics timing are unchanged. No new dependency is
required.

After deployment, repeat the supplied PageSpeed tests on both devices and test
fresh browser contexts with cold and warmed media variants. Judge the 90/85
targets from those results. The substantial boot bundle, stylesheet and
document-to-image discovery delay remain measurement targets; this PR does not
claim that every first-visit bottleneck is resolved.
