# First visit: why warm `/en` LCP is bimodal (272 vs 552 ms)

Follow-up to PR #431 (head `3c38ec4`, base `df7deb4`). Continuation of the
"remaining work" list in that PR: check CI on the exact head, explain the
unstable LCP, remeasure production.

## Summary

The LCP element of the synthetic homepage is the cover image of the first
`post-list` card (widget `…001d`). That widget is **not part of the first
paint**. Streaming SSR ships every code-split widget (`React.lazy` in
`lazyWidgets.tsx`, wrapped by `DeferredWidgetView`) as a pending Suspense
boundary: a 40 px placeholder `<div data-chrome-widget-pending="post-list">`
in the shell, and the real card HTML later in the same document, swapped in by
React's inline `$RC` script. The browser parser reaches that completion segment
only after the rest of the shell (≈ 250 kB of HTML with 50 inline `<style>`
blocks), so the card, its image and the layout below it appear in a later
frame. On the CI runner that frame lands either right after first paint
(LCP ≈ FCP + ~10 ms ≈ 272 ms) or after the main thread has been taken by the
module evaluation/hydration task that ends just before `__nesAppReady`
(LCP ≈ ready − 0…22 ms ≈ 552–596 ms). Nothing in between is possible, hence
two modes. The accompanying 0.0168 layout shift is the swap itself (everything
below the card moves down by 219 px; header chrome widgets `account-link` /
`search-button` are deferred the same way and widen the header row from 134 to
384 px).

This is application behaviour, not harness noise: the edge cache stores and
replays the streamed body, so every warm HIT for a real browser carries the
same placeholder-then-swap structure. Bots (`isbot`) receive the buffered,
complete document instead, which is why `curl` shows every boundary resolved.

## 1. CI and review state of PR #431 (head `3c38ec4`)

- Review threads: none. Codex review completed with no findings.
- Checks on this head: `first-visit` passed (run 36912399064, 32/32 within
  limits), `verify`, `build`, `test`, `test-shards 1–4`, `pg-harness`, `pgtap`,
  `e2e`, `e2e-seeded`, `lighthouse` (mode C, warnings only: `/en` performance
  0.77, LCP 2646 ms, SRT 617 ms on localhost with `placeholder.supabase.co`
  unreachable), `cms-widgets` ×4, "Required release checks" all green;
  `post-deploy` skipped (pull request).
- The green result of PR #429 was not reused: the measurements below come
  from the `first-visit` job logs of runs 36903850466 (failed, `80a65b8`),
  36909586385 (passed, `0272e58`) and the local artifact built from this head.

## 2. Evidence

### 2.1 CI logs: the late LCP lands in the frame of the layout shift

Warm `/en`, failed run on `80a65b8` (`FIRST_VISIT` lines, ms):

| side      | s   | FCP | LCP | ready | shift (at, value) |
| --------- | --- | --: | --: | ----: | ----------------- |
| baseline  | 1   | 192 | 596 |   599 | 563, 0.0146       |
| baseline  | 2   | 140 | 284 |   568 | 246, 0.0168       |
| baseline  | 3   | 264 | 264 |   568 | none              |
| baseline  | 4   | 184 | 268 |   594 | 242, 0.0168       |
| baseline  | 5   | 216 | 272 |   573 | 250, 0.0168       |
| baseline  | 6   | 260 | 260 |   572 | 227, 0.0168       |
| baseline  | 7   | 276 | 276 |   598 | 235, 0.0168       |
| candidate | 1   | 168 | 552 |   574 | 529, 0.0168       |
| candidate | 2   | 176 | 564 |   582 | 534, 0.0168       |
| candidate | 3   | 176 | 552 |   557 | 526, 0.0168       |
| candidate | 4   | 236 | 336 |   593 | 314, 0.0168       |
| candidate | 5   | 184 | 596 |   594 | 561, 0.0168       |
| candidate | 6   | 212 | 552 |   565 | 531, 0.0168       |
| candidate | 7   | 208 | 272 |   587 | 251, 0.0168       |

In all 28 warm `/en` samples of both runs LCP = shift time + 20…35 ms, and
the shift always lists the same sources: the header toolbar row
(`flex flex-row flex-nowrap … justify-center`), the frames of widgets `…001e`
and `…001f` (the two widgets below the card in the first column) and two
`::before` column dividers. The six slow samples are 0–22 ms before
`readyMs`. `beforeInteraction.lcp` equals the final `lcpMs` in every warm
sample, so the theme click (end of LCP candidate collection) plays no part.

The run on this head (`3c38ec4`, job 110538018113) already carries the PR's
`lcpEntries` and `paintResources`. Warm `/en`, both sides (ms):

| side      | s   | FCP | LCP | ready | image bytes | shift | LCP entries (start, loadTime, element)                |
| --------- | --- | --: | --: | ----: | ----------- | ----: | ----------------------------------------------------- |
| baseline  | 1   | 200 | 248 |   534 | 37–80       |   228 | (200, 0, H3 `…0021`), (248, 210, IMG `…001d`)         |
| baseline  | 2   | 224 | 268 |   561 | 42–97       |   192 | (224, 0, H3 `…0021`), (268, 202, IMG `…001d`)         |
| baseline  | 3   | 128 | 280 |   531 | 42–91       |   245 | (128, 0, SPAN), (216, 0, H3), (280, 225, IMG `…001d`) |
| baseline  | 4   | 224 | 224 |   511 | 38–84       |   191 | (224, 174, IMG `…001d`)                               |
| baseline  | 5   | 224 | 596 |   482 | 37–81       |   569 | (224, 0, H3 `…0021`), (596, 538, IMG `…001d`)         |
| baseline  | 6   | 208 | 208 |   538 | 39–91       |   182 | (208, 164, IMG `…001d`)                               |
| baseline  | 7   | 192 | 268 |   535 | 41–96       |   234 | (192, 0, H3 `…0021`), (268, 214, IMG `…001d`)         |
| candidate | 1   | 204 | 244 |   489 | 43–90       |   212 | (204, 0, H3 `…0021`), (244, 206, IMG `…001d`)         |
| candidate | 2   | 240 | 240 |   513 | 40–83       |   202 | (240, 185, IMG `…001d`)                               |
| candidate | 3   | 124 | 624 |   524 | 38–85       |   587 | (124, 0, SPAN), (220, 0, H3), (624, 503, IMG `…001d`) |
| candidate | 4   | 220 | 220 |   532 | 40–83       |   190 | (220, 172, IMG `…001d`)                               |
| candidate | 5   | 228 | 228 |   514 | 40–94       |   201 | (228, 182, IMG `…001d`)                               |
| candidate | 6   | 188 | 248 |   529 | 38–90       |   211 | (188, 0, H3 `…0021`), (248, 195, IMG `…001d`)         |
| candidate | 7   | 244 | 244 |   533 | 40–89       |   209 | (244, 192, IMG `…001d`)                               |

The final candidate is the card image in `…001d` in 14/14 samples; its bytes
are always in by ~95 ms, yet its `loadTime` (the moment the `<img>` element
exists and is complete) is 164–225 ms in the fast samples and 503/538 ms in
the two slow ones, each ~20 ms before the shift and 30–90 ms after `readyMs`
on this faster runner. When the swap precedes the first paint (`loadTime` <
FCP) the image is the first and only candidate and LCP = FCP.

### 2.2 Local artifact (this head, Chromium 1194, 4 vCPU): the image is painted when its widget is swapped in

12 warm `/en` samples with the PR's `lcpEntries` and `paintResources`:

- `image.svg` bytes arrive at 97–172 ms (preloaded) in every sample.
- The LCP entry is `IMG` in widget `…001d` (size 42 350 px²); its `loadTime`
  is 293–704 ms, i.e. 150–600 ms after the bytes, and `renderTime` =
  `loadTime` + 40…120 ms. The 0.0168 shift is at `loadTime` + ~20 ms.
- In the one sample where the image "loaded" before FCP (293 < 416) there is
  no shift and LCP = FCP.

Frame-by-frame DOM snapshots under the same spec (temporary probe, not
committed) show the cause of the late `loadTime`:

```
t=295  doc 153 kB parsed  widget 001d innerHTML:
       <!--$?--><template id="B:2"></template>
       <div data-chrome-widget-pending="post-list" style="min-height:40px;width:100%"></div><!--/$-->
t=553  doc 270 kB parsed  widget 001d innerHTML: <!--$--><style>…</style><div data-w-id="…001d">…<img …>…<h3>…
```

The MutationObserver trace confirms the swap: at the same instant the
`<template>` and the placeholder are removed from `…001d` and `…001f` and the
`<style>` + card subtree are added, while `<div hidden>` completion containers
are removed from `<body>` (React `$RC`). The `<img>` element therefore exists
only from the swap on; its `loadTime` is the swap time.

Layout before → after the swap (`layout-shift` sources, px):

| node                                        | before         | after         |
| ------------------------------------------- | -------------- | ------------- |
| header row (`flex-nowrap … justify-center`) | 1001,52 134×30 | 876,52 384×30 |
| widget `…001e` frame                        | y 309, h 58    | y 528, h 57   |
| widget `…001f` frame                        | y 374, h 40    | y 593, h 127  |
| column dividers `::before`                  | y 281, h 358   | y 301, h 419  |

Controls:

- Image request aborted: LCP = FCP (the slider heading `H3` in `…0021`,
  30 877 px²) in 4/4 runs; the 0.0168 shift still happens, so the shift is the
  swap, not the image.
- Image delayed by 3 s outside the test runner: the swap happened before first
  paint, no 0.0168 shift, LCP = image at 3.18 s.
- New instrumentation (section 3), three samples: swap at 256 ms before FCP
  400 → LCP 400, CLS 0; swap at 383 after FCP 300 → LCP 480, CLS 0.0168; swap
  at 780 after FCP 424 → LCP 904, CLS 0.0146. Pending widgets in every sample:
  `post-list` ×3 (`…001d`, `…001f`, `…0024`, all in the first section) and
  `tailored-must-reads` (`…002b`).

### 2.3 Why two modes on CI

The completion segments are at the end of the streamed document. After the
first paint the parser competes with the ES-module graph (76 scripts,
2.6 MB) whose evaluation and hydration run as one long block ending at
`__nesAppReady` (557–599 ms warm). If the parser reaches the `$RC` segment
first, the swap paints at ~240 ms; if the script task starts first, the swap
waits until it ends. The 0.03 paired p-value of the failed run compares seven
coin flips per side; identical artifacts produce this split far more often
than the nominal 5 %.

### 2.4 Confirmation on the CI runner (`3c1bec9`, job 110556000311, 32/32 PASS)

The first run with `pendingWidgets` and `longTasks` reproduces the mechanism
in all 56 samples. Every sample lists exactly four pending widgets: `…001d`,
`…001f`, `…0024` (`post-list`, all three in the first section) and `…002b`
(`tailored-must-reads`). The final LCP candidate is the `…001d` image in
56/56, with `loadTime` = `swappedAt` + 30…50 ms and LCP = `swappedAt` +
50…110 ms. Warm `/en` (ms):

| side      | s   | FCP | placeholder parsed | swapped | image loadTime | LCP | shift at | long task at swap |
| --------- | --- | --: | -----------------: | ------: | -------------: | --: | -------- | ----------------- |
| baseline  | 1   | 208 |                 92 |     574 |            603 | 680 | 638      |                   |
| baseline  | 2   | 288 |                223 |     346 |            356 | 400 | 367      |                   |
| baseline  | 3   | 316 |                200 |     239 |            260 | 316 | none     |                   |
| baseline  | 4   | 296 |                124 |     227 |            239 | 296 | 255      | 183 (84)          |
| baseline  | 5   | 204 |                 92 |     290 |            307 | 368 | 328      | 288 (50)          |
| baseline  | 6   | 252 |                127 |     566 |            589 | 640 | 250, 622 | 566 (55)          |
| baseline  | 7   | 312 |                106 |     245 |            257 | 312 | 273      | 206 (78)          |
| candidate | 1   | 292 |                226 |     350 |            372 | 428 | 395      | 342 (64)          |
| candidate | 2   | 208 |                185 |     546 |            573 | 624 | 601      | 546 (52)          |
| candidate | 3   | 168 |                146 |     272 |            283 | 336 | 291      |                   |
| candidate | 4   | 288 |                163 |     217 |            235 | 288 | none     |                   |
| candidate | 5   | 292 |                226 |     346 |            353 | 400 | 358      |                   |
| candidate | 6   | 216 |                149 |     560 |            586 | 660 | 262, 627 | 560 (56)          |
| candidate | 7   | 296 |                225 |     348 |            370 | 432 | 401      | 340 (76)          |

The placeholder is parsed at 92–226 ms; the swap follows after 40–125 ms
(early mode) or 320–480 ms (late mode), nothing in between. When the swap
precedes the first paint the image is the only candidate, LCP = FCP and there
is no shift (baseline 3, candidate 4). The 0.0146–0.0168 shift sits 55–70 ms
after every late swap. In six of the eight late samples of this run (warm and
cold) a 50–73 ms long task starts within 0.5 ms of `swappedAt`, i.e. the swap
is the first thing the main thread does after the block. `fontsLoadingDoneMs`
(three cycles per sample, warm ≈ 260–420 / 560–640 / 880–980 ms) shows no
relation to the early/late split, so the font swap is not the trigger.

### 2.5 Fixture note: which element the gate measures

Chrome excludes images below 0.05 bits per pixel from LCP. The 279-byte
`first-visit-cover.svg` is 0.011 bpp at the slider hero size (598×336) and
0.052 bpp at the card size (275×155), so the gate measures the small card and
never sees the hero's paint. Production covers are raster; the hero would be
the candidate there. A raster fixture of realistic entropy would make the gate
measure the same element as production (follow-up, changes all 32 baselines).

## 3. Instrumentation added in this continuation

- `scripts/performance/firstVisitStreaming.ts`: records every
  `data-chrome-widget-pending` placeholder with its parse time and the time it
  was swapped out (`pendingWidgets[]` in each sample). A first-fold widget with
  `swappedAt > fcpMs` was not part of the first paint.
- `scripts/performance/firstVisitMainThread.ts`: `longtask` entries and
  `document.fonts` `loadingdone` timestamps (`longTasks[]`,
  `fontsLoadingDoneMs[]`), to show which task delayed the swap.
- Both are closure-free init scripts with vm-based regressions in
  `first-visit-harness.test.mjs` (15 tests). Budgets, sample plan, comparison
  and release gates are unchanged.

## 4. Remaining work

1. **Runtime fix (separate PR, application code).** The premise in
   `lazyWidgets.tsx` ("SSR fills every Suspense boundary, so HTML and LCP are
   identical") does not hold for streamed documents. Options, in order of
   preference: resolve the lazy widget modules of the first `ABOVE_FOLD_SECTION_COUNT`
   sections on the server before rendering (await the dynamic imports in the
   loader or make `post-list`, `section-label`, `tailored-must-reads` and the
   header's `account-link`/`search-button` eager on the server via the existing
   isomorphic split); failing that, reserve the placeholder height from
   `sectionHeightEstimate` so the swap no longer shifts 219 px. Expected
   effect on the gate: warm `/en` LCP = FCP (≈ −280 ms on CI), CLS 0.0168 → 0,
   and the header row no longer widens after first paint. Validate with the
   `first-visit` gate on the fix branch and `pendingWidgets` empty for the
   first section.
2. **PageSpeed on production.** Not measured here: the anonymous PageSpeed
   Insights API quota was exhausted (HTTP 429 "Queries per day") and
   `neweuropeanstrategies.com` is denied by this container's egress policy.
   A human run of pagespeed.web.dev (desktop and mobile) or an API key as an
   environment secret is required. The 90/85 targets remain unconfirmed; the
   last known values (2026-10-01 09:15 UTC) were 80 desktop / 68 mobile. This
   PR deploys nothing, so there is no "after deployment" state to measure yet.
3. **Fixture entropy** (section 2.5), after the runtime fix.
