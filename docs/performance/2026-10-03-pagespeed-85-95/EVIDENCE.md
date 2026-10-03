# PageSpeed evidence pack — neweuropeanstrategies.com (2026-10-03, Fable 5.1 orchestrator)

Target: **mobile ≥ 85, desktop ≥ 95** (Lighthouse 13.5 / PSI) on `https://neweuropeanstrategies.com/` (homepage, PL).
Lighthouse 13 weights: TBT 30 %, LCP 25 %, CLS 25 %, FCP 10 %, SI 10 %. CLS is already 0 → 25 pts banked.
Required roughly: mobile TBT ≤ 250 ms, LCP ≤ 2.5 s, FCP ≤ 1.8 s, SI ≤ 3.4 s; desktop TBT ≤ 150 ms, LCP ≤ 1.2 s, FCP ≤ 0.9 s, SI ≤ 1.3 s.

## 0-cloud. Working environment in the CLOUD session (2026-10-03, READ FIRST — supersedes §0)

- **Repo checkout**: `/home/user/neweustrategies-dc633fb5`, branch `perf/pagespeed-mobile85-desktop95-t595d6` (= `perf/pagespeed-mobile85-desktop95` 9c071c92 = `origin/main` 6a4215db + this evidence pack). Working tree clean; **do not commit in the main checkout unless the orchestrator says so** — implementation agents work in their own `git worktree`.
- **Scratchpad** (session temp, outside the repo): `/tmp/claude-0/-home-user-neweustrategies-dc633fb5/8fd9e8e2-d544-5db4-ae5e-c509c5e3ff6c/scratchpad` (below: `$SCRATCH`). Phase-1 reports go to `$SCRATCH/phase1/<key>.md` (also mirrored later into `docs/performance/2026-10-03-pagespeed-85-95/faza1/`).
- **Tooling**: `bun` 1.3.14 on PATH (`/root/.bun/bin/bun`), `node` v22.22 (type-stripping on by default, so `node file.ts` works for plain TS; repo scripts are run with `bun run`), `python3`, Lighthouse 13.5.0 CLI at `$SCRATCH/tools/node_modules/lighthouse/cli/index.js`, Chromium at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` (always `--chrome-flags="--headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage"`). **4 CPUs / 15 GB RAM** — one build at a time (mutex `mkdir $SCRATCH/.build-lock`, `rmdir` when done; wait while it exists); Lighthouse numbers measured while a build runs are noisy.
- **NO network egress** to production, Supabase, Cloudflare or any CDN (proxy returns 403). Only registry.npmjs.org and github.com work. Therefore: PSI API, `curl https://neweuropeanstrategies.com`, Lighthouse-against-production and real-data SSR are **impossible here**. Production ground truth = the saved reports: `$SCRATCH/lh/prod-mobile.json`, `$SCRATCH/lh/prod-desktop.json` (+ `.summary.txt`), production HTML `$SCRATCH/psi/home.html` (569 347 B) with headers `$SCRATCH/psi/h1.txt`, baseline local (M3 Pro, real data) summaries `$SCRATCH/lh/baseline-*.summary.txt` and medians `$SCRATCH/lh/baseline-local-medians.txt`. The same files live in the repo under `docs/performance/2026-10-03-pagespeed-85-95/lighthouse/` (gzipped).
- **Dependencies**: installed with `bun install --frozen-lockfile`, except `xlsx` (its tarball is on cdn.sheetjs.com, blocked) which was substituted by `xlsx@0.18.5` from npm **in node_modules only** (package.json/bun.lock untouched). Consequence: `spreadsheet.worker` and admin xlsx chunks are smaller than in CI — do not read `check:bundle` deltas for those chunks as real. Worktrees: symlink `node_modules` from the main checkout (`ln -s /home/user/neweustrategies-dc633fb5/node_modules <wt>/node_modules`) instead of reinstalling.
- **Build**: `BUNDLE_INVENTORY=1 bun run build:smoke` → `.output/` + `reports/chunk-inventory.json` (log of the baseline build: `$SCRATCH/build-smoke.log`). Inventory: `bun run report:chunk-inventory <chunk> --modules`.
- **SSR data = fixture** (`scripts/performance/replayFetch.mjs` + `scripts/performance/homeFixture.ts`, data `e2e/fixtures/first-visit.json`): synthetic homepage with representative builder geometry, fewer menu rows/posts than production (production HTML 569 KB vs fixture ≈ 390 KB — see team doc). Start the artifact exactly like `playwright.performance.config.ts` does: `SUPABASE_URL=http://127.0.0.1:4199 SUPABASE_PUBLISHABLE_KEY=performance-fixture SUPABASE_SERVICE_ROLE_KEY=performance-fixture-admin PORT=4173 HOST=127.0.0.1 NITRO_PORT=4173 NITRO_HOST=127.0.0.1 node --import scripts/performance/replayFetch.mjs .output/server/index.mjs`. Client-side PostgREST calls from the browser go to 127.0.0.1:4199 (nothing listens → they fail fast; count them, do not time them).
- **Measurement helper**: `$SCRATCH/lh/measure-local.sh <worktree> <label> [runs=3] [path=/]` — starts server (fixture) + brotli proxy on label-hashed ports, warms the document cache (HIT), runs Lighthouse mobile+desktop N times with PSI-identical settings, prints per-run lines and `MEDIAN` lines, saves `$SCRATCH/lh/results/<label>-{mobile,desktop}-N.json` + `.summary.txt` (`python3 $SCRATCH/lh/lh-summary.py <json> --top 40`). Baseline of the unmodified artifact: label `baseline` (see `$SCRATCH/lh/results/baseline-*` and the MEDIAN lines in `$SCRATCH/lh/results-baseline.log`).
- Everything else in §0 below describes the laptop session (macOS paths) and is kept for provenance only.

## 0. Working environment (laptop session, historical)

- **Code lives in the worktree** `/private/tmp/claude-501/-Users-igormiasnikow-Documents-GitHub-neweustrategies-dc633fb5/4193afc7-12e8-408f-90bd-72423fed6163/scratchpad/perf-main`
  (branch `perf/pagespeed-mobile85-desktop95`, based on `origin/main` @ 6a4215db 2026-10-03). The main checkout
  `/Users/igormiasnikow/Documents/GitHub/neweustrategies-dc633fb5` is 1149 commits BEHIND main and has 114 dirty files → **never edit or build there**.
- `bun` is NOT on PATH. Use: `export PATH="/private/tmp/claude-501/-Users-igormiasnikow-Documents-GitHub-neweustrategies-dc633fb5/4193afc7-12e8-408f-90bd-72423fed6163/scratchpad/tools/node_modules/.bin:$PATH"` (bun 1.4.2). `node` is v24 (runs .ts directly).
- Dependencies are installed in perf-main (`bun install --frozen-lockfile` OK). `.env` in perf-main holds the PUBLIC Supabase anon config (same values production ships in `window.__SUPABASE_CONFIG__`). Load with `set -a; . ./.env; set +a` before build/run.
- Smoke build (node-server preset, production vite config parity, chunk inventory on): `BUNDLE_INVENTORY=1 bun run build:smoke` → `.output/` + `reports/chunk-inventory.json`. Build log of the baseline: `scratchpad/build-smoke.log`. Builds take minutes and 8 GB heap — **one build at a time on this machine (19 GB RAM)**; coordinate.
- Run artifact locally: `PORT=4173 HOST=127.0.0.1 NITRO_PORT=4173 NITRO_HOST=127.0.0.1 node .output/server/index.mjs` (needs env vars from .env). Nitro does not compress → put `node scratchpad/lh/br-proxy.mjs 4174 4173` in front and point Lighthouse at `http://127.0.0.1:4174/`.
- Lighthouse CLI 13.5.0: `scratchpad/lh/node_modules/lighthouse/cli/index.js`, Chrome at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` (`CHROME_PATH`). Mobile = default; desktop = `--preset=desktop`. Always `--only-categories=performance --output=json`.
  Summarize any report: `python3 scratchpad/lh/lh-summary.py report.json --top 40`. Production reports: `scratchpad/lh/prod-mobile.json|prod-desktop.json` (+ `.summary.txt`).
- PSI API quota for this machine is exhausted today (429). Use local Lighthouse against production for ground truth.
- Production HTML sample: `scratchpad/psi/home.html` (569 347 B), response headers `scratchpad/psi/h1.txt`, downloaded production chunks in `scratchpad/psi/assets/`.
- Repo gates you must keep green (run on the smoke artifact): `check:bundle`, `check:chunks`, `check:entry-purity`, `check:ssr-budgets`, `check:loader-policy`, `check:chunk-parity`, `check:ci-gates`, `noHasSelectors` test, `lint`, `typecheck`, `test`. CLAUDE.md/AGENTS.md rules apply (Polish comments/commit messages are the house style; see AGENTS.md in perf-main).
- Known traps (from repo docs): do not touch `hoistTransitiveImports: false` / `manualChunks` structure casually (chunk-cycle → dead hydration incident 2026-07-20; gate `check:chunks`); keep `setTimeout(0)` before hydrate in `router.tsx`; Rollup cannot move the entry module to a named chunk; any widget rendered inline must keep SSR/hydration parity.

## 1. Scores

| Source | Form | Perf | FCP | LCP | TBT | SI | CLS | TTFB |
|---|---|---|---|---|---|---|---|---|
| PSI (user, 2026-10-03 18:58 CEST) | mobile | **53** | 3.1 s | 6.6 s | 600 ms | 4.9 s | 0 | n/a |
| PSI (user) | desktop | **70** | 0.6 s | 1.1 s | **740 ms** | 1.5 s | 0 | n/a |
| Local LH 13.5 vs production (M3 Pro, Prague, edge MISS) | mobile | 63 | 3.5 s | 5.4 s | 200 ms | 7.1 s | 0 | **2 750 ms** |
| Local LH vs production (edge MISS) | desktop | 92 | 0.8 s | 1.0 s | 0 ms | 2.7 s | 0.011 | **3 300 ms** |
| Team doc 2026-10-02 (PSI 11:33) | mobile/desktop | 49 / 74 | 3.3 / 0.5 | 5.3 / 1.0 | 760 / 450 | 7.5 / 2.2 | 0 | |

PSI diagnostics (user screenshots): desktop main-thread 5.0 s, JS exec 2.7 s, unused JS 362 KiB, 16 long tasks, forced reflow, 1 non-composited animation, render-blocking 30 ms, cache TTL 9 KiB, image delivery 12 KiB. Mobile: render-blocking 410 ms, main-thread 4.2 s, JS exec 2.4 s, unused JS 360 KiB, 12 long tasks, 99 user-timing marks, LCP breakdown red, forced reflow, cache TTL 11 KiB.
Note: PSI's desktop host is far slower than an M3 Pro (TBT 740 ms vs 0 ms for the same page) → plan for a slow desktop CPU; mobile is 4× CPU throttled Moto G Power + 1.6 Mb/s.

## 2. Server / TTFB / cache (production, curl from Prague, cf-ray PRG)

- Edge document cache (`x-nes-cache`): **MISS** → `server-timing: ssr;dur=662, db;dur=2029;desc="n=23", edge-routing;dur=280, app;dur=942`. 23 DB queries on the homepage MISS. Local-LH observed MISS TTFB 2 750–3 300 ms.
- HIT → TTFB 0.13–0.5 s; `x-nes-cache-age` always 106–130 s across minutes → freshness window is short (`DOCUMENT_CACHE_MAX_FRESH_MS` = 3 min per cachePolicy comments) and per-colo (Cache API). PSI runs from Google DCs → likely MISS/STALE often. Browser gets `cache-control: no-cache, must-revalidate, max-age=0`.
- Bot UA (Chrome-Lighthouse / HeadlessChrome) is NOT bypassed (HIT with same age) — hypothesis refuted.
- `Link` response header carries ~30 preloads (CSS, 2 fonts, LCP image with imagesrcset, 9 boot modulepreloads, 8 widget modulepreloads, and stray route chunks: `admin.analytics-*.js`, `blog.index-*.js`, `EventPortalContent`, `Footnotes`, `useInFeedAds`, `prepareContent`, `PaginatedPostGrid`, `headings`, two `index-*.js`). Source: `src/lib/http/frameworkPreloads.server.ts` merges TanStack manifest hints (route `/` static imports) + `widgetPreloadHeaders` + `rootLinkHeaderValues`.
- Transfer of document: 78–84 KB gzip (brotli not negotiated by curl). Static assets: `cache-control: public, max-age=31536000, immutable` ✔. `/~flock.js` (Lovable analytics, 21 KB, defer) has `max-age=1500` (cache audit). Avatars `/media/...png?width=40` TTL 1 h.
- `/media/*` images: `Vary: Accept`, immutable; LCP hero variants: 480w=15.7 KB, 768w=37.7 KB, 1280w=74 KB (webp, q76/80). Logo SVG 26.8 KB (preloaded as image).

## 3. HTML document (`/`, 569 347 B raw, 78 KB gzip)

| Part | Bytes |
|---|---|
| `<head>` | 37.6 KB (38 `<link>`, 19 `<link rel=modulepreload>`, LCP image preloaded **4×** with identical imagesrcset + once in Link header, logo preload) |
| inline `<script>` total | 135 KB in 15 scripts: **107 041 B `$tsr-stream-barrier`** (TanStack dehydrated router/loader state: builder docs for header/footer/home, 46 menu rows × ~46 fields incl. `mega_config`, desktop/tablet/mobile variants, `label_pl/label_en`, the same post excerpts 4×), 18.6 KB react-query stream (`newsletter-settings`, `builder-post-list`…), 3.4 KB JSON-LD footer nav, 2.3 KB speculationrules, GA4 snippet, theme/dock/boot-probe scripts |
| inline `<style>` | **133 223 B in 51 blocks** (26.6 KB global colour tokens, 14.9 KB trending/ticker, 11 KB slider, dozens of per-widget `[data-w-id]...[data-w-id][data-w-id]` overrides with `!important` ×121); not cacheable, re-parsed every load |
| body markup w/o script/style | 285 KB for **6.2 KB of visible text**; class attrs 63 KB, style attrs 52 KB, data-* 20 KB; `srcset` attrs 70 KB (72 × ~5 candidates); 81 `<img>` (73 lazy, 7 `fetchpriority=high`), 56 inline `<svg>` |
| `<header>` | **103 KB** (14 `<style>` = 48.7 KB, 84 divs, mega-menu content rendered hidden) |
| `<footer>` | 37 KB |
| `<main>` | 254 KB (31 style blocks = 48 KB) |
| DOM | ~1 333 elements, depth ~29, 55 Suspense `<!--$-->` boundaries |

Team doc measured 388 KB on the fixture; production is 569 KB because of real content (more posts, menus, 4× repeated post data).

## 4. JavaScript (production, homepage)

Referenced from head/Link (28 files): **2 390 138 B raw / 646 043 B gzip**. Lighthouse mobile saw **88 scripts, 3.6 MB resource / 1.17 MB transfer** (incl. gtag ×2 = 370 KB transfer).

| Chunk | raw | gzip | note |
|---|---|---|---|
| `index-Cjx74syR.js` (entry) | 835 884 | 257 511 | 50 % unused per LH. Team inventory: entry is APP code: `src/routes` shells ~340 KB (≈300 routes incl. admin/club/profile), `lib/builder` 208 KB, `components/builder` 193 KB, `routeTree.gen.ts` 62 KB, `lib/queries` 60 KB, `components/header` 46 KB (TrendingTicker 40 KB), `lib/seo` 42 KB, `lib/theme` 37 KB, `lib/ads` 22 KB, megaMenu 20 KB, newsletter 18 KB, audio 17 KB |
| `vendor-supabase` | 224 170 | 58 609 | 80 % unused for anonymous; 114 entry modules import the client |
| `vendor-react` | 195 480 | 61 358 | |
| `vendor-tanstack` | 168 861 | 52 299 | 49 % unused |
| `pl-*.js` dictionary | 69 000 | 26 718 | top-level await in boot path |
| `vendor-zod` | 54 091 | 12 325 | 16 boot importers (settings schemas) |
| `vendor-i18n` | 49 099 | 16 216 | |
| `vendor-lucide-boot` | 45 275 | 15 046 | |
| `sliderVariants` | 41 008 | 11 421 | hero slider |
| `vendor-tw-merge` | 27 511 | 8 528 | |
| widget chunks (SearchButton, sectionLabel, animatedHeading, PostListView, AccountMenu, PostsSlider…) | ~100 KB | ~30 KB | preloaded via Link |
| stray: `admin.analytics-*.js` 18.5 KB, `blog.index`, `EventPortalContent`, `Footnotes`, `useInFeedAds`, `prepareContent`, `PaginatedPostGrid`, `headings`, `index-57LQ`, `index-D_Tb` | ~40 KB | ~15 KB | preloaded on `/` though not needed before interaction |
| after hydration | +~50 lazy chunks (ConsentBanner 24 KB, vendor-radix 112 KB, icons-0 103 KB, vendor-lucide 63 KB, vendor-sonner 35 KB, JoinUsForm, NewsletterDocRenderer, TopicsDroplist, vendor-radix-select, vendor-dompurify, popups…) | | | 44 `<link rel=modulepreload>` inserted into head by Vite preload helper after boot |
| `gtag/js` ×2 (G-EN05JH34VP, AW-17612160320) | 1.1 MB | 370 KB | loaded ~5.8 s (gtagLoadPolicy: after load + 1.5 s quiet); 185+122 ms main-thread mobile, 75 ms desktop; still inside TBT window because TTI ≈ 10 s |

Main thread (local LH mobile): Script eval 1 548 ms, Other 817, Style&Layout 631, Parse HTML&CSS 144; bootup attributed to `vendor-react` 1 422 ms (= hydration of ~48 widgets / 1 333 elements). Long tasks at 1.5–2.0 s during HTML parse (98/96/89/51 ms — parsing 575 KB HTML + 133 KB inline CSS + 107 KB inline state script), then hydration tasks.
Post-hydration network: **15 PostgREST fetches + 6 CORS preflights** (categories, tags, site_design_tokens, post_layout_settings, ad_placements, builder_popups, newsletter…) — SSR seeds with `updatedAt: 0` force immediate refetch (team doc §7.3).

## 5. CSS

- `styles-DjfYz07w.css`: **537 876 B raw / 78.6 KB gzip, render-blocking on every URL** (LH: 460–529 ms savings mobile). Team doc: 6 234 selectors, Tailwind utilities layer 333 KB + 180 KB hand CSS (`src/styles.css` 320 KB / 8 900 lines) covering admin/clubs/profile/dock/chat/checkout too. `admin-styles.css` already split (12.6 KB gzip).
- `:has()` removed 2026-10-02 (gate `noHasSelectors.test.ts`) — style recalc is cheap now; parse cost of 541 KB remains.
- Non-composited animations (LH): ConsentBanner `enter` animation uses a filter property; slider/card `<img>` opacity transitions (`sliderVariants.tsx` FillImage: `opacity: visible ? 1 : 0`, `transition: opacity 700ms, scale …`).

## 6. LCP / FCP critical path

- LCP element (mobile & desktop): hero slider image `img.eh-img` (`div.w-full > div.relative > div.pointer-events-none > img.eh-img`), rendered by `src/lib/builder/sliderVariants.tsx` FillImage (line ~330–390): `loading="eager"`, **`fetchpriority="low"`** on the active slide? (LH snippet shows `fetchpriority="low"` and `style="opacity: 0;"` for the LCP node — i.e. the LCP candidate is a stacked slide whose opacity is flipped by JS; on a slow device the paint waits for hydration → PSI mobile LCP 6.6 s vs FCP 3.1 s). Preload `<link rel=preload as=image fetchpriority=high imagesrcset… imagesizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw">` vs `<img sizes="(max-width: 767px) 100vw, (max-width: 1023px) 50vw, 50vw">` → **sizes mismatch**: on desktop the preload fetches a different variant than the img uses (wasted preload). The same preload appears 4× in head + Link header.
- LCP breakdown (local, MISS): TTFB 2 821 ms, load delay 39, load 368, render delay 74 (mobile). On HIT the TTFB part collapses to ~300 ms, so remaining LCP ≈ FCP + image; PSI mobile shows a 3.5 s gap FCP→LCP → render delay / hydration gating (opacity) is the suspect, plus bandwidth contention: 646 KB gzip of `modulepreload` at High priority competes with CSS/fonts/LCP image on 1.6 Mb/s (≈3.2 s of link time).
- Render-blocking: only `styles.css` (80 KB gzip). Fonts: 2 woff2 preloaded (31 + 14 KB), `font-display: swap`.
- Consent banner: lazy chunk mounted after idle (24 KB + radix 112 KB + sonner), fixed overlay covering the lower half on mobile; previously identified as an LCP candidate (its paragraph). It paints only after hydration.
- Speculation rules `prefetch` for all internal links (deny-list) — check eagerness (if `moderate` it is hover/touch-triggered; verify no eager prefetch during load).
- `/~flock.js` 21 KB defer on every page (Lovable analytics), 25 min TTL.

## 7. What the team already did (main, 2026-09-29 → 10-03) — do not redo, build on it

- PR #422/#424/#426/#427/#431: streamed first fold stabilised, hero widget no longer behind a late Suspense boundary (content widgets), redundant hydration avoided, slider resize work reduced, image delivery tweaks, SSR section gating.
- 2026-10-02 round 1: all 38 `:has()` rules removed from public CSS (+ CI gate) → style recalc 35 ms → 0.6 ms.
- 2026-10-02 round 2 (`81d84b1f`): `bootVendorSplit.ts` (radix-boot 3 KB, lucide-boot 45 KB), error page lazy, audio engine lazy, root CSS generators server-only (`createIsomorphicFn().server()` + `data-css-hash`), route shells slimmed, code-split exception narrowed to `/`, `/$`, `/en*`, `gtagLoadPolicy.ts` (first interaction | consent decision | load+1.5 s quiet, hard cap 8–10 s). Boot closure 1.90 → 1.59 MB raw / 567 → 480 KB gzip. Mobile 49 → 53.
- Their round-3 plan (docs/performance/2026-10-02-pagespeed-przyczyny.md §9): (2) gtag after interaction/consent with TTI fallback, (3) SSR seeds `updatedAt: 0` → staleTime from SSR render time (kill 11–15 refetches), (4) route shells for admin/profile/club/events out of entry (lazy route groups by prefix), lazy supabase for anon, lucide/radix/zod out of boot (entry 958 → ~550 KB raw), (5) public CSS core ≤ 150 KB raw + inline `<style>` → precedence sheets, (6) HTML 388 → <200 KB, (7) hero in first HTML fragment, imagesrcset preload, `/media` Accept negotiation, (8) `vars.LHCI_URL` mode A mobile.
- Older audit with 40 findings: docs/AUDYT_CWV_ZIMNE_OTWARCIE_2026-09-20.md (§8 plan, §8.1 status).

## 8. Orchestrator's root-cause synthesis (to be verified/extended by workstreams)

1. **Boot JS volume + eager preloading** (TBT, mobile FCP/LCP via bandwidth, SI): 646 KB gzip fetched at High priority before first paint; entry = whole-app route table; hydration of the entire page (48 widgets, mega menus, footer) is the single biggest main-thread block (~1.4 s mobile).
2. **Document weight** (FCP, parse long tasks): 569 KB HTML (107 KB dehydrated state, 133 KB inline CSS, 103 KB header) → ~250 ms of parse long tasks on mobile before any JS, and 78 KB gzip on the wire.
3. **LCP gating by JS**: active slide rendered with opacity 0 / low priority until hydration; preload/img `sizes` mismatch; duplicated preloads; consent banner as late LCP candidate.
4. **Render-blocking CSS** 80 KB gzip / 541 KB raw for all surfaces.
5. **Post-hydration storm**: 15 refetches + 6 preflights, 44 preload link insertions, consent banner + radix + sonner + icons chunks, then 370 KB of gtag inside the TBT window.
6. **TTFB on MISS** 1.3–3.3 s (23 queries, short 3-min per-colo freshness, no cross-colo snapshot) — PSI/Google DCs often see MISS.

## 9. Local baseline artifact (perf-main @ origin/main 6a4215db, `BUNDLE_INVENTORY=1 bun run build:smoke`, 2 min 08 s wall)

- `.output/public/assets`: 885 JS files. `vendor-react-DbdJcebo.js` and `styles-DjfYz07w.css` hashes are IDENTICAL to production → production ≈ this commit (entry hash differs slightly: local `index-Dmm1yFni.js`).
- `bun run check:bundle` on the baseline: **already RED on main** (overall 4824.6 KB > 4772 budget, new `spreadsheet.worker` 158 KB etc.). Largest chunk 254.9 KB gzip (entry); client CSS 95.5 KB gzip (public 80.6 KB); **boot closure 477.5 KB gzip / 1568.6 KB raw (9 chunks)**, budget 579 KB.
- Entry `index-*.js` inventory (1395 kB pre-minify, 527 owners, 8 static imports, **567 dynamic imports**): `src/components/builder` 188.7 kB, `src/lib/builder` 158.2 kB, `routeTree.gen.ts` 60.6 kB, `src/components/header` 49.3 kB, `src/lib/queries` 44.7 kB, `src/lib/seo` 42.4 kB, `@tanstack/start-client-core` 25.1 kB, `routes/__root.tsx` 22.4 kB, `lib/ads` 22.1, `lib/analytics` 21.5, `components/megaMenu` 19.4, `lib/newsletter` 17.7, `components/menu` 17.4, `Header.tsx` 17.3, `routes/$.tsx` 14.7, `components/atoms` 13.1, `lib/events` 11.6, `lib/clubs` 11.3, `lib/billing` 11.0, `lib/postLayouts` 10.4, `lib/i18n` 10.4, `lucide-shim` 9.5, `components/ui` 9.2, `lib/content` 9.0, `lib/menus` 9.0. Full module list: `bun run report:chunk-inventory index --modules` (in perf-main).
- Top chunks overall: PostBlockEditor 1696 kB (lazy), entry 1395, EmptyContainerPickerBox 1071, vendor-supabase 840, index-B355 791 (lazy), admin.events…conflicts 788, admin.posts._slug 725, vendor-react 586, Chart 474, vendor-tanstack 383.
- Local Lighthouse baseline of this artifact (real Supabase data, HIT, brotli proxy): `scratchpad/lh/results/baseline-{mobile,desktop}-{1..3}.json`, medians in `scratchpad/lh/results-baseline.log` (look for `MEDIAN` lines; if the file lacks them the run is still in progress).
- Measurement helper for any worktree: `scratchpad/lh/measure-local.sh <worktree> <label> [runs] [path]` (starts server+proxy on label-hashed ports, warms HIT, runs LH, prints medians). Build mutex for agents: `mkdir /private/tmp/claude-501/-Users-igormiasnikow-Documents-GitHub-neweustrategies-dc633fb5/4193afc7-12e8-408f-90bd-72423fed6163/scratchpad/.build-lock` (rmdir when done; wait while it exists) — max ONE build at a time.

## 10. Local baseline result (M3 Pro, real Supabase data, document HIT, brotli) — KEY REPRODUCTION

| form | perf | FCP | LCP | TBT | SI |
|---|---|---|---|---|---|
| mobile (median of 3) | **70** | 3.16 s | **6.90 s** | 12 ms | 3.16 s |
| desktop (median of 3) | 95 | 0.65 s | 1.46 s | 0 ms | 0.78 s |

- With TBT ≈ 0 the mobile LCP is STILL 6.9 s with FCP 3.2 s → the FCP→LCP gap is **not CPU**. LCP breakdown (observed, unthrottled): TTFB 10 ms, load delay 17, load duration 500 (image from production CDN), render delay 29 → observed LCP ≈ 0.56 s. Lighthouse's Lantern simulation then stretches it to 6.9 s because every request in flight before the LCP paint counts as a predecessor: at 1.6 Mb/s the ~480 KB gzip of High-priority `modulepreload` JS (+ CSS 70 KB, fonts 45 KB, logo 6–27 KB, 4 non-LCP slider/card images at Low ≈ 90 KB) must drain before/alongside the hero image. **Conclusion: on PSI mobile, LCP is bandwidth contention of boot JS + non-critical images against the hero image; removing/deferring/deprioritising those bytes is the lever (not only hydration).**
- Request order in the local mobile run (prio): document → styles.css VeryHigh → 2 fonts High → `pl` dict + 8 widget chunks + 9 boot chunks + stray chunks (index-DkTT, blog.index, headings, Footnotes, useInFeedAds, prepareContent, eventInvoiceMath) ALL High at t≈22 ms → LCP image High at 27 ms + logo + avatars High → 4 more slider/card images Low at 115 ms → **post-boot wave at 175–250 ms: ~25 more chunks at High** (vendor-lucide, vendor-dompurify, vendor-radix 34 KB, `admin.users-*.js`, `events._slug_.cfp-submit`, `author._slug`, `cfpSettingsDraft`, `eventInvoiceMath`, `MoneyText`, `useVoiceSearch`, `facetModel`, `archives`, `i18n-search`, `noteContext`, second dictionary `pl-CmOdyKxs.js`, AccordionWidget, PostListCard, SponsoredBadge, ArchivePagination, RichHtmlView…) → then 15 PostgREST fetches with preflights. The post-boot wave shows **chunk-graph fragmentation**: lazy widgets pull tiny shared chunks named after unrelated routes (admin.users, events cfp, author) because shared modules are placed in chunks named by their first importer (`experimentalMinChunkSize: 512`, `hoistTransitiveImports: false`). 106 requests total on "/" locally, 121 on production.
- Full data: `scratchpad/lh/results/baseline-mobile-1.summary.txt`, `baseline-desktop-1.summary.txt`.
