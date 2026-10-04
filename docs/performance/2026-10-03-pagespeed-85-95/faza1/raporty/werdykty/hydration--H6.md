# Verdict hydration/H6: no whole-tree device re-render after hydration on mobile

Feasibility: WEAKENED. Effect: REFUTED as sized (-150..-300 ms TBT). Measured in the harness: about 0.

## Corrected estimate

- Mobile TBT, canonical harness (Lantern): 0 to -60 ms. Measured B-A = **+32 ms** (median of 3 interleaved runs; A 301-399, B 395-436; the ranges overlap, so this is noise).
- Mobile score: 0 to +1.5 points. Desktop: **0**, because at 1350 px `deviceForWidth` returns "desktop" and nothing switches.
- PSI production mobile: at most about -40..-150 ms, and only if the PSI host runs the commit+recalc task 2-3x slower than the sandbox. That is +1 to +3.5 points, an upper bound and not demonstrated.
- CPU: mainthread-work-breakdown median -1.3 s simulated (-17 %), bootup -0.64 s. The pairs were +66, -1323 and -1460 ms, so this is mostly noise from machine load (load average 2-3.5). It affects TTI and the diagnostics, not any scored metric.

## What-if (no build)

- Transform `hydration-H6/no-device-switch.mjs` injects a head script that makes `ResizeObserver.observe` ignore `[data-builder-renderer]`. `viewportDevice` therefore stays at the SSR "desktop", which is the upper bound of option B within the LH window.
- Structural check (`verify.mjs`, 412 px, unthrottled):
  - Baseline: the flip happens at **1502 ms** and **only on the main content renderer**. The header renderer is `hidden lg:block` (Header.tsx:267), width 0, so it never switches (BuilderRenderer.tsx:268-271). The footer renderer (`cv-auto`) did not switch within 8 s.
  - Patched: 0 flips, 3 observe calls skipped.
  - Same `scrollHeight` (6693), same column padding, same 1-column widget grids. On the fixture the switch changes nothing visible.
- LH A/B command: `lighthouse-local.mjs --compare . . --html-transform-b ... --runs 3 --forms mobile` (CHROME_PATH set). Results in `hydration-H6/lh/`, log `hydration-H6/lh-run.log`. FCP, LCP, SI and CLS are identical.

## Lens 2 arithmetic (Lantern: TBT = sum of max(0, obs x mult - 50) over [FCP_sim, TTI_sim]; tasks that did layout get mult 2 instead of 4)

- The switch is a `startTransition` (BuilderRenderer.tsx:256-259). Its render phase yields every 5 ms, so its observed slices are about 5-14 ms. Simulated, that is 20-56 ms, at or under the 50 ms threshold: about 0-6 ms each, at most about 30 ms in total.
- The only non-yielding part is the commit plus the recalc: 25 `<style>` swaps, inline grid styles and the `data-device` attribute.
  - 166-198 ms at 4x devtools is about 45 ms observed at 1x.
  - It does layout, so mult 2: about 90 ms simulated, about 40 ms TBT.
- Expected total on the sandbox: 40-70 ms. The measurement (+32 ± ~60) is consistent with that and not with -150..-300.
- Why the plan's number is wrong:
  - It took the desktop-vs-mobile _viewport_ React delta (2512 vs 3056 ms at 4x devtools throttling) and read it as TBT. That delta is confounded by everything else that differs between viewports.
  - Under devtools 4x throttling the transition is starved until 7.4 s. Under Lantern (unthrottled observed run, x4 afterwards) it commits at about 1.5 s observed, in short slices.
  - TBT is threshold-convex: the time-sliced CPU of the transition mostly does not count.
- Not on the critical path for LCP or FCP: the flip happens after hydration, and LCP/FCP do not move (+0.01 s).

## Lens 1 findings (file:line)

1. **"CSS already lays out mobile correctly" is only half true.**
   - The `@media (max-width:767px)` block covers only `[data-columns-row]` and `[data-column-slot]` (styles.css:2514-2534).
   - About 30 further mobile rules are keyed only on `[data-device="mobile"]`, with no media-query twin:
     - widget grid 1 column (styles.css:1839-1844),
     - column padding 8px, centering and flex (2553-2560),
     - widget width (2562-2571), rows (2573-2579), images (2585-2601), figure (2603),
     - a/button wrapping (2607-2616), nav (2618-2637), h1/h2/h3 sizes (2639-2650),
     - search (2652), `aria-haspopup` (2814), tabs (2935-2967).
   - Per-device builder values are also resolved in JS for every widget: padding, margin and align in `styleToCSS` (frame.ts:44-63); hover CSS (ChromeWidgetView.tsx:235); typography CSS (:291, the 25 `<style>` swaps); frame height (:301; BuilderWidgetNode.tsx:85).
   - Further JS branches: `SiteMenu`/`MegaMenu` `mobile` (ChromeWidgetView.tsx:979, 985); `hideOn` (frame.ts:252, used at BuilderRenderer.tsx:823); `resolveSpan`/`resolveOrder` (BuilderRenderer.tsx:76-92).
   - So option B's "precondition audit" means emitting all three device variants as media-query CSS for every widget: more inline `<style>` bytes, which conflicts with html-weight (133 KB inline style in production already). The effort is not M.
   - Without that, real phones keep desktop-resolved responsive values for 10 s or more and then reflow, which is a field-CLS risk.
   - The fixture has no responsive overrides and no `hideOn` (the production homepage also has 0 `hideOn`), so neither LH nor e2e on the fixture would catch the regression.
2. **Option B's "until first user interaction" moves the whole re-render into the first tap.** Commit plus recalc is about 45 ms at 1x, and the render is about 125 ms at 1x before 4x mobile throttling. That is an INP regression for real users. "All islands hydrated" does not exist yet (H7). With a 10 s quiet window the work could still land inside the LH trace.
3. **Option A as written contradicts the code.**
   - "Render BuilderRenderer with device prop … ResizeObserver still corrects tablets" is impossible: when `device` is given, the effect sets it and returns before observing (BuilderRenderer.tsx:251-253). Admin previews rely on that, and builderRenderer.device.test.tsx pins "device z propa wygrywa z pomiarem" ("the device prop wins over the measurement").
   - It needs a new `initialDevice` prop and a client channel for the SSR value. `__root.tsx` has no request-header access today: no `getRequestHeader`, UA or bot logic.
   - The cache key is `host::pathname?query` (documentCache.ts:233) and needs a device dimension. That doubles the MISS surface per URL, and production MISS TTFB is 2.75 s (SI only per the model).
   - `revalidationHeaders` (server.ts:139-146) forwards `user-agent` but not `sec-ch-ua-mobile`. The classifier and the key derivation must agree on synthetic revalidation requests.
   - It also needs `Vary`.
   - LH does send mobile UA metadata (lighthouse core/lib/emulation.js:81), so PSI would get the mobile variant.
4. **"Removes the main source of forced island client-renders" is overstated.** The update is a transition, which suspends and retries on pending lazy boundaries instead of client-rendering them (BuilderRenderer.tsx:256 comment, F5 "restarted on pings"). It matters as a precondition for H7, not as TBT.
5. Gates: there is no chunk-graph impact; neither option adds import edges. Parity tests to update: builderRenderer.device.test.tsx and builderRenderer.streamingServer.test.tsx.

## Better alternative

- For TBT, the lever is task length and yielding. The LA what-if showed "no task over 12 ms obs" gives TBT 356 -> 0, plus H7 islands. H6 does not move the score in the harness.
- Keep H6 (option A, with an `initialDevice` prop and a keyed cache) only as an H7 precondition and for field INP/CPU on phones. If kept, it belongs in a later wave with its own A/B, not counted toward mobile 85.
- If a cheap partial is wanted: skip the switch when the subtree has no per-device overrides (compute a `hasResponsiveOverrides` flag at parse time in `safeParseBuilderDoc`). On the fixture that removes the switch with zero visual change. It still saves about 0 TBT in Lantern.
