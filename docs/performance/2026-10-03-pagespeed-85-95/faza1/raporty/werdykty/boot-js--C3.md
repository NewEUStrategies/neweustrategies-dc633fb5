# Verdict boot-js C3: start the boot set after the LCP paint

Feasibility: **WEAKENED.** Effect: **WEAKENED.** The lever is real and it is the largest mobile LCP lever in the plan, but two things are wrong as specified. The trigger fires before the LCP paint, and the "same markup SSR and client, from the manifest" design cannot carry the boot set. The claimed numbers come from the retired h1 harness with a different trigger.

Artifacts: `verdicts/boot-js-C3/` (`common.mjs`, `c3-literal.mjs`, `c3-lcpobs.mjs`, `prelcp.py`, `run1/` with LH JSONs and `summary.json`, `run1.log`).

## What-if run (canonical harness, fixture, h2, browser warm-up, n=2 mobile, loadavg 2.0-3.7)

`node scripts/performance/lighthouse-local.mjs --compare . . --html-transform c3-literal.mjs --html-transform-b c3-lcpobs.mjs --runs 2 --forms mobile`

Both transforms do the same thing first:

- strip every `modulepreload` from the document and from the `Link` header;
- replace `<script type=module async src=entry>` with an inline bootstrap that injects all 25 unique URLs (entry closure, `pl` dictionary, `/` route chunks, 8 widget chunks) as `modulepreload` in one burst, then appends the entry script.

They differ only in the trigger:

- **A = C3 as written:** `img[fetchpriority=high]` load, then decode, then 1 rAF; or `window.load`; or first interaction; or 3 s after DCL.
- **B = corrected:** a `largest-contentful-paint` PerformanceObserver plus `setTimeout(0)`; or `load` plus `setTimeout(0)`; or interaction; or the 3 s cap.

Control is the same artifact without a transform (POMIAR §3.1, A median of 3).

| variant                | FCP  | LCP      | SI   | TBT          | perf | burst start (obs) | obs FCP / LCP | JS ended ≤ obs LCP |
| ---------------------- | ---- | -------- | ---- | ------------ | ---- | ----------------- | ------------- | ------------------ |
| control (POMIAR A)     | 4.07 | 4.82     | 4.07 | 273          | 67   | 110 ms (head)     | 485 / 485     | 25 files / 518 KB  |
| A run 1 (literal)      | 2.94 | **4.82** | 3.08 | 801          | 58   | 270 ms            | 596 / 596     | **25 / 518 KB**    |
| A run 2 (literal)      | 1.52 | **3.77** | 2.27 | 1145         | 65   | 212 ms            | 189 / 439     | **24 / 289 KB**    |
| B run 1 (LCP observer) | 1.52 | **2.27** | 2.80 | 2205 (noise) | 69   | 383 ms            | 393 / 393     | 0                  |
| B run 2 (LCP observer) | 1.52 | **2.27** | 2.28 | 620          | 82   | 339 ms            | 267 / 267     | 0                  |

- CLS was 0.000 in all 4 runs. Two runs per arm is too few for the ≥5-run CLS guard.

## Lens 1: feasibility and correctness

1. **The trigger as specified fires before the LCP paint (measured).**
   - The fixture HTML has **11** `fetchPriority="high"` elements. The first `<img>` is the 180 px `image.svg` thumbnail at byte 95 915. The hero `img.eh-img` is at byte 133 203, and two `oi-img` covers come before it (`sliderVariants.tsx:378` together with other image widgets).
   - So `querySelector("img[fetchpriority=high]")` does not find the hero.
   - Even with the right element, "decode + 1 rAF" runs before the frame is presented. In both A runs the burst started 170-330 ms before the observed LCP, and 289-518 KB of JS ended before it. The LCP graph kept the JS: LCP 4.82 s and 3.77 s against 4.82 s in control.
   - `window.load` is not safe either. In B run 1, `load` fired at 375 ms, before obs LCP at 393 ms. The burst (383 ms) came from the load fallback and missed the cutoff by only about 10 ms.
   - The boot-js "measured" numbers used `load + setTimeout(0)` on the old h1 harness, where `load` was late. That is not the mechanism this change describes.
   - The trigger must key on the `largest-contentful-paint` entry, which is delivered after presentation, plus a margin (`setTimeout` of about 50 ms, or rAF+timeout). `load` should be a fallback that waits for that LCP entry, not a trigger of its own.

2. **"Same markup SSR and client, generated from the manifest" cannot carry the boot set.**
   - The dictionary URL and the widget chunk URLs are server-only by design. See `src/lib/seo/rootHead.ts:84-93`: a modulepreload in `<head>` breaks root identity, which is why it is a Link header. See also `src/lib/seo/widgetPreloads.ts:4-6`: `WIDGET_CHUNK_URLS` is `{}` in the client build.
   - The widget list also depends on the document: `widgetPreloadHeaders(doc, ABOVE_FOLD_SECTION_COUNT)` at `src/routes/index.tsx:212-214`, plus the header widgets from the root loader.
   - An inline bootstrap rendered inside the React tree with these URLs is the documented hydration-identity failure class.
   - TanStack's `transformAssets` can only rewrite href/crossOrigin (`node_modules/@tanstack/start-server-core/dist/esm/transformAssetUrls.js:95-140`). It cannot drop `preloads` or swap the root `scripts` entry (`.output/server/_tanstack-start-manifest_v-*.mjs`: `scripts:[{attrs:{type:"module",async:!0,src:"/assets/index-DPN2YAij.js"}}]`).
   - A workable design has three parts:
     - (a) a build-time rewrite of the manifest virtual module that empties root/route `preloads` and the entry `scripts`. Both SSR `<HeadContent>`/`<Scripts>` and the dehydrated client manifest (`router-core ssr-client.js:40-41`) then render nothing, so parity holds;
     - (b) the bootstrap plus the per-request URL list injected outside the React tree (`router.serverSsr.injectHtml`, or the `server.ts` document path), and persisted in the edge cache body;
     - (c) `fetchWithFrameworkPreloads` (`frameworkPreloads.server.ts:14-28`), `appendLinkHeader(widget hints)` and `dictionaryPreloadLinkHeaderValue` stop emitting modulepreload.
   - Effort is M to L, not M.

3. **Gates and tests that change.**
   - `e2e/boot-home.spec.ts:27-29` asserts entry and dictionary modulepreload in `Link`.
   - `e2e/boot-timing.spec.ts:996-1012` asserts exactly one dictionary modulepreload.
   - `check:dangerous-html` needs an allowlist entry if the bootstrap is rendered through JSX.
   - The document-weight ratchet improves (modulepreload 25 → 0).
   - Nothing in `check:chunks`, `check:entry-purity` or `check:bundle` changes, because the chunk graph is untouched.

4. **Scope.**
   - 27 route files are `ssr: false` (auth.callback, scanner, welcome, events manage, …), and admin and the editor have no SSR LCP image. For them the trigger degrades to load or the cap, which only delays them.
   - Emit the deferred bootstrap only on public SSR routes that render an LCP candidate. Boot immediately elsewhere and for stored-session users (`hasStoredAuthSession()`).

5. **Real-user side effects (not scored).**
   - Hydration starts about one hero transfer later.
   - The first tap on JS-only controls is lost until boot. It is already lost today during hydration, so the delta is the deferral window.
   - On slow 3G, DCL+3 s+2.5 s download can push `__nesBootDead` (15 s, `bootProbeScript.ts:68`) into false positives. That affects only observability.

6. **CLS.** Keeping widget chunks in the same burst holds CLS at 0. That matches F6, but it rests on 2+5 runs.

## Lens 2: effect on the score

- **Mechanism (Lantern) is confirmed.**
  - `FirstContentfulPaint.getFirstPaintBasedGraph` drops any network node with `endTime > cutoff || startTime > cutoff`. `LargestContentfulPaint` uses the obs-LCP cutoff with all nodes in the pessimistic graph.
  - With the corrected trigger, 0 JS ended before obs FCP/LCP and FCP/LCP collapse to the doc+CSS(+fonts+hero) chain.
- **Size on the canonical harness:** FCP 4.07 → 1.52 (−2.55 s), LCP 4.82 → 2.27 (−2.55 s), SI 4.07 → 2.3-2.8 (−1.3 to −1.8). That is not the claimed −3.6 / −2.95 / −1.96 from the retired h1+bot-warm-up harness (control 5.04 s there).
- **With the literal trigger:** median FCP 2.23 (bimodal), LCP 4.29 (−0.53 s), so about +1 to +2 points on LCP instead of +15.
- **TBT coupling is confirmed in direction.**
  - B: 620 / 2205 ms, A: 801 / 1145 ms, against control 273. A/A noise is up to ±464, so the sizes are not trustworthy.
  - The cause is that HTML-parse and early tasks that sat before FCP_sim (≈ 1.1-1.9 s sim) now fall inside [FCP, TTI]. TTI_sim does not move, because Lantern does not model the load/LCP wait: the burst's network nodes hang off the document and the inline CPU task.
- **Fixture scores (score.py):**

| FCP  | LCP  | TBT  | SI  | perf |
| ---- | ---- | ---- | --- | ---- |
| 1.52 | 2.27 | 273  | 2.4 | 92   |
| 1.52 | 2.27 | 620  | 2.4 | 82   |
| 1.52 | 2.27 | 1000 | 2.4 | 76   |

- **PSI projection.** Production doc is 89 KB vs 47 KB fixture (+0.2 s), origin median latency is 238 vs 19 ms (+0.2 to +0.3 s), and fonts plus the hero stay in the LCP set. That gives FCP ≈ 1.8 s, LCP ≈ 2.8-3.0 s, SI ≈ 3.8-4.2 s.

| scenario                                                     | mobile score |
| ------------------------------------------------------------ | ------------ |
| now (3.1 / 6.6 / 600 / 4.9)                                  | 53           |
| C3 corrected, TBT unchanged 600                              | 78           |
| C3 corrected, TBT with coupling 1100-1300                    | **68-70**    |
| C3 + W1, TBT ≤ 250 (including the newly exposed parse tasks) | 86-87        |
| C3 + W1, TBT ≤ 200                                           | ~90          |

- **Desktop.** Fixture FCP −0.40 s and LCP −0.26 s (POMIAR §3.1 transform). At PSI desktop 0.6 / 1.1 s this is worth at most +1 to +1.5 points (95.0 → 96.5 at TBT 110). The claimed −0.65 / −0.54 s is h1-inflated. Desktop 95 remains a TBT problem, and coupling can add desktop TBT.
- **Cheaper alternative.**
  - The POMIAR transform (drop modulepreloads, entry `fetchpriority=low`) gives FCP 1.52 but LCP 3.32: about 1.05 s worse than C3-corrected, roughly 7 points, with no CLS guarantee for widgets.
  - So C3's trigger is worth its complexity, but only with an LCP-entry trigger.
  - No cheaper change gives the same LCP.

## Corrected estimate

Mobile, fixture: FCP −2.55 s, LCP −2.55 s, SI −1.5 s, TBT +350 to +900 ms. PSI mobile:

- **+15 to +17** points alone (53 → 68-70);
- **+20 to +24** on top of W1 (66 → 86-90).

Desktop: +0 to +1.5. This holds only with the trigger keyed on the `largest-contentful-paint` entry plus about 50 ms. The literal trigger gives LCP −0.5 s, about +2 to +4.
