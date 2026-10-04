# Verdict: html-weight HW-2 (typography generator -> static template + CSS custom properties)

Reviewer: adversarial (Opus). Repo read-only. What-if artifacts: `verdicts/html-weight-HW-2/` (transform `hw2-template.mjs`, runs `lh/`, `lh2/`, logs `run.log`, `run2.log`).

## Lens 1: feasibility and correctness. Verdict: WEAKENED

The core mechanism works. Custom properties inherit. The `data-wt~=token` gate stops an unset `var()` from turning into `unset` under `!important`. The `[data-wt~=t][data-w-id][data-w-id]` selector keeps today's (0,3,0) prefix. For nesting: today `<style>` comes before each widget's `<div>` (`ChromeWidgetView.tsx:391-392`), so an inner widget's rules come later in source order and win. Nearest-ancestor var resolution picks the same winner, provided var names are per template token. My transform reproduces the final DOM: 32 blocks become 16 templates, 31 elements get `data-wt`, 2 colour-only blocks remain.

What the code contradicts or what the change leaves out:

1. **Device selection by "static @media" is wrong for this codebase.** The device comes from the renderer container width through ResizeObserver (`BuilderRenderer.tsx:250-279`, `deviceForWidth` at :208), or from an explicit prop. Examples: `MobileDrawerBody.tsx:33` (`device="mobile"`), `PatternPicker.tsx:199` (`"desktop"`), `EventPreviewCanvas.tsx:629` and `WordPressPreviewDialog.tsx:171` (`device={device}`). SSR is desktop-first on purpose (`BuilderRenderer.tsx:236-242`). Viewport @media would give different results in:
   - popups (`PopupHost.tsx:240`) and narrow content columns (`ContentRenderer.tsx:78`)
   - the 768-1023 px mobile drawer
   - admin previews
   - pre-hydration mobile first paint (it would change)

   The parity-safe design keys the vars off `[data-builder-renderer][data-device=…]`, which already exists (`BuilderRenderer.tsx:293`, 37 rules in styles.css). It switches `--wt-x: var(--wt-x-m)` and so on. Residual problem: nested renderers with different devices. A descendant combinator cannot express "nearest renderer".

2. **Var names must be per template, not per property.** Today, A's generic rule (0,8,1) beats B's title fallback (0,6,1) for `h1-h6` inside a nested widget B (`typographyCss.ts:114,155`). Any var shared between the generic and title templates would let B's value leak through inheritance.
3. **Invalid authored values behave differently.** Today an invalid declaration is dropped at parse time, so the lower-priority theme rule applies. Through `var()` it becomes invalid at computed-value time, which means `unset`, which means inherit for font properties. `cleanCssValue` only strips `{};<>` (`typographyCss.ts:44-53`), so values like a unitless "16" change behaviour. The change needs a whitelist like the slider's `cssLen` (`sliderVariants.tsx:860-868`).
4. **Cascade placement.** Today these rules are unlayered and come after the stylesheet. The template must stay unlayered and sit at the end of the public CSS. Inside a Tailwind v4 `@layer`, layered `!important` beats unlayered `!important`, which would flip the cascade against inline styles and the other `!important` rules.
5. **Scope is mis-sized.**
   - `joinUsSizeCss.ts` uses 8-attribute specificity (`:50,68`), not 3.
   - Slider `instanceCss` uses `.eh-slider.X.X.X` plus viewport @media (`sliderVariants.tsx:870-890`).
   - Together these are about one block in prod (≈0 bytes), so drop them.
   - Files that are missing from the list and assert exact CSS strings or generator selectors:
     - `widget-view/__tests__/typographyMapping.test.tsx:114,127,153,172-173,186,232-247`
     - `molecules/__tests__/AuthorByline.cascade.test.tsx` (`Element.matches` on generator output)
     - `chromeWidgetViewParity.test.tsx`
     - `widgetFrameOwnership.test.tsx`
     - `typographyMinFontSize.test.ts`
     - `liveTypography.test.ts`
     - `sliderTypographyFidelity.test.tsx`
   - Live typography crosses tabs through BroadcastChannel and a `<head>` `<style>` (`liveTypography.ts:39-56`). It needs a var-based per-id head rule.
6. **The verification claim "zero `<style>[data-w-id=` blocks" is false.** `widgetCss` coalesces hover, override colour and scoped CSS (`ChromeWidgetView.tsx:247-283,308`). Prod keeps 2 colour or background blocks.
7. **The H6 claim is weak.** In prod state, only 2 of 102 responsive font sizes differ by device. Typography CSS text barely changes on the device switch. The 797-element recalc is still triggered by the `data-device` flip and the 25 `grid-column` inline-style mutations.
8. **Conflict with hydration H10(b)** (server-only generation plus read-back of the same CSS, same file): pick one owner.

Gates:

- noHasSelectors: OK, the template uses `:is`/`:not` only.
- check:bundle: `publicCss` is 83 KB and currently ≈77.7 KiB gz, and the template adds ≈0.85-1.2 KB gz. It fits.
- check:chunks and check:entry-purity: unaffected.
- check:dangerous-html: count unchanged, because `wrap` still injects the coalesced block.
- document-weight `inlineStyleCount`: drops by about 30.

## Lens 2: effect on the Lighthouse score. Verdict: REFUTED (as a score lever)

- **Bytes.** On prod HTML (gzip-9), removing the rules and adding `data-wt` plus vars:
  - template moved to CSS: document −58 KB raw, −5.1 KB gz
  - template left in the HTML: −4.1 KB gz
  - fixture brotli-5 with the template in the HTML: net −1.05 KB (44.6 → 43.6 KB). Brotli already removes most of the repetition, so SC-7 (serve br) captures most of this transfer win for free.
  - The document is not the long pole (HWF-5: FCP and LCP flat for −25-32 KB gz). The template adds about +0.85 KB gz to the render-blocking CSS, which is the long pole: about +4-5 ms FCP/LCP on mobile at 5-6 ms/KB.
- **Attribution.** "TBT 158 → 25" is P0 → P3, which also includes HW-3 (state), HW-4, HW-5 and HW-6. HW-2 alone was never isolated. The isolations that do exist show nothing:
  - fixture no-JS C_notypo vs B_nostate: TBT 74/157 → 131/168, Style 367/278 → 465/319
  - P1 → P2 (HW-1 + HW-2): TBT 23-116 → 0-133
- **With-JS what-if** (this review). Fixture, h2, interleaved; the faithful template transform was applied in the proxy; B's document is 344 KB vs 391 KB.

  | Batch | Runs | FCP     | LCP     | TBT    | Score |
  | ----- | ---- | ------- | ------- | ------ | ----- |
  | 1     | 3+3  | +0.00 s | +0.15 s | −76 ms | −3    |
  | 2     | 4+4  | 0.00 s  | −0.06 s | +41 ms | 0     |
  - Pooled TBT medians: A ≈ 267 ms (n=6), B ≈ 333 ms (n=7).
  - Style & Layout medians: A ≈ 890, B ≈ 725 ms, but the ranges overlap (A 599-1787, B 659-1206).
  - Desktop: Δ 0 (TBT 0, perf 99).
  - So the effect is inside the A/A noise (TBT ±464 ms).

- **Mechanism.** Parse and style tasks sit before FCP today (sim FCP 4.06 s fixture, 3.1 s PSI), so TBT does not count them. Post-hydration whole-document recalcs (3 × 31-37 ms observed, 110 ms latent, LA §4b) are the only in-window channel. Fewer universal-bucket `:is()` selectors (about 450 → about 50) can trim each recalc by about 10-20 %. That is about −10…−25 ms TBT on mobile at ×4, and less on desktop.

**Corrected estimate.**

- Mobile:
  - today: 0 points (±1)
  - after boot-js moves FCP before these tasks: TBT −10…−40 ms, i.e. +0…+1 point (LA table: −100 ms ≈ +2.5)
- Desktop: ≈ 0 (PSI desktop TBT 740 is hydration and gtag).
- HTML: −4…−5 KB gz prod with gzip, ≈ −1 KB with brotli.
- Render-blocking CSS: +0.85 KB gz.
- **Worth doing as hygiene (document weight, style-node count), not as a PSI lever.**
- Cheaper alternatives:
  - SC-7 brotli, for the bytes.
  - Restrict HW-2 to `ChromeWidgetView` with `data-device`-keyed vars, and drop the joinUs and slider parts.
