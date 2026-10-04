# Verdict SC-3 — Soft purge + L1-STALE consults L2 + colo revalidation lease

Feasibility: WEAKENED. Effect on the Lighthouse score: REFUTED (about 0 points).

## Lens 1: feasibility and correctness

What holds:

- `documentRevalidator` is a module-level hook registered from `src/server.ts:203`, so calling it from `purgeDocumentPaths` / `purgeDocumentCache` creates no static import cycle. `runAfterResponse` (`waitUntil.server.ts`) works in any request, including a server-fn POST.
- Revalidation requests skip L1/L2 lookup (`documentCache.server.ts:820-821,859`), so a soft-purge render is never served from the old entry.

What breaks or is overstated:

1. **The revalidator API takes the READER's Request.** `revalidateDocument(request)` (`src/server.ts:171-176`) keeps `request.url` and copies accept, accept-language, user-agent and the lang cookie from it (`src/server.ts:137-158`). In a purge, the only request in scope is the editor's admin server-fn POST (`/_serverFn/...`, accept JSON, the editor's accept-language and lang cookie). The documentCache module also has no Request at purge time, only `currentTenantHost()`. SC-3 therefore needs a NEW synthetic-request builder per path: `https://<host><path>`, `accept: text/html`, a fixed `accept-language` (pl for `/`, en for `/en`), no cookie, plus the marker. Reusing `revalidationHeaders` as is would be wrong. With an editor's `Accept-Language: en` and `accept: text/html`, `homepageLangMiddleware` sends a 302 to `/en` (`src/start.ts:135-183`). That response is not stored, and the revalidator returns false (`src/server.ts:193-198`).
2. **"The colo has a fresh document within ~1 s" is false.** The purge clears L1 only in the editor's isolate (`documentCache.server.ts:987-1006`, loop over this isolate's `store`). Other isolates in the colo keep serving the pre-publish doc from their own L1 as a HIT until it is 180 s old (`documentCache.ts:47`). They never consult L2 while L1 is fresh (`documentCache.server.ts:823-828`). So after a publish the colo serves a mix of old (other isolates) and new (L2/editor isolate) content. That is not a regression, but the stated outcome is wrong.
3. **The content data layer is not invalidated by a selective purge** (`ssrCacheL2.server.ts:25-29`: "Purge selektywny ... wersji nie rusza"). Content keys such as `builder:post-list:*` and `builder:slider-posts:*` have a 60 s TTL with 5x serve-stale (`ssrCache.ts:26`, `postListQuery.ts:447`, `sliderPostsQuery.ts:151`). `public:home-*` and `trending_posts:*` have colo L2 snapshots. A soft-purge render at t+0.5 s is therefore very likely to use the PRE-publish post lists, and it stores that document as FRESH for 180 s. Today's next-reader MISS render has the same problem, so this is not a new bug. But SC-3 makes it deterministic: it always renders at the moment the data caches are hottest, in the editor's isolate, which is the one most likely to have just previewed `/`. A correct soft purge must also invalidate or bypass the content data keys during that render (for example `invalidateEdgeTtlCache` for the home and builder post-list keys, or an l2Bypass/generation bump). Otherwise "soft purge" can mean "re-cache stale content for another 3 min".
4. **Path list.** `postDocumentPaths` adds `/post/<slug>` (`documentCache.ts:334-345`), and that path is a legacy 301. Re-rendering it is wasted work that is never stored. The bounded list should be `/`, `/en`, `/blog`, `/en/blog` plus the canonical post path in both variants, with at most 6 renders run serially. 6 x (1-3 s) stays inside the waitUntil 30 s limit but takes up a large part of it. On a cold colo each one can come out degraded (600 ms home deadline, SC-F3) and be dropped. That is why SC-3 really depends on SC-1/SC-2/SC-8, not only on SC-1.
5. **Ordering race.** `l2Delete` runs fire-and-forget (`documentCache.server.ts:1002`). The soft render must be chained AFTER the delete settles, or a late delete wipes the fresh put. With a 1-3 s render the race is unlikely, but it is real.
6. **Lease.** `caches.default` has no compare-and-set (match then put). The lease is best-effort with a window of a few ms against renders that take seconds. Once the "L1-STALE consults L2" part exists, the lease is mostly redundant. And "L1-STALE consults L2" adds an awaited Cache API read (`l2Match`) to EVERY STALE reader response unless it moves inside the background task.
7. **Gates and tests.** Existing tests assert MISS after a purge (`documentCacheL2.test.ts:381-405`), and `platformCacheLifecycle.test.ts:183-214` asserts the purge contract. `documentCacheL2.test.ts` is missing from the gate list and must be added. Gates for chunks, entry purity and SSR budgets are not affected (server-only modules). Logged-in editors stay safe as long as the builder drops cookies and authorization. `planDocumentCache` would BYPASS on an `sb-*` cookie anyway (`documentCache.ts:201-206`).

## Lens 2: effect on the score

- **The PSI colo is not the editor's colo.** Purge (bump or delete) only reaches the colo that served the admin request (SC-F5, `documentCacheL2.server.ts:18-23`). The editor is in PL (PRG/WAW). PSI runs Lighthouse from Google DCs (US / europe-west), which map to other Cloudflare colos. In the PSI colo a publish causes NO MISS today: the old entry ages into STALE after 180 s and is served instantly (`documentCache.server.ts:829-836`, SWR up to 24 h, `documentCache.ts:57`). SC-3 changes nothing there. P(PSI run lands in the editor's colo within seconds of a publish) ≈ 0.
- **L1-STALE consults L2 and the lease** only cut background render count. A STALE response already has HIT-like TTFB, so FCP/LCP/SI/TBT are unchanged. The second-order DB-load relief is negligible at the site's traffic level (few isolates per colo).
- **Who benefits:** today, after a selective purge, a MISS only happens in the editor's isolate and in isolates with empty L1 (L2 deleted). Isolates with a warm L1 keep HITting. That is about 1 reader per path per publish, at a few publishes a day. Real-user gain is about 1-6 requests a day x 1.3-3.3 s. Lighthouse lab gain is 0.
- Arithmetic: ΔPSI ≈ P(MISS caused by publish in the PSI colo) x (4-6 desktop / 2-5 mobile points per MISS, SC-F1) ≈ 0 x 5 = 0.

## Cheaper alternative with the same real-user effect

"Mark stale" instead of delete or re-render:

- In `purgeDocumentPaths`, backdate the L1 entry's `storedAt` to `now - freshMs` and do the same for L2 (re-put with the backdated `x-nes-l2-*` metadata) instead of deleting.
- The next reader gets STALE (instant). The EXISTING `scheduleRevalidation(request, key)` (`documentCache.server.ts:293-322`) then runs with that reader's real headers, so no synthetic-request builder, accept-language handling or admin context is needed.
- Move the "check L2 for a fresher entry" step inside the background revalidation task, so readers never wait on it and no lease is needed.
- Trade-off: readers see pre-publish content for about one render (1-3 s) longer. That fits the bound the system already accepts (other colos and isolates: up to 180 s).
- This still needs the content data keys invalidated (point 3) to actually show the new post.

For the PSI score, the levers are SC-5 (EU warmer near the PSI colo), SC-2 / SC-8 (non-degraded cold render) and SC-6 (L3) or SC-9 (longer freshness with a version token). SC-3 is not one of them.
