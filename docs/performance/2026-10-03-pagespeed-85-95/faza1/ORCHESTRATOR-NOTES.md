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
