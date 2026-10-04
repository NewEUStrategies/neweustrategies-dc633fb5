# Verdict PA-C2: gate raw boot bytes (bootRaw) as a sixth frozen budget

## Lens 1: feasibility and correctness. WEAKENED

Mechanically trivial. What decides:

- `scripts/check-bundle-size.ts:2472-2480` already computes `bootRaw` over the same `bootClosure(files)` set. Adding a gate means: a `bootRaw` key in `FROZEN_BUDGET_KB` (:1752-2044), `budget("bootRaw","MAX_BOOT_RAW_KB")` (:2049-2073), an `errors.push` (:2571-2583), a headroom row (:2630-2637), and an optional `totals.bootRaw` in `BaselineFile` (:2117-2130) and in the `--update-baseline` snapshot (:2605-2613).
- The negative-control harness already exists: `src/lib/ci/__tests__/platformBuildGuards.test.ts:73-113`, with a fixture, `MAX_BOOT_KB:"1"` and `entropy()` (about 106 KB raw). A `MAX_BOOT_RAW_KB:"1"` case is a copy of that test. Existing tests stay green: the fixture's raw size is far below 1576 KB, and the regex at :112 only bans public/overall/largest.

Problems the proposal does not address:

1. **The design choice is documented.** The comment at :2476-2478 says "Raportowane, NIE bramkowane - jedna metryka, jeden próg" (reported, not gated: one metric, one threshold). Overriding it needs a chronicle entry that explains why two correlated thresholds are wanted. Minified JS keeps a raw/gzip ratio of about 3.29 (1568/477).
2. **The floor's provenance breaks the file's own rule (wpis V, :1140-1148, :2036-2041).** 1568.0 / 1568.6 KB comes from `build:smoke` (`vite.smoke.config.ts`) in the sandbox. CI gates `bun run build` (`.github/workflows/ci.yml:997,1052`) on the runner. The documented host-to-runner skew is +0.466% (:841, :1232). A floor of "1568 + 0.5%" leaves 0.03% of real headroom, which is the same mistake as the 577 -> 579 re-floor at :2032-2041. By the file's formula, the floor is 1568.6 x 1.00466 = 1575.9 -> 1576 -> **1577**, and it must be re-floored from the first green runner log.
3. **"The real artifact passes" cannot be shown end to end.** check:bundle already exits 1 on main (overall 4806.8 > 4772; prior-art/check-bundle.txt). Verification can only assert that no `boot raw` error line appears.
4. **It duplicates another gate.** The untracked `scripts/performance/document-weight-budgets.json` already gates `bootClosureRawBytes` (max 1 637 758 B = 1599.4 KB, measured 1 605 645 B = 1568.0 KB). That leaves two gates and two floors for one number, which is the "one metric, one threshold" failure in another form. Pick one.
5. No SSR, hydration, i18n, SEO or CLS risk, and no effect on chunk graphs (CI script only). The editor and logged-in paths are untouched.

## Lens 2: effect realism. WEAKENED (the metric attribution is refuted)

The claim "parse/compile on Moto G 4x scales with raw bytes, so this guards TBT/TTI" does not hold in Lighthouse's own accounting. `bootup-time` `scriptParseCompile`, summed over `.js` URLs:

- baseline2 mobile runs 1/2/3: about 8 / 3 / 2 ms (all scripts including the document: 91 / 40 / 39 ms). `scripting` (execution) is 4064-5322 ms, with vendor-react at 4447 ms (hydration).
- prod-mobile.json: 3 ms of JS parse/compile out of 1533 ms scripting. Desktop: 0-3 ms.

V8 streams and compiles module scripts off the main thread and compiles functions lazily. So 1568 KB of raw boot costs about 3-8 ms of main thread in the simulated 4x trace. A +10% raw regression (+157 KB) adds well under 1 ms of parse/compile, which is 0 TBT points. The execution cost that does count follows the code that runs (hydration), not the bytes shipped.

What actually threatens the score is the **transfer** of boot bytes at 1.6 Mb/s, which delays LCP (EVIDENCE §10). The gzip `boot` gate already covers that, but it has 102 KB of slack (579 vs 477.1). Spending that slack silently costs 102 x 8 / 1600 ≈ **0.51 s** of mobile bandwidth ahead of the hero image. Under the proposal, the raw floor would become the binding boot constraint by accident: 7.8 KB raw is about 2.4 KB gzip. That is backwards: the gate would bind on the metric Lighthouse barely counts.

**A cheaper change with the same or better effect:** ratchet the existing `boot` floor from 579 to 477.1 x 1.00466 = 479.3 -> 480 -> **481 KB gzip** (the file's own formula, :1232). It needs no new code, keeps "one metric, one threshold", and guards both transfer and, through the ratio, raw size. Keep `bootRaw` as a reported or headroom-warning line. If the audit's 3.9 must be closed literally, keep only one raw gate (check:bundle or document-weight), floored from the runner.

## Corrected estimate

- Direct score: 0 points (agrees with the claim).
- Guard value of a raw gate: about 0 TBT/TTI ms per realistic regression, since LH-attributed JS parse/compile is under 10 ms in total. It adds almost nothing over a ratcheted gzip boot gate. Its only unique catch is a highly compressible addition (inlined JSON or dictionaries), and those also cost transfer, which the gzip ratchet already catches.
- The gzip ratchet (579 -> 481) prevents up to about 0.5 s of mobile LCP drift. This is the guard worth shipping.
