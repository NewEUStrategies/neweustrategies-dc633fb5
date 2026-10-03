# Verdict PA-C3: productise check:document-weight (ratchet-only)

Feasibility: WEAKENED (the mechanism works, but not as specified). Effect: CONFIRMED (no direct score change, as the change itself claims).

## Lens 1: feasibility in this codebase

Commands run (read-only, checkout f261c49, existing `.output` from 17:42):

- `node scripts/performance/check-document-weight.ts --json ...`: **PASS**. HTML 391114 B raw / 54475 B gzip, boot 485279 B gzip, inline style 132888 B in 50 blocks. All 19 metrics are under their limits.
- `bun run scripts/performance/check-document-weight.ts --json ...`: **FAIL**, exit 1: `htmlGzipBytes 55567 > 55565`. Under bun, every gzip metric reads about 2 % higher (boot 488589 vs 485279, render-blocking CSS 80022 vs 79802), and raw HTML reads 391427 instead of 391114. The budgets were measured with node's zlib (`documentWeight.ts:135` `gzipSync(raw)`, `:353` `gzipSync(..., {level: 6})`). With 2 % headroom, bun's deflate uses up the whole margin.
- `prettier --check`, `eslint` and `tsc -p tsconfig.scripts.json` on the draft files: all clean, 0 errors. `node --test scripts/performance/document-weight.test.mjs`: 7/7 pass.

Blocking issues:

1. **The file list leaves out a hidden import.** `check-document-weight.ts:28-35` imports `startArtifact/fetchDocument/warmDocument/freePort/HARNESS_ROOT` from `./artifactServer.ts`, which is untracked and not in the change's file list. Committing only the listed files gives a module-not-found error in CI. The unit test `document-weight.test.mjs:19` also imports `./lighthouseReport.ts`, which is untracked too. `artifactServer.ts` is shared with `lighthouse-local.mjs`, so the commit needs to say which change owns it.
2. **Runtime.** House convention is `"check:x": "bun run scripts/..."`. Wired that way, the gate is red on the baseline today. The package script must call `node scripts/performance/check-document-weight.ts`, like `check:first-visit-regression` does at package.json:96. The workflow can still call `bun run check:document-weight`, which is what `check:gate-coverage` scans for (`gateCoverage.ts` RUN_RE). The other option is to re-ratchet the budgets under bun 1.2.23 as CI runs it, but node is the more stable choice.
3. **Placement in CI.** The step must sit in job `build` after "Build production artifact for a node server (smoke preset)" (`ci.yml:1118-1124`). Running it before that step would measure the cloudflare `.output`, and running it in another job means it has no artifact. CI builds with `VITE_SUPABASE_URL=placeholder.supabase.co` (or the secret). The fixture still intercepts SSR because `homeFixture.ts:97-103` accepts any `*.supabase.co` host. The only difference is `window.__SUPABASE_CONFIG__`: about 200 B raw and about 170 B gzip with a real anon JWT, which fits in the 1090 B gzip headroom measured under node. The preconnect origin is a constant (`rootHead.ts:65,112`), so `linkHeaderEntries` does not depend on the environment. Node 24.19 in CI does type-stripping, so `replayFetch.mjs` and `homeFixture.ts` load.
4. **`verify-static.ts` EXCLUDED** needs `"check:document-weight": "artifact build:smoke (.output) + fixture"`. Without it, `verify:static` goes red on any machine with no `.output`. The proposal states this correctly.

Non-blocking risks the plan understates (it rates the change "low"):

- Count budgets have **zero headroom**: `inlineStyleCount 50/50`, `modulepreloadCount 25/25`, `linkHeaderEntries 31/31`, `preloadDuplicates 22/22`, `imgFetchpriorityHigh 9/9`. Any legitimate new above-the-fold widget, or a Lovable-bot commit straight to main (PA-F7: 78/245 commits), turns `build` red. That is the gate working as intended, but every such PR then needs an edit to the budgets file, and `--ratchet` cannot raise a limit (`ratchetBudgets` takes the minimum).
- The budgets depend on `e2e/fixtures/first-visit.json`. A wave that enriches the fixture (for example to get closer to the 569 KB production document) shifts every number up, so the "only down" rule has to be broken by hand. That should be documented as a separate commit with a re-measurement.
- The gate overlaps two others. Boot gzip is now measured twice with different zlib: `check:bundle` under bun reads 477.1 KB (limit 579), and this gate under node reads 473.9 KB (limit 483.4). Same quantity, two readings. Worth one sentence in `_comment`. This gate does close PA-F3, because `bootClosureRawBytes` gets gated at 1599.4 KB.
- The default `--json` output goes to `reports/document-weight.json` in the repo (gitignored). Optionally upload it as a CI artifact.
- No SSR/hydration, i18n, SEO or editor impact: the change is tooling only and touches no `src/`.

The stated verification works: a 10 KB inline style gives htmlRaw 391114 + 10240 = 401354 > 398937, inlineStyleBytes 143128 > 135546, and inlineStyleCount 51 > 50. That is three failures.

## Lens 2: effect on the Lighthouse score

- Direct score change: **0**. The gate ships no bytes to the browser. The claim says exactly that, so it is confirmed.
- The listed metric attribution (FCP, SI, LCP from HTML bytes) is right in principle, but the gate protects the fixture, not production. Fixture: 54.5 KB gzip HTML. Production: 78 KB gzip, 569 KB raw, with the LCP image preloaded 4-6 times. On mobile at 1.6 Mb/s ≈ 200 KB/s, the 2 % gzip headroom (1.1 KB) is about 5 ms of transfer, so a regression of up to the headroom is invisible to the score. What the gate really protects is the structure: count metrics and new inline blocks, which together are worth tens of KB in production. Its value is only as large as the waves it locks in. Example: if html-weight takes inline style from 133 KB to 20 KB, that is about 25-30 KB gzip of the HTML, roughly 0.15 s FCP/LCP on mobile and maybe 1-2 points. The gate stops that from silently coming back.
- No cheaper alternative gives the same effect. `check:ssr-budgets` is static and does not see the rendered HTML. `check:bundle` does not see HTML or inline CSS. Lighthouse mode C only enforces CLS and TBT as errors. This is the only deterministic gate on document weight. Effort M is reasonable; most of the effort is CI wiring and committing the dependencies.

Corrected estimate: 0 points directly. Insurance for the locked-in gains, only after the waves land. Risk is medium (zero-headroom counts plus direct commits to main plus the runtime pitfall), not low.
