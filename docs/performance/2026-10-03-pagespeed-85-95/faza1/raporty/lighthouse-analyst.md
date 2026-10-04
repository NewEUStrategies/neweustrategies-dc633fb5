# lighthouse-analyst: where the milliseconds go, and the score model for 85 / 95

Workstream key: `lighthouse-analyst`. Phase 1 (diagnosis and design). No tracked file in the repo was changed.
All scripts and outputs are in `$SCRATCH/phase1/lighthouse-analyst/`:

| file                                            | what it is                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `score.py`                                      | Lighthouse 13 scoring re-implemented: log-normal curves, the `shared/util.js` +0.05·(s−0.9) boost with FLOOR to 2 decimals, the weights, and Lantern SI coefficients. It reproduces the reported score on **14 of 14** saved reports (prod ×2, baseline ×6, baseline2 ×6). CLI: `score`, `json`, `need`, `sens`, `si`.                                                               |
| `analyze.py`                                    | Deep parse of a single LH JSON: simulated vs observed metrics, SI decomposition, bytes per observed stage × workstream, network timeline, bootup, simulated long tasks with TBT window, treemap, diagnostics. Outputs: `*.analysis.txt`.                                                                                                                                             |
| `gather.sh`, `artifacts/lha1-{mobile,desktop}/` | Lighthouse **artifacts** (trace + devtoolslog) of the unmodified baseline artifact on the fixture (PL, hero over HTTPS).                                                                                                                                                                                                                                                             |
| `audit.mjs` + `whatif.py`                       | **Lantern what-if engine.** It edits the saved artifacts (drop or resize requests, change protocol or priority, scale or cap main-thread tasks, CPU multiplier, per-origin server latency) and re-runs the LH 13.5 audits offline. Results are deterministic (no CPU noise), and the unedited run reproduces the gathered run exactly (58/96). Outputs: `batch1-4.out`, `wi/*.json`. |
| `sim-timings.mjs`, `sim/*.txt`                  | Dumps the **simulated (scored) node timeline** of the Lantern FCP/LCP/TTI graphs.                                                                                                                                                                                                                                                                                                    |
| `tasks.py`, `attrib.py`                         | Attribute observed main-thread tasks to workstreams, and compute Lantern-style blocking (dur×mult, layout tasks ×mult/2).                                                                                                                                                                                                                                                            |

---

## 1. How Lantern actually scores this page (source-verified, LH 13.5.0 / trace_engine)

The causal chain for this page rests on five facts. All of them were verified in source and by the what-if runs.

1. **Every module script is "render-blocking" to Lantern if it finished before the _observed_ FCP.**
   - `NetworkNode.hasRenderBlockingPriority()` treats any **High** Script as blocking.
   - A script is excluded from the FCP graph only when Lantern finds an `EvaluateScript` event carrying its URL that started after the paint (`FirstContentfulPaint.js:20-60`).
   - ES modules emit only `v8.compileModule` (with a URL) and `v8.evaluateModule` (without one). There is no `EvaluateScript` with their URL: verified in `artifacts/lha1-mobile/trace.json`, which has 79 compileModule and 22 evaluateModule events with no URL. So the code path "If we can't find it at all, we can't conclude anything, so just skip it" (`FirstContentfulPaint.js:54`) leaves **all ~25 modulepreloaded chunks in the FCP graph**.
   - On a fast observed host they always finish before the first paint. The only exception is the documented race that makes FCP bimodal (POMIAR.md §3).
   - Consequence: **mobile FCP_sim ≈ 0.9 s + (CSS + High-priority JS that ended before obs FCP) × ≈5.1 ms/KB.**
2. **LCP_sim = completion of every non-Low-image request that ended before the observed LCP**, plus layout CPU nodes in the pessimistic graph (`LargestContentfulPaint.js:19-48`, estimate = max end time).
   - Request priority does not shorten LCP. Only membership in the set does.
   - On h2, Lantern drains the set through one connection at RTT granularity (`ConnectionPool.js:46-56`). `sim/parity-mobile-lcp-pess.txt` shows the terminal node is the **entry chunk** `index-*.js` (230 KB, 1.2 s alone), not the hero.
   - Consequence: **mobile LCP_sim ≈ 0.9 s + (pre-LCP set) × ≈6 ms/KB; desktop ≈ 0.25 s + ×0.8 ms/KB.**
3. **The document's own TTFB is NOT simulated.**
   - Lantern applies the per-origin **median** server response time to every request on that connection (`NetworkAnalyzer.js:443`, `ConnectionPool.js:40`).
   - In the M3-Pro production run, the 2 750 ms MISS TTFB of the document became an origin median of **238 ms** (`network-server-latency`).
   - Document TTFB reaches the score only through **Speed Index**: SI = max(FCP, c_o·observedSI + c_p·layoutSI), with c = 1.4/0.4 on mobile and 0.575/0.49 on desktop (`SpeedIndex.js:14-15,54`, RTT scaling). observedSI is the **unthrottled filmstrip SI**, so it contains the real TTFB.
   - The asset median does matter. The what-if `srt` runs (per-origin server latency 19 → 238 ms) cost **mobile +219 ms FCP / +294 ms LCP (−1 pt)** and **desktop +219 / +339 ms (−3 to −4 pts)**.
4. **TBT = Σ max(0, dur_obs × mult − 50)** over simulated tasks in the window [FCP_sim, TTI_sim] (`Simulator.js:239-240`; layout tasks get mult×0.5).
   - The 50 ms threshold makes TBT **strongly convex in host speed and task length**.
   - The window starts at FCP. Any FCP improvement pulls tasks that used to fall before FCP_sim into the TBT window: on the fixture, latent TBT is 793 ms vs 356 ms reported.
5. **Scores:** see `score.py`. PSI's numbers decompose exactly: mobile 53.1 → 53, desktop 69.8 → 70.

## 2. PSI score decomposition (2026-10-03 18:58)

| form    | FCP          | LCP          | TBT           | SI           | CLS | points lost (F/L/T/S/C)             | score  |
| ------- | ------------ | ------------ | ------------- | ------------ | --- | ----------------------------------- | ------ |
| mobile  | 3.1 s (0.46) | 6.6 s (0.08) | 600 ms (0.50) | 4.9 s (0.65) | 0   | 5.4 / **23.0** / **15.0** / 3.5 / 0 | **53** |
| desktop | 0.6 s (0.99) | 1.1 s (0.92) | 740 ms (0.12) | 1.5 s (0.83) | 0   | 0.1 / 2.0 / **26.4** / 1.7 / 0      | **70** |

Points gained per improvement at the PSI operating point (`score.py`):

| form    | metric | points gained for each cut                                                                                     |
| ------- | ------ | -------------------------------------------------------------------------------------------------------------- |
| mobile  | LCP    | −1 s +2.3, −2 s +6.6, −3 s +13.2, −4 s +19.8 (gains are back-loaded: early LCP work barely shows in the score) |
| mobile  | TBT    | −100 ms +2.5, −200 ms +5.5, −400 ms +12.0                                                                      |
| mobile  | FCP    | −1 s +3.5                                                                                                      |
| mobile  | SI     | −1 s +1.7                                                                                                      |
| desktop | TBT    | −200 ms +3.8, −400 ms +11.7, −500 ms +17.6                                                                     |
| desktop | LCP    | −0.2 s ≈ +1                                                                                                    |
| desktop | SI     | −0.5 s +1.4                                                                                                    |

**Targets.** Combinations that reach the target with CLS 0 (grid search, `score.py need`):

| form    | combination | FCP         | LCP         | TBT      | SI          | score |
| ------- | ----------- | ----------- | ----------- | -------- | ----------- | ----- |
| mobile  | A, LCP-led  | 1.8 s       | 2.4 s       | 300 ms   | 3.0 s       | 90    |
| mobile  | B, balanced | 2.0 s       | 2.7 s       | 220 ms   | 3.4 s       | 90    |
| mobile  | C, minimum  | 2.8 s       | 2.8 s       | 200 ms   | 4.6 s       | 85    |
| desktop | A, TBT only | 0.6 s (now) | 1.1 s (now) | ≤ 110 ms | 1.5 s (now) | 95    |
| desktop | B           | 0.6 s       | 1.0 s       | 150 ms   | 1.3 s       | 95    |

- Mobile hard constraint: LCP and TBT together. TBT 0 with everything else unchanged gives only 68, and LCP 2.5 s with TBT 200 and FCP/SI unchanged gives 86.
- Desktop: TBT is 26 of the 30 lost points; desktop 95 is a pure main-thread problem.

## 3. Timelines (simulated = scored; observed = unthrottled run)

### 3a. Mobile, production (M3 Pro run against prod, edge MISS; `prod-mobile.analysis.txt`)

| stage                                                                                                          | observed                                                                                                                                           | bytes in this stage (transfer)                            | simulated / scored                                                          |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------- |
| TTFB (MISS)                                                                                                    | 0 → 2 821 ms                                                                                                                                       | doc 89 KB (575 KB raw)                                    | not simulated (origin median 238 ms)                                        |
| HTML + head fetches                                                                                            | 2 852–3 250 ms: 26 boot/widget/stray JS (497 KB) + vendor-supabase (57 KB) + CSS 79 KB + fonts 45 KB + hero 38 KB, **all finished before obs FCP** | ≈ 800 KB before obs LCP (31 High requests = 712 KB + doc) | FCP **3 494** (score 0.35)                                                  |
| obs FCP 3 252 → obs LCP 3 303 (hero, same SSR `<img>`, opacity 1, fetchpriority=high, byte 177 712 of 569 347) | 51 ms                                                                                                                                              | —                                                         | LCP **5 407** (0.20); breakdown TTFB 2821 / delay 39 / load 368 / render 74 |
| DCL 3 344 / load 3 364; post-boot wave 3 375–5 300                                                             | 48 lazy chunks, 140 KB                                                                                                                             | not in FCP/LCP graph                                      | —                                                                           |
| supabase refetches 3 861–5 491                                                                                 | 15 fetches + 6 preflights                                                                                                                          | —                                                         | —                                                                           |
| gtag 5 867 / 6 045                                                                                             | 370 KB                                                                                                                                             | —                                                         | long tasks at sim 7 952 / 8 021 / **10 459 (183 ms)**                       |
| TTI                                                                                                            | —                                                                                                                                                  | —                                                         | **10 642**                                                                  |
| TBT 202 ms = gtag 153 (76 %) + React 40 + entry 9                                                              | —                                                                                                                                                  | —                                                         | —                                                                           |
| SI 7 117 = 1.4 × obsSI 3 449 (which contains the 2.8 s MISS) + 0.4 × layoutSI 5 722                            | —                                                                                                                                                  | —                                                         | —                                                                           |

### 3b. Mobile, fixture at production parity (h2, hero 38 KB; `sim/parity-mobile-*.txt`)

Simulated FCP 3 974 / LCP 4 819 / TBT 356 / SI 3 974 (perf 65).

| stage       | simulated window | detail                                 |
| ----------- | ---------------- | -------------------------------------- |
| doc         | 0–919 ms         | 3 RTT connection setup + 47 KB         |
| CSS         | 919–1 219 ms     | 70 KB                                  |
| pre-FCP CPU | 919–1 546 ms     | parse/layout 627 ms sim                |
| JS drain    | 1 274–3 974 ms   | 526 KB, entry 1 724–2 924 → FCP 3 974  |
| LCP set     | until 4 819 ms   | + fonts 45 KB + hero 38 KB → LCP 4 819 |

- Pre-FCP CPU is irrelevant: shrinking every pre-FCP task to 5 % moves FCP by 55 ms. **Mobile FCP/LCP are ≥ 98 % network.**

### 3c. Desktop

- Production M3: FCP 784 / LCP 1 043 / TBT 0 / SI 2 717 (0.575 × obsSI 3 801 + 0.49 × 1 081). Observed main-thread total 580 ms, longest task 48 ms, so TBT = 0 on that CPU.
- PSI desktop TBT 740 ms implies a host about 3× slower than this sandbox (about 6× slower than the M3; see §5).

## 4. Attribution by workstream

### 4a. Critical-path KB (mobile, pre-LCP set, production M3 run)

The cost of each workstream at ≈ 5–6 ms/KB on 1.6 Mb/s:

| workstream  | KB before obs LCP                                                                                                                          | ≈ simulated ms                   | what it is                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- | -------------------------------------------------------------------------------------- |
| **boot-js** | **554** (entry 257, react 61, supabase 59, tanstack 52, pl 27, i18n 16, lucide-boot 15, zod 12, tw-merge 9, widget chunks ≈ 39, stray ≈ 8) | **FCP ≈ 2.8 s, LCP ≈ 3.3 s**     | modulepreload in head + Link header (`src/lib/http/frameworkPreloads.server.ts:14-28`) |
| html-weight | 89 (575 raw)                                                                                                                               | ≈ 0.5 s (base RTT chain + bytes) | 107 KB `$tsr` state, 133 KB inline CSS, 103 KB header before the hero                  |
| css         | 79 + fonts 45                                                                                                                              | FCP ≈ 0.4 s, LCP ≈ 0.65 s        | the styles sheet is VeryHigh; fonts are in the LCP set only                            |
| lcp-path    | hero 38 (+ logo 6, Low, pessimistic only)                                                                                                  | ≈ 0.2 s                          | —                                                                                      |
| third-party | /~flock.js 8                                                                                                                               | ≈ 0.05 s                         | —                                                                                      |

The fixture what-ifs confirm the slope. All are on parity; transfer KB removed from the pre-LCP set:

| change                      | KB removed | FCP          | LCP        | perf              |
| --------------------------- | ---------- | ------------ | ---------- | ----------------- |
| entry −60 %                 | 138        | −600 ms      | −675 ms    | +7                |
| entry −40 %                 | 92         | −450         | −450       | +4                |
| vendor-supabase out of boot | 55         | −151         | −301       | +2                |
| 7 widget chunks out         | 42         | −151         | −226       | +2                |
| CSS −70 %                   | 49         | 0 (JS-bound) | −225       | +3                |
| HTML −45 % + parse −40 %    | 21         | −150         | −150       | +4 (TBT −93)      |
| pl dict                     | 26         | −300         | −151       | +1                |
| stray route chunks          | 13         | 0            | −76        | 0                 |
| **all byte cuts together**  | ≈ 300      | **−1 351**   | **−1 426** | **+18 (65 → 83)** |

### 4b. TBT

Fixture trace, Lantern blocking for every post-FCP task (latent), `attrib.py`:

| workstream                                                                                                                                  | mobile ×4: latent 793 ms                                     | desktop at ×4 CPU (the PSI-desktop proxy): latent 501 ms |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------- |
| **hydration**: React render/commit slices (180 tasks, mostly 9–14 ms obs, so 36–56 ms sim, right at the threshold; one 95.6 ms commit task) | **458 (58 %)**                                               | 268 (54 %)                                               |
| hydration: post-hydration whole-document style/layout recalcs (37, 32, 31 ms obs each)                                                      | 110 (14 %)                                                   | 20                                                       |
| third-party: consent banner / radix / sonner / popups chunks                                                                                | 92 (12 %)                                                    | 111 (22 %)                                               |
| other/unattributed (Commit/raster 40 ms, timers)                                                                                            | 112 (14 %)                                                   | 101                                                      |
| boot-js (GC, module link)                                                                                                                   | 21 (3 %)                                                     | 0                                                        |
| html-weight: streamed-HTML parse and inline state-script eval (15–21 ms EvaluateScript inside ParseHTML)                                    | 171 latent, but pre-FCP today; counts once FCP moves earlier | —                                                        |

- Production adds **gtag**. On the M3 it is 153 of 202 ms; scaled to sandbox speed it is ~450 ms latent on mobile and ~124–258 ms on desktop at host k = 2–3. Production also adds about 25 % more DOM (1 398 vs 1 118 elements) and real refetch rerenders.
- Estimated split of **PSI mobile 600 ms**: hydration 55–65 %, gtag 20–30 %, consent/popup chunk ≈ 10 %, the rest about 5 %.
- Estimated split of **PSI desktop 740 ms**: hydration ≈ 50 %, gtag + consent ≈ 35 %, other ≈ 15 %.

### 4c. CPU elasticity

What-if, cpuSlowdownMultiplier on the same trace:

| run     | multiplier             | TBT                         |
| ------- | ---------------------- | --------------------------- |
| mobile  | ×2                     | 67 ms                       |
| mobile  | ×3                     | 174 ms                      |
| mobile  | ×4                     | 356 ms                      |
| mobile  | ×6                     | 910 ms                      |
| mobile  | ×8                     | 1 443 ms                    |
| mobile  | ×12                    | 3 033 ms                    |
| desktop | ×1 / ×2 / ×3 / ×4 / ×5 | 0 / 25 / 254 / 444 / 765 ms |

Fixes tested at a fixed CPU multiplier:

| fix                                                           | mobile ×4    | desktop ×4   |
| ------------------------------------------------------------- | ------------ | ------------ |
| halve all post-FCP CPU (`post50`)                             | 356 → **67** | 444 → **78** |
| halve vendor-react tasks only                                 | 356 → 142    | 444 → 206    |
| perfect yielding: no task over 12 ms obs, total CPU unchanged | 356 → **0**  | 444 → **0**  |
| no task over 20 ms obs                                        | —            | 444 → 127    |

**Task length is the lever; total CPU matters through the threshold.**

## 5. Anomalies explained

1. **Desktop TBT 740 ms on PSI vs 0 ms on the M3.**
   - Desktop runs with cpuSlowdownMultiplier 1, so TBT is the PSI host's own task lengths minus 50.
   - On the M3 the longest post-FCP task is 42–48 ms, so TBT is 0. Reaching 740 needs the same tasks about 6× longer (naive post-FCP model: k = 6 gives 671 ms).
   - On the fixture, desktop TBT crosses 740 at multiplier ≈ 5 relative to the sandbox.
   - The same host factor cannot also explain PSI mobile 600. At k ≈ 3 vs sandbox ×4, mobile would be several seconds.
   - Conclusion: the PSI desktop and mobile samples ran at very different effective CPU speeds (one sample each; PSI's two runs disagree: 10-02 gave 760/450, 10-03 gave 600/740).
   - Planning rule: **judge desktop on the sandbox with `--preset=desktop --throttling.cpuSlowdownMultiplier=4`** (fixture 444 ms, production ≈ 740 with gtag/consent/refetch) and **require ≤ 110 ms there**.
   - Our JS scales super-linearly: 180 hydration slices of 9–14 ms (sandbox) sit just under 50 ms at ×4, and every slower host pushes them over.
2. **SI 7.1 s (local) vs 4.9 s (PSI).**
   - Local: 1.4 × observedSI 3 449 (the 2.8 s MISS TTFB is inside it), plus 0.4 × layoutSI 5 722, gives 7 117.
   - PSI 4.9 s means PSI's observedSI was about 1.9 s, i.e. a much faster TTFB (HIT or near).
   - The MISS costs SI only. Measured local mobile with HIT would be 3.5 s (+5.6 pts); on PSI, HIT vs current is about +2.6 pts mobile and +1.3 desktop. A PSI-side full MISS would cost about −3.4 mobile and −4.8 desktop.
3. **FCP→LCP gap: PSI 3.1 → 6.6 s vs M3 3.5 → 5.4 s vs fixture 3.97 → 4.82 s.**
   - The gap is the bytes, and on the pessimistic side the layout CPU, of whatever finished between obs FCP and **obs LCP**.
   - PSI LCP 6.6 s implies about 930 KB in the LCP set (0.9 s + 6 ms/KB), about 130 KB more than the head set. So on PSI's slower host the LCP paint was observed **after DCL**, once part of the post-boot lazy wave (radix 37, icons 25, lucide 19, sonner 10, dompurify 10, consent 8, …) had finished.
   - SSR markup rules out JS gating of the hero. The SSR hero has `opacity:1`, `fetchPriority="high"`, `loading="eager"` (home.html byte 177 712). EVIDENCE §6's `opacity:0` snippet is the end-of-run DOM after the slider rotated (`sliderVariants.tsx:378-384`).
   - Two contributing causes: 178 KB of HTML (103 KB header) must parse before the hero can paint, and a slow host interleaves module eval.
   - Unverified until a PSI JSON is captured. Decisive fields: `metrics.observedLargestContentfulPaint` vs `observedDomContentLoaded`, the LCP element, and the bytes ended before obs LCP (`analyze.py` prints them).
4. **What the fixture cannot show.**
   - h1 proxy: fixed now by POMIAR's h2 `artifactServer`; worth −940 ms FCP on the fixture.
   - Hero on a separate origin (its own connection, parallel bandwidth) and 113 KB JPEG vs 38 KB webp.
   - No gtag, no AW conversion, no consent decision.
   - Supabase fails fast: no real refetch rerenders, and 36 failing requests.
   - 382–391 KB vs 569 KB HTML, 1 118 vs 1 398 DOM elements.
   - Origin server median 19 ms vs 238 ms (prod, Prague).
   - TTFB always HIT, so observedSI is small and SI is clamped to FCP. **SI is therefore unmeasurable on the fixture.**
   - Desktop CPU ×1 on the sandbox is far faster than PSI's desktop host.
   - Fixture absolutes are 0.5–0.9 s pessimistic on FCP and optimistic on TBT; use deltas.

## 6. PSI diagnostics: cosmetic vs score-relevant

| diagnostic                                                       | verdict                   | why                                                                                                                              |
| ---------------------------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| forced reflow                                                    | cosmetic                  | score 1, no metricSavings; matters only inside a long task, and then it is TBT                                                   |
| non-composited animation (consent `filter`, slider/card opacity) | cosmetic                  | metricSavings CLS 0; CLS is 0                                                                                                    |
| 99 user-timing marks                                             | cosmetic                  | informative audit; 0 marks in our runs, so they come from PSI-only scripts                                                       |
| cache TTL 9–11 KiB (/~flock.js 25 min, avatars 1 h)              | cosmetic for score        | first visit; insights are not weighted                                                                                           |
| image delivery 12 KiB                                            | ≈ 60 ms LCP mobile        | only through bytes in the LCP set                                                                                                |
| render-blocking 410–460 ms (CSS)                                 | **mostly illusory today** | FCP is JS-bound: what-if CSS −70 % gives FCP 0 ms, LCP −225 ms. Becomes real once JS leaves the FCP set (then FCP 1.37 → 1.19 s) |
| unused JS 360 KiB                                                | relevant                  | bytes in the FCP/LCP sets; LH estimates LCP −1 050 ms                                                                            |
| LCP breakdown red                                                | diagnostic                | its TTFB phase is observed, not scored                                                                                           |
| long tasks 12–16                                                 | relevant                  | TBT                                                                                                                              |
| server response time                                             | 0 weight                  | through SI only                                                                                                                  |

## 7. Ordered change list

**Path to targets** (projected on PSI with `score.py`; ranges in §8 of the JSON):

| wave                                                           | mobile    | desktop |
| -------------------------------------------------------------- | --------- | ------- |
| now                                                            | 53        | 70      |
| W1 main-thread (TBT 600 → 150, desktop 740 → 100)              | **66**    | **95**  |
| W1 + document HIT for SI                                       | 69        | —       |
| W1 + W2 byte diet (≈ −300 KB pre-LCP), if the PSI gap persists | 73        | 97      |
| W1 + W2, gap at fixture level                                  | **85**    | 97      |
| W1 + W3 boot-after-LCP (+ hero-first HTML)                     | **91–95** | 96      |
| W3 without W1 (do not ship alone)                              | 77        | 71      |

Changes:

1. **LA-1, W1 hydration task length.** Make React work yield before ~12 ms (sandbox) / ~6 ms (M3), split the 95 ms commit, and remove whole-document style invalidations after hydration. This is the hydration and css workstreams' code; the target and the gate are mine. Fixture: mobile 356 → 0–67 ms, desktop proxy 444 → 0–78 ms.
2. **LA-2, gtag and consent out of the TBT window, or chunked.** Third-party workstream. M3: 76 % of mobile TBT.
3. **LA-3, pre-LCP byte budget.** The set of requests issued before LCP must be ≤ 300 KB brotli on mobile; today it is ≈ 800 KB. The document-weight gate already tracks `preloadedJsGzipBytes` 561 750 B against a 153 600 target.
4. **LA-4, boot after LCP (Path B), or fetchpriority=low (B-lite).** Only after LA-1. On the fixture alone: +13 (65 → 78); with LA-1: 92–95.
5. **LA-5, hero before header bytes.** Collapses the PSI-only LCP gap.
6. **LA-6, measurement.** Desktop slow-CPU proxy, PSI JSON capture, and the what-if engine in PR review.
7. **LA-7, static-asset edge latency.** Origin median 238 ms in prod; desktop −3 to −4 pts.

Details, mechanisms, risks, gates and verification for each change are in the JSON.
