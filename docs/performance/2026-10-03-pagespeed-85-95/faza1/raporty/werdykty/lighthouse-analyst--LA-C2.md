# Verdict LA-C2: gtag/AW and the consent+popup group out of the TBT window

Feasibility: WEAKENED. Effect: WEAKENED (gtag half is under-estimated; consent half is over-credited).

## Lens 1: feasibility in this codebase

1. **The interaction/consent/idle policy already exists and is in production.**
   - `src/lib/analytics/gtagLoadPolicy.ts:13-28,43-47,187-219` already loads on (a) interaction, (b) a saved consent decision, or (c) load + 2 s, then 1.5 s with no long tasks, capped at 8 s. It landed in 81d84b1 on 2026-10-02.
   - Production HTML (`psi/home.html`) has only the inline snippet and no `gtag/js` `<script src>`.
   - In the M3 prod run, G is requested at 5 867 ms obs. That is load 3 364 + 2 503 ms, which is policy (c) as it stands. So "load gtag only on interaction or consent" is not new work.
   - The real change is to retune signal (c) so it fires after Lighthouse stops recording.
2. **Why the current fallback is still observed.**
   - Lighthouse stops at load + 1 s AND network-2-quiet for 1 s AND critical-idle, then CPU quiet for 1 s (`tools/node_modules/lighthouse/core/gather/driver/wait-for-condition.js:409-480`; `constants.js:56-59`).
   - In prod, Supabase refetches run until 5 491 ms, so the trace was still open at 5 867.
   - Lantern counts every long task in the trace. TTI is the end of the last task over 50 ms (Interactive.getLastLongTaskEndTime), and timer delays are not simulated. So moving gtag later in _observed_ time does nothing as long as it stays in the trace. That explains why round 2 did not move TBT.
3. **A working rule exists.** Fire (c) only after 5 s with no long task AND no resource responseEnd, and at least 5 s after load. The third-party workstream's v2 does this (third-party.md:107-121). Their A/B: in 7/7 runs gtag never appeared in the network records.
4. **"Or chunk their work" for gtag is infeasible.** The AW container (`gtag/js?id=AW-…&cx=c`) is Google code. G loads it itself because the SSR snippet runs `config AW` (`ga4Client.ts:265-306`, `__root.tsx:491-493`). Its 183 ms sim task cannot be split from our side.
5. **Consent/popup half.**
   - The only legal gate for `ConsentBanner` is the passage of time (`__root.tsx:229-239`, contract: sole writer of `setMarketingConsent`).
   - Delaying it still inside the trace removes 0 ms of TBT, for the same Lantern reasons as gtag.
   - It also risks LCP. The banner paragraph has been the lab LCP element before (`__root.tsx:214-221`, F30). A later and larger text block would move LCP later.
   - Delaying it past the trace end flips the order for real users: gtag on first scroll (cookieless pings) would come before the consent offer. That needs a compliance review.
   - "Split" (render work in slices under ~12 ms obs) is feasible but is W1/hydration-type work. It is not a mount delay.
   - `PopupHost`/`NewsletterPopup`/`Toaster` (`__root.tsx:213,275,302`; NewsletterPopup prepare warm ≈ 45 KB) render nothing visible. They can be moved to interaction or the same 5 s quiet rule safely, except builder popups with immediate or timed triggers (a business call).
6. **Gates.**
   - The gtag retune is a pure module and is safe for check:bundle, check:chunks, check:entry-purity and check:ssr-budgets. Its tests use the exported constants (`gtagLoadPolicy.test.ts:164-270`), so new resource-quiet tests are needed.
   - SSR parity holds: the banner renders null in SSR and in the first client render.
   - There is no i18n/SEO impact.
   - Business cost: no `page_view` and no AW remarketing ping for non-interacting visits that end before about load + 10 s.

## Lens 2: effect realism

- M3 prod mobile: TBT 202 → about 49 when gtag leaves the trace. TTI drops from 10 642 to about 7 060. The removed blocking is AW 133 + G 19 + 1 = 153 ms.
- On PSI the gtag blocking scales with host speed (obs × 4 × k).
  - At k = 1.2 it is 212 ms; the Lantern long-task list gives an upper bound of 395 ms (third-party §1a).
  - Measured on this sandbox with fake gtag: cur 1 103 vs new 445 (ctl 426).
  - So −120…−180 is the low end. A realistic range is −150…−300 ms, central about −200.
- Mobile score at the PSI operating point (TBT 600, score 0.50, weight 30): 600→450 = +3.9, 600→400 ≈ +5.9, 600→300 = +8.7. Corrected: **+4…+8, central +6**.
- Desktop: 740→620 = +1.6…+2, 740→460 ≈ +6. The desktop range −120…−280 holds.
- Consent/popup: 92 ms latent on the fixture at ×4 (about 60 ms on PSI). A mount delay alone gives 0 unless the work leaves the trace. Splitting gives about −30…−60 ms, roughly +1 pt mobile. Do not book it under this change.
- Cheaper or extra lever: configure AW only on marketing consent (third-party §2.3). This removes the AW 183 ms task whenever gtag does land in the trace (slow host, cap), which makes the gain robust. Effort for the gtag part is S, not M.
- Uncertainty: there is no PSI JSON, so it is unverified that gtag is in the PSI trace today. If PSI's trace already ends before gtag, the gain is 0. This is unlikely, given the 10-02 → 10-03 numbers and the sandbox reproduction.
