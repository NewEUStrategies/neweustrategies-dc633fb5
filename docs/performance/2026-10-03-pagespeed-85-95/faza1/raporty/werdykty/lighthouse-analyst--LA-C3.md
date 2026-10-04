# Verdict LA-C3: pre-LCP byte budget as a CI ratchet, plus stray-preload drop

Feasibility: WEAKENED. Effect: REFUTED as attributed (the gate gives 0 ms; the stray drop gives about 0 ms).

## Lens 1: does it work in this codebase?

1. The stray-preload drop in `src/lib/http/frameworkPreloads.server.ts:14-28` does nothing.
   - The "stray" chunks are the static closure of the `/` route chunk. In the TanStack manifest (`.output/server/_tanstack-start-manifest_v-DcVEtS0X.mjs`), `routes["/"].preloads` is `index-BHIMq0Mj.js, blog.index, headings, Footnotes, PaginatedPostGrid, useInFeedAds, prepareContent, eventInvoiceMath`.
   - `index-BHIMq0Mj.js` imports Footnotes, PaginatedPostGrid, blog.index, headings, prepareContent and useInFeedAds with plain `from"./…"`. The router has to load the route chunk before it hydrates, so the browser fetches these chunks either way.
   - TanStack also writes them as `<link rel=modulepreload>` in `<head>` (prod `psi/home.html`: blog.index, headings, Footnotes, PaginatedPostGrid, useInFeedAds, prepareContent, index-57LQ, index-D_Tb). Taking them out of the Link header only lowers `linkHeaderEntries` and `preloadDuplicates`.
   - If they were taken out of both the head and the header, the result would be an import waterfall: route chunk, then its imports, at +1 RTT (150 ms) before hydration.
   - `admin.analytics` is not in the root preloads of the HEAD artifact. It appears only in the older production deploy, as an entry static import.
   - The real fix is in the chunk graph: lazy-load Footnotes and PaginatedPostGrid, and stop route-named shared chunks. That is boot-js work under `check:chunks`.
2. The gate already exists. `scripts/performance/document-weight-budgets.json` already has `preloadedJsGzipBytes {max 572985, measured 561750, target 153600}`, so the listed change "561750 → target 153600" is a no-op. `target` never gates (documentWeight.ts, `Budget.target` "informacyjnie"). `ratchetBudgets` takes min(old, new), so it cannot move a number toward the target without the byte cuts.
3. CI wiring is missing.
   - `check-document-weight.ts`, `documentWeight.ts` and the budgets file are untracked (`git status ??`).
   - There is no package.json script for them and no workflow runs them.
   - The gate needs `build:smoke` plus the fixture backend. `.github/workflows/first-visit.yml:52-59` already builds the candidate, so it could run there. That is effort M, not S.
4. The proposed `preLcpTransferBytes` metric has problems.
   - It is defined in brotli, but every other byte metric is gzip (`weigh()` uses `gzipSync`).
   - `assetName()` matches only js/css, so the woff2 fonts in `/assets` are not counted.
   - The hero variant depends on viewport and DPR. The fixture hero is on a separate origin as a 113 KB JPEG (LA-F9), so a static gate has to resolve imagesrcset at 412 px × 1.75 DPR.
   - A static sum cannot see Lantern's actual set: requests ended before the _observed_ LCP, which on PSI includes about 130 KB of the post-boot lazy wave (LA-F8).
5. The gate has no SSR/hydration, i18n, SEO or CLS risk.

## Lens 2: effect

- The gate itself is worth 0 ms.
- The stray drop has an upper bound from the what-if that deletes the requests entirely (`batch1.out` P_stray): mobile FCP −1 ms, LCP −76 ms, perf 65→65; desktop 99→99. The real change keeps those fetches (point 1), so its effect is about 0.
- The slope claim is overstated. M_bytes_all (≈300 KB) gives FCP 3974→2623 (−1351) and LCP 4819→3393 (−1426). That is 4.5 ms/KB FCP and 4.75 ms/KB LCP, not 5/6. FCP does not respond to every byte: CSS −49 KB gives 0 ms FCP, while JS gives about 4.3 ms/KB. Single what-ifs add up to 1.8 s of LCP against 1.43 s when combined.
- PSI arithmetic (`score.py`):

| scenario                                               | FCP / LCP / TBT / SI     | mobile score |
| ------------------------------------------------------ | ------------------------ | ------------ |
| now                                                    | 3100 / 6600 / 600 / 4900 | 53           |
| byte diet alone, TBT unchanged                         | 1750 / 5170 / 600 / 4300 | 63           |
| byte diet alone, TBT +200 from window coupling (LA-F4) | 1750 / 5170 / 800 / 4300 | 58           |
| W1 only                                                | 3100 / 6600 / 150 / 4900 | 66           |
| W1 + byte diet                                         | 1750 / 5170 / 150 / 4300 | 76           |

So the byte diet adds about +7–10 on top of W1, and it belongs to boot-js/css/html-weight, not to LA-C3. The "85" needs the PSI FCP→LCP gap to collapse, which is the hero/after-DCL question (LA-F8, unverified).

- Desktop: about −0.08 s per 100 KB, which is 0 pts at 99 on the fixture. On PSI desktop, LCP 1.1 s, so −0.2 s is about +1.

## Cheaper or better alternative

- Add `preLcpTransferBytes` as a derived sum of the existing fields: htmlGzipBytes + renderBlockingCssGzipBytes + preloadedJsGzipBytes, plus the woff2 preloads and the 768w hero. Run it in first-visit.yml. Keep everything in gzip.
- Add a runtime gate in lighthouse.yml from the LH JSON (analyze.py: KB of High/VeryHigh requests ended before obs LCP). That is the set Lantern actually scores.
- Drop the frameworkPreloads edit. The stray bytes (≈8 KB gzip: blog.index 1.6, headings 0.8, Footnotes 2.0, PaginatedPostGrid 0.8, useInFeedAds 1.0, prepareContent 0.9, eventInvoiceMath 1.2) go away only through a chunk-graph or lazy-import change.
