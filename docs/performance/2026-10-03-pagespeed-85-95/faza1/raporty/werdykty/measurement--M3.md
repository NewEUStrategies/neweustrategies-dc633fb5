# Verdict measurement / M3 - retire measure-local.sh / measure-ab.sh, re-baseline on lighthouse-local.mjs

## Lens 1 - feasibility: WEAKENED

Confirmed:

- M1 is done and tracked: scripts/performance/lighthouse-local.mjs, artifactServer.ts in git (commit 30c49a6).
- New harness defaults are right: transport h2 (lighthouse-local.mjs:90,125), warmUa browser (:135), readiness on /robots.txt (artifactServer.ts:57 in startArtifact), browser UA in waitForHttp (:126) and warmDocument (:589-599), A/B interleave (lighthouse-local.mjs:356-358), summary.json carries transport+warmUa (:383-397, written :497).
- F1 mechanism holds: old readiness `curl -sf http://127.0.0.1:$UP$URLPATH` (measure-local-cloud.sh, measure-ab-cloud.sh start()), Accept _/_ so homepageLangMiddleware passes (src/start.ts:139), br-proxy rewrites host to 127.0.0.1:$UP so cache key host::path (src/lib/http/documentCache.ts:225) is shared with the curl render.
- format:check: prettier --check on EVIDENCE.md / README.md passes; .sh not prettier-checked.

Weaknesses:

1. The scripts agents actually run are $SCRATCH/lh/measure-local.sh and $SCRATCH/lh/measure-ab.sh (byte-identical to narzedzia/*-cloud.sh, diff = 0). Marking the repo copies deprecated does nothing; the only effective lever is EVIDENCE.md:16 (§0-cloud) plus a stub/exit-1 in the scratch copies.
2. Other phase-1 plan items still prescribe the old harness in their verification fields, not in M3's file list: faza1/raporty/boot-js.json:170, boot-js.md:343, lighthouse-analyst.json:110, prior-art.json:175, README.md:7 (and the scratch copies of these reports). Phase-2 agents read those.
3. "Browser variant = production" is not true for the saved ground truth: psi/home.html has 15 <script> (buffered shape, like baseline2-home.html 14) vs browser-warm home-A.html 34. Until M4 (cache variant determinism) lands, PSI may receive either variant. Document-shape changes (barrier, streaming scripts, dehydration, preloads) should be measured on both arms (--warm-ua bot exists), not browser-only.
4. Verification only checks labels in summary.json; it does not check that the measured body is the streaming variant (raw 391 114 B vs 382 468 B, x-nes-cache=HIT) - cheap to add since home.html/headers are saved per target.

## Lens 2 - effect: WEAKENED

- Direct score effect = 0 (measurement only).
- Attribution of the baseline2 gap to "bot variant + h1" is not supported. Per run: baseline2 mobile FCP/LCP 5045/5582, 4983/5531, 4928/5635; browser-warm h1 (ab-h1-h2 A) 2993/4018, 4074/5120, 4998/5545. A-mobile-3 (browser variant) = baseline2 within 20-90 ms. So the 4.98 -> 4.06 s FCP gap is the Lantern FCP-mode race (F4: High scripts in/out of FCP graph, ~1.1 s per mode at 1.6 Mb/s), not the bot variant. The only A/B-established piece is h1 -> h2: mobile LCP -0.30 s, desktop FCP -0.28 / LCP -0.30 s (perf 95 -> 98). No LH A/B bot-vs-browser exists; byte delta is only 8.6 KB raw.
- measure-ab.sh was already interleaved, so its deltas were internally comparable; the risk is mostly (a) h1's 6 connections hiding LCP-image contention -> preload/priority changes under-read by up to ~0.3 s LCP, (b) streaming-specific changes measured on a document that lacks the stream.
- Bigger comparability hazard than the harness: n=3 medians over a bimodal/trimodal FCP. Verification should list per-run FCP mode and require n>=5 for FCP/score claims.

Corrected estimate: 0 score points; protects against mis-reading ~0.3 s LCP (mobile+desktop) and ~0.28 s desktop FCP (~3 desktop perf points) in priority/preload deltas. It does not explain/remove the 0.9 s FCP gap (mode noise). Cheaper equivalent: one-line EVIDENCE §0-cloud edit + exit-1 stubs in $SCRATCH/lh/measure-*.sh + re-point the 4 verification fields; keep --warm-ua bot as second arm for document-shape changes.
