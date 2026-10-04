# Phase 1 · third-party — Third-party code and the post-load main-thread policy

Workstream key: `third-party`. Scope: everything on the main thread after hydration that the reader did not ask for:
gtag.js ×2, `/~flock.js`, ConsentScriptInjector, deferred overlays (consent banner, newsletter popup, builder popups, Toaster/sonner),
AuthProvider/Supabase for anonymous readers, realtime, speculation rules, observability/web-vitals, user-timing marks and the boot probe.

Scratch artefacts are in `$SCRATCH/phase1/third-party/`:

- `tl-*.txt`, `tl2-*.txt` hold the prior scripts' output on the production LH JSON.
- `calib.py` is the host-speed calibration and `probe.py` is the audit probe.
- `exp/` holds the A/B experiment: `fake-google.mjs`, `inject-proxy.mjs`, `run-exp.sh`, `line.py`, `profile.mjs`, `run-profile.sh` and `results/`.
- `bench/supa.mjs` is the Supabase client microbenchmark.

## 0. Key mechanism: how Lighthouse charges post-load work (read this first)

1. **When the trace stops** is decided by `core/gather/driver/wait-for-condition.js:409-480` (LH 13.5, the same default config as PSI: `pauseAfterLoadMs=1000`, `networkQuietThresholdMs=1000`, `cpuQuietThresholdMs=1000`, as printed in `configSettings` of both prod JSONs). Recording ends at the first moment when all of the following hold:
   - `load + 1 s` has passed;
   - the network has been 2-quiet for 1 s;
   - there have been no High or VeryHigh requests for 1 s;
   - the in-page `longtask` observer has seen 1 s without a long task.

   On the production mobile run: observed load 3 364 ms, trace end 8 673 ms. The gtag pings (High priority, 6 181–6 357 ms) are what kept the trace open.

2. **Inside the trace, every long task counts, however late it runs.** Lantern's `Interactive.getLastLongTaskEndTime` (`@paulirish/trace_engine/models/trace/lantern/metrics/Interactive.js:55-63`) sets TTI to the end of the last CPU node longer than 50 ms anywhere in the graph. It has no 5-s quiet window. TBT is then summed over [FCP, TTI] (`TotalBlockingTime.js:33-44`).
3. **Timer delays are not simulated.** `PageDependencyGraph.js:244-251` turns `TimerInstall → TimerFire` into a plain dependency edge, so the simulator starts the fired task as soon as its installer finishes.

   As a result, "load + 2 s + 1.5 s without long tasks" (the current `gtagLoadPolicy.ts`) only moves gtag in _observed_ time. In the simulation its tasks still run, at ×4 cost, and they define TTI. This explains why round 2 (C5) did not move TBT.

4. **The only policies that remove a script from TBT** are:
   - (a) the script never loads before Lighthouse stops recording;
   - (b) the script does not load at all for a visitor who never interacts.

   Lighthouse never interacts. A quiet-window rule that is _longer_ than Lighthouse's own 1 s quiet thresholds always lands after the trace ends. **5 s** is the classic TTI quiet-window definition, so it is a principled real-user rule and not UA sniffing.

## 1. Timeline reconstruction (production LH JSON, M3 Pro host, document MISS)

`prod-mobile.json` (bench 3 702, cpu ×4, observed FCP 3 252, load 3 364, trace end 8 673; Lantern FCP 3 494, TTI 10 642, TBT 202):

| observed ms     | what                                                                                                                                                                | prio | transfer                   | main thread (Lantern / bootup)                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | -------------------------- | ------------------------------------------------------------------------------- |
| 3 208–3 265     | `/~flock.js` (defer, injected by Lovable hosting)                                                                                                                   | Low  | 8 402 B (21 KB raw)        | below the bootup-time threshold (< 50 ms simulated)                             |
| 3 374–3 375     | post-boot chunk wave (lucide, dompurify, PostListCard…)                                                                                                             | High | ~45 KB                     | hydration (other workstreams)                                                   |
| 3 378           | `/favicon.ico`                                                                                                                                                      | High | **26.6 KB**                | n/a (starts after observed LCP 3 303, so outside the LCP graph)                 |
| 3 861–4 039     | PostgREST site_design_tokens / post_layout_settings + 2 preflights                                                                                                  | High | 3 KB                       | refetch storm (hydration workstream)                                            |
| 3 881           | vendor-radix 112 KB raw                                                                                                                                             | High | 36.9 KB                    |                                                                                 |
| 3 904–3 908     | **ConsentBanner** (8 KB), **NewsletterPopup** (3.7), PopupImage (3.6), **PopupHost** (1.9), popups (2.1), **vendor-sonner** (10.1)                                  | High | ~30 KB                     | `afterPageLoad(…,3000)` / `whenIdle(1000)` gates (`__root.tsx:263-277,299-307`) |
| 4 134           | icons-0 (lucide icon JSON 110 KB)                                                                                                                                   | High | 25 KB                      | hydration/boot-js                                                               |
| 4 522–4 668     | `_serverFn`, **builder_popups** (+preflight, body `[]`), **ad_placements** (+preflight, body `[]`)                                                                  | High | 2 KB                       | PopupHost / overlays                                                            |
| 5 008–5 021     | **JoinUsForm, NewsletterDocRenderer, TopicsDroplist, useInterests, consents.functions, sha2…** (NewsletterPopup `prepare()` warm, `NewsletterPopup.tsx:150-166`)    | High | ~45 KB                     | popup that is never shown in LH                                                 |
| 5 363–5 491     | categories / tags refetch + preflights                                                                                                                              | High | 4 KB                       | refetch storm                                                                   |
| **5 867–6 018** | **gtag/js?id=G-EN05JH34VP**                                                                                                                                         | Low  | **170 002 B** (489 KB raw) | long tasks 69 + 51 ms sim; bootup 122 ms (scripting 86, parse 36)               |
| **6 045–6 139** | **gtag/js?id=AW-17612160320&cx=c** (loaded by G because of `config AW` in the SSR snippet)                                                                          | Low  | **199 590 B** (623 KB raw) | **long task 183 ms sim at 10 459**; bootup 185 ms                               |
| 6 052–6 357     | 8 pings: ccm/collect ×2 (**AW-11463700688** = destination linked in the Google tag admin, not in code; AW-17612160320), GA4 g/collect ×2, measurement/conversion ×4 | High | ~1 KB                      | keep the trace open about 2.3 s longer                                          |

Lantern long tasks after FCP (mobile): AW 183, vendor-react 88, G 69, index 59, vendor-react 52, G 51. **TBT 202 ms, of which gtag = 133 + 20 = 153 ms (76 %)**. The AW task alone moves TTI from about 7.06 s to **10.64 s**.
Desktop prod (M3, ×1): TBT 0, no long tasks; gtag main thread 67 ms (third-parties-insight), observed tasks 14.0 + 12.0 + 41.7 ms.

Third-party totals (`resource-summary`, mobile): **22 requests / 379 447 B**. `third-parties-insight`: Google Tag Manager 369 592 B, 75.6 ms main thread (unthrottled).

### 1a. Projection to PSI hosts (the M3 run gives TBT 202 vs PSI 600 mobile / 0 vs 740 desktop)

`calib.py` scales the observed post-FCP tasks by a host factor k until the run reproduces PSI's TBT.

| form    | model                                                                | k that reproduces PSI TBT | gtag blocking at that k | share |
| ------- | -------------------------------------------------------------------- | ------------------------- | ----------------------- | ----- |
| mobile  | observed tasks ×4×k                                                  | 1.2                       | **212 ms** of 676       | 31 %  |
| mobile  | Lantern long-task list ×k (upper bound, sub-50 ms tasks are missing) | 1.8                       | **395 ms** of 603       | 66 %  |
| desktop | observed tasks ×k                                                    | 6.4                       | **283 ms** of 746       | 38 %  |
| desktop | k = 4 (if the PSI desktop host is less slow than 6.4)                | 4                         | 122 ms of 318           | 38 %  |

=> **Removing gtag from the trace is worth about −200…−400 ms TBT on PSI mobile (central estimate −250) and −120…−280 ms on PSI desktop.**
LH 13 log-normal TBT curves (computed):

- mobile (p10 200 / median 600): 600 → 350 ms takes the TBT score from 0.50 to 0.735, which is **+7 performance points** (range +5…+12);
- desktop (p10 150 / median 350): 740 → 460 ms takes the TBT score from 0.13 to 0.34, which is **+6 points** (range +2…+6).

### 1b. Measured A/B on the local artifact (same `.output`, fixture backend, policies injected by a proxy, fake gtag)

Setup:

- `exp/fake-google.mjs` serves `www.googletagmanager.com`, `region1.google-analytics.com` and `pagead2` over TLS through `--host-resolver-rules`. The fake G is 492 KB raw / 169 KB br, and the fake AW is 620 KB raw / 204 KB br; G loads AW the way the real tag does. The fake fires the same 7–8 pings and reproduces the observed task shape (17.2 + 12.7 ms G, 45.7 ms AW) scaled ×1.77, which is the M3/this-host benchmark ratio.
- Variants:
  - `cur` sets `window.__NES_GA_ANY_HOST__=true`, so the **real** SSR snippet and the **real** `gtagLoadPolicy.ts` from the artifact run.
  - `new` is an inline simulation of policy v2 below.
  - `ctl` loads no gtag at all.
- The rounds were interleaved. Other agents were building and measuring in parallel, so the "noisy" rounds are kept separately in `exp/results/noisy` and round 2 is excluded.

| round (mobile) | ctl TBT | cur TBT   | new TBT | cur gtag long tasks (sim) | gtag requested in trace?                              |
| -------------- | ------- | --------- | ------- | ------------------------- | ----------------------------------------------------- |
| 1              | 575     | 1 042     | 426     | 410, 184, 180             | cur: yes, at 2 980 ms (load 641 + 2.3 s); new: **no** |
| 3              | 426     | 1 392     | 510     | 460, 289, 105             | cur yes / new **no**                                  |
| 4              | 422     | 1 103     | 445     | 495, 173, 106             | cur yes / new **no**                                  |
| **median**     | **426** | **1 103** | **445** |                           |                                                       |

Perf score: cur 44 / 51 / 44 versus new 56 / 54 / 56 (**+10 points** on mobile with this host's gtag cost). TTI: cur 12.2–12.3 s, new 6.9–8.4 s.
Desktop round 1: cur TBT 23 (gtag task 96 ms, blocking 46), new 18, ctl 0. On this fast host the desktop gtag blocking is small. On the PSI desktop host, see §1a.
**In all 7 `new` runs the gtag script and pings never appear in the Lighthouse network records.** The page is torn down before the 5-s quiet window closes. Lighthouse's own quiet thresholds are 1 s each.

## 2. Google tag loading policy v2 (design + exact changes)

### 2.1 Current code paths (what to change)

- `src/routes/__root.tsx:491-493` emits the SSR snippet `ga4SsrSnippet(googleTag.measurementId, GOOGLE_ADS_ID)`. It runs consent default, then `config AW-17612160320`, then `config G-…{send_page_view:false}`, then the stamp `__nesGa4SsrTag` (`ga4Client.ts:265-296`).
- `src/components/ConsentScriptInjector.tsx:222-231` calls `bootstrapGa4(ga4Id, GOOGLE_ADS_ID, {scheduleScript: load => scheduleGtagLoad(load,{onDecision})})`.
- `src/lib/analytics/gtagLoadPolicy.ts:42-52`: `QUIET_AFTER_LOAD_MS=2000`, `LONG_TASK_QUIET_MS=1500`, `LOAD_CAP_MS=8000`, `LOAD_DEADLINE_MS=10000`. In `:187-203` the check is `sinceLongTask >= 1500 || sinceLoad >= 8000`.
- `ga4Client.ts:299-306` `injectGtagScript` loads gtag.js once, with the G id. Because AW is configured in the dataLayer, gtag.js then fetches the AW container itself (`&cx=c`).
- Tests: `src/lib/analytics/__tests__/gtagLoadPolicy.test.ts` (signal (c) block `:164-270`), `src/components/__tests__/ConsentScriptInjector.test.tsx:487-626`, `ga4Client.test.ts`, `src/routes/__tests__/rootRoute.test.tsx`.

### 2.2 Policy v2 (replaces signal (c); signals (a) and (b) stay)

```ts
// gtagLoadPolicy.ts — constants
export const MIN_AFTER_LOAD_MS = 5_000; // was QUIET_AFTER_LOAD_MS = 2_000
export const QUIESCENCE_WINDOW_MS = 5_000; // was LONG_TASK_QUIET_MS = 1_500; classic TTI window
export const NO_INTERACTION_CAP_MS = 20_000; // was LOAD_CAP_MS = 8_000
export const LOAD_DEADLINE_MS = 10_000; // unchanged
// quiet = max(lastLongTaskEnd, lastResourceResponseEnd, loadedAt)
// fire (c) when: visible && now-loadedAt >= MIN_AFTER_LOAD_MS && now-quiet >= QUIESCENCE_WINDOW_MS
// cap  (c'): visible && now-loadedAt >= NO_INTERACTION_CAP_MS  (final call via rIC{timeout:1000})
```

(a) Never before idle plus TTI-like quiescence.

- A PerformanceObserver on `resource` (buffered) runs next to the existing `longtask` one, and a completed fetch or script resets the window just as a long task does. In-flight requests are invisible to resource timing; only requests that hang longer than 5 s escape this, and that is acceptable.
- The re-check uses `setTimeout(window − elapsed)` rather than a rIC loop, so it is not starved. Only the final injection goes through `requestIdleCallback`.
- Hidden tab: the check pauses while `document.visibilityState === "hidden"` and restarts the window on `visibilitychange → visible`. Background tabs and prerendered pages therefore do not pay. Prerender is already gated through `afterPrerendering` for observability.
- Safari (no `longtask`): the resource quiet window plus `MIN_AFTER_LOAD_MS` decide alone.

(b) Immediate on interaction or decision. This is unchanged: `pointerdown`, `keydown`, `touchstart`, `scroll` (capture, passive), plus `onDecision`.

- Proposed refinement for the yield: replace `rAF → setTimeout(0)` with `rAF → scheduler.postTask(fire,{priority:"background"})` and fall back to `setTimeout(0)`. The script then evaluates after the interaction's own follow-up work, which helps INP.
- `scroll` stays (scrollbar drags emit only `scroll`). The policy never scrolls programmatically. On a fresh profile `/` produces no restoration scroll, because the inline restoration script at `home.html:404623` reads only sessionStorage.

(c) GA4-only without marketing consent (§2.3).

(d) Consent Mode semantics and the dataLayer queue are untouched. The SSR snippet still sends `consent default` with `wait_for_update:500` before any command. Commands queue in `window.dataLayer` and are replayed in order when the tag arrives (`ga4Client.ts:205-219`).

Trade-off (document it in the module header):

- Today a visitor who leaves before any interaction and before about load + 2–8 s sends no `page_view`.
- With v2 that window grows to about **load + 10 s** on a quiet page (5 s minimum plus 5 s quiet; the cap is 20 s if the page keeps producing long tasks).
- On mobile, most readers scroll or tap within a second or two, and those visitors are unaffected.
- The loss concentrates on visitors who bounce without touching the page, which is exactly the traffic GA4 already reports with engagement close to zero.

### 2.3 GA4-only for visitors without marketing consent

- `ga4Client.ts:265-296` `ga4SsrSnippet(measurementId)`: drop the `adsId` parameter and the `gtag('config',AW)` line. The stamp becomes the GA4 id only.
- `ga4Client.ts:336-383` `bootstrapGa4(measurementId, options)`: drop `adsId`. Add the exported, idempotent `ga4ConfigureAds(adsId)`, which pushes `gtag('config', AW)` once per page (module flag).
- `ConsentScriptInjector.tsx:233-236`: in the `categories` effect, when `categories.marketing === true`, call `ga4ConfigureAds(GOOGLE_ADS_ID)`. If gtag.js is already loaded, it fetches the AW container lazily at that moment. Revocation needs no unconfig: `ga4ConsentUpdate` sets `ad_storage` / `ad_user_data` / `ad_personalization` to denied.
- `__root.tsx:492`: `ga4SsrSnippet(googleTag.measurementId)`.
- `conversions.ts:31-37` `adsConversion` (send_to `AW-…/label`): without the AW config the Ads destination is not registered, so the event goes nowhere. Lead conversions therefore rely on the GA4 key event → Ads import, which `conversions.ts:9-15` already names as the primary path. Labels are optional env vars.

Cost removed when gtag does load (real users, or the cap on a slow host): **−199 590 B transfer, −185 ms simulated mobile CPU, −1 long task (AW 183 ms sim; −133 ms TBT on the M3 prod run when it lands in-trace)**, plus 1–2 fewer High pings.

Trade-offs for the owner:

- **Google Ads Advanced Consent Mode modelling is lost for non-consenting traffic.** Ads moves to "basic" mode for those visitors; GA4 keeps advanced mode with cookieless pings.
- The G- tag also pings **AW-11463700688** (ccm/collect, `rcb=18`). That destination is linked in the Google tag admin, not in code. The owner should check whether it is a stale Ads account.

### 2.4 Mitigation for page_views lost to bounces (design only)

- **Client.** In `ga4Client.ts`, track `gtagLoaded` (set in `injectGtagScript` onload). A one-shot `pagehide` / `visibilitychange:hidden` listener runs only if all of these hold:
  - the tag has not loaded;
  - a `page_view` sits in the dataLayer;
  - `hasAnalyticsConsent()` is true.

  It sends `navigator.sendBeacon("/api/public/track", …)` with event `ga4_bounce_pv`, the redacted `page_location` (same `redactTrackedPath` + `redactQueryPii`), `page_title`, `language`, `engagement_time_msec`, and `client_id = ga4ClientId()` from `_ga`, or null.

- **Server.** The handler of `/api/public/track` (already consent-aware) relays the event via `sendGa4ServerEvent` (`src/lib/analytics/ga4Mp.server.ts:76`). It uses the `_ga` client id when present, otherwise `syntheticClientId(anon_id)` (`:114`), with `session_id` and `engagement_time_msec` so the event counts as an active user, and with param `transport:"mp_bounce"` so it can be analysed separately. The relay stays silent without `GA4_API_SECRET` and when `ga4_enabled:false`.
- **No consent means no MP hit.** MP has no cookieless mode equivalent to `analytics_storage=denied`. Sending identifier-bearing hits without consent would need legal sign-off (RODO/ePrivacy).
- Lighthouse never fires `pagehide` inside the trace, so this mitigation has zero score cost.

## 3. `/~flock.js`

- **What it is.** A Lovable-hosting visitor-analytics beacon (`<script defer src="/~flock.js" data-proxy-url="/~api/analytics">`, `psi/home.html` offset 37464, the last node of `<head>`). It is **not in the repo and not in the `.output` HTML**: `grep -rn flock src` returns 0 hits, and `exp/results/ctl-home.html` has none. The hosting layer (`x-deployment-id: psr2.…`) injects it downstream of our Worker.
- **Cost.** 8 402 B transfer / 21 296 B raw, Low priority, requested at 3 208 ms. That is before the observed LCP at 3 303, so it sits in Lantern's pessimistic LCP graph and costs about 45 ms of link time at 1.6 Mb/s. Its CPU is below the bootup-time threshold (< 50 ms sim, < 12 ms observed). No beacon fired inside the trace. `max-age=1500` is flagged by cache-insight (9 KiB), but insights carry no score weight.
- **Options:**
  - (1) The owner disables Lovable visitor analytics for the published project, if the Lovable analytics dashboard is not used (GA4 and the first-party `/api/public/track` cover it).
  - (2) Keep it.
- **Not possible from code:** self-hosting, deferring, or stripping it in our Worker (injection happens after our response). Defer is already set, so it does not block rendering.
- **Effect.** ≤ 0.5 point on mobile (LCP and SI by tens of ms); none on desktop. **This is an owner decision with no code change.**

## 4. AuthProvider / Supabase / realtime for anonymous readers

- `src/hooks/useAuth.tsx:265-268`: an anonymous visitor (no `sb-*-auth-token` in localStorage) already settles `loading=false` in the first effect, with no network call. There is **no logged-in flash risk today**.
- `useAuth.tsx:300-372` still calls `supabase.auth.onAuthStateChange` and `supabase.auth.getSession()` for **every** visitor. The first touch of the Proxy (`src/integrations/supabase/client.ts`, lazy `createClient`) builds GoTrueClient: `_initialize`, BroadcastChannel, `visibilitychange` → auto-refresh ticker every 30 s with navigator.locks. It also builds RealtimeClient (`_initRealtimeClient`) and PostgREST.
- CDP CPU profiles (4× throttle, `exp/results/profile-ctl-*.txt`):
  - vendor-supabase self time is **55–113 ms** for the whole load window (module eval + client creation + about 15 PostgREST builds);
  - the auth-specific frames (`_initialize` 2.6–4.4, `_initRealtimeClient` 5.4, `_getSessionToken`, `_useSession`, `detectEnvironment`) total **about 10–20 ms at 4×**.
- Node microbenchmark (`bench/supa.mjs`): the first `createClient` takes 60–120 ms cold on this loaded host (lazy compilation); later calls take < 1 ms.
- **Conclusion: the AuthProvider part on its own is small (about 3–5 ms observed, 10–20 ms simulated).** The real prize is not creating the client and not downloading vendor-supabase (58.6 KB gz, 224 KB raw) for anonymous readers. That needs three things together:
  - (i) the hydration workstream's fix that seeds `updatedAt` from SSR render time instead of 0 (it removes the anonymous PostgREST refetches in the load window);
  - (ii) boot-js's lazy client;
  - (iii) this change.
- **Proposed change (with boot-js):**
  - `useAuth.tsx:300`: when `!hasStoredAuthSession() && !urlHasAuthParams()` (`?code=`, `#access_token`, `type=recovery|magiclink`, `error_description`), do not touch `supabase`.
  - Add `onSupabaseClientCreated(cb)` in `client.ts`. When anything creates the client (a login form, a gated query), AuthProvider attaches `onAuthStateChange` synchronously at creation, so it cannot miss `SIGNED_IN`.
  - Add a `storage` event listener for `STORED_SESSION_KEY_RE` keys to catch a login in another tab.
  - The first render is unchanged (SSR `loading=true` → anonymous `false` in a transition, the current contract tested by `authHydration.test.tsx`), so there is no flash.
- **Realtime for anonymous readers: none on `/` today.** `AuthenticatedLiveSync` (`__root.tsx:196-206`) mounts channels only for `user && !loading`, and the prod LH runs show no WebSocket requests. `PollBlockView` and `LiveBlogBlock` open channels only on pages with those blocks. Proposal: a regression gate only (no anonymous `wss://` request on `/`, see §6 TP-9).

## 5. User-timing marks (PSI "99"), boot probe, observability, speculation rules, sonner, popups

- **User timings.** The `user-timings` audit is `notApplicable` with **0 items** in prod-mobile, prod-desktop and the fixture runs. The fixture trace (`exp/results/cur-mobile-1-0.trace.json`) contains only navigation-timing `R` events and LH's own markers in `blink.user_timing`.
  - Source code: no `performance.mark` / `measure` anywhere in `src`. The only built occurrence is FontAwesome core (`lucide-shim.fa-*.js`, `Wa = d.measurePerformance && …`), which is off by default and lazy.
  - The PSI "99 marks" cannot be reproduced offline; it may come from something only PSI's environment loads. Marks cost microseconds each and the audit has no score weight, so **there is no sampling and no action**. When PSI quota returns, dump `audits['user-timings'].details.items[].name`.
- **Boot probe** (`src/lib/observability/bootProbeScript.ts:79`, 737 B inline): two listeners plus one `setTimeout`. Under 0.5 ms. No action.
- **Observability and web-vitals.** `ClientObservability` (`__root.tsx:960-985`) imports `lib/observability` only when **analytics consent** is granted, so Lighthouse never loads it. `router.subscribe("onResolved")` (`__root.tsx:1053-1066`) dynamic-imports `webVitals` and `track` on navigations. No action.
- **cacheBusting.** `whenIdle(3000)` import (`__root.tsx:1073`, 8–28 ms self at 4×), with the first poll at +8 s (`cacheBusting.ts:143`). It is in-trace but small. Move it to the shared quiescence scheduler (TP-4).
- **Speculation rules.** `eagerness: "moderate"` (hover / pointerdown) and only `.single-post-content a` (`src/lib/seo/speculationRules.ts:98`, `home.html` rules). Lighthouse never hovers, so there is no effect and no action.
- **sonner / Toaster.** `afterPageLoad(…,3000)` (`__root.tsx:296-310`) loads 35 KB raw / 10.1 KB gz at High priority inside the trace. CPU 4–9 ms at 4×. Keep the `onFirstToast` trigger and move the fallback to quiescence.
- **Newsletter and builder popups. This is the largest first-party item in this scope.**
  - `overlaysReady = afterPageLoad(3000)` (`__root.tsx:274-277`) mounts `NewsletterPopup` and `PopupHost` right after load.
  - `NewsletterPopup.tsx:153-166` warms `prepare()` (loadPopupContent → JoinUsForm, NewsletterDocRenderer, TopicsDroplist, useInterests, consents…) **1 s after mount for non-delay triggers**. In production that wave arrives at 5 008–5 021 ms, about 45 KB transfer.
  - CDP profile: JoinUsForm **52–114 ms** plus part of dompurify (44–48 ms) at 4× **for a popup that Lighthouse never sees**.
  - `PopupHost.tsx:57` fetches `builder_popups` (prod body `[]`), plus `ad_placements` (body `[]`), each with a CORS preflight, i.e. 4 High requests that keep the trace open.

## 6. Ordered change list

| id   | change                                                                                                                                                      | TBT mobile (PSI)                                                                                                          | TBT slow desktop (PSI)       | risk                                 | effort         |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------ | -------------- |
| TP-1 | gtag policy v2: 5-s quiescence window after load + 5 s, cap 20 s, visibility-aware                                                                          | **−200…−400 ms (central −250, +5…+12 pts)**; measured locally −658 ms median (1 103 → 445)                                | **−120…−280 ms (+2…+6 pts)** | medium (bounce page_views)           | S              |
| TP-2 | GA4-only until marketing consent (AW config client-side after consent)                                                                                      | 0 once TP-1 lands (defence-in-depth: −133 ms on the M3 trace if gtag does land in-trace); real users −200 KB, −185 ms CPU | same                         | medium (business: Ads advanced mode) | S              |
| TP-3 | Bounce mitigation via Measurement Protocol (consented visitors only) — design                                                                               | 0                                                                                                                         | 0                            | legal review                         | M              |
| TP-4 | Shared `whenQuiescent()` scheduler; NewsletterPopup prepare on intent; PopupHost only when active popups exist; Toaster/cacheBusting fallback on quiescence | −20…−80 ms                                                                                                                | −10…−40 ms                   | low-medium (popup timing)            | M              |
| TP-5 | AuthProvider anonymous fast path (no Supabase touch) — with boot-js lazy client + hydration seeds                                                           | alone −10…−20 ms sim; enables −58.6 KB gz vendor-supabase for anonymous readers (counted in boot-js)                      | ≈0 alone                     | medium (auth edge cases)             | M              |
| TP-6 | CI gates: LHCI `resource-summary:third-party:count ≤ 0`; e2e-performance third-party quiescence spec; no anonymous wss                                      | durability                                                                                                                | durability                   | low                                  | S              |
| TP-7 | `/~flock.js`: owner disables Lovable visitor analytics (optional)                                                                                           | LCP/SI −20…−45 ms, TBT ≈0                                                                                                 | ≈0                           | business                             | none (setting) |
| TP-8 | no-ops recorded: user-timings, boot probe, speculation rules, realtime, observability                                                                       | 0                                                                                                                         | 0                            | —                                    | —              |

### TP-1 exact edits

- `src/lib/analytics/gtagLoadPolicy.ts`:
  - `:42-52`: new constants (§2.2).
  - `:92-112`: add `observeResources()` (PerformanceObserver `resource`, buffered) with the same try/catch shape.
  - `:187-203`: `checkQuiet` uses `quiet = max(longTasks.lastEnd(), resources.lastEnd(), loadedAt)`, `fire` when `visible && sinceLoad >= MIN_AFTER_LOAD_MS && now-quiet >= QUIESCENCE_WINDOW_MS`, and the cap at `NO_INTERACTION_CAP_MS`. Re-check with `setTimeout(max(250, window − since))`; the final injection goes through `whenIdleOrAfter(fire, 1000)`.
  - `:206-219`: start the first check at `MIN_AFTER_LOAD_MS`.
  - Add a `visibilitychange` handler.
  - Header comment `:1-41`: new trade-off text and the Lantern rationale from §0.
- `src/lib/analytics/__tests__/gtagLoadPolicy.test.ts:164-270`: rewrite signal (c):
  - nothing before `MIN_AFTER_LOAD_MS`, even when everything is quiet;
  - a resource entry inside the window postpones;
  - a long task inside the window postpones;
  - the cap at 20 s;
  - a hidden tab never loads and restarts the window on visible;
  - Safari without `longtask` / `resource` observers;
  - keep (a) / (b) / cancellation.
- Comments in `ConsentScriptInjector.tsx:208-221`, `ga4Client.ts:13-22` and `__root.tsx:480-490` still say "2 s / 8 s"; update them.
- Gates: unit tests; `check:bundle` / `check:entry-purity` neutral (the module is already in the entry, +≈0.3 KB); no SSR change, so no hydration-parity risk.
- Verify: LH mobile and desktop on production (or `exp/run-exp.sh cur|new`):
  - `network-requests` has 0 URLs on googletagmanager / google-analytics / googlesyndication;
  - `long-tasks` has none from googletagmanager;
  - `resource-summary` third-party count is 0;
  - TBT paired medians, n ≥ 5;
  - TTI drops from about 10.6 s to about 7 s on the prod-like run.

  Real users: the GA4 page_view count week over week, and the share of `engagement_time_msec = 0` sessions.

### TP-2 exact edits

`ga4Client.ts:265-296,336-383`, new `ga4ConfigureAds`; `ConsentScriptInjector.tsx:225,233-236`; `__root.tsx:492`; tests `ConsentScriptInjector.test.tsx:605-626` (`configCount(GOOGLE_ADS_ID)` → 0 before marketing consent, 1 after), `ga4Client.test.ts` (snippet without AW), `rootRoute.test.tsx` (head snippet).
Verify:

- a real-browser e2e with a gtag stub: without marketing consent the dataLayer has no `config AW` and no `id=AW-` request is made; after "Akceptuj wszystkie" exactly one AW container request follows;
- on PSI after the TP-1 cap edge: a single gtag request.

### TP-4 exact edits

- New `src/lib/performance/whenQuiescent.ts`, extracted from TP-1 (same constants, interaction short-circuit optional per caller). gtagLoadPolicy should reuse it so there is one primitive with one test file.
- `__root.tsx:274-277`: `overlaysReady` uses `whenQuiescent` (or first interaction), not `afterPageLoad(3000)`.
  - **`consentReady` (`:263-272`) stays time-only.** This is the contract in the comment `:234-239`.
  - The consent banner remains, because it is legally required (lcp-path owns its LCP side).
- `NewsletterPopup.tsx:153-166`: for `scroll` and `exit-intent` triggers, warm on the first `scroll` / `pointermove` / `touchstart` instead of a 1 s timer. For `delay`, keep `delay − 1.5 s`.
- `PopupHost.tsx:57`: `useActivePopups(enabled)` only after quiescence or interaction. Better: the root loader exposes `hasActivePopups` from the SSR site-settings payload (a site-wide cached boolean), so PopupHost does not mount at all when production has no active popups (prod body `[]`).
- `useToasterWanted` (`:296-310`) and `cacheBusting` (`:1073-1077`): fallback on `whenQuiescent`.
- Gates and tests:
  - `e2e-performance/on-demand-overlays.spec.ts`, `popup-first-render.spec.ts`, `e2e/popup-registration.spec.ts`;
  - `overlayCoordinator` tests;
  - SSR parity is untouched, because all of these start at `null` on both server and client.
- Verify: LH `network-requests` has no `JoinUsForm` / `NewsletterDocRenderer` / `PopupHost` / `builder_popups` / `ad_placements` / `vendor-sonner` before the trace ends; a CDP profile (`exp/run-profile.sh ctl`) shows no JoinUsForm self time in load + 10 s.

### TP-6 exact edits

- `lighthouserc.deployed.json` and `lighthouserc.deployed.mobile.json`: add `"resource-summary:third-party:count": ["error", {"maxNumericValue": 0}]`. This is a ratchet: it fails on any third party that enters the Lighthouse window.
- New `e2e-performance/third-party-quiescence.spec.ts`:
  - `addInitScript(() => window.__NES_GA_ANY_HOST__ = true)`, routing `**/gtag/js**` to a stub;
  - assert no gtag request until `load + MIN_AFTER_LOAD_MS + QUIESCENCE_WINDOW_MS`;
  - assert `page.mouse.down()` triggers it within 1 s;
  - assert `dataLayer` has no `config AW-…` before marketing consent;
  - assert no `wss://` and no `/auth/v1/` request for an anonymous visitor on `/`.

## 7. Conflicts and coordination

- **boot-js.** The lazy Supabase client and moving vendor-supabase out of the boot closure both depend on TP-5. The 4 531 ms wave (WidgetView → AdminSelect, vendor-radix-select, MessageComposerField, useMentionAutocomplete: chunk-graph fragmentation) sits between the popup and builder renderers and is theirs.
- **hydration.** SSR seeds with `updatedAt: 0` cause the anonymous PostgREST refetches (site_design_tokens, post_layout_settings, categories, tags). Without that fix, TP-5 gains nothing, because the refetches create the client anyway.
- **lcp-path.** The ConsentBanner LCP-candidate issue and the non-composited `filter` animation. TP-4 must not change `consentReady` timing.
- **measurement / lighthouse-analyst.** The LHCI third-party gate (TP-6) and the policy for paired runs. Note that the local fixture never loads real gtag (host gate at `tagIds.ts:71-75`), so fixture medians already model "gtag out of trace". Only production or PSI, or `exp/run-exp.sh` with the fake tag, shows the gtag delta.
- **html-weight.** TP-2 shortens the inline snippet by about 40 B. Negligible.

## 8. Open questions (owner decisions)

1. Accept a larger page_view loss for no-interaction bounces, from < 2–8 s to < about 10 s after load? Is the MP relay for consented visitors (TP-3) wanted?
2. Drop Google Ads Advanced Consent Mode for non-consenting visitors (TP-2)? What is AW-11463700688, which is linked in the G- tag admin?
3. Is the Lovable visitor-analytics dashboard used? If not, disable `/~flock.js`.
4. Is it acceptable for "immediate" / short-delay popups to appear after quiescence (load + about 5–10 s)? Production `builder_popups` currently returns `[]`.
5. What is the source of PSI's "99 user-timing marks"? It is not reproducible offline; recheck when PSI quota returns.
