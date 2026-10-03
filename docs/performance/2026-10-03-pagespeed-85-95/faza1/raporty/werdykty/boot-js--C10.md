# Verdict boot-js / C10: limit experimentalMinChunkSize merging

Feasibility: WEAKENED. Effect: WEAKENED (the score effect is close to zero; the change works as a guard against re-parking, not as a gain).

## Lens 1: feasibility in this codebase

What holds:

- The mechanism is real. `vite.config.ts:312` and `vite.smoke.config.ts:127` both set `experimentalMinChunkSize: 2048`. Rollup 4.60.2 defaults the option to 1 (`node_modules/rollup/dist/es/shared/node-entry.js:23585`).
- Repo history shows that 2048 keeps parking small modules in the wrong chunks:
  - `src/lib/utils.ts:27-34`: boot grew by +5 to +18 KB gz, from date-fns helpers or the whole vendor-lucide.
  - `docs/WDROZENIE_DESIGN_SYSTEM_SZESC_FUNKCJI_2026-10-03.md` §2.8: `admin.analytics` landed in boot at 491.6 KB.
  - `docs/WDROZENIE_KATALOG_OSOB_PROFIL_ORGANIZACJI_2026-10-02.md:79`: the `["checkout-success"]` key put admin.analytics into boot.
  - `scripts/lib/routeCodeSplitting.ts:39-52` (ADMIN_COCKPIT_SPLIT): 42 KB of dashboard code was billed to PUBLIC.
  - `docs/CMS_WIDGET_PERFORMANCE_2026-09-12.md:37`: an auth stub was merged with JSZip.
- My checks on the inventories:
  - **proto2-min0**: the entry's static imports are only the 8 manual vendor chunks, and the static chunk graph has 0 cycles (DFS over `imports`).
  - **proto1** (C1+C7 at 2048): the entry imports `admin.analytics-BsK4WgFx.js`. That chunk holds 40.4 KB pre-min of date-fns plus the micro-modules `eventVideoHeader`, `mentionTargets` and `notFoundIfClean`.
  - **Both builds**: the entry itself holds 0 date-fns modules. The entry needs the micro-modules, not date-fns.
- Merging into the entry also happens. At 2048, 63 modules totalling 30.1 KB pre-min are merged INTO the entry; at 0 they leave. Examples: `AdminFormSection`, `admin/newsletter/logFilters`, `adminCfpLabels`, `admin/users-query`, `crm/eventActivity`, and errorComponent splits of `$` and `post.$slug`.
- The chunk-parity test survives a value of 0. `viteChunkParity.test.ts:51` matches `\d+`, which includes "0". Removing the option instead would break the `toBeDefined` assertion.

What weakens or refutes it:

1. **Option B, a `vendor-date-fns` manual chunk, is refuted.**
   - date-fns spans 244 KB pre-min across 5 or 6 chunks: calendar 96.4, ClubEventForm 81.0, pl locales 40.4, formatDistanceToNow 18.2, search 7.8.
   - One closure-safe chunk would make every public lazy path that needs one function (search, formatDistanceToNow, post locale) download all of it, about 60-70 KB gz instead of 8-40 KB pre-min.
   - It also does not stop non-date-fns micro-modules from being parked elsewhere. Those micro-modules are what created the entry edge.
2. **A value of 512 does not deliver "never".** Merging by size heuristics still applies to modules under 512 B. The ADMIN_COCKPIT micro-module was about 140 B and the `checkout-success` key was a tiny constant. Only 0 or 1 gives the structural guarantee. 512 is what `docs/PLATFORM_SSR_REMEDIATION_2026-09-06.md:95` used before.
3. **check:bundle risk is understated.**
   - The change cites +55 KB on OVERALL, and OVERALL is already red on main.
   - The PUBLIC budget is `FROZEN_BUDGET_KB.public = 2877` (`scripts/check-bundle-size.ts`). Main measured 2854.7 on 2026-10-03 (design-system doc §2.8), so headroom is about 22 KB.
   - The build adds 422 files: 252 under 500 B pre-min and 22 empty facade chunks. These compress poorly and many are reachable from public routes, so PUBLIC can turn red. Nobody measured it.
   - The thresholds are frozen in code and cannot be overridden by env in CI. Shipping would need a recorded budget raise that the policy treats as debt.
4. **CLS hazard (F6) is not covered by C10's verification.**
   - `scripts/lib/widgetChunkPlugin.ts:177-185` preloads only the chunk that contains the widget module. It does not preload that chunk's static dependencies, and `hoistTransitiveImports: false` is set at `vite.config.ts:308`.
   - If 0 splits widget dependencies into micro-chunks, an above-fold widget gets an extra waterfall level before it hydrates. That is the class that produced CLS 0.42 in `bootjs-strip-route-mobile-2`.
   - The hydration set going from 44 to 45 files suggests the effect is small. Still, at least 5 mobile runs with CLS 0 and the smoke-build browser boot test must be added to C10's verification.
5. **Hygiene.** The 22 empty facade chunks are pure request overhead. The Rollup default of 1 gives the same "no code parking" guarantee and drops them. It should be measured instead of 0.

No i18n, SEO or SSR impact: the change applies to the client environment only, and the server build is untouched. Logged-in and admin users get more, smaller files on deep admin routes. They load over h2 via mapDeps preloading, so behaviour is unchanged.

## Lens 2: effect on the Lighthouse score

Attribution:

- The 482.4 to 479.9 KB boot figure and the 638.7 to 601.8 KB hydration-set figure belong to C1+C7+C10 together.
- C1 alone accounts for about 38 of the 36.9 KB hydration-set drop (`/` closure 56.2 to 18.0).
- C10's own increment over proto1 (C1+C7 at 2048):
  - boot: 486.6 to 479.9 = **−6.7 KB gz**, of which the parked admin.analytics chunk is about 5.5 KB.
  - `/` closure: 18.0 to 16.3 = −1.7 KB.
  - Total: **about −8.4 KB gz**.

C10 alone on current main (no C1):

- The local main build already has 9 boot files and no admin.analytics, per `reports/chunk-inventory.json`.
- The entry loses 30 KB pre-min of merged lazy modules but gains mapDeps rows for 422 more files.
- Using proto2 against proto1 minus admin.analytics, the net change to entry plus vendors is about −1 KB gz. **That is about 0, within noise.**
- Production still shows admin.analytics-D7PYqOYF (5.7 KB) because it is an older deployed graph. Main already fixed it by accident (people-catalog doc).

Score arithmetic, mobile, using the analyst slopes (LCP 6 ms/KB, FCP 5.1 ms/KB):

- Standalone: about −1 KB gives about −6 ms, which is 0 points.
- Conditional on C1 and without C3: −8.4 KB gives about −50 ms LCP and up to −35 ms FCP. Near LCP 4.8 s the LCP score moves 0.3075 to 0.3176, worth +0.25 points; FCP adds +0.06 points. **Total ≤ 0.3 points.**
- With C3 (boot after load): boot bytes leave the FCP/LCP graphs. Only parse/eval of about 15 KB of minified code remains, worth less than 5 ms of TBT, so 0 points.
- Desktop: 0.8 ms/KB × 8 KB is about 7 ms, so 0 points.
- Scale against the target: the pre-LCP set must fall about 500 KB, from about 800 to 300. C10's increment is under 2% of that.

The real value is variance control. Under 2048, any unrelated module addition can put +5 to +18 KB gz back into boot (`utils.ts:27-34`), which is 0.2 to 1 point of noise. A cheaper and stronger guarantee is the C9 purity gate plus a value of 1 (Rollup default), measured for PUBLIC and OVERALL.

Corrected estimate:

- Standalone on main: boot −0..−1 KB gz, so 0 points mobile and desktop.
- Conditional on C1 (no C3): −6.7 KB boot and −8.4 KB hydration set, so ≤ +0.3 points mobile and 0 desktop.
- Cost: +422 files, +55 KB OVERALL, and PUBLIC +? that may exceed the 22 KB headroom.
- Treat C10 as a guard that ships with C1 and C9, not as a score lever.
