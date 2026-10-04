# lcp-path — LCP/FCP critical rendering path and resource priorities (phase 1, 2026-10-03)

Workstream key `lcp-path`. Scratch: `$SCRATCH/phase1/lcp-path/` (`whatif.py` Lantern what-if engine on the lighthouse-analyst fixture artifacts `lha1-*`, h2 same-origin parity; `batch*.sh/.out`; `geom.mjs` + `prod-static.mjs` = production HTML served WITHOUT JS; `live-lcp.mts` = fixture artifact WITH JS at 4x/1x CPU; `si/` speedline + thumbnail histograms; `bw/` billed bytes; `film/` filmstrip frames).
`$SCRATCH` = `/tmp/claude-0/-home-user-neweustrategies-dc633fb5/8fd9e8e2-d544-5db4-ae5e-c509c5e3ff6c/scratchpad`.

## 0. Verdict in five lines

1. **The hero is NOT gated by JS.** The production LCP node snippet (`fetchpriority="low"`, `style="opacity: 0;"`) is a post-autoplay DOM snapshot of slide 0, not its state at paint. In SSR the active slide is `loading=eager fetchpriority=high opacity:1` with `src`, and paints with no JS at all (production HTML, JS 404'd: LCP = hero at 224 ms mobile / 264 ms desktop). Observed FCP→LCP gap: 51 ms (prod mobile), 0 ms (fixture). The whole simulated FCP→LCP gap is Lantern billing pre-LCP bytes.
2. **The pre-LCP set is 826 KB on prod mobile; 70 % is JS** (entry+react 323 KB, other 252 KB), then doc 89, CSS 79, fonts 45, hero 38. The what-ifs show that **only boot-after-LCP (boot-js C3 / LA-C4) gets mobile LCP under 2.5 s**: entry+react-only modulepreload still gives LCP 3.33 s, entry-only 3.03 s, boot set without widget/stray chunks 4.23 s (today 4.37 s), no JS before LCP 1.67 s.
3. **Priorities are structurally wrong, though content hides it today:** 7 `img[fetchpriority=high]` on `/` (one hero plus six post-list leads in sections 0–2, five of them below the fold). React 19 auto-preloads every eager `<img>` (`react-dom-server` pushImg) → 5 image preloads in `<head>` plus 1 Link header for the same cover, with 4 different `imagesizes`. `builderHeroPreload` picks the DOM-first widget (a left-column card, 25vw), not the hero. The cost is low today only because every widget leads with the same post cover (mobile: 1 request; desktop: 3 High variants, 480/768/640w).
4. **Speed Index:** Lantern SI = max(FCP, 1.4×observed SI + 0.4×layout-weighted CPU end time) on mobile. The consent banner is **27 % of the final mobile frame histogram** (prod thumbnails 72.1 % → 99.5 % when it appears) and paints ~1 s (M3) to ~1.5–2.5 s (PSI) after content. Desktop late paints: the builder logo (lazy, requested at 3665 ms, done at 6289 ms) and ticker text. A slider autoplay tick inside the trace is a PSI-only SI risk (hero = 20 % of the mobile viewport).
5. **Early Hints / speculation / AVIF have ~0 effect on Lighthouse.** Lantern hangs every request on the document node and does not simulate TTFB or 103. Speculation rules are `moderate`, with 0 prefetches in the prod trace. AVIF/quality are worth −0.15 s mobile LCP today and ~0 after C3.

## 1. Hero image: which element becomes LCP and why (mandate 1)

### 1.1 Code path

- `src/lib/builder/sliderVariants.tsx:318-395` `ResilientSliderImage`:
  - `requested` starts as `active || alwaysVisible` (:334).
  - `src` is only set when `shouldLoad` (:366), so slides 2..N carry no URL until they are first shown (verified: prod HTML slides 16–19 have no `src`, `loading=lazy`, `fetchpriority=low`, `opacity:0`).
  - `loading = priority ? eager : lazy` (:372).
  - `fetchPriority = priority && active ? high : active ? auto : low` (:378).
  - `opacity: visible ? 1 : 0` (:382), with a 700 ms opacity+scale transition (:383-384).
- `EditorialHeroVariant` passes `priority={i === 0}` and `active={i === p.safeIdx}` (:1196-1206); the other variants do the same at :1423, :1567, :1711 and :1847.
- `SliderRender` starts at `useState(0)` (:909), so SSR and the first client render agree (idx 0 active).
- Autoplay is `setInterval(intervalMs)` in an effect (:925-941). The default is 4500 ms (`src/lib/theme/carouselDefaults.ts:14`); the homepage template uses 5500 (`src/lib/builder/homepageTemplate.ts:106`).
- `PostsSliderWidget.tsx:161` renders `<SliderRender config lang>` and does NOT pass any above-fold information. Slider priority is therefore unconditional: any slider anywhere gets an eager+high first slide and a React head preload.

### 1.2 Evidence

| Probe                                                      | Hero (`img.eh-img`, slide 0) at paint                                                                                                 | LCP                                                                                                                                     |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Prod HTML, no JS (`geom-mobile.json`, `geom-desktop.json`) | `fp=high`, `loading=eager`, `opacity:1`, `src=…768w q80`; slides 1–4 `fp=low lazy`, no src                                            | IMG at 224 ms (mobile), 264 ms (desktop), = FCP                                                                                         |
| Prod LH M3 (`prod-mobile.json`)                            | snippet at END of trace: `loading="eager" fetchpriority="low" style="opacity: 0;"`, `sizes` without `auto,` (so `priority=true`, i=0) | obs FCP 3252 / obs LCP 3303; `lcp-discovery-insight.priorityHinted=true`; breakdown TTFB 2821, load delay 39, load 368, render delay 74 |
| Fixture with JS (`live.json`, `lha1-*` traces)             | one `largestContentfulPaint::Candidate` (nodeId 19 mobile / 20 desktop), size 68 121 / 219 804                                        | mobile obs FCP = LCP = 375 ms; desktop 336 = 336                                                                                        |

So the snippet is slide 0 after `safeIdx` moved to 1. The `priority&&active` term then flips it to `low`, and `visible` flips it to opacity 0. A same-size slide fading in does not emit a new LCP entry. **No change is needed for "the active first slide in the first HTML with high/eager/opacity 1"; it is already true.** What remains structurally wrong:

- (a) slider priority ignores position (LP-1);
- (b) autoplay ticks inside the Lighthouse window (LP-5);
- (c) the C3 bootstrap's hero signal must not be `img[fetchpriority=high]` while 7 such images exist (LP-3).

CLS and crossfade: SSR markup equals the first client render, so CLS stays 0 (prod CLS 0). The crossfade after hydration only needs `requested`/`active`, which LP-1 and LP-5 do not touch.

## 2. Preload correctness (mandate 2)

### 2.1 What production ships (`$SCRATCH/psi/home.html`, head = 37 537 B)

| Offset      | Hint                                           | imagesizes                                                 | Source                                                                                                     |
| ----------- | ---------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 185         | `preload as=image href=logo.svg` (no fp → Low) | –                                                          | React auto-preload of the eager `<img>` in `src/components/Header.tsx:237-243`                             |
| 374         | `preload as=image imagesrcset fp=high`         | `(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw` | React auto-preload: left-column post-list lead (`POST_LIST_GRID_COVER_SIZES`, `widgetImageSizes.ts:39-40`) |
| 2095        | same                                           | `(max-width: 767px) 100vw, (max-width: 1023px) 50vw, 50vw` | React auto-preload: **hero** slide 0                                                                       |
| 3816        | same                                           | `… 33.33vw, 33.33vw`                                       | React auto-preload: section-2 grid lead (below the fold)                                                   |
| 5543        | same                                           | `… 37.5vw, 25vw`                                           | React auto-preload: section-1 lead (below the fold)                                                        |
| 7316        | stylesheet                                     |                                                            |                                                                                                            |
| 26288       | `preload as=image href imagesrcset fp=high`    | 25vw grid sizes                                            | `imagePreloadLink` (`src/lib/seo/meta.ts:353-365`) from `routes/index.tsx:307-312` ← `builderHeroPreload`  |
| Link header | same 25vw descriptor                           |                                                            | `imagePreloadLinkHeaderValue` (`meta.ts:377-390`) ← `routes/index.tsx:255`                                 |

- **React 19.2 mechanism** (`node_modules/react-dom/cjs/react-dom-server.edge.production.js:2150-2240`): every `<img>` that is not `loading=lazy` and not `fetchPriority=low`, and has src/srcSet, gets a `<link rel=preload as=image>` keyed by `srcSet+"\n"+sizes`. The first 10 (or any with fp=high) go to `highImagePreloads`, which are flushed in `<head>` before stylesheets. The "4 identical preloads" are therefore NOT generated by app code; they are a by-product of eager images.
- **Wrong candidate in `builderHeroPreload`** (`src/lib/builder/heroImage.ts:250-275`, `sectionWidgetsInPaintOrder` :221): it returns the first preloadable widget in DOM order. On `/` that is the left-column post-list (DOM offset 161 411, before the hero at 177 478). Visually the hero is first on mobile (top 139 vs card 726) and largest on desktop (633×356 vs 293×165).
- **7 `fetchpriority=high` images** come from `ABOVE_FOLD_SECTION_COUNT = 3` (`src/lib/builder/prefetch.ts:604`) feeding `AboveFoldProvider` (`BuilderRenderer.tsx:378-391`), plus `PostListView.tsx:298/545/580/700` `priority={aboveFold && i===0}` (one lead PER WIDGET), `WidgetView.tsx:492`, `mediaWidgets.tsx` `priority={aboveFold}`, and the unconditional slider `priority={i===0}`.
  - Prod positions: hero top 139; leads at 726/1071 (section 0, mobile); 3425, 4534, 5046, 5559 (sections 1–2, below the fold on both form factors).
- **Bytes it costs today:** mobile 0 extra requests (all 7 resolve to the same `…2efcf6…webp?width=768` URL because every widget leads with the same post). Desktop: 3 High variants of the same cover before/around LCP: 480w 15.8 KB (cards, legitimately visible), 768w 38.0 KB (hero = LCP), 640w 25.1 KB (37.5vw lead, below the fold, started 3569 ms, i.e. wasted). With different lead covers (normal editorial content) the same structure would put **up to 6 extra High images, ~25–38 KB each (≈150–230 KB) in the pre-LCP set → +0.9–1.4 s mobile LCP at 6 ms/KB**. That is a latent regression.
- **sizes mismatch:** preload `imagesizes` = 25vw vs hero `sizes` = 50vw → on desktop the explicit preload/Link header fetches 480w while the hero needs 768w. It is not wasted on this content only because the cards use 480w.

### 2.2 Single source of truth (design → LP-1 + LP-2)

- One pure function `lcpCandidate(doc): {sectionId, widgetId} | null` (new, in `src/lib/builder/heroImage.ts` next to `sectionWidgetsInPaintOrder`).
  - It is computed from the document only (no query data), so SSR and client agree without serialisation.
  - Rule: in section 0 (not `abTest`, not `hideOn.desktop`), take the widget with an image whose desktop slot share × intrinsic size is largest. Type rank on ties: slider (`showCover`) > image (non-logo, single source) > dark-featured-card > post-list lead. Then DOM order.
- `AboveFoldProvider` gets a second value `lcpWidgetId`. **Only that widget's first image** is `loading=eager fetchpriority=high`. Every other image is `loading=lazy`, `fetchpriority=auto` (React then emits no preload for them), including leads in sections 0–2.
  - `ABOVE_FOLD_SECTION_COUNT` stays 3 for data prefetch only.
  - Slider variants use `priority={isLcp && i===0}` instead of `i===0`.
  - The `<img>` gets `data-lcp-candidate` (the LP-3 signal).
- The `<head>` image preload comes ONLY from React's auto-preload of that single eager `<img>`. That is byte-identical by construction: it is generated from the same props, which closes the "KONTRAKT PARYTETU" in `heroImage.ts:10-14`.
  - Remove `imagePreloadLink` from the builder head (`routes/index.tsx:307-312`).
  - Keep the HTTP `Link` header, but feed it from `builderHeroPreload` → `lcpCandidate` (same sizes via `sliderImageSizes`).
- Logo: keep eager (in viewport). Its auto-preload is Low priority. On desktop the mobile logo (`Header.tsx:241`) is hidden but preloaded (5.7 KB Low): accept, or move it to `<picture>` later.

## 3. Bandwidth model on mobile (mandate 3)

### 3.1 What the browser bills before LCP today (prod M3, `bw/prod-mobile.billed.txt`, LH network-requests; F = ended before obs FCP and render-blocking priority, L = ended before obs LCP and not a Low image)

| Group                                                                                                                                                                   | Requests |    Transfer | Priority | Start→end (obs ms)                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------: | ----------: | -------- | ---------------------------------------------------- |
| Document `/`                                                                                                                                                            |        1 |      89 371 | VeryHigh | 0→2963 (MISS TTFB 2.8 s)                             |
| `styles-*.css`                                                                                                                                                          |        1 |      78 624 | VeryHigh | 2852→3193                                            |
| Fonts latin 30 796 + latin-ext 14 158                                                                                                                                   |        2 |      44 954 | High     | 2852→3273                                            |
| Entry `index-Cjx74syR` + `vendor-react`                                                                                                                                 |        2 |     318 499 | High     | 2854→3182                                            |
| Other boot vendors (tanstack 52.3, supabase 58.6, i18n 16.3, zod 12.4, lucide-boot 14.9, tw-merge 8.6, radix-boot 1.4)                                                  |        7 |     164 403 | High     | 2855→3150                                            |
| `pl` dictionary                                                                                                                                                         |        1 |      26 799 | High     | 2853→3127                                            |
| Widget chunks (sliderVariants 11.5, SearchButton 6.9, AccountMenu 5.4, sectionLabel 5.2, PostListView 5.1, animatedHeading 4.8, PostsSlider 1.2, PaginatedPostGrid 0.8) |        8 |      40 886 | High     | 2853→3165                                            |
| Stray route chunks (admin.analytics 5.7, Footnotes, index-57LQ, blog.index, index-D_Tb, EventPortalContent, prepareContent, useInFeedAds, headings)                     |        9 |      16 530 | High     | 2855→3129                                            |
| Hero 768w webp q80                                                                                                                                                      |        1 |      37 940 | High     | 2860→3228                                            |
| Logo svg (26.7 KB raw)                                                                                                                                                  |        1 |       5 761 | Low      | 2861→3188 (Low image → excluded from LCP optimistic) |
| `/~flock.js`                                                                                                                                                            |        1 |       8 402 | Low      | 3208→3264                                            |
| **Billed pessimistic LCP set**                                                                                                                                          |          | **826 408** |          | obs LCP 3303                                         |

FCP set (render-blocking priority, ended before obs FCP 3252): 735 KB. **JS = 575.5 KB (567 KB first-party + 8.4 KB flock) = 70 % of the LCP set.** At 1.6 Mb/s that is ≈2.9 s of link time for JS alone. The entry module evaluates before DCL, and the first paint lands after DCL in every observed run (fixture mobile DCL 371 → FCP 375), so every boot chunk "ends before observed FCP" and is billed (lighthouse-analyst fact).

### 3.2 Marginal cost of each class (Lantern what-if, fixture h2 same-origin, `batch2.out`, `batch3.out`, deterministic)

| Variant (pre-LCP set)                                      |  mob FCP |  mob LCP | mob SI | desk FCP | desk LCP |
| ---------------------------------------------------------- | -------: | -------: | -----: | -------: | -------: |
| today (S0/E0)                                              |     3973 |     4368 |   3973 |      772 |      812 |
| no widget + stray chunks (E4 ≈ boot-js C2 upper bound)     |     3822 |     4217 |   3822 |      731 |      771 |
| boot set only, no widgets/stray (E3)                       |     3835 |     4230 |   3835 |      737 |      777 |
| no vendor-supabase (E5 ≈ boot-js C4)                       |     3823 |     4218 |   3823 |      732 |      772 |
| **modulepreload only entry + react (E1)**                  |     2789 |     3334 |   2789 |      574 |      654 |
| entry only (E2)                                            |     2482 |     3027 |   2482 |      532 |      612 |
| **no JS before LCP (T0 = C3)**                             | **1367** | **1667** |   1952 |      330 |      410 |
| C3 + hero −34 % (640w) (T1)                                |     1367 |     1667 |   1952 |      330 |      370 |
| C3 + font subset (T3)                                      |     1367 |     1667 |   1952 |      330 |      410 |
| C3 + hero 640w + one PL font (E6)                          |     1367 | **1517** |   1952 |      330 |      370 |
| C3 + hero −34 % + font subset + CSS −50 % + doc −40 % (T5) |     1067 |     1217 |   1892 |      290 |      290 |
| no C3: hero −34 % only (S1)                                |     3973 |     4218 |   3973 |      772 |      812 |

Conclusions:

- The entry alone (230 KB) costs +1.1 s FCP / +1.36 s LCP on mobile. The "modulepreload only entry + react in head" policy from the mandate is **not sufficient** (LCP 3.33 s > 2.5 s).
- The only policy that reaches the targets is **no JS request before the LCP paint (C3)**. After C3, the remaining LCP−FCP is 300 ms (hero + fonts), and image/font diets are worth only 0–150 ms each.
- The SI floor (1952) is then set by `0.4 × layout-based SI` and the observed filmstrip (see §6), not by bytes.

### 3.3 Priority/ordering policy (design; JS part is boot-js C3 / LA-C4, image part is LP-1)

1. Before LCP paint the HTML may request only: CSS (VeryHigh), ONE font file (High, LP-8), the LCP image (High, via React auto-preload + Link header), the logo (Low). Nothing else may be High.
2. No `<link rel=modulepreload>` in `<head>` and no JS in the `Link` header. The C3 bootstrap inserts the boot set after the `img[data-lcp-candidate]` `load` + `decode()` + rAF, or after first input, or 1.5–3 s cap (LP-3 contract).
3. Below-the-fold and non-candidate images: `loading=lazy`, so React emits no preload.
4. After LCP: boot set in one burst. Overlays, gtag and popups follow the TP-1/TP-4 quiescence scheduler.

Estimated Lantern results: fixture mobile FCP 1.37 / LCP 1.52 / SI 1.95 (E6); desktop 0.33 / 0.37 / 0.51. Prod/PSI projection with LA's 6 ms/KB:

- the prod pre-LCP set falls from 826 KB to doc 89 + CSS 79 + font 32 + hero 25 ≈ 225 KB → mobile LCP ≈ 0.9 + 1.35 ≈ 2.25 s;
- with html-weight/css diets (doc 50, CSS 45): ≈ 150 KB → ≈1.8 s;
- FCP ≈ 0.9 + 5.1 ms/KB × (doc + CSS + font) ≈ 1.9 s → 1.55 s.

## 4. Consent banner (mandate 4)

- Mount: `routes/__root.tsx:144-145` `lazy(ConsentBanner)`; `useOverlayGates` (:262-272) does `requestAnimationFrame → whenIdle(…, CONSENT_IDLE_TIMEOUT_MS=1000)` (:222). The render is `{consentReady ? <ConsentBanner/> : null}` (:1004).
  - The component returns null until `mounted`, and when `decided` (`ConsentBanner.tsx:405-406`).
  - Compact card: `fixed right-3 bottom-3 left-3`, `animate-in fade-in slide-in-from-bottom-4` (:544-558). The `enter` keyframes are the non-composited animation flagged by LH.
  - Chunk group in prod: ConsentBanner 8.0 KB + vendor-radix 36.9 KB + sonner 10.1 KB + lucide 18.7 KB (transfer), requested 3881–3908 ms, done 4167–4181 ms (obs).
- Geometry (`live.json`, fixture artifact, Playwright 4x/1x):
  - mobile banner 388×236 = **27 % of the viewport**, largest text `P` 354×54 = 19 116 px², appears at 4810 ms (4x CPU);
  - desktop 380×230 = 7 % of the viewport, `P` 18 757 px², at 1162 ms.
  - Hero: 68 121 px² (mobile), 224 972 px² (desktop). **On `/` the banner cannot become LCP.** It can on pages whose largest element is < ~19 K px² (text pages, short titles on mobile), where it would set LCP ≈ 4.8 s+ (audit F30).
- **SI weight** (histogram progress of prod LH thumbnails, `si/thumbs.cjs`):
  - mobile 4336 ms frame 72.1 % → 5420 ms frame 99.5 % → **the banner is ≈27 pp of visual completeness**;
  - desktop 93.7 → 98.3 % (≈4.6 pp);
  - fixture (speedline on `lha1-mobile` trace): histogram 91 → 97–99 % between 1953 and 2234 ms obs, after content at 507 ms.
- Lantern SI = max(FCP, 1.4×obsSI + 0.4×layoutSI) on mobile (`@paulirish/trace_engine/.../lantern/metrics/SpeedIndex.js:11-67`, RTT 150 → multiplier 1); desktop 0.575/0.49.
  - Painting the banner with FCP removes ≈0.27×(t_banner−t_content) of obs SI: M3 run ≈0.27×0.95 s ≈ 0.26 s → **−0.36 s Lantern SI**; PSI (1.5–2.5 s later) **−0.55…−0.95 s** → SI 4.9 → ~4.1–4.35 s, +1.1…+1.6 pts mobile. Fixture: −0.15 s. Desktop: ≈ −0.03 s.
  - After C3 the banner would come even later (boot waits for LCP), so **without a shell, C3 regresses SI by about +0.3…0.8 s**. That is ≈0 pts at SI ≈2 s (flat curve) but real for users.
- **Design (co-owned with hydration H9):**
  1. `CONSENT_INIT_SCRIPT` (new `src/lib/consent/consentInitScript.ts`), injected right after `THEME_INIT_SCRIPT` (`__root.tsx:935`).
     - A one-line IIFE sets `document.documentElement.dataset.consentDecided="1"` when `localStorage["consent:v2"]` parses with `version === CONSENT_VERSION`, or when cookie `nes_cookie_consent` holds the same.
     - The expression is shared with `src/lib/ads/consent.ts:33-35,100-150` as a string fragment, like `themeChoice.ts`. This avoids the 4-copy drift defect documented in `themeInitScript.ts`.
     - try/catch → undecided.
  2. `<ConsentShell>` (new `src/components/consent/ConsentShell.tsx`), rendered in `__root` SSR AND on the client (static markup, same geometry and classes as the compact card, texts from the dehydrated cookie-banner settings and i18n, inline SVG icons, no lucide/radix import). It is rendered only when `privacy.cookie_banner && banner.enabled`. CSS `html[data-consent-decided] [data-consent-shell]{display:none}` → decided visitors never see it, with no flash, because the script runs before body parse. No `:has()` (noHasSelectors gate).
  3. Clicks before hydration: the same init script installs one delegated `click` listener on `[data-consent-action]` and records `window.__nesConsentIntent`. This is the same pattern as `pendingOpenPrefs` (`consent.ts:42-64`).
  4. The lazy `ConsentBanner` (mounted on idle, or immediately when an intent exists) replaces the shell in one commit: it renders without `animate-in` when a shell was present and consumes the intent through `acceptAll`/`rejectAll`/open-prefs. It stays the ONLY writer of `setMarketingConsent`/`setConsentOverlayVisible` (contract `__root.tsx:234-239`).
  5. CLS: fixed-position nodes and replace-not-move → 0. LCP: the shell paints with FCP, so on text pages LCP becomes ≈FCP instead of 4.8 s+.

## 5. Early Hints, speculation rules, /media formats, logo (mandate 5)

- **Early Hints.** Lantern links every request without an initiator request to the root document node (dependents start after the document finishes) and does not simulate TTFB, so 103 cannot move simulated FCP/LCP. Score effect **0**. Real users gain ~1 RTT + server time for CSS/fonts/hero on MISS.
  - **Precondition:** today the `Link` header carries 31 hints: 1 CSS, 1 preconnect, 2 fonts, **26 modulepreloads** (incl. `admin.analytics`, `PaginatedPostGrid` ×2) and the hero (`psi/h1.txt`). Enabling EH now would front-load ~575 KB of JS before the HTML on every MISS/HIT.
  - Policy: the Link header carries only {CSS, the one font, LCP image} (`src/lib/http/frameworkPreloads.server.ts`, `routes/index.tsx:215` `widgetPreloadHeaders`); then EH may be switched on in the Cloudflare dashboard (human; the Workers + document-cache compatibility cannot be verified here, no egress).
- **Speculation rules:** `src/lib/seo/speculationRules.ts:98,109` → prefetch and prerender with `eagerness: "moderate"` (prod HTML: 2× `moderate`). There are 0 prefetch/prerender requests in the prod mobile trace (only one Document). No change.
- **/media formats:** `src/routes/media.$.ts:13-22,117` forwards `Accept` to Supabase transforms, which choose WebP only (`format` knows only `origin`). AVIF needs Cloudflare Image Transformations (`cf.image`, paid quota → human).
  - Effect from the what-ifs: hero −34 % → mobile LCP −0.15 s today (S1), 0 after C3 (T1); desktop −0.04 s after C3.
  - Cheaper and free: correct mobile `sizes`. The hero slot is 348 css px (32 px gutters), but `sizes` says `100vw` → 412×1.75 = 721 → 768w (37.9 KB). `calc(100vw - 64px)` → 609 → **640w (25.1 KB prod, −34 %)** at the same visual density (1.84x). Quality: hero q80 vs q76 elsewhere; q72 ≈ −10–15 % (optional).
- **Logo:** mobile `…20uj13.svg` is 26.7 KB raw / 5.8 KB transfer, Low, ends before LCP → ≈0 (what-if T7 nologo: 0 ms). The desktop builder logo `…zx9she.svg` is `loading=lazy` (OptimizedImage without priority, `mediaWidgets.tsx:167-215`; header chrome never sets `aboveFold`, `ChromeWidgetView.tsx:193`). It was requested at 3665 ms obs and **finished at 6289 ms**, so the logo appears only in the final desktop frame (`film/desktop-05-06396.jpg` vs `desktop-final.jpg`). Fix: chrome logo eager (no high). SVGO at upload (`src/lib/media/upload.ts`) to cut the 27 KB raw. Inlining the SVG is not recommended: the HTML is already 569 KB and an inline copy moves the same gzip bytes into the render-critical document.

## 6. Speed Index: what paints late (mandate 6)

Prod LH filmstrip (`film/*.jpg`, histogram progress via `si/thumbs.cjs`):

| Frame (thumb time) | mobile | desktop | What changes                                                                             |
| ------------------ | -----: | ------: | ---------------------------------------------------------------------------------------- |
| ≤3252 / ≤3198      |    0 % |     0 % | MISS TTFB 2.8–3.4 s (not simulated, but inflates obs SI ×1.4 → server-cache/measurement) |
| 4336 / 4264        | 72.1 % |  93.7 % | content incl. hero (single paint)                                                        |
| 5420 / 5330        | 99.5 % |  98.3 % | **consent banner** (+27.4 pp mobile, +4.6 pp desktop)                                    |
| 6396 desktop       |      – |  96.7 % | ticker headline swap (histogram dip)                                                     |
| 7462 desktop       |      – |  99.1 % | **desktop logo arrives** (lazy, 6289 ms)                                                 |
| final              |    100 |     100 |                                                                                          |

Fixture (speedline over the full trace): mobile histogram 61 % at 439 ms, 91 % at 507 ms, flat until the banner at 1953–2234 ms → 97–99 %. Desktop: 94 % at 430, 98 % at 1766–1837 (banner).

Late-paint fixes in order: banner shell (LP-4), autoplay gate (LP-5: a slide change inside the trace changes ~20 % (mobile) / ~22 % (desktop) of the viewport, so every earlier frame is ~10–20 pp "incomplete" vs final; it fires at hydration + 4.5–5.5 s, which is inside the PSI trace whenever gtag keeps it alive past ~10 s — PLAUSIBLE, verify with PSI JSON M6), desktop logo eager (LP-6), and the layout-based term (0.4×weighted end time of CPU tasks with Layout → H5/H6 forced layouts and device-switch re-render, hydration-owned).

## 7. Ordered change list (with deltas)

| #   | ID    | Change                                                                                                                                              | Mobile Δ (Lantern)                                                                  | Desktop Δ                              | Basis                                   |
| --- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------- | --------------------------------------- |
| 1   | LP-3  | C3 hero-signal contract: `img[data-lcp-candidate]` load+decode+rAF / LCP observer / input / cap; boot set inserted after                            | (C3 itself) FCP −2.6 s, LCP −2.7 s fixture; PSI LCP 6.6 → ~2.0–2.5 s                | FCP −0.44, LCP −0.40 s                 | what-if T0 vs S0                        |
| 2   | LP-1  | Single LCP candidate per document (pure `lcpCandidate(doc)`, context, slider/post-list/image priority only for it, everything else lazy)            | 0 today; prevents +0.9–1.4 s LCP with distinct lead covers                          | −25 KB High pre-LCP (640w) → ≤ −0.03 s | prod network list; 6 ms/KB              |
| 3   | LP-2  | Preload single source: React auto-preload of the candidate img only; drop head `imagePreloadLink` for builder docs; Link header from `lcpCandidate` | 0 (5→1 head image preloads, −7 KB raw HTML)                                         | removes 25vw→480w mis-preload; ≈0      | prod head                               |
| 4   | LP-4  | Consent shell SSR + pre-paint decided script + intent queue (with H9)                                                                               | SI −0.55…−0.95 s PSI (+1.1–1.6 pts); fixture −0.15 s; avoids +0.3–0.8 s SI after C3 | SI −0.03 s                             | thumbnails + Lantern SI formula         |
| 5   | LP-5  | Slider autoplay starts only after first interaction or `whenQuiescent()` + in-viewport + visible                                                    | SI −0…−1.1 s on PSI when a tick lands in-trace (PLAUSIBLE); TBT −0…−60 ms           | same order                             | hero 20–22 % viewport × remaining trace |
| 6   | LP-8  | One latin+PL font file (≈32 KB) instead of latin 30.8 + latin-ext 14.2                                                                              | LCP −0.08 s today; −0…−0.15 s after C3                                              | ≈0                                     | B3/B4 vs B0; 6 ms/KB × 13 KB            |
| 7   | LP-7  | Mobile hero `sizes` minus section gutter (640w), merge with html-weight HW-4                                                                        | LCP −0.15 s today; 0 after C3                                                       | LCP −0.04 s after C3                   | S1, T1                                  |
| 8   | LP-6  | Header-chrome logo eager (no high), SVGO at upload                                                                                                  | SI ≈0                                                                               | SI −0.03…−0.06 s                       | desktop logo 3665→6289 ms               |
| 9   | LP-10 | CI gate: critical-path invariants in `check-document-weight.ts`                                                                                     | durability                                                                          | durability                             | –                                       |
| 10  | LP-9  | Link header = CSS + font + LCP image only; Early Hints only after that (human)                                                                      | 0 Lantern; real users −1 RTT on CSS/hero                                            | 0                                      | Lantern graph semantics                 |
| 11  | LP-11 | AVIF via CF Image Transformations (human, cost)                                                                                                     | LCP −0.15 s today, 0 after C3                                                       | −0.02…−0.04 s                          | S1/T1                                   |

Stacked fixture projection (C3 + LP-1/2/7/8): mobile FCP 1.37 / LCP 1.52 / SI 1.95 (score capped by TBT, see LA-C1); desktop 0.33 / 0.37 / 0.51. With LP-4 + LP-5, the observed SI component approaches observed FCP.

## 8. Conflicts / ownership notes

- LP-4 = hydration **H9** (same files `__root.tsx`, `ConsentBanner.tsx`): merge into one item; lcp-path supplies the pre-paint/SI/LCP spec.
- LP-3 is a contract on boot-js **C3** / LA-C4 (bootstrap trigger); LP-1 delivers the `data-lcp-candidate` marker C3 needs.
- LP-7 overlaps html-weight **HW-4** (srcset ladders, `imageSlot.ts`/`cropSizes.ts`): one owner.
- LP-8 touches `src/styles.css` @font-face (css workstream owns `styles.css`): coordinate the hunk.
- LP-9 overlaps boot-js C2/C3 and LA-C3 (Link header JS entries); LP-9 adds only the "no EH before trimming" rule.
- LP-5 uses TP-4's `whenQuiescent()` scheduler (third-party).
- LA-C5 (hero-first HTML) is complementary; nothing here changes HTML order.
