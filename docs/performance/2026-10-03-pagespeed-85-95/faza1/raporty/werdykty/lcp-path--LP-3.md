# Verdict lcp-path LP-3: boot-after-LCP hero-signal contract

Feasibility: **WEAKENED.** Effect: **WEAKENED** (direction confirmed, size overstated on PSI, and it is C3's effect and must not be summed with it).

## Lens 1: feasibility and correctness

1. **The primary signal "load, then decode(), then one rAF" fires before the hero frame is presented, which breaks the change's own verification.**
   - The trigger script runs inside a rAF callback, which is before style, layout and paint of that frame.
   - decode() of a ~38 KB webp often resolves before the first frame that paints the image. So the rAF usually lands in that same frame, and the boot `<script>` and modulepreloads start a few ms _before_ the `largest-contentful-paint` presentation timestamp.
   - That contradicts "every Script request starts after the observed LCP candidate".
   - Lantern rule: `trace_engine/.../lantern/metrics/FirstContentfulPaint.js:104` keeps a network node only if it ended before the cutoff. At `:46-65`, a script stays in the graph when it has no EvaluateScript before the cutoff, or no EvaluateScript at all, as with modulepreloaded chunks. So every small chunk that completes inside that window is billed.
   - On PSI hosts this is about 0 KB, since a fetch needs at least 1 RTT. On the localhost h2 fixture it is a few small chunks.
   - The boot-js C3 verdict measured the literal trigger. It used the wrong element, but it shows the class: the burst started 170-330 ms before obs LCP and 289-518 KB of JS was billed, giving LCP 4.82/3.77 s against 4.82 s in control.
   - Fix: `requestAnimationFrame(() => setTimeout(boot, 0))`, or better, trigger on the LCP PerformanceObserver entry. Entries are delivered after presentation.

2. **The "LCP observer, first entry" fallback is a race hazard that the fixture cannot detect.**
   - `src/styles.css:41,52` set `font-display: swap`, so text paints at FCP before the hero.
   - In prod, obs FCP is 3252 ms and obs LCP is 3303 ms, so the first LCP entry is text.
   - If the observer races the hero signal (the mechanism lists it as a fallback, but also says "if there is no candidate, DCL+rAF"), boot fires tens of ms before the hero paints.
   - The prod observed JS throughput was about 1.7 KB/ms (575 KB from 2854 to 3182 ms). A 50 ms window therefore bills up to about 85 KB, which is about +0.5 s simulated LCP.
   - The fixture has a single candidate (obs FCP = LCP), so the C3 B-arm "0 JS before LCP" result does not cover this.
   - Contract fix: accept only an entry whose `element` has `data-lcp-candidate`, or whose `url` equals `candidate.currentSrc`. Drop "first entry".
   - Also handle `decode()` rejection (a broken image) with a catch that falls through to the next fallback.

3. **The file list cannot carry the mechanism.**
   - `BOOT_PROBE_SCRIPT` is a static literal: `bootProbeScript.ts:79`, allowlisted at `scripts/lib/dangerousHtmlAllowlist.ts:28-30` as "no inserted content". It is rendered in the React tree at `src/routes/__root.tsx:931`, inside the entry chunk.
   - So it can hold the trigger logic, but not the boot URL list.
   - Embedding the hashed entry URL in a module that lives in the entry chunk creates a content-hash cycle.
   - The dictionary URL and widget chunk URLs are per request: `__root.tsx:531-532,743`, `routes/index.tsx` widget preloads.
   - The entry `<script type=module async>` comes from TanStack `<Scripts>` and the manifest, not from any listed file.
   - Missing from the change:
     - a manifest rewrite;
     - the URL list injected outside the React tree (`server.ts` / injectHtml);
     - removal of JS from the `Link` header in `__root.tsx:522-532,743`, `rootHead.ts:94` and `widgetPreloads.ts:25`, in addition to `frameworkPreloads.server.ts:14-17`.
   - `router.tsx:210` (`setTimeout(0)`) is only something to keep. The change does not modify it.
   - Effort is M to L, not S. This is the same conclusion as the C3 verdict.

4. **Wrong gates.**
   - check:entry-purity, check:chunks and check:chunk-parity do not change, because the chunk graph is untouched.
   - What actually breaks:
     - `e2e/boot-home.spec.ts:26-29`, which asserts dictionary and entry modulepreload in `Link`;
     - `e2e/boot-timing.spec.ts:961-975`, which asserts one dictionary modulepreload;
     - `bootProbeScript.test.ts`;
     - the document-weight ratchet, which improves.

5. **"Nothing before LCP except CSS, font, hero" cannot be met in prod.**
   - `/~flock.js` (8.4 KB, `defer`) is injected by the host and is not in `src`. It is billed in both LCP graphs: `isNotLowPriorityImageNode` returns true for scripts.
   - That is about +50 ms at 6 ms/KB, and the trace verification fails on prod unless it is excluded.

6. **Hydration stability holds.**
   - Slides use `key={i}` (`sliderVariants.tsx:1198`).
   - `OptimizedImage.tsx:63,78,121` has no load-opacity state and computes `sizes` deterministically.
   - The C3 B-arm kept a single LCP candidate through hydration.
   - Autoplay crossfades a same-size image, so there is no new LCP entry because the area is not strictly larger.

7. **Hard dependency on LP-1.**
   - Without `data-lcp-candidate`, the trigger degrades to DCL+rAF. JS then competes with the hero, which is about the literal-trigger result (LCP about −0.5 s).
   - `events.$slug` and `tag.$slug` have image covers (`:256`, `:132`) and need the marker too.
   - Stored-session users and editors should boot immediately. The contract does not say this.

## Lens 2: effect on the score

- **Fixture whatif vs measurement.**
  - The whatif T0 claims FCP 3973→1367 and LCP 4368→1667, a delta of −2.6 / −2.7 s.
  - The canonical harness measurement with the corrected trigger (C3 verdict B-arm) gave FCP 4.07→1.52 and LCP 4.82→2.27, a delta of −2.55 / −2.55 s.
  - The delta is confirmed; the absolute values are too optimistic by about 0.15 / 0.6 s.
  - E6 (1517) adds LP-7/LP-8, which are worth 0 to 150 ms after C3.
- **PSI LCP "6.6 → 2.0-2.5 s" is inconsistent with its own model.**
  - At 6 ms/KB, today's 826 KB gives 0.9 + 4.96 = 5.86 s, not 6.6, so the intercept calibrated to 6.6 is 1.64 s.
  - Then 225 KB gives 1.64 + 1.35 = **3.0 s**.
  - Equivalently: 6.6 − (826 − 225) × 0.006 = 3.0 s.
  - Add flock (+0.05) and a possible text-first race (+0 to 0.5 if the contract is not fixed).
  - Corrected: **PSI mobile LCP ≈ 2.7-3.0 s**, which matches the C3 verdict's 2.8-3.0 s.
- **Mobile score arithmetic (LH13 log-normal curves).**

| metric | before | after  | score before | score after | points                                         |
| ------ | ------ | ------ | ------------ | ----------- | ---------------------------------------------- |
| LCP    | 6.6 s  | 2.85 s | 0.09         | ~0.84       | +19 (of 25)                                    |
| FCP    | 3.1 s  | 1.8 s  | 0.41         | 0.90        | +5                                             |
| SI     | 4.9 s  | 4.0 s  | 0.72         | ~0.84       | +1 (consent banner arrives later; LP-4 needed) |

- Gross gain is about +25.
- TBT coupling (C3 verdict: parse tasks move into [FCP, TTI]) takes TBT from 600 to 1100-1300 ms, a TBT score of 0.5 → 0.15-0.2, which is −9 to −10.
- **Net: +15 to +17 alone (53 → 68-70), and about +22 with LA-C1/W1 holding TBT ≤ 250.**
- **Desktop.**
  - Claimed: −0.44 / −0.40 s. Measured: −0.40 / −0.26 s.
  - Worth +1 to +1.5 points at PSI desktop (95 is a TBT problem).
- **Attribution.** This is C3's effect. LP-3 adds no points of its own beyond keeping C3 from leaking. The plan must not add LP-3 on top of boot-js C3.
- **Cheaper alternative.**
  - No cheaper change reaches the same LCP. Entry-only modulepreload gives LCP 3.03 s on the fixture.
  - The cheaper and more robust contract is the LCP-observer trigger: an entry matching the candidate, then `setTimeout` of about 50 ms, with `load` as a backstop that still waits for that entry, plus input and the cap. It needs no decode() or rAF.

## Corrected estimate

Fixture mobile: FCP −2.55 s, LCP −2.55 s, SI −1.3 to −1.8 s, TBT +350 to +900 ms. PSI mobile LCP 6.6 → 2.7-3.0 s (not 2.0-2.5). Mobile score +15 to +17 alone, +20 to +24 with the TBT program (this is C3's effect; do not double count). Desktop +1 to +1.5. This holds only with the trigger fixed as above. The literal decode+rAF / first-entry contract risks giving back 0.1-0.5 s of PSI LCP.
