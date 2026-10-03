# Verdict: hydration / H2 (one site_design_tokens row query + real post_layout_settings warm)

Reviewer: adversarial (Opus), 2026-10-03. Repository read-only. No LH run: the canonical harness has a dead
client backend (127.0.0.1:4199), so it cannot reproduce the production trigger (see L2), and A/A TBT noise is
±464 ms. The evidence below is structural: code, the React 19 source in node_modules, and the existing CDP traces
in `phase1/hydration/runs/`.

## Verdicts

- Feasibility/correctness: **WEAKENED**. The mechanism works and the gates can be met. The attribution is partly wrong,
  and there is required collateral the change does not list.
- Effect: **WEAKENED**. One real ~260–390 ms (CDP 4x) recalc+layout task is removed. It is not caused by a data change,
  though, and a much cheaper change removes the same task. The "-2 style swaps" and "ContentAreaStyle" parts are not supported.

## L1 — what the code says

1. **What really costs time: an identical-text rewrite of `<style data-brand-tokens>` (26.6 KB of `:root` vars).**
   - React 19.2 `updateProperties` (node_modules/react-dom/cjs/react-dom-client.development.js:21122-21127) calls `setProp` whenever `nextProp !== lastProp`, comparing by object identity. `setProp` then writes `domElement.innerHTML` unconditionally (:20407-20420).
   - `DesignTokensStyle.tsx:75` passes a fresh `{{ __html: html }}` on every render. So **any** re-render rewrites the sheet, even when `html` is unchanged.
   - Trace proof: `runs/m4-ok-1` shows `style[data-css-hash=sarry70nrrqq4]` #text add/rm at 3174 ms with **no `data-css-hash` attribute change** (no attr record exists in any run), so the hash and content were unchanged.
   - What triggers the re-render: `useFontScale()` (`DesignTokensStyle.tsx:48`). Its `data` goes from undefined to `{}` when the client fetch resolves, because `["site_font_scale"]` is not warmed (`__root.tsx:631-639`). `normalizeFontScale('{}')` returns a new `{}`, and the column default is `'{}'` (migration 20260908145237). The hash stays the same and only the DOM write happens.
2. **This rewrite IS the expensive task.**
   - ok runs: brand swap, then an immediate ULT+Layout task. m4-ok-1 3174 → task 3097-3389 (ULT 115 + Layout 143). m4b-ok-2 3821 → 3869 (264 ms). d4-ok-1 (desktop@4x) 4809 → 4812 (370 ms; ULT 175 + Layout 168). m4b-ok-1 4320 → 4327 (558 ms, with a forced layout inside rAF).
   - m4-dead-1 (backend dead): the brand swap comes late, at 9934 → 9938 (392 ms; ULT 194 + Layout 162), with no other mutation in that window. The header `data-settled` commit at 2788 (no brand swap) causes **no** long task.
   - So H2's TBT claim points at a real task, but the cause is "re-render + React 19 identity", not "font-scale data changed".
3. **Misattributions in the change text.**
   - (a) The "font scale swap at ~2.92 s" is two header `<style>` rewrites in the `--sticky-header-h` / `data-metrics` / `data-settled` commit (m4-ok-1 2923.8; m4-dead-1 2423 with a dead backend). They happen before the fetch completes (2948 ms). H2 does not touch them.
   - (b) ContentAreaStyle: the fixture post_layout refetch returns defaults, which deep-equal the seed. TanStack's structural sharing keeps the seed reference, so there is no re-render and no swap. In production it swaps only if the tenant row differs from the defaults, and nothing shows that it does. Even if it did, the selectors (`.post-content`, `[data-builder-renderer] > ...`) are class-scoped, so the cost is small.
4. **Gates.**
   - `check:ssr-budgets` passes today with cacheWrites = 11/11 (ran `bun run scripts/check-ssr-budgets.ts`). Regex `ssrBudgets.ts:418-419`.
   - Under H2: −1 `ensureQueryData(globalColors)`, −1 seed (the two seeds at `__root.tsx:676-685` merge into one row seed), +1 `ensureQueryData(postLayout)`, giving 10/11. Wave-1 arms go to 3 (≤ 6). Feasible.
   - The entry is unaffected: `lib/theme/fontScale` is already in boot through `DesignTokensStyle`.
5. **Collateral the change does not list (needed for editors to keep working).**
   - The three save hooks write the old per-key shapes and must patch the row instead: `designTokens.ts:154`, `useGlobalColors.ts:46`, `useFontScale.ts:46`. Otherwise admin/appearance panels that read via `select` show stale values after a save.
   - The `homeDeadline` cancel loop (`__root.tsx:642-652`) must use the row key.
   - `rootRoute.test.tsx:134-140` (mocks) and `:396-397`, `:419-421` (seed `dataUpdatedAt 0`) must be rewritten.
   - Re-adding the network warm of post_layout reverses the deliberate decision at `__root.tsx:573-577` (PR #314). It adds one SSR subrequest on **every** chrome route whenever the per-isolate 60 s edgeTtlCache misses.
6. SSR parity is fine: the hash comes from the same dehydrated row on both sides. i18n, SEO, CLS and a11y are unaffected. Production CLS is 0, so the production font scale is evidently empty, and the correctness gain from rendering tenant font sizes in SSR is hypothetical.

## L2 — effect arithmetic (Lantern)

- The task is mostly layout or style. Lantern simulates CPU nodes that perform layout with `layoutTaskMultiplier = cpu × 0.5` (`@paulirish/trace_engine/.../Simulator.js:101,239`): ×2 on mobile and ×0.5 on desktop, **not ×4/×1**.
- Observed (unthrottled) duration on the sandbox is about CDP-4x/4, so 66–98 ms.
  - Mobile, sandbox host: 132–196 ms simulated → **−82…−146 ms TBT** → about +2…+4 pts (analyst table: −100 ms = +2.5, −200 ms = +5.5).
  - Mobile, PSI-like host (1.5–3× the sandbox): −150…−300 ms → +4…+7 pts. This holds only if the task stays before TTI_sim (prod TTI 10.6 s; fetch observed at 3.9 s), which it does in production.
  - Desktop: sandbox 33–49 ms simulated → 0. PSI host (3× the sandbox): 100–145 ms → −50…−95 ms TBT → about +1…+3 pts. That matters for desktop 95 (TBT ≤ 110).
- The network part (−2 PostgREST, −2 preflights) is post-FCP and non-critical, so it is worth about 0 score.
- In the canonical fixture harness, the client backend is dead. The rewrite then fires late, on the failure path (9.9 s at CDP 4x), so an A/B there can show anything from ~0 to the full delta. Measure with a live client backend (trace.mjs `--backend=ok`) or on production.

## A cheaper change with the same TBT effect

Make the root `<style>` sinks skip identical-content commits:

- Move each sink into a `React.memo` leaf that takes the primitive `css` string and renders `dangerouslySetInnerHTML={{ __html: hardenStyleCss(css) }}` inline. Keeping the `{__html}` literal at the render site keeps `check:dangerous-html` green; a memoized object would trip the rule at `src/lib/ci/dangerousHtml.ts:1078`.
- Apply this to DesignTokensStyle, ThemeDesignStyle, ThemeOptionsStyle, ThemeFontSizesStyle, ContentAreaStyle, and the header style blocks.
- It removes the brand rewrite whatever re-renders the component (font scale, H1 stale refetch, root re-renders). It probably also removes the two header-sheet rewrites at hydration (if their text is unchanged). Effort XS–S. It changes no cache writes, admin hooks, loader or tests.

Keep H2 only as an optional follow-up: the font-scale-as-`select`-projection part, for tenants who set custom font sizes. Drop the post_layout warm.

## Corrected estimate

H2 as specified: mobile TBT −80…−150 ms on the sandbox host, −150…−300 ms on a PSI-like host (+2…+7 pts). Desktop 0 on the sandbox, −50…−95 ms on the PSI host. The "-2 style swaps" become "-1 identical-text rewrite of the 26.6 KB brand sheet". The ContentAreaStyle and post_layout parts give about 0. The memo-leaf alternative gives at least the same TBT for XS effort.
