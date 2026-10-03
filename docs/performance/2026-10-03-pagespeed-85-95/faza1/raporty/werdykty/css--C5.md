# Verdict css / C5: strip the color-mix @supports fallback

Scripts: `verdicts/css-C5/sim.mjs` (C5 as specified) and `verdicts/css-C5/hybrid.mjs` (the safer variant). Both run on the real
`.output/public/assets/styles-DjfYz07w.css` and write `stripped.css` and `hybrid.css` next to them.

## Lens 1: feasibility and correctness. Verdict: WEAKENED

**What holds up**

- 670 `@supports (color:color-mix(in lab,red,red))` blocks are in the built sheet: 576 in `@layer utilities`, 82 top-level hand CSS, 9 in components, 1 in base and 2 in `@media`.
- The block comes from Tailwind's own `Polyfills.ColorMix` pass (`node_modules/tailwindcss/dist/lib.js`, enum `St`: None=0, AtProperty=1, ColorMix=2, All=3; the pass runs under `r&2`). It also rewrites the hand-CSS color-mix in `src/styles.css`.
- Byte claim reproduced. Sibling-merge simulation: **-74 314 B raw, -5 305 B gzip-6, -4 924 B gzip-9, -3 501 B br-11** (the report says -69 013 raw / -5.0 KB gzip).
- No gate is violated:
  - `check:bundle` publicCss (`scripts/check-bundle-size.ts:2022`, `:2456-2461`) only gets smaller.
  - `noHasSelectors.test.ts` and `searchOverflowCascade.test.ts:21` read the `src/styles.css` source, which a build-time strip does not touch.
  - It is CSS only: no SSR/hydration or chunk-graph effect, and no CLS on browsers that support color-mix.

**What breaks or is under-specified**

1. **There is no config knob.** `@tailwindcss/vite` 4.3.3 never passes `polyfills` to `compile` (0 occurrences in `node_modules/@tailwindcss/vite/dist/index.mjs`), and `vite.config.ts:101` has no CSS post-step. Its `generate:build` transform is `enforce:"pre"`, and its output still has the polyfill nested inside each rule. Implementation therefore needs one of:
   - a `bun patch` of `@tailwindcss/vite` that passes `polyfills: Polyfills.AtProperty`, or
   - a lightningcss `visitor` (the Lovable config sets `css.transformer: "lightningcss"`, `@lovable.dev/vite-tanstack-config/dist/index.js:1600`), or
   - a post-transform plugin.
     Doing it in `generateBundle` leaves the content hash stale. "Effort S" is optimistic; S-M plus a unit test on the built sheet is realistic.
2. **"The fallback is the OPAQUE colour, wrong anyway" is only partly true.** Of the 622 paired fallbacks:
   - 350 are an opaque `var(--x)` (wrong, as claimed).
   - 87 are an opaque box-shadow (wrong).
   - 2 are `currentColor`.
   - **183 are correct pre-resolved hex+alpha values**, for example `.border-amber-300\/50{border-color:#ffd23680}`. Tailwind resolves palette theme vars itself. On a browser without color-mix, C5 turns these from correct into IACVT (`unset`). That is a regression, not "already wrong".
3. **A11y regression on the old-browser band.** 48 blocks set `--tw-ring-color`, e.g. `.focus-visible\:ring-ring\/50:focus-visible`. Without color-mix, the substituted `box-shadow` becomes invalid at computed-value time, so the focus ring disappears, and so does any `--tw-shadow` combined with it in that one property. Today the opaque ring stays visible (WCAG 2.4.7).
4. **The browser floor is below color-mix.** Vite 7.3.6 with no `build.target` defaults to baseline-widely-available (chrome107 / firefox104 / safari16). The comment at `src/lib/observability/redact.ts:55` says Safari 14. Either way, the JS boots on Chrome 107-110, Safari 16.0-16.1 and Firefox 104-112, none of which have color-mix.
   - This is mitigated by the fact that the codebase already relies on unguarded color-mix: 309 TS/TSX occurrences and 49 in production `/` inline styles.
   - The tokens are oklch (`styles.css:303-320`), so Chrome below 111 is already broken on colours.
   - The band that actually changes is Safari 15.4-16.1 and Firefox below 113. A floor decision is needed, as the change says.
5. 53 inner rules have no adjacent same-selector fallback, because lightningcss merged the selectors. A naive regex strip would mis-pair them, so they need an AST pass.

**Better variant (hybrid):**

- Where the fallback is a resolved literal, keep the literal and drop the color-mix branch.
- Where the fallback is `var()`, keep color-mix and drop the fallback.
- Measured: **-83 119 B raw, -5 595 B gzip-6, -3 531 B br-11**. That is more bytes than C5, and it introduces no regression for the 183 palette colours.
- The ring/shadow issue still needs the floor decision, or the `--tw-ring-color` blocks can be left untouched (about 48 x 110 B, roughly 0.3 KB gzip).

## Lens 2: effect on the score. Verdict: WEAKENED (bytes are real, score value about 0)

- The sheet is VeryHigh and render-blocking, so it is on the critical path.
- Delta in transfer:
  - fixture br proxy: about -3.5 to -4 KB (proxy br is below q11: 69 971 transfer vs 59 398 br-11)
  - production / PSI: about -5.3 KB (PSI transfer 78 624 B is about the gzip-6 size, so it is served gzip)
- Elasticity:
  - css.md measured about 4-6 ms/KB on mobile.
  - lighthouse-analyst's deterministic what-if: CSS -70 % (-49 KB) gives FCP 0 ms (JS-bound) and LCP -225 ms, i.e. 4.6 ms/KB on LCP only.
- Mobile today:
  - LCP: -5.3 KB x 4.6 ms/KB = about -24 ms; FCP 0 to -25 ms.
  - At the PSI operating point (LCP 6.6 s, where -1 s is worth +2.3 pts; FCP where -1 s is worth +3.5 pts): +0.06 (LCP) + 0 to 0.09 (FCP) = **about +0.1 pt**.
- Mobile at the target operating point (LCP about 2.8 s, roughly 6.7 pts/s; FCP about 2 s, roughly 3.3 pts/s): 0.024 x 6.7 + 0.024 x 3.3 = **about +0.25 pt at most**.
- Desktop: about 1 ms/KB x 5 KB = 5 ms, so **0 pts**.
- TBT: 0. The 74 KB less CSS to parse happens before FCP, and the analyst shows pre-FCP CPU is irrelevant (shrinking it to 5 % moves FCP 55 ms). Dropping 670 duplicate rules does not measurably change the post-hydration recalc tasks: class-bucketed selectors, only matching rules cost.
- The verification criterion ("FCP/LCP move about 5 ms per KB br") **cannot be verified**. The expected movement is about 20 ms, but the run-to-run noise of `measure-ab.sh` at n=3 on this shared host is about ±100 ms, so A/B would be pure noise. I did not run a Lighthouse what-if for that reason. The structural byte measurement is the verification; require only the static `check:bundle` render-blocking line plus a cssSurfaces/built-sheet test.
- In the stage-3 world (core about 250 KB raw), the strip removes roughly the same absolute gzip bytes (about -3.7 KB gzip, the estimate in the change), worth about 15-20 ms. Still below 0.3 pt.
- Cheaper with the same effect: nothing is cheaper. It is already cheap, and its value is gate headroom (publicCss 83 KB budget, the proposed ≤45 KB render-blocking target), not score.

## Corrected estimate

- Bytes: -74 KB raw / -5.3 KB gzip / -3.5 KB br as specified. The hybrid is -83 KB / -5.6 KB / -3.5 KB with no palette regression.
- Mobile: LCP -15 to -25 ms, FCP 0 to -25 ms, about +0.1 pt now and at most +0.25 pt at the target.
- Desktop: 0. TBT: 0.
- Worth shipping only as budget headroom for C11 and only in the hybrid form, after an explicit floor decision (Safari ≥16.2, Firefox ≥113, Chrome ≥111). Do not count it toward the 85/95 path.
