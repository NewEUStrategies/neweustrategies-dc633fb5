# Popup registration: first render and CMS media

Owner: Fundacja New European Strategies. Date: 2026-09-29.
Base: `bb6a339d59d6b3bcfdaa71bf68abd1d650b6fc16`.

## Problem and evidence

The screenshot shows the registration popup's showcase layout. On the inspected
revision, the first-visit path was: hydration -> idle overlay shell -> newsletter
settings -> trigger/consent -> empty modal -> selected lazy module -> discovery of
original image URLs -> native lazy image fetch. The showcase close control lived
inside the unloaded module. Focus trapping and body locking started before its
contents arrived. The image URLs also bypassed `mediaRenderUrl`, so admin-uploaded
branded URLs could point a preview at the production host.

SSR (server-side rendering) and hydration are already present. A marketing popup
initially hidden on both server and client should stay outside the critical SSR
response. Adding its form or all media to the root loader/HTML would compete with
the page's primary content. Code splitting is already present; the missing piece
is resource scheduling and readiness, not increasing the number of chunks.

## Implementation sequence and acceptance

1. **Complete panel before opening.** Load only the selected showcase, document or
   form module. Warm it in idle time within the existing delay (1.5s lead), or
   after 1s for scroll/exit-intent. On Data Saver, prepare only at the trigger.
   Take the coordinated overlay slot only after code is ready. Preserve consent,
   frequency, route cancellation, account creation and focus restoration. A failed
   speculative import can retry at the trigger; a final failure leaves the page
   usable and records `content_load_failed` instead of showing a blank modal.
2. **CMS media delivery.** Use the same media atom in admin preview and frontend.
   Normalize owned media to the current origin; use `srcset` and layout-derived
   `sizes`, native eager loading once visible and asynchronous decoding. Warm
   first-party visible frames with identical responsive candidates and low
   priority, in parallel with code. External URLs stay unchanged. Retry original
   media on a transform failure, then preserve the image frame if missing.
   Single-image mode renders only the active slide; rotation is bounded to the
   four supported gallery slots. Stacked/split images use the same delivery path.
3. **Regression verification.** Run focused popup, registration and image tests,
   type checking, formatting/lint, a production smoke build and chunk gates.
   Exercise slow chunk delivery, complete form/close controls, CMS images including
   failed transforms, mobile width and reduced viewport height on that artifact.
4. **Deployment acceptance.** After review/merge and publication, repeat cold-cache
   visits on production and Lovable preview with the actual uploaded images and
   live settings. Check real phone keyboard, PL/EN, all three layouts, consent
   acceptance/rejection, focus/close, data saving and missing media. Verify account
   and confirmation-mail delivery in the existing disposable registration harness
   or an explicitly designated test environment.

## Measurement contract

Field targets, measured at the 75th percentile separately for mobile and desktop:
LCP (Largest Contentful Paint) <= 2.5s; INP (Interaction to Next Paint) <= 200ms;
CLS (Cumulative Layout Shift) <= 0.1. Track actual cold-visit network requests,
image bytes/currentSrc, trigger-to-complete-panel time, import errors and layout
shifts. No popup form/panel chunks should enter the initial hydration graph.

These are acceptance targets, not claimed results. Synthetic fixture tests prove
loading behavior and layout, not actual image byte savings or production Core Web
Vitals. Lighthouse laboratory scores cannot replace field INP/CrUX data. No new
SSR data fetch or unconditional high-priority popup preload is added. Images on a
very slow connection may still finish after opening; image decoding does not
block access to the registration form indefinitely.

The next performance decision is evidence-led: compare current and changed cold
visits before expanding work to unrelated homepage widgets or changing manual
vendor chunk rules. No new service or recurring infrastructure charge is required
by this change; existing image transformation traffic remains subject to hosting
limits and billing. An unsupported transform falls back to the original file.

## Validation results

- 166 focused tests passed (8 files), covering existing registration behavior,
  popup eligibility/focus, delayed and rejected imports, image fallback, gallery
  loading and client/smoke chunk-config parity.
- Changed files passed Prettier and ESLint. Production TypeScript plus changed
  tests passed in a temporary configuration excluding the unrelated test suite.
- Vite's client and SSR compilation completed. The final Nitro packaging step
  exhausted the local heap; the full repository typecheck also exceeded available
  memory. Neither complete gate is reported as passed. They remain CI gates.
- The generated browser graph contains 1,009 chunks and 7,093 static edges, with
  no cycles. The boot closure has 9 chunks, passes the existing entry-purity gate
  and contains no NewsletterPopup, SignupPopupPanel or PopupSignupForm chunks.
  This is a structural check, not a measured reduction versus the base artifact.
- Two Chromium 153 browser cases passed at 1440x1000 and 390x844, including a held
  popup chunk, all four gallery images, a failed transform with original fallback,
  Escape, horizontal overflow and a 390x420 reduced viewport. The client and SSR
  build outputs were served through a temporary Node HTTP adapter because final
  Nitro packaging could not finish locally. This verifies those compiled outputs,
  not the final deployment adapter. The browser received synthetic CMS records and
  synthetic images; no production registrations, mail or database writes occurred.
- The browser fixture is shared between SSR and client replay. A client-only
  override was masked by the fresh disabled settings hydrated from SSR; the first
  test attempt caught that harness error, which was corrected before the two
  passing cases. The test is wired into `test:e2e:performance`.

Run the browser gate on a fully packaged artifact:

```sh
NES_PERFORMANCE_CASE=popup-first-render bunx playwright test --config playwright.performance.config.ts e2e-performance/popup-first-render.spec.ts
```

Still required: full CI, production/preview cold visits with the actual CMS uploads,
real phone keyboard, live confirmation-mail acceptance, and post-deployment field
LCP/INP/CLS. This change is prepared for review, not deployed to production.

## References

- [Google: Web Vitals](https://web.dev/articles/vitals)
- [Google: Optimize LCP](https://web.dev/articles/optimize-lcp)
- [React: hydrateRoot](https://react.dev/reference/react-dom/client/hydrateRoot)
