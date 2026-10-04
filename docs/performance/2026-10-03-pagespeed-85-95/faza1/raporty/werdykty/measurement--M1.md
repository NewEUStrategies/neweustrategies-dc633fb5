# Verdict M1: adopt the measurement harness. Feasibility WEAKENED, effect WEAKENED

## What I checked and ran (read-only)

- `tsc -p tsconfig.scripts.json --noEmit`: 0 errors. `eslint scripts/performance/`: clean. `prettier --check` on all 12 files: clean. `node --test scripts/performance/document-weight.test.mjs`: 7/7 pass.
- `node scripts/performance/check-document-weight.ts` on the current `.output`: ends with "✓ Waga dokumentu w progach". The raw HTML median is 381.9 KB on a short port, so the port-length effect is visible.
- No product code is touched, so the SSR, chunk-graph, entry-purity and loader gates are not affected. `check:gate-coverage` only reads package.json scripts (scripts/check-gate-coverage.ts:33-36). vitest only includes `src/**` (vitest.config.ts:9), so the node:test file is not picked up by `bun run test`. knip is not run in CI.

## Problems in the code (fidelity claims, not breakage)

1. **The cached document goes STALE during a series, which is not controlled.** The fresh window is 3 min: DOCUMENT_CACHE_MAX_FRESH_MS=180000 (src/lib/http/documentCache.ts:47, :269). The harness warms each artifact only once (scripts/performance/lighthouse-local.mjs:333). Server logs from the workstream's own runs show STALE with a background re-render during measured runs:
   - ab-h1-h2: A 4x, B 2x (asymmetric)
   - ab-js-lowprio: 3x/3x
   - baseline-h2: 4x

   Consequences:
   - (a) SSR runs during Lighthouse runs, in the same Node process that serves every JS/CSS asset (one origin), on the shared 4-CPU host.
   - (b) The revalidator (src/server.ts:203) re-renders with Lighthouse's own UA. LH 13 does not append "Chrome-Lighthouse" (lighthouse core/config/constants.js:43), so `isbot` is false and the cache flips to the streaming variant. As a result `--warm-ua bot` is only valid for about the first 3 minutes.

   Fix: call `fetchDocument` with the chosen UA before each `runLighthouseWithRetry`, which is free.

2. **"PSI-identical" variant is overstated.** `isbot` returns true for "...Chrome-Lighthouse" and HeadlessChrome (verified with node_modules/isbot). TanStack waits for allReady for bots (node_modules/@tanstack/react-router/dist/esm/ssr/renderRouterToStream.js:31). PSI appends Chrome-Lighthouse (per server-cache report and src/lib/http/**tests**/botFilter.test.ts:54,116). So on a MISS, PSI gets the buffered bot variant; on a HIT it gets whatever the colo seeded. A browser warm-up measures what users get, not necessarily what PSI gets. Label it that way and report both variants with `--warm-ua` A/B.
3. **psi-sample.mjs:71 builds params without `locale=pl`.** PSI then uses en, `homepageLangMiddleware` (src/start.ts ~138-148) answers 302 to /en, and the sampler measures a different page. This contradicts EVIDENCE §0-cloud ("always hl=pl"). It is a one-line fix and blocks the PSI sampler's use as the contract instrument.
4. **The noise floor did not come from an A/A run.** ab-js-lowprio side B had a proxy transform: the document was buffered and recompressed with `brotliCompressSync`, and 44 attributes were injected. B's main-thread time was higher in every pair: 10257/8199/10838 ms vs 8694/5903/6316 ms (+3.9 s median). That is systematic, so "TBT ±464 ms is noise" is not established. The FCP/LCP ±0.01 s figure is a single n=3 pair, and FCP is bimodal (about 1.1 s jumps). A real A/A run (`--compare . .`, no transform) is needed.
5. **Request count drifts with run index, the same way in A and B** (122, then 134/148, then 182 in each A/B). The drift is client refetches to the dead 127.0.0.1:4199 (Fetch+Preflight 18 → 48, `/rest/v1/posts` x24 in run 3). Two likely causes are document age against staleTime 5 min (src/router.tsx:46) and the revalidations. Interleaving cancels this in A/B. A single-artifact DELTA against the baseline JSON does not cancel it.
6. **Minor:**
   - The Node "type stripping" note is wrong: it is on by default only from 22.18/23.6, and 22.6-22.17 need `--experimental-strip-types`.
   - `highPriorityBytesBeforeLcpImage` counts requests that _start_ before the image ends, using observed timings. It is a contention proxy, not "bytes before", so it is not deterministic enough for the hard gate planned in M2.
   - The F2 narrative ("image never queued behind JS under h1") predicts h1 faster, but h2 measured faster. The real cause is per-connection handshake and slow start: 6 cloned h1 connections plus TLS on a separate image origin.

## Lens 2 (score)

The direct score effect is 0, because this is a tool. Bias corrections, checked per pair:

- **h1 → h2, mobile LCP:** 4.02→3.63, 5.12→4.99, 5.55→4.82. Pair 3 changes FCP mode (5.00 vs 4.07 s), so the same-mode delta is −0.13 to −0.39 s. The median of −0.30 s holds within about ±0.15 s.
- **h1 → h2, desktop FCP:** 1.09→0.84, 1.14→0.79, 1.10→0.82, so −0.25 to −0.35 s, consistent with the claim.

Converted to score with LH v10+ curves:

- **Mobile LCP** (median 4000, p10 2500, σ=0.367): 5.12 s gives 0.25 and 4.82 s gives 0.305. That is +0.055 x 25 = **+1.4 pts**. The measured +9 is TBT noise.
- **Desktop FCP** (σ 0.42): 1.10 s gives 0.81 and 0.82 s gives about 0.94. That is +0.13 x 10 = +1.3 pts.
- **Desktop LCP** (σ 0.541): 1.24 s gives 0.889 and 0.94 s gives 0.958. That is +0.069 x 25 = +1.7 pts.
- Desktop total is about +3, which matches 95→98.

The bot-variant bias was quantified only in bytes (382 vs 391 KB, 14 vs 22 scripts). There is no Lighthouse A/B of bot-warm vs browser-warm, so its effect on the metrics is unmeasured.

The corrected harness moves local numbers further from PSI (53/70). The remaining gaps are larger than the ones it removes:

- local HIT TTFB is 11 ms, while prod MISS is 2.75 s (about +2.6 s on FCP/LCP in the simulation)
- the fixture document is 391 KB vs 569 KB in prod
- client fetches fail locally but succeed in prod, so the TBT work is different
- Chrome 141 locally vs PSI's Chrome

Use the harness for A/B deltas only, never as an absolute PSI predictor.
