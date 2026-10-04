export const meta = {
  name: "pagespeed-phase1-diagnose-design",
  description:
    "PageSpeed 85/95: ten parallel diagnosis+design workstreams on origin/main, adversarial verification of each proposed change, integrated plan + completeness critique",
  phases: [
    {
      title: "Diagnose",
      detail: "8 workstreams + Lighthouse analyst + prior-art auditor (Opus, read-only)",
    },
    {
      title: "Verify",
      detail: "two adversarial lenses per proposed change (feasibility, effect realism)",
    },
    {
      title: "Synthesize",
      detail: "integrated plan with waves and file ownership, then completeness critic",
    },
  ],
};

const SCRATCH =
  "/private/tmp/claude-501/-Users-igormiasnikow-Documents-GitHub-neweustrategies-dc633fb5/4193afc7-12e8-408f-90bd-72423fed6163/scratchpad";
const WT = SCRATCH + "/perf-main";
const EVIDENCE = SCRATCH + "/EVIDENCE.md";
const OUTDIR = SCRATCH + "/phase1";

const COMMON = `
You are a senior web-performance engineer (Opus) working under a Fable 5.1 orchestrator on a TanStack Start + React 19 + Vite 7 + Nitro (Cloudflare Workers) + Supabase content platform. Goal: PageSpeed/Lighthouse 13 **mobile >= 85, desktop >= 95** on https://neweuropeanstrategies.com/ (currently 53 / 70 on PSI).

FIRST read the evidence pack: ${EVIDENCE} (it has all measured numbers, tool paths, environment rules, and what the team already did). Then read the team's own analysis: ${WT}/docs/performance/2026-10-02-pagespeed-przyczyny.md (sections relevant to you) — do not re-derive what is already measured there; extend it.

Code to analyse: the worktree ${WT} (branch perf/pagespeed-mobile85-desktop95 = origin/main). A production-parity build already exists there: ${WT}/.output (smoke/node-server artifact) and ${WT}/reports/chunk-inventory.json. Production HTML sample: ${SCRATCH}/psi/home.html; production Lighthouse JSON: ${SCRATCH}/lh/prod-mobile.json and prod-desktop.json (summaries *.summary.txt; summarizer ${SCRATCH}/lh/lh-summary.py).

RULES
- This phase is DIAGNOSIS + DESIGN. Do NOT edit files in ${WT} (exception noted in your mandate if any). You may run read-only commands, Lighthouse against production or against the local artifact (${SCRATCH}/lh/measure-local.sh ${WT} <your-label> 1), inventory reports (\`bun run report:chunk-inventory <chunk> --modules\` in ${WT} with PATH prefixed by ${SCRATCH}/tools/node_modules/.bin), Chrome DevTools-style experiments via Lighthouse flags, and python/node analysis scripts written under ${OUTDIR}/<your-key>/.
- Builds: avoid. If an experiment truly needs a build, do it in your OWN throwaway git worktree (git worktree add ${SCRATCH}/exp-<key> origin/main; copy ${WT}/.env; bun install --frozen-lockfile) and hold the mutex (mkdir ${SCRATCH}/.build-lock; rmdir when done; wait while it exists). Max one build at a time machine-wide. Remove your worktree when done.
- Timing numbers measured while other agents run are noisy; use them for structure (what loads, when, sizes, priorities), not for benchmarking.
- Every finding must cite file:line in ${WT} (or a measured artifact). Every proposed change must state: exact files, mechanism, which Lighthouse metric it moves and by roughly how much (with the basis for the estimate), risk, repo gates/tests it touches (check:bundle, check:chunks, check:entry-purity, check:ssr-budgets, check:loader-policy, chunk parity, noHasSelectors, SSR/hydration parity tests), and how to verify (which measurement proves it worked).
- Respect repo doctrine documented in code comments (chunk-cycle incident 2026-07-20, no manualChunks on server env, setTimeout(0) before hydrate, SSR HTML parity for chrome). Prefer changes that are structural and durable (with a CI gate) over one-off tweaks.
- Think about Lighthouse's simulated throttling model (mobile: 1.6 Mb/s, 150 ms RTT, 4x CPU; desktop: 1x CPU on a slow PSI host) — bandwidth contention and main-thread blocking are what score.
- Write your FULL report (markdown, with tables, code excerpts, measurements, and the ordered change list) to ${OUTDIR}/<your-key>.md (create the directory). The structured output you return must be consistent with that file and name it in report_path. Return data, not prose for a human.
`;

const WORKSTREAMS = [
  {
    key: "boot-js",
    title: "Boot JavaScript closure and preload hygiene",
    mandate: `
Own: everything the browser must download+parse+execute before hydration starts, and what is preloaded before first paint.
Questions to answer with evidence:
1. Exact composition of the entry chunk (index-*.js, 1395 kB pre-minify) by module, grouped by "needed for first interaction on a public page" vs "admin/club/profile/events/editor" vs "framework". Use chunk-inventory (--modules). Identify the import edges that drag each big group in (who imports lib/builder 158 kB, components/builder 189 kB, lib/queries, lib/seo, lib/ads, lib/analytics, lib/newsletter, megaMenu, header/TrendingTicker, routeTree.gen 61 kB with 567 dynamic imports).
2. Why vendor-supabase (224 KB raw) is in the boot closure for an anonymous reader (114 importers): design a lazy client (proxy/thunk) that only loads the real SDK when a query actually executes on the client or when a session exists; what breaks (AuthProvider, headerTickerQuery, realtime). Same for vendor-zod (16 boot importers) and the i18n dictionary top-level await.
3. Preload hygiene: the Link header + head carry stray chunks (admin.analytics-*, blog.index, EventPortalContent, Footnotes, useInFeedAds, prepareContent, PaginatedPostGrid, headings, two index-*.js). Trace how src/lib/http/frameworkPreloads.server.ts + TanStack manifest produce them (route "/" static imports; shared chunks named after first importer) and design the fix (import structure or filtering). Decide which modulepreloads should exist at all before first paint on mobile given 1.6 Mb/s (646 KB gzip today) — propose a policy: boot closure preloaded; route widgets preloaded only above-the-fold; everything else after load.
4. Design target: boot closure <= ~250 KB gzip / <= 800 KB raw; entry <= 120 KB gzip; no admin/editor/club code reachable statically from entry. Give an ordered list of concrete refactors (route group lazy-loading by prefix, builder dispatcher split into chrome-only vs content, lazy supabase, lazy zod schemas, dictionary namespaces) each with measured module bytes and the dependency edges to cut.
5. Vite preload helper inserting 44 <link rel=modulepreload> after boot: assess cost and whether build.modulePreload.resolveDependencies / polyfill settings should change.
`,
  },
  {
    key: "hydration",
    title: "Hydration cost, deferred-hydration islands and the post-hydration storm",
    mandate: `
Own: the main-thread work from the moment the entry executes to TTI: hydrateRoot of ~1333 elements / ~48 widgets / mega menus / footer, and everything the app does right after hydration.
1. Measure/derive how hydration time splits across header (mega menus, ticker), hero/first fold, below-the-fold sections, footer. Read src/components/builder/organisms/* (BuilderRenderer, WidgetView, SimpleWidgets, lazyWidgets, lazySuspense), SiteChrome/Header/Footer, routes/__root.tsx and routes/index.tsx.
2. Design "deferred hydration islands": React 18/19 selective hydration leaves server HTML in place for a Suspense boundary whose lazy component has not loaded yet; propose wrapping below-the-fold sections (and heavy chrome parts like mega-menu panels) so their chunk import is triggered only by IntersectionObserver / first interaction / idle, keeping the SSR HTML visible and interactive-looking. Check how the repo's existing streamed boundaries and \`lazySuspense\` interact (16 boundaries stream today), CLS risk, SEO parity, and the SSR budget machinery (hasSsrQueryData, homeSsrDeadline). Specify exact components and the trigger policy.
3. Post-hydration storm: enumerate every network request and DOM mutation after hydration on "/" (production LH shows 15 PostgREST fetches + 6 preflights: categories, tags, site_design_tokens, post_layout_settings, ad_placements, builder_popups, newsletter...; 44 modulepreload link insertions; <style> text swaps; image src rewrites; input attr rewrites). For each: which query/effect fires it (file:line), whether SSR already had the data (seeds with updatedAt: 0 / dataUpdatedAt), and the fix (dehydrate with proper dataUpdatedAt / staleTime from SSR render time; move categories/tags to on-demand; avoid preflights by using simple requests; batch). Target: zero network requests from the app in the first 5 s after hydration for an anonymous reader except user-triggered ones.
4. Overlays mounted eagerly: ConsentBanner (+radix 112 KB, sonner 35 KB, icons-0 103 KB, JoinUsForm, NewsletterDocRenderer, TopicsDroplist, popups, useUnsavedChangesGuard): which are needed for anonymous first visit and when; design strict gating (consent banner shell SSR'd with a pre-paint script toggling visibility; interactive part loads after first interaction).
5. Long tasks map: for both production LH reports, list long tasks (time, duration, attribution) and map each to a cause.
`,
  },
  {
    key: "html-weight",
    title: "HTML document weight: dehydrated state, inline CSS, header, markup",
    mandate: `
Own: bytes of the SSR document for "/" (569 KB raw / 78 KB gzip today; target <= 200 KB raw / <= 35 KB gzip) and its parse cost.
1. Dehydrated router state (\`$tsr-stream-barrier\`, 107 KB): decode it (python; ${SCRATCH}/psi/barrier.js) and attribute bytes to loaders/queries: header/footer builder documents, 46 menu rows x ~46 fields (mega_config, desktop/tablet/mobile, label_pl/label_en, css_class...), post lists repeated 4x, site settings, design tokens, ticker. Find in code (routes/__root.tsx loader, lib/builder/prefetch.ts, lib/queries/public.ts, lib/views/headerTickerQuery.ts, useSiteSetting, menus) what the client actually needs after hydration and design a trimmed shape (select lists, server-side projection, dedupe posts by id, strip other-language labels, drop mega_config for items without mega, do not dehydrate what is re-derivable). Quantify savings per item.
2. The 18.6 KB react-query stream and the other 13 inline scripts (JSON-LD 3.4 KB footer nav, speculationrules 2.3 KB, GA snippet, theme/dock/boot-probe): what can move to external cacheable files or shrink.
3. 133 KB inline CSS in 51 <style> blocks (26.6 KB global colour tokens, 14.9 KB trending, 11 KB slider, per-widget [data-w-id] overrides with 121 !important): classify each block (static per widget type vs instance-specific). Design: static parts into Vite CSS chunks loaded with the widget (or into styles.css), instance parts as CSS custom properties on the element (one short style attr) — remove triple-specificity selectors. Check React 19 <style href precedence> hoisting as used by sliderVariants. Expected savings in raw/gzip and in parse.
4. <header> 103 KB: what is rendered (mega menu panels for 46 items, hidden), 14 <style> blocks, inline SVGs; design on-demand rendering of mega panels (render first-level only on server; panels on hover/focus/touch via lazy) while keeping SEO links present (e.g. a compact <nav> in footer/sitemap) and no CLS. <footer> 37 KB likewise.
5. Markup: 72 srcset attrs (70 KB, ~5 candidates each): propose fewer candidates matched to real slot widths; 56 inline <svg> (dedupe via <symbol>/<use> or CSS mask); 63 KB class attrs / 52 KB style attrs (Tailwind class soup from builder props: can repeated widget variants share a class?); 4 duplicate LCP preload <link>s + logo preload.
6. Produce a byte budget table: today -> proposed, per component, with gzip estimates (measure by actually transforming the saved HTML in python where possible).
`,
  },
  {
    key: "css",
    title: "Render-blocking CSS and style pipeline",
    mandate: `
Own: styles-*.css (537 876 B raw / 78.6 KB gzip, render-blocking on every URL), admin-styles.css split, Tailwind 4 config, src/styles.css (8 900 lines), and animation compositing.
1. Measure composition of the built stylesheet: by @layer, by feature area (public chrome, builder widgets, posts/prose, clubs, profile, dock/chat, checkout/forms, admin leftovers, keyframes, @supports blocks), and the used vs unused share on "/" and on a post page (run Lighthouse with --only-audits=unused-css-rules or Chrome coverage via Lighthouse artifacts; use the local artifact).
2. Design the split: public core (<= 150 KB raw / <= 30 KB gzip render-blocking), module sheets loaded with their route/widget chunks (Vite CSS code splitting: CSS imported from lazy modules becomes its own file loaded by the preload helper — check how adminCssPlugin.ts already does this and the \`check:bundle\` CSS budgets), and a critical-CSS strategy for first paint (inline the above-the-fold subset <= 14 KB and load the rest non-blocking with preload+onload swap, or keep one small blocking core). Evaluate Tailwind source globbing (@source / content) so admin-only utilities stop landing in the public sheet.
3. The 51 inline <style> blocks (coordinate with html-weight workstream: you own the CSS architecture, they own the document bytes): propose the target mechanism (per-widget static CSS files via lazy chunk CSS, instance values via custom properties).
4. Non-composited animations: ConsentBanner enter animation uses a filter property; slider/card images animate opacity+scale with transitions; find all animations/transitions that run during load (keyframes in styles.css, tw-animate-css) and make them compositor-only or remove them during the load window.
5. Fonts: Red Hat Display latin + latin-ext preloaded (45 KB); check subsetting, unicode-range, whether both are needed above the fold for PL, font-display, and whether system-font fallback metrics (size-adjust) are set to avoid layout shift.
6. Provide the exact file-level plan (styles.css sections to move, Vite/Tailwind config changes, rootHead.ts link changes) and the measurement that proves FCP improvement.
`,
  },
  {
    key: "lcp-path",
    title: "LCP/FCP critical rendering path and resource priorities",
    mandate: `
Own: the time from TTFB to LCP paint on mobile and desktop: resource discovery, priorities, bandwidth contention, render gating.
1. Hero image: src/lib/builder/sliderVariants.tsx FillImage (lines ~310-395): the LCP <img> ships with fetchpriority="low" / "auto" vs "high" depending on priority&&active, opacity 0->1 transition, and the production LH shows the LCP node with fetchpriority="low" and style="opacity: 0;" — determine exactly which slide element becomes LCP and why it is not the active one with priority high (SSR vs client idx, alwaysVisible, how PostsSliderWidget passes priority; look at how the home route decides builderHeroPreload). Design: the active first slide must be in the first HTML flush with fetchpriority=high, loading=eager, opacity 1 (no JS needed to paint), correct sizes; other slides must not be fetched at all before interaction (no src/srcset until needed) — verify no CLS and the crossfade still works after hydration.
2. Preload correctness: 4 identical <link rel=preload as=image imagesrcset> in head + 1 in Link header; preload imagesizes "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw" vs img sizes "(max-width: 767px) 100vw, (max-width: 1023px) 50vw, 50vw" -> different candidates on desktop (wasted preload + double download). Find the generators (lib/seo/meta.ts imagePreloadLink, lib/builder/heroImage.ts builderHeroPreload, lib/cardImageSizes.ts, routes/index.tsx) and specify the single source of truth for sizes. Also 7 images with fetchpriority=high: only the LCP should be high.
3. Bandwidth model on mobile (1.6 Mb/s): list in order what the browser fetches before LCP today (HTML 78-84 KB gz, CSS 78.6 KB, 2 fonts 45 KB, logo svg 27 KB, LCP image 38 KB@768w, 9 boot modulepreloads ~480 KB gz, 8 widget preloads ~30 KB, stray chunks) with priorities from prod-mobile.json network-requests; compute the critical bytes and propose the priority/ordering policy that gets the LCP image and CSS first (e.g. modulepreload only the entry + react in head, rest via Link after first paint or lower priority; logo inline SVG; fewer fonts) and estimate LCP/FCP on the simulator.
4. Consent banner as late LCP candidate / SI contributor: how it mounts (routes/__root.tsx lazy ConsentBanner, whenIdle), its size on mobile, whether its paragraph can become LCP; design an SSR'd shell with a pre-paint visibility script (like THEME_INIT_SCRIPT) so it paints with FCP, or constrain its size so it is never the largest element.
5. Early Hints (103) on Cloudflare for CSS/fonts/LCP image (Cloudflare emits Early Hints from cached Link headers when enabled) — feasibility with the document cache; Speculation Rules eagerness (ensure no prefetch during load on mobile); /media Accept negotiation (AVIF) and quality for the hero variants; logo SVG 27 KB.
6. Speed Index: from the filmstrip in the LH JSON, what paints late (images with opacity transitions? streamed sections? fonts swap?) and the fixes.
Return the ordered change list with expected LCP/FCP/SI deltas per form factor.
`,
  },
  {
    key: "server-cache",
    title: "TTFB, document cache and the MISS path",
    mandate: `
Own: time to first byte for "/" and other public routes from any region (PSI runs from Google datacenters), the Workers document cache, and the query waves on MISS.
1. Read src/server.ts, src/lib/http/documentCache.server.ts (1155 lines), src/lib/http/cachePolicy.ts, src/lib/ssr/*, routes/__root.tsx loader, routes/index.tsx loader, lib/builder/prefetch.ts, scripts for warmers (scripts/warm-edge-cache.mjs if present, .github workflows) and explain precisely: cache key, storage (Cache API per colo? KV?), freshness (3 min?), stale-while-revalidate behaviour, single-flight, purge on publish, why observed x-nes-cache-age is always ~106-130 s, under what conditions a MISS render is NOT stored (degraded budgets), and why MISS TTFB is 1.3-3.3 s (23 queries: list them and their serial waves; server-timing ssr 662 / db 2029 / app 942 / edge-routing 280).
2. Design to make MISS rare and fast: (a) longer freshness with event-driven purge (publish hooks already exist?) + stale-while-revalidate for minutes/hours, background revalidation after serving stale; (b) a cross-colo snapshot layer (KV or R2 or Cache Reserve / tiered cache) so a PSI request from a US colo is served from a snapshot rendered elsewhere; (c) collapse query waves into one bootstrap RPC / parallel waves with a shared L2 snapshot for settings/tokens/menus/ticker; (d) warmers from EU+US on a schedule and after deploy; (e) ensure bot UAs and Lighthouse never bypass. Quantify target: HIT ratio > 97 % for "/", MISS TTFB < 800 ms, HIT TTFB < 200 ms.
3. Browser cache-control for the document (no-cache, must-revalidate, max-age=0): bfcache implications; whether a short browser max-age or stale-while-revalidate is safe for anonymous readers; set-cookie __cf_bm presence (Cloudflare bot management cookie prevents some caching?).
4. HTTP: check brotli vs gzip for the document (curl got gzip; verify what Chrome gets), HTTP/2 vs HTTP/3, Early Hints feasibility (coordinate with lcp-path), Link header size (~4 KB per response).
5. Measurement: how to observe cache status and server timing in production from Lighthouse JSON / curl and how to add logging (Workers logs) — minimal, privacy-safe.
Return the ordered change list with expected TTFB deltas and risks (editorial freshness, memory limits of Workers, cost).
`,
  },
  {
    key: "third-party",
    title: "Third-party and post-load main-thread policy",
    mandate: `
Own: everything that runs on the main thread after hydration that is not the reader's intent: gtag.js x2 (G-EN05JH34VP + AW-17612160320, 370 KB transfer, ~300 ms CPU mobile, loaded ~5.8 s under src/lib/analytics/gtagLoadPolicy.ts), /~flock.js (Lovable analytics, 21 KB defer), ConsentScriptInjector, IconPackSync, AuthProvider session resolution, realtime for anon, sonner, speculation rules, observability/web-vitals, user-timing marks (99 on mobile), service workers if any.
1. Reconstruct the timeline of these on the production LH traces (prod-mobile.json / prod-desktop.json: network-requests, long-tasks, bootup-time, third-party-summary, user-timings) and quantify their contribution to TBT/TTI on each form factor. Note Lighthouse never interacts and TTI is ~10 s today, so "after load + quiet" policies still land inside the TBT window.
2. Design the loading policy for the Google tag that (a) never executes before the page is idle AND past TTI-like quiescence (e.g. no long task for >= 5 s and >= N s after load) for users without an interaction, (b) loads immediately on first interaction or explicit consent decision, (c) loads only the GA4 tag for users who have not granted marketing consent (Ads tag only with ad consent), (d) keeps Consent Mode semantics and the dataLayer queue (document the trade-off: sessions that bounce before any interaction send no page_view; consider a server-side page_view via Measurement Protocol as mitigation — design only). Check the current policy's code paths and tests (src/lib/analytics/__tests__/gtagLoadPolicy.test.ts) and propose exact changes.
3. /~flock.js: what it is (Lovable platform analytics injected by the host?), whether it can be removed/deferred/self-hosted with long cache, and its CPU cost.
4. Anonymous-reader cost of Supabase auth/session resolution and realtime: when does AuthProvider hit storage/network, can it be deferred to idle without flashing logged-in UI (coordinate with boot-js on lazy client).
5. User-timing marks (99) and the boot probe: cost and whether to sample.
6. Provide an ordered change list with TBT deltas (mobile and slow desktop) and the measurement that proves it (Lighthouse long-tasks / bootup-time attribution).
`,
  },
  {
    key: "measurement",
    title: "Measurement harness, budgets and CI gates",
    mandate: `
Own: making every later change provable. You MAY add NEW files under ${WT}/scripts/performance/ and ${WT}/docs/performance/ (no edits to existing files; follow repo conventions: Polish comments/docs, TypeScript strict, no new dependencies).
1. Productize the local harness: scripts/performance/lighthouse-local.mjs that (a) optionally builds the smoke artifact, (b) starts .output/server/index.mjs with env from .env (or the fixture via replayFetch.mjs when NES_PERFORMANCE_FIXTURE=1), (c) fronts it with a brotli proxy (port from the existing ${SCRATCH}/lh/br-proxy.mjs logic), (d) runs Lighthouse mobile and desktop N times with PSI-identical settings (the repo has lighthouse via @lhci? check node_modules; if lighthouse is not a dependency, document using npx lighthouse@13 and keep the script dependency-free), (e) prints medians and a diff against a saved baseline JSON (reports/lighthouse-local-baseline.json), (f) dumps the audits that matter (network requests with priorities, long tasks, bootup, unused JS, LCP breakdown, render-blocking). Use ${SCRATCH}/lh/measure-local.sh and lh-summary.py as the starting point. Verify it runs end-to-end in ${WT} (do NOT run a build; the artifact exists) and record the baseline numbers it produces.
2. Document-weight gate design: a script that renders "/" from the artifact (fixture backend) and asserts byte budgets: HTML raw/gzip, inline <style> bytes and count, inline <script> bytes, number of <link rel=modulepreload>, number of preload duplicates, boot closure raw bytes (extend check-bundle-size.ts semantics: it already computes bootRaw but does not gate it). Specify thresholds as a ratchet from today's numbers.
3. CI: how to turn on Lighthouse mode A (vars.LHCI_URL) for mobile against the deployed URL (.github/workflows/lighthouse.yml, lighthouserc.deployed.mobile.json), and what the first measured floor should be; PSI API usage with a key (quota) as an alternative.
4. Production observability: a simple script (scripts/performance/psi-probe.mjs or curl recipe) to sample x-nes-cache / server-timing from several regions (e.g. via Cloudflare colo hints, or by running Lighthouse in headless Chrome from this machine) — design only if it needs infra.
5. Return: the list of files you created, how to run them, the baseline numbers, and the proposed budgets.
`,
  },
  {
    key: "lighthouse-analyst",
    title: "Trace-level analysis of the production and baseline Lighthouse reports; score model",
    mandate: `
Own: the quantitative model of where every millisecond goes and what combination of improvements reaches 85/95.
1. Parse ${SCRATCH}/lh/prod-mobile.json and prod-desktop.json in depth (python): network-requests timeline with priorities, render-blocking, critical request chains / network-dependency-tree, main-thread breakdown, bootup-time per script, long-tasks with attribution and start times, LCP element + breakdown, screenshot-thumbnails (filmstrip) for Speed Index, user-timings, diagnostics (numRequests, totalByteWeight, mainDocumentTransferSize), script-treemap-data if present (unused bytes per module!), third-party-summary, dom-size, non-composited-animations, forced reflow. Also parse the local baseline runs ${SCRATCH}/lh/results/baseline-*.json when they exist (check ${SCRATCH}/lh/results-baseline.log for MEDIAN lines; if the run is not finished, proceed and note it).
2. Build the mobile and desktop timelines: TTFB -> HTML download -> CSS -> FCP -> LCP -> hydration -> TTI, with bytes and ms per stage, and attribute TBT to tasks (parse HTML/CSS long tasks, module evaluation, hydration, post-hydration effects, gtag, consent banner).
3. Score model: using Lighthouse 13 scoring curves (log-normal; mobile p10/median: FCP 1800/3000, SI 3387/5800, LCP 2500/4000, TBT 200/600, CLS 0.1/0.25; desktop: FCP 934/1600, SI 1311/2300, LCP 1200/2400, TBT 150/350) compute the current score decomposition and the metric targets needed for 85 (mobile) and 95 (desktop); give 2-3 feasible target combinations.
4. Attribute each ms of TBT and each KB on the critical path to one of the workstreams: boot-js, hydration, html-weight, css, lcp-path, server-cache, third-party — so the synthesis can prioritise by score impact. Note explicitly which PSI diagnostics (forced reflow, non-composited animation, 99 user timings, cache TTL, image delivery) are cosmetic vs score-relevant.
5. Highlight anomalies: e.g. desktop TBT 740 ms on PSI vs 0 ms on an M3 Pro (what does that imply about CPU scaling of our JS?), SI 7.1 s on my local mobile run vs 4.9 s on PSI, the FCP->LCP gap on PSI mobile (3.1 -> 6.6 s) vs local (3.5 -> 5.4 s).
`,
  },
  {
    key: "prior-art",
    title: "Prior art audit: what the team already did, planned, abandoned; gates and constraints",
    mandate: `
Own: institutional memory so the plan builds on main instead of colliding with it.
1. Read in ${WT}: docs/AUDYT_CWV_ZIMNE_OTWARCIE_2026-09-20.md (40 findings F01-F40, §8 plan, §8.1/8.2 status), docs/performance/2026-09-30-critical-boot.md, 2026-10-01-first-visit.md, 2026-10-01-first-visit-lcp-streaming.md, 2026-10-02-pagespeed-przyczyny.md, docs/performance/README.md, docs/POPUP_FIRST_RENDER_2026-09-29.md, docs/CMS_WIDGET_PERFORMANCE_2026-09-12.md, docs/HOMEPAGE_COLD_SSR_2026-09-05.md, and \`git log --since=2026-09-19 --format='%h %ad %s' --date=short\` filtered for perf/ssr/cache/chunk/preload/hydration/lighthouse/consent/gtag/css commits (read the bodies of the important ones: 81d84b1f, b006c2ec, eeb6de8e, 32010f8a, 6658bf38, 478cd758, f884ad32, 3d939fad, 1488dfe9, fa678903).
2. Produce: (a) table of every performance finding/plan item from those docs with status DONE / PARTIAL / PLANNED / ABANDONED and the commit/PR that did it; (b) the list of ALL perf-related CI gates and tests (name, script, what it asserts, current state on main — note check:bundle is red on main today), and the documented "do not touch" constraints with their reasons; (c) things tried that regressed or were reverted; (d) in-flight work on other branches that may collide (git branch -r --sort=-committerdate | head -30 and recent PR titles if gh is available).
3. Map each remaining planned item to our workstreams (boot-js, hydration, html-weight, css, lcp-path, server-cache, third-party, measurement) and flag items where the team's plan and the evidence pack disagree.
4. Extract the repository's working conventions relevant to implementation agents: commit message style (Polish, imperative?), where to document (docs/performance/<date>-*.md), test expectations (vitest gates per change), formatting (prettier), how the team records bundle budget moves (kronika in scripts/check-bundle-size.ts), how they measure before/after.
`,
  },
];

const WS_SCHEMA = {
  type: "object",
  properties: {
    key: { type: "string" },
    report_path: { type: "string" },
    summary: { type: "string", description: "<= 150 words, the diagnosis in numbers" },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          claim: { type: "string" },
          evidence: { type: "string", description: "file:line refs and/or measured numbers" },
          metric: { type: "string" },
          severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
        },
        required: ["id", "claim", "evidence", "metric", "severity"],
      },
    },
    changes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          files: { type: "array", items: { type: "string" } },
          mechanism: { type: "string" },
          metric: { type: "string" },
          expected_effect: { type: "string" },
          estimate_basis: { type: "string" },
          risk: { type: "string", enum: ["low", "medium", "high"] },
          risk_notes: { type: "string" },
          gates: { type: "array", items: { type: "string" } },
          verification: { type: "string" },
          depends_on: { type: "array", items: { type: "string" } },
          effort: { type: "string", enum: ["S", "M", "L", "XL"] },
        },
        required: [
          "id",
          "title",
          "files",
          "mechanism",
          "metric",
          "expected_effect",
          "estimate_basis",
          "risk",
          "gates",
          "verification",
          "effort",
        ],
      },
    },
    conflicts_with_other_workstreams: { type: "array", items: { type: "string" } },
    open_questions: { type: "array", items: { type: "string" } },
  },
  required: ["key", "report_path", "summary", "findings", "changes"],
};

const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    change_id: { type: "string" },
    lens: { type: "string" },
    verdict: { type: "string", enum: ["confirmed", "weakened", "refuted"] },
    reasoning: { type: "string" },
    corrected_estimate: { type: "string" },
    blocking_issues: { type: "array", items: { type: "string" } },
    better_alternative: { type: "string" },
  },
  required: ["change_id", "lens", "verdict", "reasoning", "blocking_issues"],
};

const LENSES = [
  {
    name: "feasibility",
    prompt:
      "LENS = FEASIBILITY/CORRECTNESS IN THIS CODEBASE. Read the actual files named by the change (and their importers/tests). Try to REFUTE that the mechanism works as described: hidden import edges, SSR/hydration parity breaks, chunk-graph cycles, gate violations (check:bundle, check:chunks, check:entry-purity, check:ssr-budgets, check:loader-policy, noHasSelectors), behaviour regressions for logged-in users/editors, i18n/SEO regressions, CLS. Default to weakened/refuted if the code contradicts the claim. Give the file:line that decides.",
  },
  {
    name: "effect",
    prompt:
      "LENS = EFFECT REALISM ON THE LIGHTHOUSE SCORE. Using the evidence pack numbers and Lighthouse simulation semantics (mobile 1.6 Mb/s + 150 ms RTT + 4x CPU; desktop 1x CPU on a slow PSI host; TBT counts only tasks before TTI; LCP needs discovery + download + render), try to REFUTE the claimed effect size and the metric attribution. Is the resource actually on the critical path? Would the bytes/ms saved translate into score points? Is there a cheaper change with the same effect? Provide a corrected estimate with your arithmetic.",
  },
];

function wsPrompt(w) {
  return `${COMMON}
YOUR WORKSTREAM KEY: ${w.key}
TITLE: ${w.title}
MANDATE:
${w.mandate}
Report file: ${OUTDIR}/${w.key}.md . Return the structured summary (key = "${w.key}").`;
}

function verifyPrompt(w, r, c, lens) {
  return `You are an adversarial reviewer (Opus) for a web-performance plan. Context pack: ${EVIDENCE}. Code: ${WT} (read-only). Workstream "${w.key}" full report: ${r.report_path}.
${lens.prompt}
THE CHANGE UNDER REVIEW:
${JSON.stringify(c, null, 2)}
Related findings from the same workstream (for context): ${JSON.stringify(r.findings.slice(0, 12))}
Do the work: open the files, trace imports (grep), check tests and gates, run read-only commands. Do NOT edit the repository. Return the verdict for change_id="${c.id}", lens="${lens.name}".`;
}

phase("Diagnose");
log(
  `Launching ${WORKSTREAMS.length} diagnosis workstreams (Opus, high effort); each proposed change then gets 2 adversarial lenses.`,
);

const verified = await pipeline(
  WORKSTREAMS,
  (w) =>
    agent(wsPrompt(w), {
      label: `ws:${w.key}`,
      phase: "Diagnose",
      schema: WS_SCHEMA,
      model: "opus",
      effort: "high",
    }),
  (r, w) => {
    if (!r) {
      log(`workstream ${w.key} returned nothing`);
      return null;
    }
    const top = (r.changes || []).slice(0, 5);
    log(
      `${w.key}: ${r.findings.length} findings, ${r.changes.length} changes; verifying top ${top.length} x 2 lenses`,
    );
    return parallel(
      top.flatMap((c) =>
        LENSES.map(
          (lens) => () =>
            agent(verifyPrompt(w, r, c, lens), {
              label: `verify:${w.key}:${c.id}:${lens.name}`,
              phase: "Verify",
              schema: VERDICT_SCHEMA,
              model: "opus",
              effort: "high",
            }),
        ),
      ),
    ).then((vs) => ({ key: w.key, result: r, verdicts: vs.filter(Boolean) }));
  },
);

const good = verified.filter(Boolean);
log(
  `Diagnosis complete: ${good.length}/${WORKSTREAMS.length} workstreams; ${good.reduce((n, g) => n + g.verdicts.length, 0)} verdicts.`,
);

phase("Synthesize");
const compact = good.map((g) => ({
  key: g.key,
  report_path: g.result.report_path,
  summary: g.result.summary,
  findings: g.result.findings,
  changes: g.result.changes.map((c) => ({
    ...c,
    verdicts: g.verdicts
      .filter((v) => v.change_id === c.id)
      .map((v) => ({
        lens: v.lens,
        verdict: v.verdict,
        corrected_estimate: v.corrected_estimate,
        blocking_issues: v.blocking_issues,
        better_alternative: v.better_alternative,
      })),
  })),
  conflicts: g.result.conflicts_with_other_workstreams,
  open_questions: g.result.open_questions,
}));

const PLAN_SCHEMA = {
  type: "object",
  properties: {
    plan_path: { type: "string" },
    targets: {
      type: "object",
      properties: { mobile: { type: "string" }, desktop: { type: "string" } },
    },
    waves: {
      type: "array",
      items: {
        type: "object",
        properties: {
          wave: { type: "integer" },
          goal: { type: "string" },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                workstream: { type: "string" },
                title: { type: "string" },
                files: { type: "array", items: { type: "string" } },
                expected_effect: { type: "string" },
                risk: { type: "string" },
                depends_on: { type: "array", items: { type: "string" } },
                parallel_group: { type: "string" },
                effort: { type: "string" },
              },
              required: [
                "id",
                "workstream",
                "title",
                "files",
                "expected_effect",
                "risk",
                "parallel_group",
                "effort",
              ],
            },
          },
          expected_scores_after: { type: "string" },
        },
        required: ["wave", "goal", "items"],
      },
    },
    file_ownership: {
      type: "array",
      items: {
        type: "object",
        properties: {
          path_pattern: { type: "string" },
          owner_item_ids: { type: "array", items: { type: "string" } },
        },
        required: ["path_pattern", "owner_item_ids"],
      },
    },
    dropped_or_deferred: { type: "array", items: { type: "string" } },
    decisions_for_human: { type: "array", items: { type: "string" } },
  },
  required: ["plan_path", "waves", "file_ownership", "decisions_for_human"],
};

const plan = await agent(
  `You are the planning lead (Opus, maximum rigour). Integrate ten diagnosis reports into ONE implementation plan that reaches Lighthouse mobile >= 85 and desktop >= 95 for https://neweuropeanstrategies.com/ with world-class engineering quality (durable mechanisms + CI gates, not hacks).
Inputs: evidence pack ${EVIDENCE}; the team's own plan ${WT}/docs/performance/2026-10-02-pagespeed-przyczyny.md §9; the workstream reports (read each report_path fully) and their adversarially-verified change lists below (verdicts: confirmed/weakened/refuted with corrected estimates — drop refuted changes unless you can argue the refutation is wrong, and use corrected estimates).
${JSON.stringify(compact)}
Produce ${OUTDIR}/PLAN.md (Polish, the repo's house language for docs, with English identifiers) containing:
1. Root-cause statement (ranked by score impact, with numbers) and the score model (which metric targets we are engineering for, per form factor).
2. Waves of work ordered by effect/risk with explicit parallelism: Wave 1 = highest-impact low-risk items that do not conflict in files; later waves build on them. For each item: id, workstream, title, exact files, mechanism (2-5 sentences), expected effect with basis, risk + mitigation, gates/tests to add or keep green, verification command/measurement, depends_on, parallel_group (items in the same group must not be implemented concurrently because they touch the same files).
3. A file-ownership matrix so implementation agents can work in parallel worktrees without merge conflicts.
4. Cumulative expected score trajectory after each wave (mobile/desktop), honest about uncertainty.
5. Items deliberately dropped/deferred and why; decisions that need the human (analytics policy, cache TTL vs editorial freshness, consent UX, removing /~flock.js, etc.).
6. Definition of done for the whole effort: local medians + production PSI confirmation protocol.
Return the structured plan (same content, compact).`,
  {
    label: "synthesis:plan",
    phase: "Synthesize",
    schema: PLAN_SCHEMA,
    model: "opus",
    effort: "xhigh",
  },
);

const critique = await agent(
  `You are the completeness critic (Opus). Read ${EVIDENCE}, ${plan.plan_path}, and every report in ${OUTDIR}/*.md. Answer: what is MISSING or WRONG in the plan for reaching mobile 85 / desktop 95 on PSI? Check: (1) every byte/ms bucket in the evidence pack has an owner item or an explicit drop; (2) the score arithmetic closes (sum of expected effects actually reaches the metric targets with margin, considering PSI's slow desktop host and Lighthouse simulation); (3) no two parallel items touch the same files; (4) each item has a measurable verification; (5) risks to logged-in users/editors/SEO/i18n/CLS are addressed; (6) anything the production evidence shows that no workstream explained (e.g. the FCP->LCP gap on PSI mobile, desktop TBT 740 ms on PSI). Write ${OUTDIR}/CRITIQUE.md and return the structured list.`,
  {
    label: "synthesis:critic",
    phase: "Synthesize",
    model: "opus",
    effort: "xhigh",
    schema: {
      type: "object",
      properties: {
        critique_path: { type: "string" },
        gaps: {
          type: "array",
          items: {
            type: "object",
            properties: {
              severity: { type: "string", enum: ["blocking", "major", "minor"] },
              gap: { type: "string" },
              suggested_fix: { type: "string" },
            },
            required: ["severity", "gap", "suggested_fix"],
          },
        },
        score_arithmetic_closes: { type: "boolean" },
        verdict: { type: "string" },
      },
      required: ["critique_path", "gaps", "score_arithmetic_closes", "verdict"],
    },
  },
);

return {
  workstreams: compact.map((c) => ({
    key: c.key,
    report_path: c.report_path,
    summary: c.summary,
    n_findings: c.findings.length,
    n_changes: c.changes.length,
  })),
  plan,
  critique,
};
