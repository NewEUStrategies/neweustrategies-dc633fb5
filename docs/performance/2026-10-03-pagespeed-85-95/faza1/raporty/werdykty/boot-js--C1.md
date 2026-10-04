# Verdict boot-js C1: cut the static edges of the `/` route component

Reviewer: adversarial (Opus). Code at b407045 (= 6a4215db + evidence), read-only. What-if run is in `verdicts/boot-js-C1/lh/`.

## Lens 1: feasibility and correctness. Verdict: WEAKENED

What holds:

- F10 holds. `routeSplitBehavior` returns `undefined` for `/` (`scripts/lib/routeCodeSplitting.ts:28-34`). The plugin treats `undefined` as the default groupings: see `router-code-splitter-plugin.js:79` (`fromCode.groupings ?? pluginSplitBehavior ?? getGlobalCodeSplitGroupings()`) and `constants.js` (`[["component"],["errorComponent"],["notFoundComponent"]]`). So the comment at `routeCodeSplitting.ts:3-8` is wrong. If `/` returns `[["component"]]`, `HomeErrorComponent` and `HomeNotFoundComponent` (`src/routes/index.tsx:80-97`) stay in the shell. They only add `HomeErrorNotice` and `HomeNotFoundNotice` (about 2.8 KB of source). `lib/errorCopy` is already in the entry. In return the merged `eventInvoiceMath-*` preload (billing/nip code) is dropped from `/`. The test `src/lib/ci/__tests__/routeCodeSplitting.test.ts:21-26` pins `/` to `undefined`, so it has to change. The change already lists that file.
- The FooterSlideup parity claim holds. On SSR and on the first client render it returns `null` (`src/components/ads/FooterSlideup.tsx:64`; `visibleId` is only set inside a timeout effect). Mounting it after `whenIdle` keeps the HTML identical. `whenIdle` already exists (`src/lib/ads/idle.ts`). The behaviour change is that the slide-up appears up to 3 s later. Logged-in users and editors are not affected.
- The prototype data refute my worry that an idle `import()` of FooterSlideup would re-fetch the `blog.index` closure. In both prototype builds (2048 and 0), FooterSlideup becomes its own chunk (`chunk-inventory-proto1.json`: `FooterSlideup-7aHMjohj.js` imports vendor-react, the entry, `Logo-*` and vendor-i18n).

What breaks or is missing:

1. **A plain `React.lazy` for `LatestPostsHome`, and for `Footnotes`, goes against the repo's documented SSR rule.** `src/components/builder/organisms/widget-view/lazyWidgets.tsx:49-56` says, as a fix dated 2026-10-01, that under streaming SSR `React.lazy` suspends on the first render in each process. The shell then ships the fallback, and the real HTML arrives at the end of the document through `$RC`. That was measured as LCP bimodality plus a 0.0168 layout shift (`docs/performance/2026-10-01-first-visit-lcp-streaming.md:9-27`), and the edge cache replays that body. The repo's fix is to load the component eagerly on the server via `createIsomorphicFn` (`lazyWidgets.tsx:151-162`). In `latest_posts` mode, the LCP element (the first card cover) is inside `LatestPostsHome`. Being "already inside Suspense" (`index.tsx:410`) is the problem, not the protection: the fallback is `HomeLoadingNotice`, a skeleton. The change has to use the isomorphic pattern.
2. **Hydration-discard hazard (F6 class).** After C1, nothing preloads the `LatestPostsHome` chunk, so the dehydrated boundary waits a full extra waterfall. During that wait, `Index` can re-render (three `useSuspenseQuery` calls plus `useTranslation`, `index.tsx:347-356`). If it does, React drops the server HTML and shows the skeleton. That is CLS in `latest_posts` mode. Fix: add a conditional modulepreload when the loader resolves `homeMode === "latest_posts"`, or start the import on the client when the loader runs. `Footnotes` has the same issue when footnotes exist: `HomeBuilderContent.tsx:68-72` has no Suspense of its own, so a lazy child would suspend the route boundary.
3. **C1 cannot ship alone.** The proto1 build at `experimentalMinChunkSize: 2048` (`vite.config.ts:312`) parks date-fns in `admin.analytics-*` and the entry imports it statically. Boot goes from 482.4 to 486.6 KB gz, which is pre-FCP and render-blocking, and an admin-named chunk lands in boot. `check:entry-purity` is marker-based and will not catch this. The C9 gate does not exist yet. `check:bundle` boot (579) still passes, so only C10 plus C9 protect against it. The `depends_on: C10` is right and must be a hard dependency.
4. **The prototype that produced the numbers has a bug.** In `phase1/boot-js/prototype.diff`, `IdleFooterSlideup` renders `<IdleFooterSlideup />` instead of `<FooterSlideup pageType="home" />`. FooterSlideup never mounts, and a new nested component appears on every idle tick. The static closure numbers from `hydset.py`/`homeset.py` still hold. The Footnotes part was never prototyped at all.
5. **Most of the gain is C10's.** In the baseline, `/` inherits `cfp-submit`, `vendor-lucide`, `MoneyText`, `author._slug` and the date-fns `pl` chunk only because Rollup's min-size merge put FooterSlideup into `blog.index-BPS41JJU.js` (`reports/chunk-inventory.json`: one chunk holding `FooterSlideup.tsx` and `blog.index.tsx?tsr-split=component`). FooterSlideup has five static importers (`index.tsx:8`, `$.tsx:171`, `blog.index.tsx:11`, `search.tsx:35`, `ArchiveBody.tsx:5`). With `minChunkSize: 0` it would naturally be a shared chunk of its own, so C10 alone most likely cuts that inheritance with no React change. This is inferred, not built. What is left for C1 alone is `LatestPostsHome` (PaginatedPostGrid, useInFeedAds, PostListCard, ArchivePagination: about 4.8 KB transfer), Footnotes (2.2 KB) and the errorComponent chunk (1.5 KB).

Gates: `check:chunks` and `check:chunk-parity` are not threatened; these are only new dynamic edges. `noHasSelectors`, i18n (`ads.dismiss` is a core key), SEO head and JSON-LD all stay in the shell, so no change there. `homeRoute.test.tsx:164` mocks FooterSlideup and works with a dynamic import.

## Lens 2: effect on the Lighthouse score. Verdict: WEAKENED

**Pre-FCP part, measured.** The what-if `drop-route-preloads.mjs` removes the head and Link modulepreloads for exactly the C1-removed chunks: blog.index, Footnotes, PaginatedPostGrid, useInFeedAds and eventInvoiceMath. I ran it with the canonical harness: h2, fixture, A/B interleaved, 3+3 mobile.

- In every B run, the 5 chunks moved after observed FCP: 25 files / 506.4 KB → 20 / 500.2 KB pre-oFCP; `highBeforeLcpImg` went from 618.3 to 612.2 KB.
- **FCP 4.07 → 4.08 s, LCP 4.82 → 4.83 s, SI 4.07 → 4.08 s.** That is zero within the ±0.01 s A/A noise.
- The TBT delta (+90 ms) is noise (range 213-398 ms).

In production h2 the removed pre-FCP set is about 5.6-7 KB (PaginatedPostGrid 815 B, blog.index 1 745, Footnotes 1 990, useInFeedAds 1 037, plus the error chunk). Even the pack's ~5 ms/KB gives at most about 35 ms, which works out as FCP 0.09 pt + LCP 0.12 pt + SI 0.04 pt, or about 0.25 pt. Measured locally it is 0. Without C10, the +4.2 KB of `admin.analytics` cancels most of it.

**TBT and SI (the claimed −20..−50 ms).** The evidence does not support it:

- Production mobile TBT is 202 ms. It is gtag `AW-…` (133 ms past 50) plus `G-…` (20) plus hydration in vendor-react and the entry (49). TTI is 10.6 s, set by gtag.
- None of the removed chunks (cfp-submit, vendor-lucide, PostListCard, ArchivePagination, MoneyText, author._slug) appear in `bootup-time` (50 ms threshold) or `long-tasks`. That is true in prod-mobile and in 8 local mobile runs. The one exception is `author._slug` at 71 ms, once, with 0 ms of scripting.
- Their evaluation (about 160 KB raw, roughly 20-40 ms simulated) runs as a separate module-graph task, because `router.tsx` keeps `setTimeout(0)` before hydrate. A task under 50 ms adds 0 to TBT.
- Render work does not change in builder mode: FooterSlideup renders `null`, LatestPostsHome is not rendered, and there are no footnotes.
- SI equals FCP locally, and the post-boot wave starts after observed LCP (3 374 ms against 3 303 ms in production). The bandwidth it frees goes to below-the-fold images, so SI effect is about 0.

**Corrected estimate.**

- Mobile: TBT 0..−15 ms (expected about −5). Near TBT 250-400 the slope is φ(z)/(σ·TBT)·0.30 ≈ 0.031 pt/ms × 0.30 → about 1 pt per 30 ms. That gives **0..+0.5 pt**. FCP/LCP: 0 measured, at most +0.25 pt in theory.
- Desktop: TBT is 0 in production and 50-71 ms locally, which is already a score of about 0.99. **0 pt.**
- Contribution to the targets (mobile 85: pre-LCP ≤ 300 KB and TBT ≤ 250; desktop 95: TBT ≤ 110): negligible. C1 is hygiene and a real-user win: the `/` component graph goes from 3-4 import levels to about 2, so hydration starts 1-2 RTT earlier. It is not a score lever.

**Cheaper ways to get the same effect.**

- C10 alone (min-chunk merge fix) most likely gets the FooterSlideup/blog.index part.
- C2 (preload filter) drops the errorComponent and other foreign preloads without code changes in the route.
- If C1 is kept, use `createIsomorphicFn` (server eager, client lazy) for `LatestPostsHome` and `Footnotes`, plus a conditional preload for `latest_posts`.
