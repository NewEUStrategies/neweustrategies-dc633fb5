# Orchestrator notes for the synthesis (Fable 5.1, 2026-10-03)

Authoritative constraints and corrections the planner must honour.

## Score model to engineer for (from lighthouse-analyst, verified by score.py 14/14)

- Mobile 85 needs BOTH: pre-LCP byte set ≤ ~300 KB (today ~800 KB, boot JS 554 KB = 70 %) AND TBT ≤ 200–250 ms on PSI. Desktop 95 needs TBT ≤ ~110 ms on a host ~4× slower than this sandbox at 1×.
- Lantern facts: every module chunk that finishes before observed FCP/LCP counts (mobile FCP ≈ 0.9 s + 5.1 ms/KB, LCP ≈ 0.9 s + 6 ms/KB of the pre-LCP set); document TTFB is NOT simulated for FCP/LCP and only inflates SI (×1.4 of observed SI); TBT is threshold-convex (fixture CPU ×2/×4/×8 → 67/356/1443 ms), so "tasks ≤ 12 ms at 4×" or "−50 % post-FCP CPU" collapses TBT to 0–78 ms.
- Therefore the plan's two load-bearing levers are: (A) the pre-LCP byte diet / boot-after-LCP path (LA-C4 + boot-js changes), and (B) the main-thread task-length program (LA-C1 + hydration H1–H9 + third-party TP-1/TP-4). Server-cache items have ~0 PSI score effect (verdicts SC-2/SC-3 refuted) and belong to a "real users / SI" wave, not to the score path.

## Verdict outcomes to respect (do not re-litigate)

- SC-2, SC-3: effect REFUTED for the score; keep only if cheap and clearly labelled "real-user TTFB / SI". SC-1: observability, 0 points, wave 0 with the three corrections in its verdict.
- TP-1: direction confirmed, size weakened (incremental −50 ms mobile if TP-2 lands first); TP-2: CONFIRMED with three implementation conditions (command order in the gtag queue after consent update; GPC path; no AW config before consent); TP-3: 0 points, design-only, out of this PR.
- PA-C2: prefer ratcheting the existing boot budget 579 → 481 KB gzip over a new sixth budget; PA-C1: chronicle entry + measured cause before any threshold change (check:bundle is red on main by +31.5 KB overall from spreadsheet.worker; this PR must not make it worse and should document any budget move in the kronika).

## Facts corrected by the workstreams (use these numbers)

- Post-hydration network in production is 6 PostgREST + 6 preflights + 1 serverFn (hydration report), not "15 PostgREST" as the evidence pack said. Each has a code-level cause (H1–H3).
- Fixture mobile TBT on this sandbox is 558–991 ms; 90–95 % is vendor-react long tasks AFTER FCP; hot single tasks: root commit 361 ms, `--sticky-header-h` write on :root (recalc 874 elements 137–177 ms + forced layout), device-switch re-render on mobile (25 <style> swaps, 166–198 ms), refetch + ticker animation.
- gtag: 153 of 202 ms TBT (76 %) on the PSI mobile trace and TTI 7.1 → 10.6 s; Lantern ends TTI at the last long task in the trace and does not simulate timers, so only a policy that lands gtag after Lighthouse stops recording helps (5 s quiescence window).
- PSI locale trap: `/` + Accept-Language en + no cookie → 302 to `/en` (start.ts homepageLangMiddleware). PSI with hl=pl measures `/`; hl=en measures `/en` after a hop. Verification protocol must say `hl=pl`; the EN first-visit 302 is a decision for the human.
- A cold MISS on `/` = 4 serial DB waves; above ~150–200 ms/call the 600 ms home deadline lapses and the reader gets a degraded 163 KB page served private,no-store and NOT stored (server-cache SC-F3). Real-user issue, not a PSI lever.

## Environment constraints for implementation waves

- 4 CPUs, 15 GB RAM, one build at a time (mutex `$SCRATCH/.build-lock`), ~2.5 min per build:smoke when the machine is quiet, 8 GB heap. No network to production/Supabase/CDN; fixture backend only; `xlsx` substituted in node_modules (spreadsheet.worker size not comparable to CI).
- Measurement = interleaved A/B (`$SCRATCH/lh/measure-ab.sh`), medians of 3, deltas; absolute scores on the fixture are not PSI scores. LCP element on the fixture is the hero image only because the harness serves fixture images over HTTPS (see EVIDENCE §0-cloud).
- Implementation agents work in `git worktree`s off the PR branch; the file-ownership matrix must make every wave's items disjoint in files; the orchestrator merges item branches into the PR branch and re-measures the wave.
- Repo gates per item: prettier, eslint, typecheck, targeted vitest, check:entry-purity, check:ssr-budgets, check:loader-policy, check:chunk-parity, noHasSelectors; per artifact: check:bundle (not worse), check:chunks, boot e2e on the artifact (offline).

## Decisions that need the human (collect, do not assume silently)

1. Google tag policy: 5 s quiescence window (bouncers without interaction send no page_view) and GA4-only until marketing consent. Default assumption for the plan: implement TP-1 + TP-2 behind the existing gtagLoadPolicy module with tests; document the trade-off.
2. Document cache freshness (3 min cap) vs editorial freshness, cross-colo snapshot: real-user TTFB, no PSI effect; propose but keep out of the score path.
3. Consent banner UX: SSR shell with pre-paint visibility toggle and interaction-gated interactivity.
4. `/~flock.js` (host analytics, 21 KB defer): cannot be removed from the app repo if injected by the host; state what it costs.
5. EN first-visit 302 on `/` (PSI hl=en and en-US Chrome users): keep, or serve PL at `/` for everyone with a language switch.

## Status of the inputs (2026-10-03 22:45 UTC, after the usage-limit interruption)

- Reports: all 10 workstreams (css.json reconstructed from css.md by a structuring agent; lcp-path re-run after the limit).
- Verified so far (feasibility/effect): SC-1..3, TP-1..3, PA-C1..3, LA-C1..3, M1..3, boot-js C3/C4/C1/C10; hydration H1/H2/H3/H5/H6, html-weight HW-1..3, css top-3 and lcp-path top-3 verified in the second round (see verdicts/). Unverified changes keep their author's estimate but must be marked "niezweryfikowane" in the plan.
- Change ids collide across workstreams (boot-js C1..C13 vs css C1..C11): always write <workstream>:<id>.
- boot-js:C3 verdict (key for the whole plan): trigger must be the PerformanceObserver 'largest-contentful-paint' entry + ~50 ms (not img[fetchpriority=high] load, not window.load); delivery needs a build-time rewrite of the TanStack manifest (empty root/route preloads and entry scripts on SSR and client) plus server-side injectHtml of the bootstrap and per-request boot-set URLs; only public SSR routes with an LCP candidate; e2e boot-home/boot-timing Link-header assertions must be rewritten; TBT coupling +350..900 ms is real, so it ships in the same wave as the TBT cuts. Corrected PSI projection: alone 68-70; on top of TBT <= 250 ms: 86-90 mobile; desktop +0..1.5.
- boot-js:C4 (lazy Supabase facade) needs: detectSessionInUrl/implicit-flow handling (magic-link, OAuth, recovery landings carry tokens in location.hash), vite.config.ts vendor-supabase manualChunk split (otherwise import('@supabase/postgrest-js') loads the whole 224 KB chunk), tslib shared with vendor-radix, mutable chain recorder for in-place builders (src/lib/admin/community.ts:124). Effect alone +1..2 mobile; ~0 with C3.
- measurement F8 / server-cache: the first MISS in a colo decides bot-vs-browser document variant for 3 min; harness and warmers must use a browser UA (production fix: cache key or forced streaming variant for bots = decision for the human, real-user issue).

## Owner decision (2026-10-03, recorded by the orchestrator)

The product owner approved every optimisation that (a) does not break the platform's functioning and (b) makes it faster. Consequences for the plan:

- No item waits on a human decision any more. TP-1 (5 s quiescence window for the Google tag) and TP-2 (GA4 only until marketing consent, AW configured after consent) are APPROVED; document the trade-off (bouncers without interaction send no page_view) in the implementation doc, do not block on it.
- The consent banner as an SSR shell with a pre-paint visibility toggle and interaction-gated interactivity is APPROVED, provided consent semantics (Consent Mode defaults, GPC, stored decisions) stay byte-for-byte equivalent and are covered by tests.
- Boot-after-LCP (boot-js:C3 with the corrected trigger and delivery), deferred-hydration islands, lazy Supabase facade (with the auth-URL/magic-link handling from the C4 verdict) are APPROVED as long as logged-in flows, editors, admin, EN pages and SEO markup keep working; every such item needs the parity tests the verdicts list.
- "Does not break functioning" is the acceptance bar: an item that changes visible behaviour for users (first-visit 302 to /en, removing the color-mix fallback for old browsers, device-class SSR that drops desktop nav from mobile HTML, removing /~flock.js) stays a RECOMMENDATION with its trade-off, not an implemented item, unless it is strictly invisible to users.
- check:bundle must not get worse; budget moves only with measured cause and a kronika entry.

## Corrections from the last reports (lcp-path, hydration verdicts) — supersede older statements above

- The hero is NOT JS-gated. SSR slide 0 ships eager / fetchpriority=high / opacity 1 and paints without JS (prod HTML no-JS LCP 224 ms); the "fetchpriority=low, opacity:0" snippet in the PSI report is a post-autoplay snapshot. The observed FCP→LCP gap is 51 ms; the simulated 1.9 s gap is Lantern billing the 826 KB pre-LCP set (70 % JS). Evidence-pack hypothesis 3 ("LCP gating by hydration") is therefore WRONG as a cause; the cure is still the same: no JS before LCP (boot-js:C3 / LP-3), one LCP candidate per document (LP-1/LP-2), smaller hero variant and one font (LP-7/LP-8).
- Latent LCP hazard: 7 img[fetchpriority=high] + 5 React auto-preloads + a wrong builderHeroPreload candidate. Today they share one URL (0 ms), but with distinct covers it costs +0.9..1.4 s mobile LCP → LP-1/LP-2 are insurance, gate them (LP-10 in the document-weight check).
- Consent banner: 27 pp of the mobile final-frame histogram, painted 1–2.5 s late → SSR shell with a pre-paint decided-state script (LP-4 merged with hydration H9) is worth SI −0.55..−0.95 s on PSI (+1.1..+1.6 pts) and prevents a +0.3..0.8 s SI regression after C3. Slider autoplay must not tick inside the trace (LP-5).
- Hydration verdicts: H1 refuted (0), H3 ~0, H5 as specified refuted (variant (b) makes TBT WORSE; only "skip the --sticky-header-h write to <html> at load" gives −16..−31 ms), H6 ~0 in the harness (+1..3.5 on PSI only as an upper bound). H2 remains: −80..−150 ms sandbox / −150..−300 ms PSI-like host (+2..+7), with the real root cause being DesignTokensStyle rewriting a 26.6 KB :root sheet via dangerouslySetInnerHTML on every re-render (React compares by identity) triggered by the un-warmed ['site_font_scale'] query → the fix is: warm/derive font scale, memoise the __html object, warm post_layout_settings.
- Therefore the TBT programme that reaches ≤ 250 ms on PSI is: (1) gtag out of the trace (TP-1, central −215 ms), (2) H2 root-cause fix, (3) LA-C1 task-length work on hydration itself (React commit splitting / yielding, measured as the only way to bring fixture TBT 356 → <100 ms), (4) keep popups/toaster/consent interactivity out of the window (TP-4/H9/LP-4). Document-weight and CSS items are hygiene (+0..1.5 total) and must not be counted toward 85.

## Verdict ledger (auto-generated from faza1/raporty/werdykty/*.json)

| change                   | feasibility | effect    | corrected estimate (truncated)                                                                                                                                                                           |
| ------------------------ | ----------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| boot-js:C1               | weakened    | weakened  | Mobile: FCP/LCP/SI 0 s measured (±0.01 s), theoretical at most -35 ms (≈ +0.25 pt); TBT 0..-15 ms (expected about -5) -> 0..+0.5 pt; total about 0..+0.5 pt. Desktop: 0 pt. Without C10: net about 0 or  |
| boot-js:C10              | weakened    | weakened  | Standalone on current main: boot -0..-1 KB gz, 0 points on mobile and desktop. Conditional on C1, without C3: boot -6.7 KB gz and hydration set about -8.4 KB gz, giving at most +0.3 points mobile (LCP |
| boot-js:C3               | weakened    | weakened  | With the trigger keyed on the largest-contentful-paint entry plus about 50 ms, mobile on the fixture: FCP -2.55 s (4.07 to 1.52), LCP -2.55 s (4.82 to 2.27), SI -1.3 to -1.8 s, TBT +350 to +900 ms thr |
| boot-js:C4               | weakened    | weakened  | Mobile: +1 to +2 points standalone. On the fixture 65 -> 67. On PSI, FCP -0.15 s is about +0.5 point and LCP 0 to -0.3 s at 6.6 s is about +0 to +0.7 point. Desktop: 0 points (-2 to 0 on the x4 proxy) |
| css:C1                   | weakened    | weakened  | Core sheet -26.9 KB raw / -6.0 KB gzip-6 / -4.1 KB br (not -29.5 / -6.6). Mobile LCP -20 to -36 ms; FCP 0 today and about -30 ms after boot-js:C3; +0.1 to +0.3 mobile points; desktop 0. Its only real  |
| css:C5                   | weakened    | weakened  | Bytes as specified: -74 KB raw / -5.3 KB gzip-6 / -3.5 KB br-11 (claimed -69 KB / -5.0 KB). The hybrid variant gives -83 KB raw / -5.6 KB gzip / -3.5 KB br with no palette regression. At stage 3 it is |
| css:C6                   | refuted     | refuted   | Honest C6 (content hand CSS plus content-only utilities, stacked on C1-C5): -28.6 KB raw / -3.8 KB gzip-6 / -2.9 KB br render-blocking. At about 4.6 ms/KB that is mobile LCP about -13 ms and FCP 0 to  |
| html-weight:HW-1         | weakened    | refuted   | Mobile: FCP/LCP about -5 ms today (net -1.0 KB gz pre-FCP: JS -6.73, CSS +5.69); about +25..30 ms worse once boot-js removes JS from the FCP set; TBT 0..-15 ms. Score change about 0 points (±0.5). Des |
| html-weight:HW-2         | weakened    | refuted   | HTML: -4..-5 KB gz prod with gzip, about -1 KB with brotli. Render-blocking CSS: +0.85 KB gz (≈ +4-5 ms FCP/LCP mobile). Mobile score: 0 (±1) today; after boot-js moves FCP before these tasks, TBT -10 |
| html-weight:HW-3         | weakened    | weakened  | Production state -8.4 KB gz / about -50 KB raw (fixture about -3.0 KB gz), not -10.8 / -61. FCP/LCP 0 ms. Mobile TBT 0 today, -15 to -35 ms after boot-js C3, which is +0.4 to +1.0 mobile points, only  |
| hydration:H1             | weakened    | refuted   | 0 requests, 0 ms TBT, 0 points in the canonical harness and in the measured prod run (fresh or MISS document). For a STALE edge document older than 5 min: N fewer refetches of identical data, about 0- |
| hydration:H2             | weakened    | weakened  | H2 as specified: - Mobile TBT: -80..-150 ms on the sandbox host, -150..-300 ms on a PSI-like host (+2..+7 pts). This assumes production font_scale is empty, which CLS 0 suggests. - Desktop TBT: 0 on t |
| hydration:H3             | weakened    | refuted   | Network: -3 fetches and -3 preflights in prod (confirmed). TBT: 0 ms in the canonical harness; 0 to -40 ms on prod-like LH mobile, all from the catalog half, ad half about 0; desktop 0; about 0 increm |
| hydration:H5             | refuted     | refuted   | H5 as specified: mobile TBT about 0 for (a), plus roughly +190 ms (worse) if (b) removes the last Layout from the hydration task; desktop about 0 for (a), +41..+136 ms for (b). Do not ship (b). The wo |
| hydration:H6             | weakened    | refuted   | Mobile TBT in the harness: 0 to -60 ms (measured +32 ms ± noise, n=3 interleaved), which is 0 to +1.5 points. PSI production upper bound -40..-150 ms (+1 to +3.5 points), only if the PSI host runs the |
| lcp-path:LP-1            | weakened    | weakened  | Today: mobile 0 ms / 0 points; desktop 0 ms / 0 points. The 640w and 480w High requests end after observed LCP (5705 and 3769 ms, against 3722 ms), so Lantern already excludes them. Head image preload |
| lcp-path:LP-2            | weakened    | weakened  | 0 score points on mobile and desktop, today and after LP-1. HTML −1.85 KB raw / −44 B gz for LP-2 alone (−7.1 KB raw / −144 B gz together with LP-1, not ~1 KB gz). It prevents about +0.01 s desktop LC |
| lcp-path:LP-3            | weakened    | weakened  | Fixture mobile: FCP -2.55 s, LCP -2.55 s (1.52 / 2.27 s, not 1.37 / 1.67 s), SI -1.3 to -1.8 s, TBT +350 to +900 ms. PSI mobile LCP 6.6 -> 2.7-3.0 s (not 2.0-2.5 s). Mobile score +15 to +17 alone, +20 |
| lighthouse-analyst:LA-C1 | weakened    | weakened  | Fixture: mobile ×4 TBT 356 → 22–93 ms (≤12–16 ms React cap plus style fix), or 187 at a ≤20 ms cap. Desktop at ×4: 444 → 150–290 ms (target ≤110 only if non-React tasks are capped too). PSI: mobile 60 |
| lighthouse-analyst:LA-C2 | weakened    | weakened  | Gtag out of the trace (5 s resource+long-task quiet rule): mobile PSI −150…−300 ms TBT (central −200, +4…+8 pts, central +6). Desktop PSI −120…−280 ms (+2…+6 pts). Consent/popup: 0 ms for delay-only;  |
| lighthouse-analyst:LA-C3 | weakened    | refuted   | LA-C3 as specified: 0 pts mobile and desktop (the gate is a guard rail; the stray-header drop is ≤−76 ms LCP even with the requests fully removed, ≈0 in practice). Byte diet credited to its owners: ≈4 |
| measurement:M1           | weakened    | weakened  | Lighthouse score: 0 pts (measurement only). The old harness's bias is smaller than "+0.30 s LCP / +0.28 s FCP" suggests in score terms: h2 vs h1 is mobile LCP −0.30 s ±0.15 s (same-mode pairs −0.13 to |
| measurement:M2           | weakened    | weakened  | Score effect: 0 (prevention only). Static gate: 2 × ≈6 s, deterministic under node. It blocks structural regressions (inline style/script, state, preload count and duplicates, boot raw/gzip, High JS p |
| measurement:M3           | weakened    | weakened  | 0 direct score points. Prevents mis-reading about 0.30 s of LCP (mobile and desktop) and about 0.28 s of desktop FCP (about 3 desktop perf points) in deltas for preload and priority changes. It does n |
| prior-art:PA-C1          | weakened    | weakened  | Score: +0 points (gate only). OVERALL floor about 4826 KB, from runner 4765.45 + host delta 59.48 = 4824.93, rounded up, +1 KB; it stays pending until the first green runner log. Alternatively cut at  |
| prior-art:PA-C2          | weakened    | weakened  | 0 score points directly. As a guard, the raw gate is worth about 0 ms of TBT/TTI per realistic regression: Lighthouse attributes under 10 ms of parse/compile to all boot JS, and a +10% raw regression  |
| prior-art:PA-C3          | weakened    | confirmed | 0 points directly; it locks in gains only after the html-weight and lcp-path waves land. Risk is medium, not low, because of the zero-headroom count budgets, direct bot commits to main, and the bun/no |
| server-cache:SC-1        | weakened    | weakened  | 0 Lighthouse points directly. It is worth doing as a wave-0 enabler (effort S, low risk) to measure HIT ratio per colo and the cold-isolate share. As specified, it will not explain the 1.8-2.4 s TTFB  |
| server-cache:SC-2        | weakened    | refuted   | -0.09...-0.2 s MISS TTFB, only for the narrow class "cold isolate + '/' missing from colo document L2 + data snapshots < 300 s old". 0 s on fully cold colos and on HIT/STALE. Degraded renders do not d |
| server-cache:SC-3        | weakened    | refuted   | Lighthouse/PSI: 0 points on mobile and desktop, because the PSI colo never sees the editor's purge. Real users: about 1-6 fewer MISS renders a day in the editor's colo (1.3-3.3 s each), plus fewer bac |
| third-party:TP-1         | weakened    | weakened  | PSI mobile TBT −200 to −225 ms (central −215): score from 0.50 to about 0.70, +6 points (range +4 to +8 given PSI TBT variance of 450-760). PSI slow desktop −120 to −280 ms: +2 to +6 points (central + |
| third-party:TP-2         | confirmed   | confirmed | Lighthouse lab after TP-1: about 0, at most 0.5 point expected, on mobile and desktop. If gtag lands in the trace: −133 ms mobile TBT on the prod trace (202 → 69 ms, TTI 10.64 → 8.07 s), which is −160 |
| third-party:TP-3         | weakened    | confirmed | 0 points on mobile and 0 on desktop. - Byte cost is 0 ms if the listener lives in track.ts, or under 3 ms of non-blocking transfer if it lives in ga4Client. - Analytics recovery is limited to consente |
