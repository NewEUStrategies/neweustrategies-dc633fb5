# Verdict PA-C1 (bundle gate: chronicle XXII, boot ratchet, overall green)

## Lens 1 - feasibility: WEAKENED

The mechanism is valid: FROZEN_BUDGET_KB is at scripts/check-bundle-size.ts:1752-2045 (boot 579 at :2043), and entries XX and XXI (:1703-1750) set the chronicle convention. Tests read the frozen values from the file and override them through env (platformBuildGuards.test.ts:86,113-124), so they do not hard-code budget literals. CI build job 37139637892 (main 6a4215d) is red ONLY on "Bundle size budget". The other steps in that job are green.

What is wrong in the plan:

1. The per-chunk causes are wrong. The moves report compares against reports/bundle-baseline.json (b006c2e). Round 2 (81d84b1) refreshed that file from a LAPTOP build that had no `spreadsheet.worker` and no `i18n-event-front`. The previous baseline 46452fe88 had both, at 138.6 and 10.0. So "+139.8 spreadsheet.worker (NOWY)" and "+10.2 i18n-event-front (NOWY)" are artefacts of the baseline, not growth. admin.seo +7.4 is mostly the old i18n-admin-seo-hub (-6.1), renamed. Host-to-host against 46452fe88 (same xlsx 0.18.5 substitution): overall 4747.4 -> 4806.8 = +59.4 KB, spread over many chunks (templateKit +12.5, qa._slug +8.3, styles/admin-styles, ...). Several large moves are only renames: DockEmptyState vs WorkspaceDock, publicCfpErrors vs i18n-event-cfp, EmptyContainerPickerBox vs Builder, icons-0..3 vs lucideIconNodes.
2. The runner value is not the host value. The worker skew is +18.08 (entry XX: runner 4765.45 vs host 4747.374). Runner now ~ 4765.45 + (4806.85 - 4747.374) = 4824.9, so the runner breach is ~53 KB, not 34.8. A floor derived from the sandbox number (for example 4808) keeps CI red, while "bun run check:bundle on build:smoke exits 0" still passes locally. The verification step is insufficient: CI measures `bun run build` (cloudflare preset, ci.yml:993-1051).
3. The baseline cannot be refreshed here. Runner job logs are blocked (blob download 403). Entry V, restated at :1243, forbids --update-baseline from a host. reports/bundle-baseline.json must stay untouched or be refreshed only from the first green runner log.
4. "~485" contradicts the plan's own formula: 477.15 x 1.005 + 1 = 480.5 -> 481. With the host-runner skew from entry VII (+0.466%): 477.15 x 1.00466 = 479.4 -> 480 -> 481.
5. Ordering: the perf waves change boot (that is their purpose). Ratchet last, on the final tree. Ratcheting first makes every wave fight a moving floor.

## Lens 2 - effect: WEAKENED (no score effect)

This is a CI-only change. It saves 0 bytes and 0 ms, so 0 Lighthouse points on mobile or desktop. A gzip gate on boot is only a proxy for TBT: parse and compile on 4x CPU scale with RAW bytes (1568 KB), which are not gated (:2470-2480). "Main goes green" holds only if OVERALL is floored from the runner-estimated value (~4826) or ~53 KB of admin code is cut. The second option is not effort S.

## Corrected estimate

- Score: +0 pts.
- OVERALL floor: 4765.45 + (4806.85 - 4747.374) = 4824.93 -> 4825 -> 4826, pending the first green runner log (entry V). Chronicle XXII should attribute causes against 46452fe88, not b006c2e.
- BOOT floor: 481, not 485.
- Optionally add a raw-boot gate: 1568.0 x 1.005 -> ~1577 KB.
