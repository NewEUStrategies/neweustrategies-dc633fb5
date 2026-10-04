# Phase 1 — workstream `boot-js`: boot JavaScript closure and preload hygiene

Scope: everything the browser downloads, parses and executes before hydration, and everything that is
preloaded before first paint. Code = `/home/user/neweustrategies-dc633fb5` @ 6a4215db (+ evidence docs).
All scratch artifacts: `$SCRATCH/phase1/boot-js/` (`$SCRATCH` = `/tmp/claude-0/-home-user-neweustrategies-dc633fb5/8fd9e8e2-d544-5db4-ae5e-c509c5e3ff6c/scratchpad`).

## 0. Diagnosis in numbers (TL;DR)

| Fact                                                                                                                                                    | Number                                                                                                                                                                                                                                                                                                                      | Evidence                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First-party JS that **finished before observed FCP** in the production PSI-equivalent run (mobile)                                                      | **27 files, 567 117 B transfer** (of 810 KB total bytes before oFCP)                                                                                                                                                                                                                                                        | `$SCRATCH/lh/prod-mobile.json` network-requests, oFCP 3 252 ms                                                                                                                                                                          |
| … of which boot closure (entry + 8 vendors + stray `admin.analytics`)                                                                                   | 488 640 B (86 %) — entry 257 132, supabase 58 635, react 61 367, tanstack 52 311                                                                                                                                                                                                                                            | same                                                                                                                                                                                                                                    |
| … dictionary `pl-*.js` / widget chunks / route `/` chunks                                                                                               | 26 799 / 40 886 / 10 792 B                                                                                                                                                                                                                                                                                                  | same                                                                                                                                                                                                                                    |
| Lantern rule that makes this count                                                                                                                      | network node is in the FCP graph iff it **ended before observed FCP** and priority is VeryHigh or **High+Script**; LCP graph keeps every non-low-priority-image node that ended before observed LCP                                                                                                                         | `$SCRATCH/tools/node_modules/@paulirish/trace_engine/models/trace/lantern/metrics/FirstContentfulPaint.js` (`getFirstPaintBasedGraph`), `graph/NetworkNode.js:68-75` (`hasRenderBlockingPriority`), `metrics/LargestContentfulPaint.js` |
| `fetchpriority="low"` on `<link rel=modulepreload>` and on the module `<script>`                                                                        | **ignored** (all 79 scripts still `High`), FCP 4.85–4.89 s vs 5.04 s control                                                                                                                                                                                                                                                | variant `bj3-low-*`                                                                                                                                                                                                                     |
| Experiment: fixture artifact, boot set started **after `load`** (preloads injected at that moment)                                                      | mobile **FCP 5.04→1.40 s, LCP 5.61→2.66 s, SI 5.04→3.08 s**; desktop FCP 1.03→0.38 s, LCP 1.14→0.60 s; CLS 0 (5/5 runs)                                                                                                                                                                                                     | variants `bj3-control-*`, `bj3-defer-load-pre-*` (n=3)                                                                                                                                                                                  |
| Experiment: drop only non-boot modulepreloads (widgets + route `/` chunks)                                                                              | mobile FCP −0.87 s, LCP −0.69 s; desktop FCP −0.15 s; **but CLS 0.421 in 1 of 5 runs** (hydration-discard of a lazy widget boundary)                                                                                                                                                                                        | `bj3-strip-route-*`, `bootjs-strip-route-mobile-2.json` layout-shifts                                                                                                                                                                   |
| TBT/FCP coupling                                                                                                                                        | in the control trace **600–1 125 ms of long-task excess happens before simulated FCP and is not counted**; moving FCP to 1.4 s without less CPU would add **+530…+770 ms TBT**                                                                                                                                              | counterfactual over `bj2-control-mobile-{1,2}.json`, `baseline2-mobile-{1,2}.json` long-tasks                                                                                                                                           |
| Entry `index-DPN2YAij.js`                                                                                                                               | 1 427 732 B pre-minify / 836 921 B raw / 257 464 B gzip, 788 modules                                                                                                                                                                                                                                                        | `reports/chunk-inventory.json`                                                                                                                                                                                                          |
| Entry = root/router closure 62.4 %, **route shells 30 %** (377 non-hot routes + `routeTree.gen` + exclusive helpers), hot routes 6.2 %, framework 2.1 % | 891 007 / 403 k / 87 909 / 29 661 B pre-min                                                                                                                                                                                                                                                                                 | `$SCRATCH/phase1/boot-js/classify.py`                                                                                                                                                                                                   |
| Vite preload machinery inside the entry                                                                                                                 | `__vite__mapDeps` table 32 148 chars (840 files) + 559 index arrays 46 941 chars = **78 KB raw ≈ 23 KB gzip (9 % of entry)**; admin route imports alone 25.7 KB of arrays                                                                                                                                                   | analysis of `.output/public/assets/index-DPN2YAij.js`                                                                                                                                                                                   |
| `experimentalMinChunkSize: 2048`                                                                                                                        | 1 290 chunks, **503 below min size** merged → 884; produces cross-route static edges (`/` → `blog.index` → `events._slug_.cfp-submit` → `vendor-lucide`); in production the **entry statically imports `admin.analytics-D7PYqOYF.js`**; my prototype reproduced it (entry → `admin.analytics-BsK4WgFx.js` = 40 KB date-fns) | `vite.config.ts:312`, `$SCRATCH/phase1/boot-js/build-proto.log`, `psi/h1.txt` Link line 31                                                                                                                                              |
| Core dictionary `pl`                                                                                                                                    | 70.9 KB JSON / 26.9 KB gzip; **94 % are `admin` (41.6 KB), `blocks` (15.4), `notifications` (6.7), `comments`, `adminComments`**; public core = 4.8 KB / **2.3 KB gzip**                                                                                                                                                    | `$SCRATCH/phase1/boot-js/dict2.mts`                                                                                                                                                                                                     |
| `vendor-supabase`                                                                                                                                       | 224 170 B raw / 58 436 B gzip in boot; `auth-js` 47 % of its pre-min bytes, `postgrest-js` 13 %                                                                                                                                                                                                                             | inventory                                                                                                                                                                                                                               |

**Root cause for this workstream:** Lighthouse/PSI mobile FCP, LCP and SI are bandwidth-bound by ~570 KB of
High-priority JavaScript that the page asks for _before first paint_ (modulepreload in head + Link header),
86 % of it the boot closure. Shrinking it helps linearly (~5–7 ms per KB on mobile, measured in round 2:
−87 KB → −0.45 s FCP); **starting it after the LCP image has painted removes it from the FCP/LCP graphs
entirely** (−3.6 s FCP / −3.0 s LCP on the fixture), but then the main-thread work that today hides before
simulated FCP (HTML parse + hydration long tasks) lands in the TBT window — so this lever must ship together
with the hydration/html-weight workstreams' CPU reductions.

## 1. Measurement model and experiments

### 1.1 How Lantern treats boot JS (Lighthouse 13.5, verified in source)

- `FirstContentfulPaint.getFirstPaintBasedGraph`: a network node is kept if it is the main document, or if
  `endTime <= cutoff` (observed FCP from the unthrottled trace) **and** `treatNodeAsRenderBlocking(node)`.
  Optimistic: `hasRenderBlockingPriority() && initiatorType !== 'script'`; pessimistic:
  `hasRenderBlockingPriority()`; final = 0.5/0.5.
- `NetworkNode.hasRenderBlockingPriority()` = `priority === 'VeryHigh' || (priority === 'High' && resourceType === 'Script')`.
  `<link rel=modulepreload>` and module scripts are `High` in Chromium 1194 (and the `fetchpriority=low`
  hint is ignored for them — variant `low`).
- The escape hatch "script finished loading but its `EvaluateScript` started after FCP" relies on
  `EvaluateScript` events with a URL; module evaluation is not reported that way, so **every modulepreloaded
  chunk that finished before observed FCP is treated as render-blocking**.
- LCP: optimistic graph keeps every node that ended before observed LCP except Low/VeryLow images;
  pessimistic keeps all. So for LCP, priority does not matter at all — only "did it finish before the hero
  painted in the observed run".
- Consequence: the only ways to take boot JS out of simulated FCP/LCP are (a) fewer bytes, or (b) start the
  requests after the observed LCP paint. Priority hints do not work.

### 1.2 Experiments (HTML-rewriting proxy over the unmodified artifact, fixture backend)

Harness: `$SCRATCH/phase1/boot-js/rewrite-proxy.mjs` + `measure-variant.sh` (copy of `measure-local.sh`
with the proxy swapped). Machine shared with other agents (load avg 5–9 on 4 CPUs): **TBT numbers are not
usable**, FCP/LCP/SI (network-simulated) are stable to ±0.1 s across runs.

| Variant (n=3 unless noted)                                                            | mobile FCP | mobile LCP | mobile SI | desktop FCP | desktop LCP | CLS                  | JS ended before oFCP           |
| ------------------------------------------------------------------------------------- | ---------- | ---------- | --------- | ----------- | ----------- | -------------------- | ------------------------------ |
| `control` (same proxy, no rewrite)                                                    | 5.04 s     | 5.61 s     | 5.04 s    | 1.03 s      | 1.14 s      | 0                    | 25 files / 525.6 KB            |
| `low` (fetchpriority=low on all modulepreload + entry script)                         | 4.85–4.89  | 5.60–5.84  | 4.85–4.89 | 0.96–1.06   | 1.12–1.16   | 0                    | 25 / 525.6 KB (all still High) |
| `strip-route` (keep entry closure + dictionary; drop widget + route preloads)         | **4.17**   | **4.92**   | 4.17      | 0.88        | 1.03        | **0.421 once (1/5)** | 9 / 456.8 KB                   |
| `strip-all` (no modulepreload at all, entry script unchanged; n=2)                    | 2.70       | 3.83       | 2.71–5.20 | —           | —           | 0                    | (waterfall)                    |
| `defer-load` (entry script injected after `load`, no preloads; n=1 mobile, 2 desktop) | 1.38       | 2.65       | 2.01      | 0.36–0.37   | 0.62–0.65   | 0                    | 0                              |
| `defer-load-pre` (after `load`: inject all boot-set modulepreloads + entry script)    | **1.40**   | **2.66**   | **3.08**  | **0.38**    | **0.60**    | 0 (5/5)              | 0                              |

Score model (Lighthouse 13 log-normal curves, `$SCRATCH/phase1/boot-js/score.py`, reproduces control = 60):
`defer-load-pre` timings with TBT 335 ms → **88**; with TBT 1 000 ms → 74; with TBT 250 ms → 91. Desktop
`defer-load-pre` → 99–100.

### 1.3 The CLS hazard behind "just drop the widget preloads"

`bootjs-strip-route-mobile-2.json` → `layout-shifts`: 0.4208 on
`div[data-column-slot][data-col-id=…001b]` (hero section column, 380×674 px). Mechanism (documented in
`src/components/builder/organisms/widget-view/lazyWidgets.tsx:19-23`): a lazy widget boundary that has
not hydrated yet is discarded and client-rendered (fallback `null`) when an urgent update reaches it
before its chunk arrived. Widget modulepreloads (`src/lib/seo/widgetPreloads.ts:25-55`, emitted from
`src/routes/index.tsx:213-215` and the root loader) are therefore **load-bearing for CLS**: above-the-fold
widget chunks must be part of the boot set and arrive together with the entry. `defer-load-pre` keeps
them together (0 CLS in 5 runs); `strip-route` does not.

### 1.4 TBT coupling (why this workstream cannot ship alone)

Long tasks (simulated) in the control run start at 918 ms (HTML parse, `Unattributable`, 1.1–1.9 s) and
hydration (`vendor-react`, 4.5–6.6 s). TBT only counts tasks after simulated FCP:

| Trace                | TBT reported | recomputed at FCP | if FCP = 2.7 s | if FCP = 1.4 s | excess before FCP |
| -------------------- | ------------ | ----------------- | -------------- | -------------- | ----------------- |
| bj2-control-mobile-1 | 199          | 282               | 350            | 813            | 842               |
| bj2-control-mobile-2 | 472          | 502               | 627            | 1 273          | 1 125             |
| baseline2-mobile-1   | 616          | 599               | 1 026          | 1 441          | 1 059             |
| baseline2-mobile-2   | 558          | 637               | 675            | 991            | 608               |

So the FCP/LCP gain of moving boot JS after paint (+~30 points from FCP/LCP/SI) is partly paid back in TBT
(−10…−15 points) unless the parse long tasks (html-weight workstream) and hydration cost (hydration
workstream) shrink at the same time. On production the coupling is the same (prod mobile long tasks at
1 581–1 958 ms `Unattributable` = HTML parse, `$SCRATCH/lh/prod-mobile.json`).

## 2. Entry chunk composition (`index-DPN2YAij.js`, 1 427 732 B pre-minify)

Groups computed on the static import graph restricted to entry modules (`graph.py` → `classify.py`,
exclusive = reachable only through that group's route files; ratios entry-wide: minified/pre-min 0.586,
gzip/pre-min 0.181 — gzip per group below is that ratio applied, route code compresses better than average):

| Group                                                                               | pre-min B            | %          | ≈ gzip    | Who drags it in                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------- | -------------------- | ---------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Root/router closure (`__root.tsx`, `router.tsx`, `start.ts`, minus `routeTree.gen`) | 891 007              | 62.4       | ~161 KB   | `src/routes/__root.tsx:1-112` imports: SiteChrome → Header → BuilderRenderer → ChromeWidgetView → SimpleWidgets/MegaMenu/SiteMenu; `lib/builder/prefetch` (`__root.tsx:98`); providers (Auth, Theme, Consent, Analytics) |
| Hot routes `/` and `/$` (exclusive)                                                 | 87 909               | 6.2        | ~16 KB    | `lib/queries/blocks.ts` 15.5 KB, `heroImage`, seo `citations`, `resolvePublicPath`                                                                                                                                       |
| `routeTree.gen.ts`                                                                  | 62 026               | 4.3        | ~7–11 KB  | generated, 377+ route `update()` calls                                                                                                                                                                                   |
| Route shells, public-secondary (52 routes)                                          | 138 706              | 9.7        | ~20–25 KB | blog/category/tag/author/tracker/podcasts/qa/web-stories… `head()`/`validateSearch` + `podcast/types` (zod, 5.6 KB)                                                                                                      |
| Route shells, **admin** (213 routes)                                                | 99 917               | 7.0        | ~14–18 KB | 95 101 B of shells (avg 446 B) + `eventListSearch`, `saveConflict`, `postRouteParams`…                                                                                                                                   |
| Route shells, events (23)                                                           | 35 105               | 2.5        | ~5–6 KB   | `i18n-event-head`, `eventTabHead`, `EventsListSkeleton`                                                                                                                                                                  |
| Route shells, club (21)                                                             | 29 056               | 2.0        | ~4–5 KB   | `clubs/specializationHead` 5.0 KB, `specializations` 2.7 KB, `clubHead`                                                                                                                                                  |
| Route shells, account/profile (33)                                                  | 17 851               | 1.3        | ~3 KB     | `ListHydrationNotice`, `useHeaderProfile`, `guestPreviewStore`                                                                                                                                                           |
| Route shells, billing/commerce (11)                                                 | 14 579               | 1.0        | ~2 KB     | `pricing/queries`, `billing/returnPath`                                                                                                                                                                                  |
| Framework (`@tanstack/start-client-core` etc.)                                      | 29 661               | 2.1        | ~5 KB     | bootstrap — must stay (vite.config.ts:363-372)                                                                                                                                                                           |
| Vite preload tables (`__vite__mapDeps`)                                             | (78 KB raw minified) | 9 % of raw | ~23 KB    | 567 dynamic imports × avg 20 deps, `hoistTransitiveImports: false` (`vite.config.ts:308`)                                                                                                                                |

Biggest single cut points inside the root closure (exclusive bytes if the node left the static graph,
`excl.py`):

| Cut point                                                                                                                    | exclusive pre-min | Edge(s) to cut                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `SimpleWidgets.tsx` (+socialHover, mediaWidgets, resizeWrappers, chromeWidgets, AuthorByline, text-rotate…)                  | **109 919**       | `ChromeWidgetView.tsx:85` `renderSimpleWidget` (all simple widgets in one module)                                              |
| `ChromeWidgetView.tsx` whole dispatcher (incl. MegaMenu, SiteMenu, lazyWidgets, footnotes, typographyCss)                    | 247 101           | `BuilderWidgetNode` → `ChromeWidgetView`                                                                                       |
| `lib/builder/prefetch.ts` + 13 query factories (worldMapGeo 8 KB, speakers, ratedList, clubs, events, schedule, newsTicker…) | **53 568**        | `__root.tsx:98` (root loader chrome prefetch, `:839`), `BuilderRenderer`, `useSectionPreload`, `sectionStreaming`, `heroImage` |
| `components/header/TrendingTicker.tsx`                                                                                       | **40 961**        | `components/Header.tsx:18`                                                                                                     |
| `components/megaMenu/MegaMenu.tsx` (+i18n-public, Showcase, grid-card)                                                       | **30 486**        | `ChromeWidgetView.tsx:83`                                                                                                      |
| `components/menu/SiteMenu.tsx`                                                                                               | 23 131            | `ChromeWidgetView.tsx:84`                                                                                                      |
| `hooks/useNewsletterSettings` (+`newsletter/popupDesign` 13.5 KB)                                                            | 18 528            | via `prefetch.ts`                                                                                                              |
| `lib/builder/chromeDefaults.ts`                                                                                              | 13 871            | `__root.tsx:97` (`defaultDocFor`)                                                                                              |
| `lib/ads/consent.ts`                                                                                                         | 13 577            | `__root.tsx:77`                                                                                                                |
| `SectionTabsBar` / `socialHover`                                                                                             | 11 688 / 10 024   | builder renderer                                                                                                               |
| `lib/seo/settings.ts` (zod)                                                                                                  | 10 526            | `__root.tsx:85`, `index.tsx:61`                                                                                                |
| `lib/postLayouts.ts`                                                                                                         | 10 691            | `__root.tsx:72` (`defaultPostLayoutSettings`)                                                                                  |
| `lib/footnotes.ts`                                                                                                           | 10 635            | `ChromeWidgetView.tsx:63`                                                                                                      |

## 3. Why vendor-supabase / vendor-zod / the dictionary are in the boot closure

### 3.1 Supabase (224 170 B raw / 58 436 B gzip)

- Only edge: `src/integrations/supabase/client.ts:14` `import { createClient } from "@supabase/supabase-js"`
  (static). The client is already a lazy _constructor_ proxy (`client.ts:48-54`) but the SDK import is eager.
  95 entry modules import the client (78 use `.from`, 29 `.rpc`, 12 `.auth`, 3 `.channel`, 3 `.storage`).
- Anonymous boot does not need auth/realtime/storage: realtime bridges are already mounted only for signed-in
  users (`__root.tsx:161-205`); `hasStoredAuthSession()` already decides "guest" synchronously
  (`src/hooks/useAuth.tsx:80,107-121`).
- What touches the SDK at boot for a guest today: `AuthProvider` effect (`useAuth.tsx:301`
  `onAuthStateChange`, `:358` `getSession`), consent (`src/lib/ads/consent.ts:503` `onAuthStateChange`),
  **every server-function RPC** through the global middleware `src/integrations/supabase/auth-attacher.ts:9`
  (`supabase.auth.getSession()` — this is what the header ticker refetch `lib/views/headerTickerQuery.ts`
  → `postViews.functions` hits), and post-hydration PostgREST reads (`site_design_tokens`,
  `post_layout_settings`, `ad_placements`, `categories`, `tags`, `builder_popups` — 15 calls in the fixture
  trace).

**Design — `supabase` facade with deferred SDK (client only; server keeps the static import):**

```ts
// client.ts (generated file, exception #3 documented like #1/#2)
let real: SupabaseClient<Database> | undefined, realP: Promise<…> | undefined;
let rest: PostgrestClient | undefined, restP: Promise<PostgrestClient> | undefined;
export const loadSupabase = () => (realP ??= import("./client.full").then(m => (real = m.create(), fireReady(real), real)));
const loadRest = () => (restP ??= import("@supabase/postgrest-js").then(({ PostgrestClient }) =>
  (rest = new PostgrestClient(`${url}/rest/v1`, { headers: { apikey: key, Authorization: `Bearer ${key}` },
                                                   fetch: fetchWithTenantHostAndCorrelation }))));
const wantsFull = () => real !== undefined || hasStoredAuthSession();          // moved to a tiny shared module
const deferredBuilder = (root: "from" | "rpc" | "schema", args) => recorder(async () =>
  (wantsFull() ? await loadSupabase() : await loadRest())[root](...args));       // replays .select/.eq/… on then()
export const supabase = import.meta.env.SSR ? createServerClient() : new Proxy({}, { get(_, p) {
  if (real) return Reflect.get(real, p);
  if (p === "from" || p === "rpc" || p === "schema") return (...a) => deferredBuilder(p, a);
  if (p === "auth") return authFacade;   // getSession(): guest → {data:{session:null},error:null} WITHOUT loading;
                                         // onAuthStateChange(cb): queue cb until real exists, return {data:{subscription}};
                                         // any other auth.* / auth.mfa.* → await loadSupabase()
  if (p === "storage") return storageFacade;  // getPublicUrl() computed synchronously; upload/list → loadSupabase()
  return (...a) => loadSupabase().then(c => c[p](...a));   // channel/removeChannel/functions
}});
// cross-tab login: addEventListener("storage", e => STORED_SESSION_KEY_RE.test(e.key) && loadSupabase())
```

- Wire format for guests is identical (supabase-js's `fetchWithAuth` sends `apikey` + `Authorization: Bearer
<anon key>`; `x-tenant-host`/correlation come from the same `fetchWithTenantHostAndCorrelation`).
- Boot effect: vendor-supabase leaves the boot closure (−58.4 KB gzip, −224 KB raw); guests download a
  postgrest-only chunk (~13 % of the SDK ≈ 7–8 KB gzip) at the first client query, i.e. after hydration.
- What can break: (1) code that relies on a synchronous builder object identity (`instanceof`, inspecting
  `.url`) — audit with a grep gate; (2) `onAuthStateChange` listeners registered before load must be
  attached on load before the first `signIn*` resolves (fire-ready hook runs inside `loadSupabase` before
  returning); (3) `attachSupabaseAuth` must short-circuit for guests or every serverFn RPC pulls the SDK;
  (4) tests mocking `@/integrations/supabase/client` keep working (same export); (5) Lovable preview frame —
  `hasStoredAuthSession()` already returns `true` in a frame (`useAuth.tsx:110`), so the frame keeps today's
  behaviour.

### 3.2 zod (54 091 B raw / 12 301 B gzip)

Boot-reachable zod users (source import + `z.` uses, entry inventory): `lib/seo/settings.ts` (6.6 KB, 24 uses;
`__root.tsx:85`, `index.tsx:61` head/JSON-LD), `lib/podcast/types.ts` (5.6 KB, 83 uses, podcast route shells),
`routes/publications.tsx` (4.5 KB), `lib/menus/types.ts` (2.0 KB), `lib/web-stories/types.ts` (1.9 KB),
`lib/analytics/config.ts` (`AnalyticsConfigSchema`, `__root.tsx:112,411`), `lib/search/searchParams.ts`,
`lib/theme/footerSettings.ts`, `routes/error.tsx`. `*.functions.ts` validators (`checkout.functions`,
`menu.functions`, `postViews.functions`) are 0.5–1 KB client stubs and most likely not real zod users on the
client (verify after the first refactor). Fix: hand-written total parsers (they already exist as patterns,
e.g. `parseSeoSettings`) or `zod/v4-mini` (ships inside zod 3.25.76) for boot-reachable schemas; keep zod in
server code and lazy admin code. Gate: add a `vendor-zod` boot-closure check to `check-entry-purity`.

### 3.3 i18n core dictionary and its top-level await

`src/lib/i18n.ts:120-131` awaits `import("@/lib/locale/pl")` at module top level; the chunk is preloaded via
the Link header (`scripts/lib/localeChunkPlugin.ts`). Namespace sizes of `src/lib/locale/pl.ts` (JSON):
`admin` 41 624, `blocks` 15 357, `notifications` 6 652, `comments` 1 880, `adminComments` 575, everything
public ≈ 4 800. Entry modules referencing `admin.*` keys are only admin route files (split components);
`blocks.*` is used only by `src/components/admin/blocks/**`. Moving the five namespaces to overlays
(`ensureI18n()` pattern already used by `i18n-club`, `i18n-network`, see `check-entry-purity.ts` remedies)
shrinks the boot dictionary **26.9 → 2.3 KB gzip (pl), 23.5 → 1.9 KB (en)** and the `storeCopy`
JSON clone (`i18n.ts:52-54`) by 15×. The TLA itself is harmless while the chunk is preloaded in parallel.

## 4. Preload hygiene: how the stray chunks get into head + Link

Mechanism (all verified):

1. `scripts/lib/routeCodeSplitting.ts:28-34` returns `undefined` for `/`, `/$`, `/en*` intending "keep the
   whole module in the entry", but `undefined` means **default groupings**
   (`node_modules/@tanstack/router-plugin/dist/esm/core/router-code-splitter-plugin.js:79`:
   `fromCode.groupings ?? pluginSplitBehavior ?? getGlobalCodeSplitGroupings()`; default
   `[["component"],["errorComponent"],["notFoundComponent"]]`, `constants.js:11-15`). So `/` has a
   component chunk (`index-BHIMq0Mj.js`) and an errorComponent chunk (merged into `eventInvoiceMath-*.js`
   with `lib/events/eventInvoiceMath` and `lib/billing/nip`). The file comment is wrong.
2. TanStack Start's manifest gives every route `preloads = [chunk, ...chunk.imports]` for **each** split chunk
   of the route, including errorComponent/notFoundComponent (`@tanstack/start-plugin-core/dist/esm/
start-manifest-plugin/manifestBuilder.js:161-167, 252-260`); root gets the entry chunk + its imports
   (`:276-281`). Not transitive (one level).
3. `<HeadContent>` renders those as `<link rel=modulepreload>`; `src/lib/http/frameworkPreloads.server.ts:12-19`
   copies the same `onEarlyHints` modulepreloads into the `Link` header; `widgetPreloadHeaders`
   (`index.tsx:213-215`) and `rootLinkHeaderValues` add widgets and the dictionary. Duplicates are not
   normalized (`PaginatedPostGrid` appears twice in the production Link header, lines 10 and 40 of `psi/h1.txt`).
4. The `/` component statically imports `LatestPostsHome` (`index.tsx:17`, used only in `latest_posts` mode),
   `FooterSlideup` (`index.tsx:8`, renders `null` until an ad placement + delay, `FooterSlideup.tsx:23,64`),
   and `HomeBuilderContent` → `Footnotes` (`HomeBuilderContent.tsx:51`, even when there are no footnotes).
   Rollup put `FooterSlideup` into the chunk named after its other importer (`blog.index-*.js`, which also
   holds the `/blog` component), so `/` inherits **all of `/blog`'s static imports**:
   `events._slug_.cfp-submit` (holds `FriendlyErrorPage` + `AuthGate` + `DegradedDataNotice`, imports
   `vendor-lucide` 63 KB raw), `MoneyText` (Breadcrumbs) → `author._slug` (web-stories loader, geoAspect,
   RouteErrorFallback) → `cfpSettingsDraft`, `pl-DF8VX0lg` (date-fns pl+en-US locales, 42 KB pre-min).
   Measured: `/` static closure beyond boot = **19 chunks / 160 KB raw / 56.2 KB gzip** (`homeset.py`).
5. Production additionally shows the entry statically importing `admin.analytics-D7PYqOYF.js` (5.7 KB
   transfer, `h1.txt` line 31 sits between `vendor-lucide-boot` and `vendor-radix-boot`, i.e. inside the
   root preload list = entry imports). Cause: `experimentalMinChunkSize: 2048` (`vite.config.ts:312`)
   merges side-effect-free small chunks into a bigger chunk "likely loaded under similar conditions"; the
   target is picked by size, so a tiny module the entry needs can be parked inside an admin-named chunk.
   **Reproduced** in my prototype build: after removing the `/` → `blog.index` edge, the entry gained a static
   import of `admin.analytics-BsK4WgFx.js` (40.4 KB of date-fns + `eventVideoHeader`, `mentionTargets`,
   `notFoundIfClean`, `checkout.success?tsr-shared`), boot closure 482.4 → 486.6 KB gzip. Same class as the
   `ADMIN_COCKPIT_SPLIT` note in `routeCodeSplitting.ts:39-52` (2026-10-03).
6. After boot, Vite's preload helper inserts `<link rel=modulepreload>` for every transitive dep of each
   `import()` (44 insertions), all fetched at High: production shows **58 first-party files / 221 KB transfer
   after boot** (`prod-mobile.json`, from 3 374 ms), incl. `vendor-radix` 36.9 KB (AccountMenuWidget →
   `components/ui/popover` + `avatar`, `AccountMenuWidget.tsx:17-18`), `vendor-lucide` 18.7 KB (via the merged
   cfp-submit chunk), `vendor-dompurify` 9.8 KB (sliderVariants/animatedHeading/AccordionWidget), search
   extras (`SearchButtonWidget.tsx:16-28`: `useVoiceSearch`, `facetModel`→`archives`, side-effect
   `import "@/lib/i18n-search"`), admin-named merged chunks (`admin.companies._id`, `admin.users`
   = greetings, `admin.crop-sizes`, `sponsorReportLabels`, `ClubUnreadBadge`, `vendor-radix-select`,
   `AdminSelect`, `MessageComposerField`, `useMention*` via the full `WidgetView`).

### 4.1 Proposed preload policy

| Class                                                                                                                                                                                              | Before first paint (head/Link)                                                                                                                                                                                                                                                                                                                                       | When             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| CSS, 2 fonts, LCP image (one `imagesrcset` preload, sizes equal to the `<img>`)                                                                                                                    | yes                                                                                                                                                                                                                                                                                                                                                                  | always           |
| Boot set = entry static closure + active-language core dictionary + matched route's **component** chunk (+ its direct imports) + chunks of widgets **above the fold** (`ABOVE_FOLD_SECTION_COUNT`) | **no** (target) — requested by a tiny inline bootstrap after the LCP candidate is decoded / `load`, or immediately on first `pointerdown`/`keydown`/`touchstart`/`focusin`, hard cap ~3 s after DOMContentLoaded; all members requested at the same moment (modulepreload burst, then the module script) so lazy widget boundaries never hydrate without their chunk | after LCP paint  |
| Interim (if the bootstrap is not accepted)                                                                                                                                                         | boot set only, deduplicated; never errorComponent/notFoundComponent chunks; never chunks containing `src/routes/(admin                                                                                                                                                                                                                                               | club             | profile | events…)`or`src/components/admin/**` modules | before paint |
| Route errorComponent / notFoundComponent chunks, other-mode components (`LatestPostsHome`), below-fold widgets, overlays (consent, newsletter, popups, toaster, FooterSlideup)                     | never preloaded                                                                                                                                                                                                                                                                                                                                                      | on demand / idle |

## 5. Vite preload helper and `build.modulePreload`

- Cost in the entry: 78 KB raw / ~23 KB gzip of mapDeps tables (§0). Runtime cost of the 44 head insertions
  is negligible after the `:has()` removal (style recalc 0.6 ms); the real cost is that every listed dep is
  fetched at High in the hydration window.
- `resolveDependencies` prototype (drop boot chunks from every list, `polyfill: false`) in my worktree build:
  mapDeps arrays 46 941 → 41 337 chars, entry 257 464 → 255 974 B gzip (−1.5 KB, together with the `/` change).
  Worth doing but small. Larger and safe: return `[]` for imports whose host chunk is an admin/club/profile
  route component (204 admin imports carry 25.7 KB of arrays) — those navigations are not latency-critical
  and the deps are still fetched by the module loader (one waterfall level per graph depth).
- `polyfill: false`: ~1 KB; only matters for browsers without modulepreload (none in the supported set).
- `modulePreload: false` globally is NOT recommended: with `hoistTransitiveImports: false`
  (`vite.config.ts:308`, chunk-graph auditability doctrine) public lazy widgets would load in multi-hop
  waterfalls (150 ms RTT each on mobile).

## 6. Design target and what it takes

| Target                                                 | Today                                             | After C1+C2+C4+C5+C7+C12 | + C6 (route groups) + C11 (chrome islands) |
| ------------------------------------------------------ | ------------------------------------------------- | ------------------------ | ------------------------------------------ |
| Boot closure gzip (entry + vendors)                    | 482–489 KB                                        | ~400 KB                  | **~270–310 KB**                            |
| Pre-FCP High JS (prod)                                 | 567 KB                                            | ~430 KB                  | ~320–360 KB                                |
| Entry gzip                                             | 257 KB                                            | ~250 KB                  | **~150–185 KB**                            |
| Admin/editor/club code statically reachable from entry | yes (213 admin shells, `admin.analytics` in prod) | gated (C9)               | shells gone                                |

Honest assessment: ≤ 250 KB gzip boot and ≤ 120 KB gzip entry are **not** reachable without removing the
route table from the entry (C6, XL) and splitting the builder dispatcher (C11). For the Lighthouse targets
the decisive lever is C3 (start the boot set after LCP), which makes the absolute size matter for TBT/TTI and
real users, not for simulated FCP/LCP.

## 7. Ordered change list

See the structured JSON (`boot-js.json`) for the machine-readable version; summary:

| #   | Change                                                                                                                                                                                   | Effort | Risk        | Main metric (estimate)                                                                                                                 |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| C3  | Boot-after-LCP bootstrap (one inline script, preload burst of the boot set after hero decode/load/interaction)                                                                           | M      | medium      | mobile FCP −3.6 s, LCP −2.9 s, SI −2.0 s; desktop FCP −0.65 s, LCP −0.54 s (measured, fixture); TBT +0.5–0.8 s unless CPU work shrinks |
| C1  | `/` route static edges: lazy `LatestPostsHome`, client-only idle `FooterSlideup`, `Footnotes` only when present, `/` split `[["component"]]`                                             | S      | low         | `/` hydration closure 56.2 → 18.0 KB gzip (measured prototype), −12 requests in the hydration window                                   |
| C9  | Boot-set purity gate (entry closure ∪ `/`,`/$` route preloads ∪ above-fold widget closures: no admin/club/profile/events modules, no error/notFound chunks, byte cap)                    | S      | low         | prevents the `admin.analytics` class (prod + prototype)                                                                                |
| C10 | Make min-chunk merging unable to create public→admin edges (see appendix B for the `experimentalMinChunkSize: 0` build)                                                                  | S–M    | medium      | removes `admin.analytics` from boot (−4–6 KB gzip) and cross-route waves                                                               |
| C2  | Preload filter in `frameworkPreloads.server.ts` + head: dedupe, drop errorComponent/notFoundComponent chunks, keep boot set only                                                         | S      | low         | mobile FCP/LCP −0.1…−0.3 s (prod h2), desktop −30…−60 ms                                                                               |
| C4  | Lazy supabase facade (§3.1)                                                                                                                                                              | M      | medium      | −58.4 KB gzip pre-FCP → mobile FCP/LCP/SI −0.3 s (w/o C3); −50…−130 ms bootup (vendor-supabase 57–130 ms sim.)                         |
| C5  | Core dictionary split (`admin`, `blocks`, `notifications`, `comments`, `adminComments` → overlays)                                                                                       | M      | low–medium  | −24.6 KB gzip pre-FCP → mobile −0.12 s FCP/LCP; −JSON clone work                                                                       |
| C8  | Header widget guest paths: AccountMenu without radix Popover/Avatar for guests, SearchButton heavy parts on intent, slider/heading sanitization via `sanitizePure`                       | M      | medium      | post-boot wave −~60 KB gzip (radix 36.9, dompurify 9.8, search ~12) → TBT/SI; with C3 they shrink the boot set                         |
| C7  | `build.modulePreload`: `polyfill:false`, `resolveDependencies` dropping boot chunks and admin-route dep lists                                                                            | S      | low         | entry −1.5…−6 KB gzip                                                                                                                  |
| C12 | zod out of boot (hand-written/`zod/v4-mini` parsers for 9 boot schemas)                                                                                                                  | M      | low–medium  | −12.3 KB gzip pre-FCP → −60 ms mobile                                                                                                  |
| C11 | Chrome islands: TrendingTicker, MegaMenu, SiteMenu, SimpleWidgets per type, `prefetch` client-lazy (server eager via `createIsomorphicFn`, client `React.lazy` inside the same Suspense) | L      | medium–high | entry −24…−40 KB gzip; must keep SSR parity and join the boot set (CLS hazard §1.3)                                                    |
| C6  | Route groups out of the entry (admin first: 213 shells ≈ 100 KB pre-min + 25.7 KB mapDeps; then events/club/profile/billing)                                                             | XL     | high        | entry −45…−70 KB gzip; TBT −30…−60 ms (parse/compile/eval)                                                                             |
| C13 | lucide-boot shrink (`import * as LucideIcons` in `ChromeWidgetView.tsx:42` and `SearchButtonWidget.tsx:9` makes all shim icons boot-reachable: 190 icons, 45 KB raw / 14.8 KB gzip)      | S–M    | low         | −~8 KB gzip boot                                                                                                                       |

## 8. Interactions / conflicts

- **hydration** workstream: C3 moves FCP before HTML-parse and hydration long tasks → TBT rises unless their
  CPU cuts land in the same wave; C8/C11 overlap with "hydrate less" (lazy islands). File overlap:
  `ChromeWidgetView.tsx`, `lazyWidgets.tsx`, `AccountMenuWidget.tsx`, `SearchButtonWidget.tsx`.
- **html-weight**: parse long tasks (918–1 958 ms simulated) become TBT-visible after C3.
- **lcp-path**: C3 depends on the LCP candidate being visible without JS (true on the fixture: `img.eh-img`
  painted, LCP 2.66 s with no JS), and on one correct hero preload; trigger should key off that element.
- **third-party**: `gtagLoadPolicy` keys off `load` + quiet window; C3 shifts hydration after `load`, so the
  "quiet" detector will see hydration long tasks first (no change in correctness).
- **server-cache**: `frameworkPreloads.server.ts` / Link header is persisted by the edge cache (document
  cache record keyed by body identity, `frameworkPreloads.server.ts:5-6`); changing hints changes cached
  headers only after re-render.
- `routeCodeSplitting.ts` is shared with the admin cockpit fix (`ADMIN_COCKPIT_SPLIT`).

## 9. Verification plan

- Static: `bun run report:chunk-inventory index --modules`, `$SCRATCH/phase1/boot-js/homeset.py <worktree>`
  (boot closure + `/` closure sizes), `check:entry-purity` (extended), `check:chunks`, `check:bundle`
  (boot floor `FROZEN_BUDGET_KB.boot`), `check:chunk-parity`, `check:loader-policy`, `check:ssr-budgets`.
- Lighthouse: `$SCRATCH/lh/measure-local.sh <wt> <label> 3` and compare mobile FCP/LCP/SI medians and
  "JS ended before observed FCP" (bytes) against `bj3-control` (5.04/5.61/5.04 s, 525.6 KB); TBT only on an
  idle machine, paired with control in the same session.
- CLS guard: ≥5 mobile runs per variant must show CLS 0 (hydration-discard hazard §1.3).
- Production: PSI after deploy; check `network-requests` that no first-party script ends before observed FCP
  (C3) or that pre-FCP JS bytes dropped by the predicted amount (C1/C2/C4/C5).

## Appendix A — artifacts

- Graph/attribution scripts: `graph.py` (entry-restricted static import graph), `classify.py`, `excl.py`,
  `attr.py`, `attr2.py`, `homeset.py`, `dict.mts`, `dict2.mts`, `score.py`.
- Experiments: `rewrite-proxy.mjs`, `measure-variant.sh`, results `lh/bj2-*`, `lh/bj3-*` (+ logs `lh/variants*.log`).
- Worktree `$SCRATCH/exp-boot-js` (6a4215db): build 1 = hidden sourcemaps (entry map came out empty — some
  plugin in the chain drops the entry's map, so per-module minified attribution used ratios instead);
  build 2 = prototype C1+C7 (`build-proto.log`, `chunk-inventory-proto1.json`, `manifest-proto1.mjs`);
  build 3 = prototype + `experimentalMinChunkSize: 0` (`build-proto2.log`).

## Appendix B — prototype builds (worktree on 6a4215db, `BUNDLE_INVENTORY=1 bun run build:smoke`, diff in `prototype.diff`)

Prototype = C1 (`/`: lazy `LatestPostsHome`, idle client-only `FooterSlideup`, split `[["component"]]`)

- C7 (`modulePreload: { polyfill: false, resolveDependencies: drop vendor boot chunks }`).
  "Hydration set" = static closure of entry ∪ `/` manifest preloads ∪ the 8 above-fold widget chunks
  (`hydset.py`); "suspicious" = chunk names starting with admin/club/profile/events/author/blog/checkout/tracker.

| Build                                          | JS files | boot closure (files / raw / gzip)                                                   | `/` closure beyond boot (gzip) | hydration set (files / raw / gzip) | suspicious chunks in hydration set                                      | all-asset JS gzip (sum)        |
| ---------------------------------------------- | -------- | ----------------------------------------------------------------------------------- | ------------------------------ | ---------------------------------- | ----------------------------------------------------------------------- | ------------------------------ |
| baseline (minChunk 2048)                       | 885      | 9 / 1 605 645 / 482 403                                                             | 19 files / 56 178              | 44 / 2 085 730 / 638 713           | `admin.users`, `author._slug`, `blog.index`, `events._slug_.cfp-submit` | 4 891 543                      |
| prototype C1+C7 (minChunk 2048)                | 884      | **10** / 1 620 331 / **486 592** (entry now imports `admin.analytics-*` = date-fns) | 7 files / 18 026               | n/m                                | `admin.analytics` in **boot**                                           | n/m                            |
| prototype C1+C7, `experimentalMinChunkSize: 0` | 1 307    | 9 / 1 597 580 / **479 939**                                                         | 8 files / 16 321               | 45 / 1 967 125 / **601 830**       | none                                                                    | 4 946 796 (+55 KB, +422 files) |

Reading: the `/` edge cleanup is real (−38 KB gzip on the `/` closure) but with `minChunkSize: 2048` Rollup
immediately re-parks entry-needed tiny modules inside an admin-named date-fns chunk (+4.2 KB gzip on the boot
closure, same failure as production's `admin.analytics-D7PYqOYF.js`). With `minChunkSize: 0` the boot closure
is the 8 vendors only, the hydration set shrinks by 36.9 KB gzip with the same request count (44 → 45), and no
foreign route chunk is reachable; the price is +422 mostly-never-co-loaded files and +55 KB on the
sum-of-all-chunks metric that `check:bundle` "overall" budgets (already red on main: 4 824.6 > 4 772 KB).
Recommendation for C10: do not ship C1 without either `experimentalMinChunkSize` ≤ 512 (to be measured) or a
dedicated `vendor-date-fns` manual chunk (closure: date-fns has no deps outside itself), **and** the C9 gate.
