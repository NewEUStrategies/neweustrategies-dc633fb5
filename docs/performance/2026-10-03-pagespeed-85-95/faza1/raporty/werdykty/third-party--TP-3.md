# Verdict TP-3: bounce page_view relay through Measurement Protocol

Feasibility: WEAKENED. Effect: CONFIRMED (0 Lighthouse points).

## Lens 1: feasibility and correctness

What holds:

- `sendGa4ServerEvent` (ga4Mp.server.ts:76-111) and `syntheticClientId` (:114-120) exist and stay silent without GA4_API_SECRET (:82-83).
- `ga4ClientId()` reads `_ga` (ga4Client.ts:454-458).
- The client consent gate exists: `hasAnalyticsConsent()` at track.ts:200.
- No chunk-graph risk. `__root.tsx:77` and `:111` already import `ads/consent` and `ga4Client` statically, so a runtime consent import in ga4Client adds no new edge. Putting the listener in track.ts, which is a lazy chunk (`__root.tsx:1063`), adds zero boot bytes. That is the better spot.
- The gate tests exist: `__tests__/ga4MpServer.test.ts`, `trackRedaction.test.ts`, `routes/api/public/-track.test.ts`.

What the design gets wrong or leaves open:

1. **Duplicate page_view.** `visibilitychange:hidden` is not terminal. bfcache `pagehide` with persisted=true is not terminal either.
   - TP-1 is visibility-aware and restarts its window on `visible`. gtag.js then loads and replays the queued `page_view` from `window.dataLayer` (ga4Client.ts:205-219, 433-446).
   - GA4 dedupes only `transaction_id` purchases (ga4Mp.server.ts:6-7), not page_view.
   - Required fix: after relaying, splice the page_view `arguments` entry out of `dataLayer` (safe, because gtag has not processed it yet) and set a relayed flag. The design lists "dedupe" as a risk but has no mechanism for it.
2. **The server is not "already consent-aware".** `routes/api/public/track.ts:104-160` has no consent check, no tenant `ga4_enabled` read and no signature. `-track.test.ts:3-8` calls it one of four unauthenticated public write paths.
   - A relay makes it an open GA4 injection proxy that signs with the project's GA4_API_SECRET. Anyone could POST forged client_id or page_location values.
   - The only limit is a per-isolate rate limiter of 120 burst and 2/s (track.ts:64).
   - Needs: one relay per request, a strict schema, a page_location host check against `currentTenantHost()`, and `loadTenantGa4Settings(tenantId)` (ga4Mp.server.ts:44), which costs a Supabase read per relayed beacon (cache it).
3. **Session and attribution quality.**
   - The design passes `session_id` from track.ts `readSession()`, which is our own UUID (`nes.analytics.session`, track.ts:75-93). That is not GA4's session id, which lives in the `_ga_<suffix>` cookie.
   - Result: a separate GA4 session. MP also never emits session_start and keeps no source attribution, so those sessions report (not set) for source/medium and landing page.
   - MP does not derive geo or device from the caller. The signature (ga4Mp.server.ts:98-102) has no `timestamp_micros`, `user_location` or `device`, so the recovered page_views land with (not set) geo and device, and with the pagehide time rather than the view time.
   - The signature needs extending. Forwarding the IP or user-agent to Google is a further RODO item.
4. **First-party double count.** If the bounce event passes through the existing insert path as `type: page_view`, it doubles first-party page views (semantic/metrics.ts:185; aggregates migration 20260912110000:156,184,214). It must be relay-only (no insert), or a non-page_view type.
5. **The target population is small.**
   - gtag already loads on any pointerdown, keydown, touchstart or scroll, and on an explicit decision (gtagLoadPolicy.ts:59, 170-177).
   - Fresh visitors without a decision have no consent, so they are excluded.
   - What remains is returning visitors with stored analytics consent who leave with zero interaction before about load+10 s (TP-1). ConsentScriptInjector.tsx:36-39 deliberately does not treat a stored decision found at mount as a load signal.

Cheaper alternative, owner decision:

- For visitors whose stored decision at mount grants analytics (`hasConsentDecision() && hasAnalyticsConsent()`, consent.ts:618-630), keep the v1 timing (load+2 s, 1.5 s quiet, 8 s cap) instead of TP-1's longer v2 window, or load right after load.
- Zero Lighthouse cost: the PSI/LH fresh profile has no stored consent, because `readLocal()` returns null.
- It keeps gtag's native session, geo, device and attribution, and needs no server surface and no dedupe. Effort S.
- Cost: field INP/TBT for returning consented visitors, which is the trade-off noted at ConsentScriptInjector.tsx:36-39.
- An optional MP relay could stay as a fallback for the 0-2 s window only.

## Lens 2: effect on the Lighthouse score

- The code runs only on `pagehide` or `visibilitychange:hidden` and only with analytics consent. Lighthouse stops the trace before navigating away, the headless tab never goes hidden, and a fresh profile has no stored consent. That is three independent zeros.
- Bytes: about 0.3-0.6 KB gzip. In the lazy track chunk that is 0 on the critical path. In ga4Client (root chunk) it is about 2-3 ms of transfer at 200 KB/s, under 1 ms of compile at 4x CPU, and 0 points.
- Corrected estimate: 0 points on mobile and desktop. The analytics gain is a small recovered share (consented returning bouncers with no interaction), and those page_views would be degraded: no geo or device, and (not set) attribution unless the design is extended.
