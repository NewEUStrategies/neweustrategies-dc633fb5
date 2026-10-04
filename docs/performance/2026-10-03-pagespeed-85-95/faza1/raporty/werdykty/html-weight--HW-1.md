# Verdict: html-weight / HW-1 (static CSS out of JS literals and inline <style> into the core CSS)

Reviewer: Opus, adversarial. Code was read-only. Work files are in `verdicts/html-weight-HW-1/`: ticker.css, slider.css, bridge.css, search.css, moved.min.css, minify.mjs, twtest/.

## Lens 1: feasibility and correctness. Verdict: WEAKENED (the mechanism works, but a frozen gate fails as specified)

What holds:

- **Placement works.** Tailwind v4.3.3 inlines an `@import` written after other rules in place, so source order is kept. I tested this with `@tailwindcss/node compile`: `.first`, then the imported rule, then `.after` (twtest/).
- **Precedence order is as claimed.** In the production HTML, `styles-*.css` (`data-precedence="default"`, byte 7316) comes before `nes-slider-shared-v1` (7401) and `nes-search-widget` (18423). Appending in that order keeps the order between these sheets.
- **Admin and editors keep the rules.** `styles.css` is linked on every route, admin included (`src/lib/seo/rootHead.ts:58`). The admin live previews and the admin sidebar would still get the bridge and sidebar rules. Those previews are `GlobalColorsEditor.tsx:361` and `ThemeBackgroundsPane.tsx:203`, which call `globalColorsToCss`.
- **Hydration parity is safe.** `designTokensStyleCss` (`src/components/theme/css/designTokensCss.ts:25-29`) is the only shared generator, so server and client output change together.
- **No `:has()`.** None of the moved blocks contains `:has()`, so the noHasSelectors gate stays green.

What breaks or is wrong:

1. **check:bundle fails. This is the blocker.**
   - `publicCss: 83` (`scripts/check-bundle-size.ts:2022`; the check is at `:2580`) is a frozen budget: per `:1150-1158`, CI ignores env overrides.
   - Today the non-admin CSS is 80.3 KiB (gzip-6, real artifact). Adding the minified blocks makes `styles.css` 79 705 → 85 478 B, so publicCss is about **86.0 KiB, over budget by about 3 KiB**.
   - The `css: 96` total (`:1980`) goes from 95.2 to about 100.8 KiB. **That fails too.**
   - The change lists check:bundle as a gate but plans neither a budget raise nor an offset. It has to land after the css workstream's surface split (C1, charts out of the core) or come with a reviewed budget increase.
2. **The cascade claim is only partly true.**
   - "Today they sit inline in body" holds only for the ticker and the bridge. Both now come after `admin-styles.css` and after every head sheet. After the move they come before them.
   - Concrete flip: the bridge rule `[data-sidebar="sidebar"] a:hover:not([data-active="true"]):not([data-sidebar-brand]){background:… !important}` (`src/lib/builder/globalColors.ts:917`, specificity 0,4,1) against `aside[data-sidebar="sidebar"][data-sidebar-style="style-2"] [data-sidebar="menu-button"]:hover{background:transparent !important}` (`src/admin-styles.css:657`, also 0,4,1, also !important). Today the bridge wins because it comes later. After the move, `admin-styles.css` (linked by `src/routes/admin.tsx:68`, after the root sheet) wins.
   - Result: the admin sidebar hover changes for editors on sidebar style-2 when the menu button is an `<a>`.
   - Fix: move the 13 `[data-sidebar]` rules into `admin-styles.css` at the end, or keep them in the generated block. That also takes them out of public bytes.
3. **The `.sbw` hover sheet is not static.**
   - `socialHover.ts:482` derives `uid = sbw-<hash(body)>` from the per-widget config. Dedupe via `WidgetStyleSheet` (precedence `nes-widgets`) hoists it into `<head>`, before the body instance typography blocks, so its cascade position changes.
   - Saving: 2 KB raw / about 0.4 KB gz.
4. **Tests need rewriting. This is not "low risk / S" work.**
   - `src/lib/builder/__tests__/globalColors.test.ts:186-191` expects `:where(` and `@layer utilities` in `globalColorsToCss({})`.
   - `sliderVariantCatalogs.test.tsx:555` and `sliderTypographyFidelity.test.tsx:43` assert exactly one `style[data-href="nes-slider-shared-v1"]`.
   - The slider catalog tests check the responsive `@media` rules as text inside `<style>` (`:28-41`), because happy-dom computes no cascade. That proof moves to the CSS file.
5. **Minor points.**
   - The HTML numbers are larger than claimed: −50.7 KB raw / −10.5 KB gz on `psi/home.html` (the claim was −44 / −8.5).
   - Moving the ticker literal out of TSX also removes accidental Tailwind candidates from that file. This is harmless, but the parity probe should cover it.

## Lens 2: effect on the Lighthouse score. Verdict: REFUTED (the claimed −30…40 ms FCP/LCP is gross, not net)

Measured on the real artifact (gzip-9, chunk with and without the literal):

- Entry `index-DPN2YAij.js`: −3 808 B gz.
- `sliderVariants-Cl4hnw1I.js`: −2 922 B gz.
- JS total: **−6.73 KB gz**. Both chunks are High and finished before the observed FCP in prod-mobile (entry ends at 3 182 ms, slider at 3 102, observed FCP 3 252), so they are on the critical path.
- The same CSS, minified with lightningcss and appended to `styles.css`, adds **+5.69 KB gz** (+4.5 KB br) to the VeryHigh render-blocking sheet: ticker 2.26 + slider 1.78 + bridge 2.33 + search 0.64 KB gz, or 6.35 KB gz on its own.
- Lantern drains both kinds of bytes through the same h2 connection at the same slope, so **the net pre-FCP change is −1.0 KB gz → about −5 ms FCP / −6 ms LCP mobile** (5.1–6 ms/KB). Desktop is about 0 (0.8 ms/KB).

HTML −10.5 KB gz:

- The workstream's own A/B (HWF-5: document −32 KB gz, no JS) shows no FCP/LCP change, because the document finishes in parallel with the 79 KB CSS. So this saving gives **0 ms**.
- The same experiment shows the CSS is the long pole once JS leaves the FCP set (the boot-js regime). In that regime, adding +5.7 KB gz to the blocking sheet **costs about +25…30 ms FCP/LCP mobile**.

TBT:

- The number of rules in the document is unchanged, so style-recalc cost is unchanged.
- The CSS parse work moves from inline `<style>` parsing to the stylesheet parse. That parse happens before FCP, which is outside the TBT window.
- Not parsing the 25 KB string literal in JS saves almost nothing.
- Plausible effect: 0…−15 ms. TBT is threshold-convex, so tasks under 50 ms count 0.
- The −100…150 ms TBT cited in the claim comes from P0→P3, which combines HW-3 state trim, HW-2 typography and markup changes. In P1→P2 (HW-2 + HW-1), TBT is indistinguishable: median 86 → 0–133, N=2. None of it can be attributed to HW-1. HW-2, which removes 148 descendant `:is()` `!important` rules, is the plausible cause of the Style & Layout drop.

What-if:

- Not run on purpose. The harness transforms only HTML, so it cannot model the CSS added to `styles.css` or the JS removed from the chunks.
- At A/A noise of up to ±464 ms TBT and ±13 points, two runs cannot resolve an effect of about ±10 ms. The structural arithmetic above is the stronger evidence.

Corrected estimate:

- **Mobile:** FCP/LCP −5 ms today, about +25 ms after boot-js; TBT 0…−15 ms. Net score change about **0 points (±0.5)**.
- **Desktop:** 0.
- **Benefits that remain, none on a cold run:** document weight (gate inlineStyleBytes −50 KB), cacheable CSS for repeat views and SPA navigation, and a smaller entry chunk.

Cheaper or better options:

- Land HW-1 only together with or after the css workstream's core split (C1 charts out, C11 gate contract), so render-blocking CSS shrinks overall and publicCss passes.
- Move the 13 sidebar rules (admin only) into `admin-styles.css`.
- Drop the `.sbw` dedupe.
- Book HW-1 as hygiene and document weight, not as score points.
