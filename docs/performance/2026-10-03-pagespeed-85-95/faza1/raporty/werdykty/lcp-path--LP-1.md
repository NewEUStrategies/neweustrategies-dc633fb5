# Verdict LP-1: single LCP candidate per document (adversarial review, Opus)

Feasibility: **WEAKENED**. Effect: **WEAKENED** (0 today on both form factors, including desktop; the insurance claim holds only as an upper bound).

## Lens 1: feasibility and correctness

What holds:

- The current priority sources are as described. `BuilderRenderer.tsx:381` sets `aboveFold={index < aboveFoldCount}`, with a default of 3 (`:233`). Priority is consumed only at `PostListView.tsx:298/545/580/700`, `WidgetView.tsx:492` (dark-featured-card), `mediaWidgets.tsx:211/225` and `ChromeWidgetView.tsx:193/461`. Sliders use an unconditional `priority={i===0}` (`sliderVariants.tsx:1203/1423/1567/1711/1847`), and `PostsSliderWidget.tsx:161` passes no position.
- The production HTML confirms it: 7 eager `<img>` plus the logo, all with the same `2efcf6…webp` (offsets 161411…359521).
- React behaviour is as claimed. A lazy img gets no auto-preload; `OptimizedImage.tsx:121/125/130` gives priority=false the values lazy, `fetchpriority=auto` and `sizes="auto, …"`.
- SSR/hydration parity holds if the candidate is computed from the loader doc. The client hydrates from the dehydrated doc, which on SSR is guest-stripped (`queries/public.ts:124-127`), so both sides see the same doc. The id is stable across the post-hydration device flip.
- Chunk graph and gates: `BuilderRenderer`, `heroImage.ts`, `postListQuery`, `sliderFallbackQuery`, `prefetch`, `imageSlot` and `supabase/client` are **all already in the entry chunk** (`reports/chunk-inventory.json`, `assets/index-DPN2YAij.js`). Importing `lcpCandidate` from `heroImage.ts` into `BuilderRenderer` therefore adds no module edge, and check:chunks and check:entry-purity are not at risk today. The document-weight ratchet only goes down, and LP-1 lowers `imgFetchpriorityHigh`.

What breaks or is under-specified (the blocking issues):

1. **There is more than one BuilderRenderer per page.** Footer (`Footer.tsx:120`, default window 3), Header chrome (`Header.tsx:271`), `MobileDrawerBody.tsx:33`, `PopupHost.tsx:240`, ContentRenderer, HomeBuilderContent and TaxonomyPage each have one. A doc-level `lcpCandidate` inside BuilderRenderer would mark one candidate per instance, so `data-lcp-candidate` and `fetchpriority=high` would not be single per _page_. LP-3 would then pick the header or drawer one first in DOM order. An opt-in owner prop is needed, and it must be set only on the primary content renderer.
2. **The "largest desktop slot share" rule ignores the mobile column order** (`types.ts:512-513` `order: ResponsiveValue<number>`; `imageSlot.ts:18-31` computes desktop and tablet only).
   - On `/` it works only because the hero column also has `order:{mobile:1}` (`homepageTemplate.ts:95,118`).
   - For a generic section where the desktop-largest widget is not the first on mobile, the mobile LCP image (today eager+high, since sections 0-2 are prioritised) becomes lazy. That is a mobile LCP regression and triggers the "LCP lazy-loaded" insight.
   - The candidate must take `order.mobile` into account. Allowing at most 2 candidates (desktop-largest and mobile-first) is also acceptable.
3. **"Section 0 only + skip abTest" can return null**, and then a page has no eager image at all.
   - Today, a hero in section 1 (under a thin title, breadcrumb or announcement section) is eager+high. A section-0 A/B pair also still gets eager variant A, because SSR deterministically shows A (`experiments.ts:94-101`).
   - `lcpCandidate` should scan the visible, variant-A sections within `ABOVE_FOLD_SECTION_COUNT` and take the first section that holds an image-bearing widget. It should also use the same filters as `SectionsList` (`BuilderRenderer.tsx:363-368`).
4. **LP-1 must ship together with the builderHeroPreload change.** `builderHeroPreload` (`heroImage.ts:250-275`) still returns the DOM-first widget, the 25vw left card, and feeds the head `imagePreloadLink` and the Link header (`routes/index.tsx:236/255/311`, `routes/$.tsx:669/673/814`).
   - With LP-1 alone, that card becomes lazy, yet it is still preloaded at fetchpriority=high.
   - The stated verification `count(link[rel=preload][as=image][fetchpriority=high])==1` then fails: it counts 2 (React's candidate preload plus the app's 25vw preload). "5→1" is not reached.
   - Either LP-1 and LP-2 land together, or `builderHeroPreload` must iterate only `lcpCandidate`.
5. **Tests that encode the old contract are missing from the gate list:**
   - `builderRenderer.streaming.test.tsx:137-166` expects `["eager","eager","eager","lazy","lazy"]`;
   - `mediaWidgetsBranches.test.tsx:163-174` expects aboveFold → eager/high;
   - `homeRoute.test.tsx:608`.
     They must be rewritten deliberately, not "kept green".
6. Placement (non-blocking): `sectionWidgetsInPaintOrder` and `visibleChildren` are private to `heroImage.ts`, which imports query modules (`:36-47`). Move the pure part into its own module (imageSlot + types only), so that `BuilderRenderer` does not pin `heroImage`'s query imports into the entry chunk while boot-js is trying to shrink it.
7. Minor: `SliderRender` is also used in the admin `SliderEditor.tsx:244/620`. With no provider, slides become lazy there, which is harmless. The `isLcp` prop has to be threaded through `lazySliderRender`, `SimpleWidgets` and `PostsSliderWidget`.

## Lens 2: effect realism

Lantern facts (trace_engine lantern `LargestContentfulPaint.js:19-55`, `FirstContentfulPaint.js:93-118`):

- Both LCP graphs drop every network node with `endTime > observed LCP` (except the document).
- The estimate is the maximum end time over non-Low-image nodes.

Desktop (`prod-desktop.json`):

- Observed LCP is 3722 ms.
- The 640w High image (3570→5705) ended **after** observed LCP, and so did the 480w High image (3405→3769).
- Both are already cut out of the optimistic and pessimistic graphs, so removing them changes Lantern LCP by **0 ms**, not "≤ −0.03 s". Desktop LCP is 1043 ms, score 0.938, and that does not move.

Mobile (`prod-mobile.json`):

- There is one High cover (768w, 37.9 KB, 2861→3228) against observed LCP 3303.
- The other covers are Low lazy requests that start at ≥ 3589, so today's effect is **0**. Confirmed.

Insurance claim (distinct lead covers):

- Each extra eager+high lead is preload-discovered with the hero. On a fast observed network it ends near the hero, i.e. before observed LCP, so it is kept in both graphs and adds its bytes at 1.6 Mb/s ≈ 195 KB/s (5-6 ms/KB).
- Per distinct lead: 25-38 KB → **+0.15-0.23 s**.
- All 6 distinct: +0.9-1.4 s. This is the upper bound, and it needs every widget to lead with a different post. Today they all show "newest" with the same lead.
- In score points (mobile LCP curve p10 2.5 s / median 4.0 s, weight 25):
  - today 5.4 s → 6.3-6.8 s = **−2.4…−3.3 pts**;
  - after C3, fixture 1.67 s → 2.6-3.1 s = −2.6…−5.7 pts;
  - after C3 at PSI ~2.5 s → 3.4-3.9 s = −5.7…−9.3 pts.
    So the insurance matters more after C3.

Cheaper alternative with most of the insurance:

- Keep the prefetch window at 3, but use `priority = aboveFold && sectionIndex === 0`, and gate the slider priority on aboveFold (effort S).
- This removes the 4 leads in sections 1-2 (≈ 4/6 of the bytes, i.e. 0.6-0.9 s of the 0.9-1.4 s upper bound).
- It does not produce a single `data-lcp-candidate`. LP-1's unique value is the LP-3 marker and the single-source preload (with LP-2), not score points today.

## Corrected estimate

- **Today:** mobile 0 ms / 0 pts; desktop 0 ms / 0 pts. The −25 KB High desktop request is outside the Lantern LCP graph.
- **Head:** React image preloads 5 → 1 (plus the logo) only with LP-2. LP-1 alone leaves 2 High image preloads plus a Link header pointing at a now-lazy card.
- **Insurance:**
  - each distinct-cover lead ≈ +0.15-0.23 s mobile LCP; 6 leads ≈ +0.9-1.4 s;
  - in points: −2.4…−3.3 today, −2.6…−9.3 after C3.
- **Precondition for LP-3:** valid only once there is a page-level owner (one renderer).
