# Verdict css/C6 "Content-route CSS (hand + utilities) out of the core"

Feasibility: REFUTED as specified. Effect: REFUTED (attribution error, effect is roughly 1/4 to 1/15 of the claim).

## Lens 1: feasibility and correctness

1. The four hand sections are not "content route" CSS. Three of them render inside builder widgets, on any builder surface:
   - Footnotes (`sup.fn-ref`, styles.css:8337-8666): `RichHtmlContent.tsx:17-21,71` (expandFootnotes + FootnoteTooltips) is used by `RichHtmlView`. That widget is in the `/` chunk set (`RichHtmlView-*.js` in home-chunks.json) and in `ChromeWidgetView.tsx:808-810`, so it also renders in header/footer chrome on every route. `BlocksRenderer.tsx:14-24,142` renders footnotes too.
   - Code blocks (styles.css:3276-3406): `CodeBlockView` comes through `BlocksRenderer`. The builder `RichTextView.tsx:8,34` renders `BlocksRenderer`.
   - Digital features (styles.css:4231-4341, `.neh-armed .nes-feature-reveal`): the builder `FeatureWidgets.tsx:24-29` imports `components/features/*`.
   - Only key takeaways (`$.tsx` only) and `.glossary-term` are truly post-only.
2. "Content route components" are not a separable surface. Posts render through the universal resolver `src/routes/$.tsx:1-5` (the same route serves every CMS builder page). `post.$slug.tsx:33-47` has no component, it is just a 301. Builder content also renders in `index.tsx`, `support.tsx`, `checkout.success.tsx`, `preview.$token.tsx`, events (the manifest carries RichTextView CSS for `/events/$slug/*`) and SiteChrome. You cannot import content.css by route without either putting it back on `/` (no gain) or dropping footnote/code/feature styling on `/` and the other builder routes. Importing it from the widget modules instead makes it lazy-chunk CSS on the client (Vite preload helper). css.md §2 item 2 itself says that is wrong for SSR-rendered React.lazy widgets (FOUC). With a Float `<link precedence>` it becomes render-blocking or reveal-blocking again wherever the widget is on the page.
3. The utility half is mis-specified. In tiers2.mjs the hand content CSS is removed in **stage 1** (`r.area==="posts-content"` is excluded in stage1) and the content-only utilities are removed in **stage 2**. What stage 3 ("C6") actually removes is utilities with `homeReach===false` in areas `ui-shadcn` (22.5 KB), `builder-widgets` (17.1 KB), `other` (38.3 KB) and `public-chrome` (1.3 KB). That is 902 rules / 79 KB raw of shared-component utilities.
   - `homeReach` = "candidate appears only in modules of the 79 chunks loaded during ONE fixture LH run" (analyze.mjs:31-35,105). It is a runtime, data-dependent property, not a file-glob property. So `surfaceCssPlugin(content)`, which is glob-based like `adminCssPlugin.ts:5,26-33`, cannot express it.
   - Moving those candidates to a content-only sheet would leave unstyled any interaction-gated UI on `/` (dialogs, sheets, popovers, login, search results; shadcn components not loaded in that run). It would also break builder widgets that are absent from the fixture home but present on production home or on `/$` builder pages (the fixture has fewer rows/widgets than prod, EVIDENCE 0-cloud).
4. Gates and tests:
   - `cssSurfaces` test and the render-blocking line do not exist yet (C11).
   - `publicCss` (check-bundle-size.ts:2016-2022, summed at :2456-2461) rises with a split.
   - `chartClasses.test.ts:34` reads only `src/styles.css` + `charts.css`. Moving digital-feature/neh rules out needs that list updated.
   - noHasSelectors is not affected.
   - CLS: footnote `sup` font-size 0.5em/line-height 1 arriving late shifts lines on builder pages that have footnotes.

## Lens 2: effect

Simulated with `sizes.mjs` (same rows.json and stage predicates as tiers2.mjs; my stage numbers are within 3 % of the report's):

| step                                                                                   |      raw |   gzip-6 |    br-11 |
| -------------------------------------------------------------------------------------- | -------: | -------: | -------: |
| today minus content hand (the 4 sections + audio)                                      | -12.2 KB | -1.96 KB | -1.78 KB |
| today minus key takeaways + glossary only (truly post-only)                            |  -5.0 KB | -0.82 KB | -0.80 KB |
| today minus content hand + content-only utils                                          | -28.6 KB |  -3.6 KB |  -2.9 KB |
| stacked: stage2 without C6 → stage2 (honest C6 increment after C1-C5)                  | -28.6 KB |  -3.8 KB |  -2.9 KB |
| stage2 → stage3 (what the "Stage 3 core" figure credits to C6; not content CSS, see 3) |   -85 KB | -10.5 KB |  -7.4 KB |

- The expected effect quotes the `core` A/B (297 774 B raw, 44.2 KB br vs 70 KB) of -0.15 s FCP / -0.17 s LCP. That is the whole surface split (C1-C5 + C6) measured against today, not C6's increment. It was also measured with the retired h1 harness.
- On the canonical model (lighthouse-analyst §4a), CSS -70 % = 49 KB gives FCP 0 (JS-bound) and LCP -225 ms, i.e. ≈4.6 ms/KB.
- Honest C6 (2.9 KB br, of which only ≈0.8-2 KB is legitimately content-only): LCP ≈ -13 ms, FCP 0 to -15 ms. Using score.py at the 85 operating point: 2800→2785 ms on FCP and LCP gives 85.35→85.55, so **≈ +0.1 to +0.2 mobile points, 0 desktop**. That is below A/A noise (±0.01 s), so `measure-ab` cannot verify it.
- Even crediting the full stage-3 delta (10.3 KB br): ≈ -45 ms LCP, ≈ +0.5 point.
- No what-if run: lighthouse-local.mjs only transforms HTML, swapping the sheet needs a patched artifact copy, and the delta is below the harness noise floor. The structural numbers above decide.

## Cheaper alternative

Drop C6 as specified. If anything, move only the post-only hand CSS (key takeaways + glossary-term, 5 KB raw / 0.8 KB br) into a CSS file imported by `$.tsx` (manifest route CSS, SSR-linked, no FOUC). Keep footnotes, code blocks and digital features in core (they are builder-widget CSS). Do not ship `surfaceCssPlugin(content)` for stage-3 utilities. The same or larger byte win at zero risk comes from C5 (color-mix fallback strip, -5 KB gzip) and from the boot-js workstream (hundreds of KB in the same pre-LCP set).
