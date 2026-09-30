# Critical boot performance — September 30, 2026

## Goal and constraints

Reach at least 85 performance on both mobile and desktop through measured improvements to real loading and interaction. Do not detect Lighthouse, suppress real features for audits, relax budgets, shrink full-column images, disable zoom, or defer work solely beyond the audit window. Preserve public pages and authenticated events, clubs, chat, calendar and dock behavior.

User requested an early draft PR and incremental commits so another session can continue without relying on scratch files.

## Baseline

Base commit: `174b3efdea3fddf7b154678e46c55e5467dee1da` (PR #423 merged).
Reports captured at 2026-09-30 15:57 UTC:

- [Mobile](https://pagespeed.web.dev/analysis/https-neweuropeanstrategies-com/fto8sf9zdh?hl=pl&form_factor=mobile)
- [Desktop](https://pagespeed.web.dev/analysis/https-neweuropeanstrategies-com/fto8sf9zdh?hl=pl&form_factor=desktop)

| Metric          |  Mobile |   Desktop |
| --------------- | ------: | --------: |
| Performance     |      48 |        74 |
| FCP             | 2476 ms |    621 ms |
| LCP (simulated) | 5401 ms |    981 ms |
| TBT             |  898 ms |    368 ms |
| CLS             |       0 | 0.0000015 |
| Speed Index     | 8800 ms |   3434 ms |

The previous layout stability fix is reflected in both reports. The remaining dominant costs are JavaScript execution, style/layout and mobile image loading.

## Evidence, not yet implementation claims

- Mobile main-thread work: 5899.9 ms; script evaluation 3038.0 ms; style/layout 1204.2 ms; parsing/compilation 460.7 ms.
- React-attributed mobile CPU: 2743.1 ms total, 2372.4 ms scripting. Attribution to the vendor file identifies framework work, not the responsible application component; a CPU trace is needed.
- Two Google tag scripts consume 367 KB transfer and approximately 582 ms main-thread time (third-party insight). Bootup attribution includes additional parsing costs. Preserve consent, queued events and analytics semantics while investigating duplicate/unneeded startup work.
- Mobile render-blocking CSS: estimated FCP saving about 450 ms. Avoid asynchronous global CSS that creates unstyled content or layout shifts.
- The observed LCP insight reports about 4396 ms resource discovery delay. Its final DOM snapshot shows an inactive carousel image (`opacity:0`, low priority), while the discovery checklist reports an initial high-priority discoverable resource. Do not infer a missing preload from that snapshot alone: distinguish initial slide, auto-rotation and actual request timing.
- Unused JavaScript opportunity: about 393 KiB. Reduce actual startup imports/work, rather than hiding it with a long fixed timeout.

## Work stages

1. **Diagnosis in progress:** inspect live startup requests and CPU profile; map React work to app components, and determine why the carousel changes the LCP candidate.
2. **Implementation in progress:** commit one verified improvement at a time, with its mechanism and affected shared surfaces documented below.
3. **Verification pending:** compare baseline/candidate under the same fixtures and browser settings, exercise public/authenticated paths, run unchanged CI gates, and keep raw metric improvements separate from deployed PSI scores.
4. **Production target pending:** do not claim 85 until deployment and fresh mobile/desktop PSI measurements confirm it. This PR is not authorization to merge or deploy.

## Continuation

- Branch: `perf/critical-boot-work`.
- Prior fix: PR #423; streamed first-fold SSR, mobile pre-hydration geometry, stable lazy widget boundaries, theme snapshots and input IDs are already on main. Preserve them.
- Current useful entry points: `src/routes/__root.tsx`, `src/components/builder/organisms/ChromeWidgetView.tsx`, `src/lib/builder/sliderVariants.tsx`, `src/components/ConsentScriptInjector.tsx`, `src/lib/performance/afterPageLoad.ts`.
- Full local builds previously exceeded workspace memory; use focused tests/types locally and full build/coverage/production-artifact checks in CI. Do not replace the full build with a success claim based on dev timings.
- Implementation commits, validation evidence and remaining work must be added here and in the PR description before handoff.

## Implemented changes and verification

### Copyright year: avoid unnecessary cold Intl initialization

CPU profiling mapped a long application call to `siteYear()` in the shared copyright widget. Constructor instrumentation found **one** `Intl.DateTimeFormat` construction, taking 80.8 ms under 4x CPU throttling. This is cold initialization, not repeated formatter construction; adding a formatter cache would not remove that first-call cost.

`siteYear()` now returns the UTC year away from January 1 / December 31, when Warsaw and UTC must have the same year. At the year boundary it retains the actual IANA timezone rules; pre-AD dates retain Intl era handling. No localized date/time formatting or event timezone behavior changes.

Validation:

- 25 tests passed: `siteYear.test.ts` and `ssrRenderSafety.test.tsx`. Includes half-day comparisons against Intl throughout ordinary, leap and century years, the exact Warsaw New Year boundary, SSR timezone independence, default clock argument and unavailable-Intl fallback. The test clock is fixed, as required by the repository's clock-freeze gate.
- Focused ESLint and Prettier passed.
- Isolated Chromium cold-process comparison, five alternating runs per implementation, 4x CPU throttling: baseline first-call median **93.4 ms**, candidate **0.6 ms**. Baseline samples: 93.4, 56.7, 142.2, 59.8, 102.3 ms; candidate: 0, 0, 0.6, 0.8, 0.8 ms. Each browser process loaded only the transpiled `format.ts` module, then timed one September copyright-year call. This isolates the mechanism; it is **not** a whole-page TBT reduction or a new PSI score.

### Diagnostic cautions for continuation

- Lighthouse's headline LCP and long-task diagnostics use simulated timing. Its network-request table and observed LCP breakdown use trace timing. Do not subtract timestamps between those models. In the supplied report, all initial assets started together after the document; the hero was initially high priority and preloaded. A later DOM snapshot shows the previous slide after autoplay.
- HAR replay is useful for CPU attribution, but missing replay responses fell back to network and some images had not loaded. Do not report its LCP as equivalent to production PSI.
- A naive React DevTools commit walk that counts `PerformedWork` flags overcounts reused fibers with stale flags. Do not use those counts as proof of excessive component renders.

### Slider measurement: subscribe only where navigation needs it

All five slider variants previously observed their container and stored its raw width in React state, although only multi-card navigation uses the measured column count. The four single-slide variants now avoid this observer entirely. Multi-card stores the responsive breakpoint and ignores subsequent width notifications within that breakpoint. CSS still sets full-width media and card geometry before hydration; image sizes, image loading priorities, manual navigation and autoplay are unchanged.

Validation: four focused test files passed (141 passing tests and 5 existing expected failures). New behavioral coverage checks navigation in all four single-slide variants, tablet/mobile/desktop pagination, no React commits for same-breakpoint width changes, updated configured columns, empty-to-populated widgets and observer cleanup when switching variants/unmounting. Existing image `sizes` and display-setting tests remain green. Focused ESLint and Prettier passed.

### Validation handoff

- TypeScript checking the changed files and their dependencies passed. The full local check exhausted its 6144 MB Node heap; CI completed the full typecheck successfully on `174ad5e`.
- Runtime changes are in `59f78b2` and `174ad5e`. The latter passed the full build/bundle gates, 8 artifact boot tests, regular E2E job, database harnesses and Lighthouse blocking gates. Lighthouse still emits performance/LCP warnings: green CI is not evidence of reaching 85. The CI clock-freeze gate caught the new year test importing a function with a default clock argument; the follow-up fixes the test clock and explicitly covers that default, without relaxing the gate.
- Consult the current PR checks for full build, coverage, seeded E2E, Lighthouse, paired first-visit and CMS-widget results before proceeding. Do not infer that these are green from local focused tests.
- Further high-impact work remains: attribute the React hydration cost to actual application components, evaluate splitting feature-specific CSS with route/SSR coverage, and investigate Google tag startup while preserving configured consent and conversion semantics. The copyright/slider changes alone do not establish the 85+ target.
- Concrete hydration candidate: `ChromeWidgetView` creates a frame before falling back to `DeferredWidgetView`; the full `WidgetView` creates another frame. The profile includes `useWidgetFrame` and typography-rule generation. Removing duplicate work must preserve the memoized lazy boundary from PR #423, which prevents early subscription updates from discarding streamed SSR content. Do not pass an unstable frame object across that boundary without a slow-hydration regression test.
- The captured homepage HTML contains 13 builder sections and 51 inline styles (132896 raw CSS bytes). Footer layout already uses `.cv-auto`; other below-fold sections are candidates for measured layout containment, with anchor navigation, focus, sticky/fixed descendants, editor previews and CLS checked before enabling it. These are investigation candidates, not implemented optimizations.

### Continuation: one owner for content-widget frames

All five workflows on `a23cc6c` completed successfully: CI, E2E (including seeded cases), Lighthouse, paired first-visit and CMS-widget performance. This confirms the previous checkpoint's gates, not the production 85+ target.

The next verified defect was duplicated frame setup: `ChromeWidgetView` called `useWidgetFrame()` before discovering that a widget belonged to the lazy full dispatcher, whose `WidgetView` called the same hook again. A regression test on the previous code observed two typography subscriptions for one post-list widget.

Content-only types now go straight to the existing memoized lazy boundary. The full dispatcher owns their only frame; chrome widgets use a separate frame component so changing types in the editor cannot change hook order. The small, typed dispatch list is checked against all three renderers to prevent metadata drift and stays independent of the full renderer's imports.

- Applies to 46 content types, including post lists, event widgets, club widgets, booking, donations and rich text. No data-access policy changes.
- New regression tests check one subscription / one initial typography compilation, live typography updates, unsubscribe, SSR markup parity, global widget updates (including a changed type), optimistic editor snapshots and chrome/content type transitions.
- 95 focused tests passed, including existing SSR parity, deferred hydration and column geometry cases. Focused lint and the performance-test TypeScript check passed.
- The slow-first-fold browser test now holds the content-dispatcher chunk after releasing the rest of the application. Both Chromium cases passed at 390/1440 px: streamed post titles survived, no fallback replaced them, the hero retained its full-column width and position, no hydration errors occurred, and CLS stayed below 0.1. This local run used Vite and fixture responses; it verifies behavior and geometry, not production performance. CI repeats this test against production artifacts.
- The shared homepage fixture has 48 widgets, seven of these content-only types: the structural change removes seven redundant frame setups (55 → 48), not half the whole page's CPU. Paired production-artifact timing remains the performance gate; no new PSI score is claimed.
