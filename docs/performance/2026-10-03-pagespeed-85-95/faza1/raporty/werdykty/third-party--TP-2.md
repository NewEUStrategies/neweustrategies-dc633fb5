# TP-2: adversarial verdict (GA4 only until marketing consent)

## Lens 1: feasibility. Verdict: CONFIRMED, with three implementation conditions

What decides it:

- The AW container loads only because a `config AW` command is in the queue. `ga4Client.ts:271-273` (the SSR snippet) and `:370` (the client bootstrap) both add it.
- The prod network log supports this. G loads at 5867 ms. Then `gtag/js?id=AW-17612160320&cx=c` starts at 6045 ms, a child container that gtag.js fetches after G has parsed the queue.
- `AW-11463700688` pings `ccm/collect` at 6052 ms, before the AW container finishes (6139 ms). So that destination is built into the G container, and TP-2 does not affect it.
- Taking AW out of the snippet and the bootstrap therefore removes the 200 KB transfer and the 183 ms task for visitors without marketing consent.
- `useEffectiveConsent` already turns marketing off under GPC (`consent.ts:556-592`).

Gates and other checks:

- `ga4Client` is already in the entry through `ConsentScriptInjector` (`__root.tsx:76,1137`). There is no new import edge, so `check:chunks`, `check:entry-purity` and `check:bundle` are neutral.
- The SSR snippet gets about 40 B shorter, which is fine for `check:ssr-budgets`.
- `head()` builds the same string on the server and the client, so hydration parity is kept.
- No i18n, SEO or CLS surface is involved.
- `ga4_enabled:false` behaves as today: there is no snippet (`__root.tsx:491`) and no bootstrap (`ConsentScriptInjector.tsx:200-206,223`).

Conditions the plan does not state:

1. **Command order.** `ga4ConfigureAds` must run in the same effect as the consent update, after `ga4ConsentUpdate(categories)` (`ConsentScriptInjector.tsx:233-236`). gtag.js replays the queue in order. If AW is configured in an effect declared before the consent update, a returning consented visitor's first AW hit goes out in the denied state.
2. **Idempotency.** A module flag is not enough. The function must also skip when an `arguments` entry `['config', AW]` is already in `window.dataLayer`, for example from an edge-cached document that still has the old snippet. The `SSR_TAG_GLOBAL` stamp (`:93,293`) holds only `ga4||ads`, so it cannot tell whether AW was configured. Without this check, AW is configured twice. The double `config` and second Ads ping on entry are exactly what the stamp was added to prevent (`:83-91,360-364`). This is low impact, because old HTML usually loads old hashed entry chunks.
3. **Tests outside the plan's list.**
   - `ga4Client.test.ts:103-211` and `:372-382` must be rewritten (one asserts `ga4SsrSnippet("", "AW-…")` contains the AW config).
   - `ConsentScriptInjector.test.tsx:611-626`: `configCount(GOOGLE_ADS_ID)` should be 0, then 1 after marketing consent.
   - `analyticsHost.test.ts:29` still passes `"AW-1"`. That is harmless if the parameter stays.
   - Keep the `(measurementId, adsId)` signature, or update every caller.

Side notes:

- **Event order.** The router's first `page_view` (`ga4PageView`) is queued before the post-mount AW config, so that event goes to G only. The AW config sends its own default page_view, so Ads remarketing still gets one hit, as in prod (one `ccm/collect tid=AW-17612160320`).
- **Possible re-load.** If `VITE_GOOGLE_ADS_*_LABEL` is ever set, a `send_to AW-…/label` conversion event from a visitor without marketing consent may make gtag fetch the AW container anyway, on conversion only. Today neither label is set in the repo.
- **Business trade-off.** Advanced Consent Mode for Ads is lost for traffic without marketing consent; Ads falls back to basic mode. The owner has to decide (open question 2).
- **Verification gap.** The proposed e2e uses a gtag stub. It can prove what lands in the dataLayer, but not the real lazy load of the child container. Only a production LH run or a HAR can show that.

## Lens 2: effect. Verdict: CONFIRMED for the conditional TBT figure; expected lab effect is about 0

Prod-mobile trace, simulated:

- Total TBT is 202 ms. The AW task is 183 ms at 10459 ms and contributes 183 − 50 = 133 ms.
- TTI is 10642 ms, the end of the AW task. Without it, TTI becomes the end of G's 51 ms task at 8021 ms, about 8072 ms. All other long tasks still fall before that point.
- TBT therefore drops from 202 to 69 ms, i.e. −133 ms. Lighthouse runs with no consent stored, so marketing is false and AW never loads.

On the PSI host (k = 1.2 to 1.8 from F4):

- The saving would be −160 to −240 ms on mobile.
- That takes 600 ms to about 400–440 ms. On the TBT log-normal curve (p10 200, median 600) the score goes from 0.50 to about 0.67–0.72.
- At 30% weight that is +5 to +7 points.

But this applies only when gtag lands in the trace. With TP-1 (F3), 0 of 7 runs had a gtag request in the trace. On a slow PSI host the only way back in is TP-1's cap. So the expected lab effect is P(in-trace) × 5 points. With P around 0–10%, that is 0.5 point or less.

Desktop: the Lighthouse delta is 0 with TP-1, and there is no reliable conditional estimate (prod-desktop TBT is 0 on the M3).

Real users without marketing consent:

- −199,590 B transfer. It is low priority and comes after load, so it does not affect LCP.
- −185 ms simulated mobile CPU and one fewer long task after load.
- Field INP improves only when an interaction overlaps that task, which is small at p75. Field data does not count toward the Lighthouse score.

Is there a cheaper change? Not with the same effect. The edit is already effort S. The only cheaper option is to drop the AW config entirely and rely on GA4 key-event import (`conversions.ts:7-15`). That is about the same size but makes the business loss larger, so TP-2 is the right granularity.

Corrected estimate: Lighthouse lab ≈ 0 (≤ 0.5 point expected) once TP-1 lands. Conditional on gtag landing in the trace: −133 ms mobile TBT on the prod trace, −160 to −240 ms on PSI, +5 to +7 points. Real non-consenting users: −200 KB and −185 ms simulated CPU. These conclusions stand as long as the order and dataLayer-idempotency conditions above are implemented.
