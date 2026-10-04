# Verdict: html-weight / HW-3 (dehydration diet: project query results in the query functions)

Reviewer: Opus, adversarial. Code was read-only. No what-if run, on purpose (see Lens 2).

## Lens 1: feasibility and correctness. Verdict: WEAKENED

Sub-items (a), (b), (c) and (e) work in principle, but each needs more files or conditions than the change lists. Sub-item (d) is mostly refuted by the code.

### (d) Site-settings boot projection: mostly refuted

Trim-sim `settingsOmit` (html-weight/trim-sim.mjs:66-68) drops 9 keys, worth 6 650 B of JSON. Three of those keys **are read during the first render**:

| Key            |    Size | Read during first render by                                                                                   | Why it must stay                                                                                                                                                                                        |
| -------------- | ------: | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `theme_design` | 2 260 B | `src/components/theme/ThemeDesignStyle.tsx:63-72`                                                             | Without it, client input ≠ SSR input, so the hash differs. `useDeferredStyleCss.ts:52-69` then regenerates the CSS from `undefined`, which resets theme tokens after hydration (the F29a class of bug). |
| `font_sizes`   |   909 B | `src/components/theme/ThemeFontSizesStyle.tsx:32-38`                                                          | Same mechanism as `theme_design`.                                                                                                                                                                       |
| `seo`          | 1 087 B | `src/routes/index.tsx:356,401` → `homeSrHeadingText` (`src/components/home/atoms/homeHeadingSource.ts:31-35`) | The home h1 text would differ between SSR and client: a hydration text mismatch on the h1.                                                                                                              |

Other keys cannot be dropped safely either:

- **`key_takeaways` and `discussion`** are read on post routes. A union boot set over `/`, a post and a category keeps them.
- **`auth_branding` is read straight from the bulk cache, not through `useSiteSetting`**:
  - `src/hooks/useAuth.tsx:409-411` reads the logout redirect via `ensureQueryData(siteSettingsQueryOptions)`.
  - `src/hooks/useAuthSettings.ts:18-27` builds `initialData` from the bulk map.
  - Result: a logged-in user's sign-out ignores the configured `logout_redirect_url`, and sign-in uses the defaults for 60 s.
  - Neither path goes through `useSiteSetting`, and the SSR key-read recorder cannot see event-time reads.
- **About 40 non-admin files read `siteSettingsQueryOptions` directly.** The "lazy full map in `useSiteSetting`" design covers only the 12 `useSiteSetting(` call sites.

What is actually safe to omit today: `menu_primary`, `permalinks`, `media`, about 0.4 KB raw. With auth readers migrated it is about 1.8 KB raw, roughly 0.1–0.45 KB gz. The claim was 1.58 KB gz.

Gate note:

- `check:ssr-budgets` `dehydrationWritesPerLoader` is 11, and `__root.tsx` measures exactly 11 (`src/lib/ci/ssrBudgets.ts:152,186-189`).
- A "partial marker" written with an extra `setQueryData` would fail that gate. The marker must live inside the data object.

### (e) Do not dehydrate global colors / design tokens: feasible only as "fetch on the server, exclude from dehydration"

- **"Not prefetched for anon" is wrong as written.** SSR renders `DesignTokensStyle` from those queries. `src/routes/__root.tsx:603-611` documents that dropping `globalColors` from wave 1 removes half the block: `--gc-*`, the `--background`/`--primary` overrides and the bridge.
- **The exclusion needs files the change does not list:**
  - `src/router.tsx:67`: `shouldDehydrateQuery` must filter by key or meta. Keep the literal `status === "success"`, which the `ssrBudgets.ts:686` invariant checks.
  - `DesignTokensStyle.tsx:47-53`: it passes `tokens ?? EMPTY_TOKENS`, so the hook cannot tell "undefined" from "empty".
- **`useFontScale()` (`DesignTokensStyle.tsx:48`, `src/hooks/useFontScale.ts:18-27`) is not warmed and still fetches the row after hydration.**
  - When it arrives, the input changes while tokens and globals are still undefined (disabled for anon). The generator then runs with EMPTY colors and wipes the theme.
  - Font scale must be gated in the same way, or folded into hydration H2's single row query.
  - H2 owns the same cause (the design-token refetch and style swap). These are two alternative designs and must not be counted twice.
- **"−2 PostgREST": at most −1 request and −1 preflight.**
  - Tokens, globals and font scale converge on one in-flight `fetchSiteDesignTokensRow` (`src/lib/builder/designTokens.ts:79-104`).
  - Font scale must be gated too.
  - (a)'s idle prefetch of menu children adds one serverFn GET back.

### (a) Public menu projection: OK. Top level only, children on intent: feasible with conditions

- **The projection works.** The server function can project from the same `edgeTtlCache(menuCacheKey(key))` entry (`menu.functions.ts:104-115`), so the purge at `:250` and the durable/L2 lists (`src/lib/ssrCache.ts:34-39,64-71`) stay valid.
- **Conditions for the top-level-only split:**
  - `hasPanel` and `panelKindFor` (`src/lib/menus/siteMenu.ts:101-109`) read `children.length`, and `hasNestedChildren` decides mega auto-promotion. `has_children` must be computed after `filterMenuItemsForViewer`'s visibility rules (SiteMenu.tsx:552-553), otherwise SSR renders a `<button>` where today an anon user gets a link.
  - `warmMegaPanel` (`SiteMenu.tsx:339-345`) cannot know "mega" without the children.
  - `MobileItem` (`SiteMenu.tsx:466-…`) renders children inside `<details>` the moment the lazy drawer opens (`Header.tsx:22,315`). The idle prefetch is mandatory.
  - The `__root.tsx:884-893` HMR guard, `:746-747` and `prefetch.ts:220,457` must move to the new key.
  - 10 test files reference `menu-with-items`.
- **Real-user cost (no PSI effect):** a `lang` in the key means a soft language switch (`switchUiLanguage.ts:163`) refetches and shows the skeleton (`SiteMenu.tsx:555-575`). That needs `placeholderData`.

### (b) Post-row locale projection: feasible

- The post-list, slider and rated-list keys already carry `lang` (`postListQuery.ts:438`, `sliderPostsQuery.ts:147`, `ratedListQuery.ts:350`).
- **Fallbacks must match each consumer exactly:**
  - `PostListView.tsx:269-277`: title falls back to PL, then EN; excerpt has **no** fallback.
  - `PostsSliderWidget.tsx:149-151` and `NewsTickerView.tsx:61` have their own variants.
  - A generic "lang with fallback" would change EN excerpts.
- `sectionPrefetch.test.ts` pins `RATED_LIST_POST_COLUMNS`.
- **The ticker key gains `lang`** (`headerTickerQuery.ts:83-91`). On a soft language switch the ticker unmounts its data and the bar collapses and reappears. This is the CLS the root comment at `__root.tsx:726-731` was written against. It needs `placeholderData: keepPreviousData`.

### (c) Newsletter inline projection: feasible

- The full key must stay for `NewsletterPopup`, admin, and `registrationFields.ts:67`, which reads `popup_fields` for `AuthPortal` and `ClubAccessGate`.
- The popup fetch comes about 15 s later, after the Lighthouse window.

### Gates

- check:entry-purity, check:chunks and noHasSelectors: no graph change.
- check:loader-policy: excludes `__root.tsx` (`loaderPolicy.ts:224-236`).
- check:ssr-budgets: see (d) and (e).

## Lens 2: effect on the Lighthouse score. Verdict: WEAKENED

### Bytes (production, trim-sim per-step gz)

- **The claimed −10.8 KB gz is not all HW-3.** It is 25 930 → 15 111 B, and that total includes `internPosts` (HW-3h), `relUrls` (HW-5), `builderLocale` (HW-3f, "later") and `seoLoader`.
- **HW-3 (a)–(e) as listed:** 1 642 + 1 280 + 1 796 + 1 578 + 713 + 2 627 = **9 636 B gz**.
- **After correcting (d)** (−1.58 → about −0.3 KB): **about 8.4 KB gz** (about −50 KB raw).
- **Fixture:** (a)–(e) claimed 3 842 B gz. With `settingsOmit` corrected 985 → about 200 B: **about 3.0 KB gz**.

### FCP / LCP

0 ms.

- HWF-5 measured no FCP/LCP movement for a −32 KB gz document cut (80.5 → 48.5 KB). The P0 → P1 state trim alone gave FCP 1 380–1 449 vs 1 386–1 439.
- Structurally: with an initial cwnd of about 14.6 KB, delivery is cumulative 14.6 / 43.8 / 102 KB per RTT round. The 89 KB production document and 89 − 8.4 = 81 KB both need 3 rounds, so no round is saved. The document is not the long pole while the 79 KB render-blocking CSS and the boot JS are in the set.
- This holds after boot-js too: the document stays above 44 KB.

### TBT today

0.

- In the PSI mobile trace, every document-attributed long task (1 581 / 98 ms, 1 739 / 51, 1 831 / 96, 1 958 / 89) comes before FCP at 3 494 ms, so none is counted.

### TBT after boot-js:C3 (FCP ≈ 1.4 s)

Those tasks enter the TBT window, with an excess of (98−50) + (51−50) + (96−50) + (89−50) = 134 ms.

- **The claim "barrier eval ~140 ms at 4×" is refuted by `bootup-time`.** The document URL has scripting 53 ms and parse/compile 19 ms in total, at 4× (prod-mobile.json), covering _all_ inline scripts.
- **Halving the barrier:** about −20…25 ms of script.
- **HTML tokenizing:** 50/569 KB × 144 ms parseHTML ≈ −13 ms.
- **CPU saved:** about −35 ms. **TBT saved:** about −15…−35 ms, because the tasks stay above 50 ms.
- This matches the measured no-JS P0 → P1: main thread −62 ms median, TBT median 103 → 86 (−17, noise-level, N = 3).
- **Score arithmetic:**
  - Mobile TBT curve (p10 200, median 600, σ = 0.858): about 0.029 score per 30 ms near 200 ms, times a weight of 0.3, gives **about +0.9 pt per 30 ms**.
  - Result: **+0.4…1.0 mobile points, only after boot-js**.
- **Desktop:** PSI TBT is already 0, and document tasks at 1× are under 50 ms. **0 points.** SI change is at most a few tens of ms, so about 0.

### Post-hydration requests

- Net about 0. (e) removes at most 1 request + 1 preflight, and only with font-scale gating. (a) adds one serverFn GET.
- The style-swap TBT win belongs to H2. Do not count it here.

### What-if

Not run.

- The harness rewrites HTML only. A trimmed `$tsr` without matching client query functions makes hydration refetch or re-render, which contaminates TBT.
- At A/A TBT noise of up to ±464 ms, two runs cannot resolve −15…35 ms.
- The workstream's no-JS P0/P1 run plus the trace arithmetic are the stronger evidence.

### Corrected estimate

- **Bytes:** production state −8.4 KB gz / about −50 KB raw (fixture about −3.0 KB gz).
- **FCP/LCP:** 0.
- **Mobile TBT:** 0 today; −15…−35 ms after boot-js, which is +0.4…1.0 points.
- **Desktop:** 0.

### Cheaper option with most of the effect

Ship (a) projection without the children split, (c), (b) with `keepPreviousData` on the ticker, and (e) merged into H2 under one owner. That gives 1 642 + 1 280 + 2 627 + 713 ≈ **6.3 KB gz, about 75 % of the corrected bytes, at low risk**.

- Drop (d), or reduce it to the 3 unread keys.
- The top-level-only split is +1.8 KB gz at medium risk (first hover, drawer, visibility, mega warm-up).
