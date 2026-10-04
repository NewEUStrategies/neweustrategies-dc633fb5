# Verdict SC-1 (server-cache): cache/TTFB observability

Feasibility: WEAKENED. Effect: WEAKENED (no score effect, which the change admits. Its stated diagnostic goal, decomposing the 1.8-2.4 s gap, is mostly out of reach for in-isolate timers).

## Lens 1: feasibility / correctness

Parts that work as described:

- colo. Nitro cloudflare-module passes the original CF Request through: `_module-handler.mjs` `nitroApp.fetch(request)`, and `fetchViteEnv` -> h3 `toRequest(input)` returns `input` unchanged (h3.mjs:571-582). So `request.cf?.colo` reaches `src/server.ts:239`. Nothing in `src/` reads `request.cf` today. It must be optional: tests, dev and possibly the Lovable dispatch layer have no `cf`. A more robust fallback is the colo suffix of the `cf-ray` request header.
- nes-layer. `replay()` (`documentCache.server.ts:432-467`) builds Server-Timing fresh on every HIT/STALE. L2 entries do not persist the header (`entryFromL2`, :470-482), so a new metric cannot be replayed stale from cache. L1 vs L2 needs one new argument (the L2 branch is at :873-919). The `nes-edge`-first contract holds if new metrics are appended (`ssrTiming.ts:68`). Exact-string tests need updating: `ssrTiming.server.test.ts:187-361` and `documentCache.server.test.ts:598`.
- isoReq counter (module-level) and uaClass. `botFilter.ts` has no heavy deps (`isBotUserAgent`). Fine in a log line. In a public header it is pointless, because the client knows its own UA.

Parts that do not work as described:

1. A `stream` metric in Server-Timing cannot exist. The header is fixed in the middleware chain (`withCacheStatus` :491-505, `replay` :452) and in `server.ts:262-263`, before the body streams. HTTP trailers are not usable here, so stream end can go only into the log line.
2. "Stream end from the tee collector" covers only storable MISS. The tee exists only when `deferredStores` has a record (`applyDeferredDocumentStore` :652-655, tee at :696). HIT/STALE replay a buffer. BYPASS has no record. A degraded MISS (`policy.store` false at :599-616, or `canStillStore()` false at :669-686) has no tee. So the case the workstream cares about most (SC-F3 degraded homepage) gets no streamMs. Fix: wrap `guarded.body` in `server.ts` after line 254 (outside the guard, on the already rebuilt Response, which keeps the ~61 s body-identity incident safe) with a TransformStream `flush()` that emits the log. This also means the log line moves from `server.ts:261` (before streaming) to stream end.
3. The Workers clock does not advance during pure CPU work (Spectre mitigation: Date.now/performance.now advance only on I/O). Repo evidence: `server-init;dur=0/1` in all 65 saved samples (the lazy import of the 13 MB bundle, which is pure CPU), and `app;dur=0` on L1 HITs (faza1/server-cache h-*.txt). As a result:
   - "module age" taken at module scope is unreliable (the global-scope clock is not meaningful). Take it lazily at the first request; `isoReq==1` alone already gives the cold flag.
   - streamMs/appMs miss React render CPU between I/O awaits, and they cannot see isolate startup before `fetch` runs or the hosting dispatch hop.
4. degradedBy. `resilientLoad.ts` is shared client/server (`isSsrRequest()`, :123) and is imported by routes (`__root.tsx`, ...). Recording the label in a request-scoped store needs the same pattern as `ssrTiming.server.ts:21-25`: a WeakMap keyed by Request, server-only, and loaded only dynamically behind `import.meta.env.SSR`. Otherwise import-protection / check:entry-purity breaks the client build. A cheaper option: the `[ssr-resilient] degraded render ... for <label>` console.warn (:150-152) already lands in the same Workers invocation, so it can be joined by invocation/ray without new code.
5. Public exposure: iso-req (per-isolate request counts) and uaClass in a public header add nothing for the client. Keep them log-only and expose only nes-layer and the colo desc. (Colo is already public via cf-ray, so there is no privacy issue.)

Gates: check:bundle, check:chunks, noHasSelectors and CLS are unaffected (server-only, no client bytes). ssr-budgets and loader-policy are unaffected. Logged-in users, editors, i18n and SEO are unaffected (headers and log only). Risk stays low.

## Lens 2: effect realism

- Direct score effect: 0 points. The extra header is about 100-200 B and goes into HPACK/QPACK-compressed headers. That is under 1 ms at 1.6 Mb/s, and Lantern does not model it anyway.
- The diagnostic claim "where the 1.8-2.4 s between app;dur and TTFB goes" is mostly not delivered:
  - For Lighthouse/PSI UAs, isbot leads to `allReady` (SC-F12), so TanStack returns the Response only after the full render. In that case `streamMs - appMs` is approximately the transfer of an already-buffered body. Expect about 0-50 ms, not the gap.
  - The gap sits in places in-isolate Date.now() cannot see: isolate cold start (13 MB parse/compile before fetch), render CPU (frozen clock), the Lovable dispatch hop, and network/RTT. The measured 942 ms app;dur may itself undercount render CPU.
- What it does deliver, and what is worth having: per-colo MISS share, MISS correlated with `isoReq==1` (cold isolate), L1/L2/render split, and degradedBy frequency. These are the HIT-ratio inputs SC-2/3/5/6 need, so it is a prerequisite rather than a score item.
- Cheaper or better ways to get the same insight:
  1. Put `ray` (the cf-ray request header, not PII) in the log line so external curl/PSI-like probes (time_starttransfer) can be joined to server records. This decomposes client-observed TTFB directly.
  2. If enabled on the hosting account, Workers Logs/Tail invocation metadata (`cpuTimeMs`, `wallTimeMs`, `cf.colo`) measures the CPU and wall time that in-app timers cannot.
  3. Colo is already in the cf-ray response header for any curl series.

Corrected estimate: 0 score points. Keep it as effort S in observability wave 0, with three changes: (a) drop the Server-Timing `stream` metric and take streamMs from a body wrapper in server.ts, not the tee; (b) take the cold flag from isoReq plus a lazy first-request timestamp, not module-scope age; (c) add `ray`, and prefer platform cpu/wall time for the gap. Expected outcome: it explains HIT ratio and the cold-isolate share; it does not explain the 1.8-2.4 s gap without (c).
