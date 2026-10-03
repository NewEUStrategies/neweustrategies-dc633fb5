# Verdict TP-1: gtag policy v2 (5 s quiescence after load+5 s, cap 20 s, visibility-aware)

Feasibility: WEAKENED. Effect: WEAKENED (the direction is right and the size is smaller).

## Lens 1: feasibility and correctness

What holds:

- Lighthouse's stop condition is a strict subset of the v2 condition. In LH 13.5 `core/gather/driver/wait-for-condition.js:422-480`, the run ends at:
  load+1 s AND network-2-quiet for 1 s AND critical-quiet for 1 s, THEN 1 s of cpu-quiet (an in-page longtask observer).
  v2 needs: load+5 s AND 5 s with no longtask AND no _finished_ resource.
  Before gtag can fire inside the trace, Lighthouse would have to stay open more than 4 s with no completed request and no long task. That happens only with requests that stay in flight for more than 4 s (more than 2 in flight, or a critical one). Nothing like that exists on `/` for anonymous visitors: no WebSocket, and cacheBusting's first poll is at about +8 s after a `whenIdle(3000)` import.
- 7 of 7 simulated runs had no gtag in the trace (exp/results r1, r3, r4).
- No SSR, hydration, i18n or CLS impact. The SSR snippet (`__root.tsx:491-493`) and the dataLayer/Consent Mode queue are untouched. The only gtag loader is `ConsentScriptInjector.tsx:225-229`. The `ga4Client.ts` and `__root.tsx` edits are comment-only.
- The module is already statically in the entry (`__root.tsx:76` imports `ConsentScriptInjector`). The growth is about 0.15 KB gz, which is negligible for check:bundle and check:entry-purity, though CI bundle is already red on main.
- Logged-in users and editors: no change except the fallback timing. Interaction and consent still fire immediately.

What weakens it:

1. **The project constraint conflicts with the design rationale.** `docs/performance/2026-09-30-critical-boot.md:5` says: "Do not detect Lighthouse, suppress real features for audits ... or defer work solely beyond the audit window." prior-art D1 (`faza1/raporty/prior-art.md:240`) already flags this for gtag. The report's own justification (§0.4) is that a window longer than Lighthouse's 1 s thresholds "always lands after the trace ends". It is a TTI-style quiescence rule and not UA sniffing, but it needs an explicit owner or user sign-off and cannot be treated as a pure engineering change.
2. **Possible real-user INP regression.** Today, a visitor who first interacts after about load+3.5 s already has gtag evaluated during idle time. Under v2, anyone who interacts before about load+10 s pays gtag evaluation right after their first interaction: about 300 ms of CPU on a mid-range phone with AW, or about 120 ms without it. If a tap follows a scroll, that tap's INP takes the hit, because scroll is not an INP event but the next tap is. The lab gains and the field may lose.
3. **Page-view loss is larger than stated.** The cap is gated on visibility. A tab opened in the background and closed unseen never sends `page_view`; today the 8 s cap fires even when hidden. The loss is not only "bounces before load+10 s".
4. **The gate list is incomplete.**
   - The cancellation test outside the stated block, `gtagLoadPolicy.test.ts:290`, asserts `observers.disconnect` was called once. That breaks with a second (resource) observer.
   - The shared `FakePerformanceObserver` (`:15-31`) feeds `longTask()` to every observer, so the tests need entry-type dispatch.
   - `ConsentScriptInjector.test.tsx:267` and `:503` say "2-8 s" in comments.
   - `scheduler.postTask` has no typing in TS 5.9.3's lib.dom (0 matches), so it needs a local interface while keeping `check:unknown-casts` clean.
5. **The evidence came from a simulation, not the proposed code.** `exp/inject-proxy.mjs` NEW_POLICY differs from the proposal:
   - it listens to `wheel` while the proposal uses `scroll`;
   - its cap is 30 s, not 20 s;
   - it has no visibility gate;
   - it uses `getEntriesByType('resource')`, which is capped by the 250-entry buffer, rather than an observer;
   - it does not run through ConsentScriptInjector or the SSR snippet.
     The real implementation has to be re-measured with run-exp.sh against a build of the change.

## Lens 2: effect on the score

- TTI is not scored, and LCP, SI and FCP do not change. gtag starts after observed LCP and outside the LCP graph. **Only TBT moves.**
- **Mobile PSI.** The host factor comes from the main-thread ratio: PSI 4.2 s vs M3 prod-mobile 3418 ms, so k ≈ 1.23. This supports the low calib model (k=1.2), not the k=1.8 upper bound.
  - Lantern-list gtag tasks at k=1.23: AW 183→225 (175 blocking), G 69→85 (35), G 51→63 (13), total about 223 ms. The observed-task model gives 212.
  - TBT 600→about 385 moves the TBT score 0.50→0.698, which is **+6 points** (range +4…+8 across PSI TBT 450-760). The "+12" (−400 ms) end needs k=1.8, which contradicts the main-thread ratio.
- **Desktop PSI.** There is one run (TBT 740, main thread 5.0 s at 1x vs 0.58 s on M3, an overloaded host).
  - With M3 gtag observed tasks 14/12/41.7 and calib k=6.4: −283 ms. At k=4: −122 ms.
  - TBT score 0.13→0.21-0.34 gives **+2…+6 points, central about +4**, with high variance.
- **The local A/B "+10" does not transfer.** The fake gtag's simulated tasks (410/184/180 ms) are about 2.2x production's (183/69/51).
- **Cheaper or overlapping option: TP-2** (no `config AW` before marketing consent).
  - It removes the AW task: 133 of 153 blocking ms on M3 (87%), or about 175 of 223 ms at PSI k=1.23, i.e. about −175 ms, +5 points.
  - It also removes 200 KB and about 185 ms of CPU for real users, with no page_view loss and no "audit-window" issue. Its cost is that Ads advanced consent mode is lost for non-consenting visitors.
  - With TP-2 landed, TP-1 adds only the G tasks: about −50 ms, +1-2 points.
  - A constants-only version of TP-1 (5000/5000/20000, no resource observer) would very likely give the same lab result on `/` today, at lower cost.

## Corrected estimate

- PSI mobile TBT −200…−225 ms (central −215), +6 points (range +4…+8).
- PSI desktop −120…−280 ms, +2…+6 points (central +4).
- If TP-2 lands first, TP-1's incremental effect falls to about −50 ms mobile (+1…+2 points).
