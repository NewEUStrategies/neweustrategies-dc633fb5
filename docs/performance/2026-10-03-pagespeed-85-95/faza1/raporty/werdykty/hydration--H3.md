# Verdict hydration/H3: load the interest catalog and footer slide-up placements on demand

Feasibility: WEAKENED. Effect: REFUTED (both the size and the attribution).

Corrected estimate:

- Network: -3 fetches and -3 preflights in prod is confirmed. In the harness it is -9 fetches and -9 preflights, all of which already fail.
- TBT: 0 ms in the canonical harness. On a prod-like LH mobile run, 0 to -40 ms, all of it from the catalog half; the ad half is about 0. Desktop: 0.
- Once H7 lands (JoinUs not hydrated in the LH window), the incremental effect is about 0.
- Score: 0 to +1 point on mobile, 0 on desktop.
- The 166-198 ms recalc belongs to H6 only.

## Lens 1: does the mechanism work in this codebase?

1. **The trigger only exists after the catalog loads.**
   - JoinUsForm renders `TopicsDroplist` only when `showInterests && allItems.length > 0` (JoinUsForm.tsx:861).
   - `TopicsDroplist` itself returns null for an empty list (TopicsDroplist.tsx:209).
   - A unit test pins this: "PUSTY katalog nie renderuje NICZEGO - ani nagłówka, ani przycisku" ("an EMPTY catalog renders NOTHING - neither heading nor button", topicsDroplist.test.tsx:259).
   - So `enabled = dropOpen` can never become true: the button you would open is never rendered.
   - H3 needs a new "pending vs empty" state: render the heading and trigger while the catalog has not been fetched, and hide them once a fetched catalog (or the `interestSlugs` filter, test :225) turns out empty.
   - That changes the SSR markup. The heading and trigger now appear in SSR, where today nothing is rendered. Parity still holds because both sides render it. CLS is actually better for real users: today the block pops in at about 5.5 s.
   - It also needs loading and a11y states for a popup with no options yet (aria-busy, loading text in i18n-interests PL and EN), plus test changes.
2. **Picked pills.**
   - `picked` is seeded from `useMyInterests`: `user_follows` for logged-in users, localStorage `nes.interests.anon.v1` for anonymous ones (JoinUsForm.tsx:272-275).
   - The pills take their labels from `allItems` (TopicsDroplist.tsx:225-227).
   - So `enabled` must also be true when `picked.size > 0`. Otherwise returning or logged-in users see "N selected" with no pills.
3. **Submit path regressions** if the catalog has not loaded when the user submits:
   - :347: the `requireInterests` check is bypassed (`allItems.length > 0 && ...`).
   - :404-405: the CRM `interests*` custom fields are silently dropped.
   - :464: `my.save` is skipped.
   - "Enabled on submit" as a state flip does not help, because the handler closes over a stale `allItems`.
   - The fix is to `await queryClient.fetchQuery(interestCatalogQueryOptions(lang))` before validation. That requires pulling the inline queryFn out of the hook (useInterests.ts:67-127) into a query-options factory: the doctrine in ads/queries.ts:151-157 says the key and queryFn live in one place. The same factory is needed for prefetch-on-hover and for the chips SSR warm.
4. **Chips SSR warm.**
   - Two registries must both change: prefetch.ts ~:277 (`sectionQueryOptionsList`) and the key/staleTime list at ~:507.
   - It adds a categories+tags read to the SSR second wave, which `check:ssr-budgets` caps at 6 parallel subrequests ($.tsx:504-507).
   - Not relevant to prod `/`: the prod home JoinUs has `showInterests:"1"`, `requireInterests:"0"` and no `interestsDisplay`, so it uses the default droplist (psi/home.html).
5. **Builder canvas.** Keep the catalog eager when `useBuilderMode() !== null`, so editors still see the droplist and chips.
6. **Other consumers keep fetching.** NewsletterForm.tsx:126 and NewsletterSubscribedPanel.tsx:39 also call `useInterestGroups`. A default of `enabled: true` leaves them as they are, so H3 only covers JoinUs.
7. **FooterSlideup is feasible.**
   - `useAdPlacements` needs an options argument (queries.ts:285-306). `enabled: false` still returns SSR-warm data.
   - The delay tests (footerSlideup.test.tsx:228-275) assume the bar shows after the delay with no interaction, so they change. This is a product change: bouncers never see the bar, so impressions drop. It needs sign-off.
   - Not SSR-warming `footer_slideup` matches the repo doctrine ($.tsx:497-502).
   - Share the "first interaction" listener with H7's island gate.
8. **Gates.**
   - check:loader-policy: no loader changes unless the chips warm is added.
   - noHasSelectors and check:chunks: unaffected.
   - check:entry-purity: the shared interaction hook must stay dependency-free.

## Lens 2: does the effect show up in the Lighthouse score?

- **The recalc is double-counted.** The 166-198 ms ULT (797 elements, at 7401 ms PO time / 7317 ms trace time in runs/m4-ok-1) is the BuilderRenderer device-switch commit.
  - The `data-device` flip is at 7391 ms. The JoinUs `input` name/type "rewrites" at 7390.7 ms are no-ops (old == new) inside that same commit.
  - In m4b-ok-2 everything lands at 8788.5 ms, which is the device flip at 8788 ms.
  - In m4b-ok-1 and m4b-ok-3 the switch never commits. There are no JoinUs input rewrites at all, although the catalog requests were sent.
  - The catalog-arrival commits in m4-ok-1 (7139, 7149 and 7208 ms, after responses at 7118-7122 ms) are all under 50 ms: there is no long task between 3504 and 7396 ms PO time.
  - H6 already claims this same recalc ("-1 recalc of ~800 elements 166-198 ms").
- **FCP, LCP and SI: 0.** Every H3 request starts after observed LCP:
  - prod mobile: 4531 ms vs obsLCP 3303 ms;
  - prod desktop: 4232 ms vs 3722 ms;
  - harness: ≥753 ms vs ≤544 ms.
  - So they are not in Lantern's FCP or LCP graphs. TTI is not scored, and in prod it is pinned by gtag at 10.46 s.
- **Canonical harness: no measurable change.**
  - The browser backend at 127.0.0.1:4199 is dead: status -1, three attempts per request (baseline2-mobile-1, css-cv-A-mobile-1).
  - The fixture's `categories`, `tags` and `ad_placements` tables are empty (homeFixture.ts:43-56).
  - So the catalog never arrives with data and nothing re-renders. ΔTBT is about 0, with only a few ms of supabase-js request/error microtasks, against ±464 ms A/A noise.
  - An HTML-transform what-if cannot model this JS behaviour change, and it would be A=A anyway. I did not run one.
- **Prod LH mobile (M3 host): saving ≤ 38 ms.**
  - TBT 202 = gtag (133+19+1) + React (88-50 = 38 at sim 6972 ms, 59-50 = 9, 52-50 = 2).
  - JoinUsForm's chunk loads at 5.02-5.26 s and the catalog lands at 5.49 s, so the 88 ms vendor-react task is the only candidate.
  - Upper bound: -38 ms, which is about +1.2 points near TBT 250 (log-normal 200/600: 0.846 → 0.888 at 212 ms, × 30).
  - The ad half is about 0: no creative or impression request in the window, and the handler is trivial.
  - Desktop prod TBT is 0, so 0 there.
- **PSI.** The host is slower (TBT 600). If that same task is about 2× longer: -80 to -140 ms at most, or +2 to +3 points at TBT 600. That holds only if H6 and H7 have not landed and the task really is the catalog re-render. Neither is verifiable offline.
- **Overlap with H7.** H7 islands stop JoinUsForm hydrating in the LH window if JoinUs sits beyond the 1-viewport rootMargin. Then the catalog request vanishes anyway and H3's catalog half adds about 0.

## Better alternative

- Book the catalog effect under H7 (island gating). Ship H3 as a robustness and real-user change:
  - (a) `interestCatalogQueryOptions` factory, plus `await fetchQuery` in submit;
  - (b) `enabled = dropOpen || picked.size > 0 || inBuilder || display === 'chips'`, with the trigger rendered while pending; drop the SSR warm for chips;
  - (c) FooterSlideup `enabled` on first interaction, using the shared H7 interaction hook, after business sign-off.
- Score it as 0 to +1 point, not -80 to -150 ms.
