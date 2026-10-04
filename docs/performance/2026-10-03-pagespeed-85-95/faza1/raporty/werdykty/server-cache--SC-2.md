# Verdict SC-2: add builder:/ad_placements:/ticker_posts: to EDGE_TTL_L2_KEY_PREFIXES

Feasibility: WEAKENED. Effect: REFUTED (the size is wrong by 3-4x and PSI rarely hits the case).

## Lens 1: feasibility and correctness

Mechanically this is fine:

- `src/lib/ssrCache.ts:65-72`: the list is consulted only by `l2Allowed` (`:192-195`). No test or gate pins the list (grep: no other references to EDGE_TTL_L2_KEY_PREFIXES). check:bundle, check:chunks and entry-purity see a few bytes. ssr-budgets and loader-policy are not affected.
- The values are anonymous. The builder fetchers use the module-singleton anon client (`src/integrations/supabase/client.ts`), and the trace shows auth = anon key. Cached values are JSON row arrays; the Maps in speakersQuery and eventsQuery are intermediates, not cached values. The ads multi value `{fetchedAt, rows}` survives JSON, and the emission window is projected after the read (`ads/queries.ts:181`). The `random` post-list stays uncached (`postListQuery.ts:444-448`). Keys include lang via `postListInput(c, lang)`.

Correctness regression, in the one case where SC-2 actually changes TTFB:

- Publishing a post does a selective purge. It deletes "/" from document L1 and L2 (`documentCache.ts:324` always includes "/"; `documentCache.server.ts:986-1004` calls `l2Delete`) but does NOT bump the host version (`ssrCacheL2.server.ts:28-30`: "Purge selektywny per ścieżka ... wersji nie rusza").
- Nothing invalidates `builder:*` keys. The only `invalidateEdgeTtlCache` callers are menus and donations.
- Today, a cold isolate that re-renders "/" after a publish fetches the post lists fresh, so the new post appears.
- With SC-2, every isolate in the colo reads the pre-publish `builder:post-list` / `slider-posts` snapshot. That is up to 60 s fresh, or up to 300 s stale and served immediately (`maxAgeFor`, `ssrCache.ts:41-45, 371-374`). The re-rendered "/" then lacks the new post and is stored as the new document: 180 s fresh, then 24 h SWR (`documentCache.ts:47,57`).
- The "same freshness as today's L1" claim is therefore false for the publish-then-check-homepage editorial path. The stale state is now colo-wide and the purge cannot reach it.
- Fix needed with SC-2: when a selective purge includes "/", bump a per-host data-version segment, or write a per-host purgedAt marker and reject snapshots with `at < purgedAt`.

Verification plan is not runnable on the fixture:

- In Node preview `getColoCache()` returns null (`documentCacheL2.server.ts:92-100`; `ssrCacheL2.server.ts:31-32`). There is no way to "restart the process keeping an injected colo cache". Only a vitest with `setEdgeTtlL2Adapter` can prove the mechanism.
- The production check "db n < 23" does not discriminate. n=23 > fixture 18 means W1, home-page and trending (already L2) also missed, so that sample came from a fully cold colo, where SC-2 does nothing.

Minor: `cache.put` writes start during render (`persistFetched` calls `l2.write` immediately; only completion is deferred). They count toward the 6 simultaneous connections in W4/W5. That adds a few ms of queueing on a fully cold colo. Negligible.

## Lens 2: effect realism

Wave mapping from trace-120.jsonl:

| Wave | Calls                      | Cache key                                                             | Already L2 today?                  |
| ---- | -------------------------- | --------------------------------------------------------------------- | ---------------------------------- |
| W1   | settings, tokens, menus x2 | existing prefixes                                                     | yes                                |
| W2   | pages                      | `public:home-page`                                                    | yes                                |
| W2   | trending                   | `trending_posts:`                                                     | yes                                |
| W2   | ad_placements              | `ad_placements:`                                                      | **no** (runs in parallel)          |
| W3   | get_entity_content         | inside `public:home-page` (`public.ts:538`)                           | yes                                |
| W3   | get_post_refs              | inside `trending_posts` resolveAuthors (`postViews.functions.ts:124`) | yes                                |
| W4   | 5x posts                   | `builder:*`                                                           | **no**                             |
| W5   | newsletter_settings        | none: plain `supabase.from` (`useNewsletterSettings.ts:191`)          | never cached, SC-2 does not add it |
| W5   | 3x posts                   | `builder:*`                                                           | **no**                             |

- Today, a cold isolate in a warm colo already pays only about 1 DB wave before the shell (W4, in parallel with ads), not 4.
- With SC-2 the shell wave drops to 0. Bots (isbot means allReady, SC-F12) still wait 1 RTT for newsletter_settings in W5.
- Saving: 1 RTT = 0.09-0.2 s (88-142 ms/call in production; 140-200 in the report), not 0.4-0.8 s.

When the case happens at all:

- Document L2 serves STALE for up to 24 h (`documentCache.ts:57`). A cold isolate in a colo with any "/" render in the last 24 h therefore gets the document from L2 and does not render.
- Data snapshots for builder keys live at most 300 s. So SC-2 matters only when "/" was deleted (post publish), when the previous render was degraded/no-store, or for a sibling variant (/en) rendered within 5 min. The PSI colo is usually either warm on the document (HIT/STALE) or fully cold (data L2 empty too).
- Degraded renders happen on the fully cold path, where SC-2 has nothing to read. On a warm colo today the remaining single wave (~0.2 s) is already well inside HOME_SSR_BUDGET_MS = 600 (`homeSsrBudget.ts:15`).

Score arithmetic. Per SC-F1, Lantern charges document TTFB only to SI.

- Desktop: SI grows ~0.55 ms per ms of TTFB ((2408-1029)/2500), and perf drops ~4.5 points per 2.5 s, about 1.8 points/s. Saving 0.15 s gives about 0.27 points.
- Mobile: SI grows ~0.66 ms per ms. 0.1 s of SI at ~5 s SI is about 0.012 x 10 % weight, about 0.1 points.
- Multiplied by P(PSI lands in this case) of 5-10 % or less, the expected value is about 0.01-0.03 points. That is noise.
- Side benefit: background STALE revalidations on cold isolates get faster, so fewer revalidations degrade to no-store. This is a small HIT-ratio gain and does not show in the score.

Cheaper or better options:

- Cache newsletter_settings with edgeTtlCache + L2. This removes the last W5 DB wave for bots.
- The score-relevant lever is document HIT ratio in the PSI colos: SC-F5 L3/warmers.
- Keep SC-2 only together with the purge-aware fix above.

Corrected estimate: -0.09...-0.2 s TTFB on the narrow class "cold isolate + document absent from colo L2 + data snapshots < 300 s"; 0 on fully cold colos and on HIT/STALE. Expected PSI effect is about 0 points (< 0.05 desktop, < 0.02 mobile).
