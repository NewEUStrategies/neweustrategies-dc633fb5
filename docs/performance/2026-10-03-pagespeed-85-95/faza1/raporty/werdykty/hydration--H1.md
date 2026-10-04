# Verdict hydration/H1: count dehydrated query freshness from hydration time

Feasibility: WEAKENED. Effect: REFUTED. Corrected estimate: 0 requests, 0 ms TBT and 0 points in the canonical harness and in the measured prod run. In the rare case of a STALE edge document older than 5 min: fewer refetches, but only about 0-10 ms TBT and roughly 0 points.

## 1. The "316 s" premise compares two different documents

- psi/home.html came from a curl. Its headers (psi/h1.txt) show `date: 17:09:15 GMT`, `x-nes-cache: HIT` and `x-nes-cache-age: 129`, so it was rendered at about 17:07:06. That matches its `dataUpdatedAt` of 1791047225xxx (17:07:05).
- The beacon `_p=1791047541952` (17:12:21) comes from lh/prod-mobile.json. That is a separate load: `fetchTime` 17:12:18 and server-response-time **2752 ms**, which means an edge **MISS** and a fresh render. EVIDENCE §1 also labels this run "edge MISS".
- So in the measured prod run the dehydrated data was a few seconds old. It was fresh under the 5-minute default staleTime (router.tsx:46). The prod desktop run (TTFB 3301 ms, also a MISS) shows the same request set.

## 2. Why the observed fetches happen (staleness is not the cause)

- `site_design_tokens`: `["site_font_scale"]` is not warmed. It is pending on SSR with 0 observers and is fetched on mount regardless (useFontScale.ts:18-27, DesignTokensStyle.tsx:48). The tokens and colors queries share the browser in-flight dedupe in `fetchSiteDesignTokensRow` (designTokens.ts:79-104, `inflightRow`). Even when they are stale they join the same single request, so H1 saves **0** requests here.
- `post_layout_settings`: dehydrated with `updatedAt: 0`, which H1 explicitly leaves alone.
- `builder_popups`, `ad_placements(footer_slideup)`, `categories`, `tags`: not dehydrated as success. They are pending or not warmed (only `status==='success'` is dehydrated, router.tsx:67), so H1 cannot touch them.
- Result: of the 6 PostgREST requests and 6 preflights in prod, H1 removes 0.

## 3. The TBT claim (removes 1 `<style>` swap and a full recalc, 115-177 ms)

- `useDeferredStyleCss` swaps CSS only when the hash of the input changes (useDeferredStyleCss.ts:46, 52-53). On top of that, react-query structural sharing keeps the `data` reference when a refetch returns identical data, and the tracked notify props mean no re-render. A stale-but-identical refetch therefore produces **no** swap and no recalc.
- The `data-css-hash` swap at about 3.17 s in runs/m4-ok-1 was traced against a fresh local document (trace.mjs --backend=ok). There, font scale goes from `undefined` (SSR used EMPTY_FONT_SCALE) to real data, which changes the hash. That is H2's cause, not H1's.
- With H1 a swap would be avoided only when the row really changed after the document was rendered. In that case the swap is the correct behaviour.

## 4. Feasibility and correctness in the code

- Mechanically possible. The integration's `sentQueries` makes the streamed keys disjoint from the initial batch (router-ssr-query-core index.js, `sentQueries.has` check). Re-stamping via `queryCache.getAll()` + `query.setState` after `setTimeout(0)` (router.tsx:209-210) runs before React hydration. I found no gate conflicts: check:ssr-budgets only scans the router, and the router.test.tsx hydrate-wrapper tests stay valid.
- The stream part is flawed:
  - A streamed chunk for a key that already exists runs `query.setState` (an `updated` event), not `added`.
  - Promise chunks resolve through `query.fetch({initialPromise})`, which already stamps client time.
  - Sync-resolved chunks are stamped with server `dehydratedAt` (query-core hydration.js:110-123, 152-160).
  - So "subscribe to 'added' for 2 s" misses some cases and stamps others twice.
- The risk notes understate the bound. The SWR window is **24 h** (`DOCUMENT_CACHE_MAX_SWR_MS`, documentCache.ts:59), not "3 min + SWR". Today a STALE document of up to 24 h self-heals on the client: every stale query refetches on mount. H1 removes that self-heal for another 5 minutes on every success query, including data that a publish purge does not cover (popular posts, ads, newsletter settings). That is a real freshness regression, not "low" risk.

## 5. What this means in Lighthouse

- Canonical harness (lighthouse-local.mjs): the document is warmed and measured within minutes, so it is fresh, and the browser backend at 127.0.0.1:4199 is dead. Any refetch fails fast and leaves `data` unchanged, so no re-render follows. ΔTBT = 0 and Δscore = 0. A what-if transform is pointless: A/A TBT noise is ±464 ms, against an expected effect of 0-10 ms.
- PSI against prod: in the typical HIT case `x-nes-cache-age` is 106-130 s (EVIDENCE §2), plus TTFB and boot. That is under 300 s, so no effect.
- STALE document older than 300 s: N refetches of identical data are avoided.
  - Main thread: JSON parse plus `replaceEqualDeep`, about 1-3 ms per small response at 4x. These are small tasks after FCP, under 50 ms each, so about 0 ms TBT.
  - Network: they start after LCP discovery, on a different origin. In Lantern they only share bandwidth: about 10-20 KB at 1.6 Mb/s is at most about 50-100 ms of bandwidth, spread across the tail. The effect on LCP or SI is about 0.
  - Score: about 0 points.

## Better alternative

- H2 removes the real causes: warm or derive `site_font_scale` from the already-warm row, and warm `post_layout_settings` instead of seeding it with `updatedAt: 0`. That removes both fetches and the swap.
- If STALE documents do matter, use per-query `refetchOnMount: false` (or `staleTime: Infinity`) only for the presentational token keys, which cacheBusting and version invalidation already refresh. Do not re-stamp the whole cache.
