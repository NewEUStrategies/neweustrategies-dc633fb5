# Verdict M2: document-weight gate + mobile LH A/B in first-visit.yml

Feasibility: WEAKENED. Effect: WEAKENED (a guardrail with 0 direct score points; the LH part costs 8-10 CI minutes for a signal the static gate already gives).

## What I ran (read-only)

- `node scripts/performance/check-document-weight.ts --json $SCRATCH/m2t/dw-node.json`: green, 5.8 s, all 19 metrics within budget.
- `bun run scripts/performance/check-document-weight.ts --json $SCRATCH/m2t/dw-bun.json`: green, but the gzip metrics drift (see 2).
- `node --test scripts/performance/document-weight.test.mjs`: 7/7 pass.
- Per-run byte metrics recomputed with the current `extractMetrics` over every saved LHR (`$SCRATCH/m2t/perrun.mjs`).
- `gh run view 37142944502`: the current job takes 13.2 min (192 s + 191 s for the two builds, 333 s paired Playwright).

## Lens 1: feasibility in this codebase

1. **The blocking LH byte comparator does not exist.** `scripts/performance/lighthouse-local.mjs:413-427` only prints `deltaLine`. Its only `process.exitCode = 1` is in the exception handler (`:504`). "Block on scriptTransferBytes/highPriorityBytesBeforeLcpImage > +1 %" needs a new comparator over `summary.json`, and no such file is in the change's list.
2. **Runtime parity: gzip metrics depend on the JS runtime.** Bun's zlib (`12731092…`) differs from node's (`1.3.1-470d3a2`).

   | metric               | node    | bun     | max                                 |
   | -------------------- | ------- | ------- | ----------------------------------- |
   | htmlGzipBytes        | 54 469  | 55 432  | 55 565 (bun leaves 0.24 % headroom) |
   | bootClosureGzipBytes | 485 279 | 488 589 | 494 985                             |
   | preloadedJsGzipBytes | 561 750 | 565 376 | 572 985                             |

   Under bun, `startArtifact` also launches the SSR server with bun, because `artifactServer.ts:214` spawns `process.execPath`. The house style is `"check:x": "bun run scripts/…ts"`, and the file's own Usage line says `bun run`. Written that way, the gate measures on a different runtime from the one the budgets were ratcheted on. A PR adding about 150 B of gzipped HTML would then turn red. The package.json script MUST be `node scripts/performance/check-document-weight.ts` (precedent: `check:first-visit-regression` = `node …`, package.json:96). This also corrects measurement.md's claim that 473.9 KB matches check:bundle's 477.5 KB "within header noise": check:bundle runs under bun, and bun gives 477.1 KB.

3. **check:gate-coverage.** `src/lib/ci/gateCoverage.ts:57` counts only `bun run <script>` inside `run:`. If the workflow calls `node scripts/performance/check-document-weight.ts` as the mechanism text says, `check:document-weight` counts as unwired and the gate fails. If both baseline and candidate go through `bun run check:document-weight`, it is a duplicate in job `first-visit` and fails (`:178-196`). Rule: the candidate goes through `bun run check:document-weight -- --root ../candidate --json reports/document-weight.json`. The baseline goes through `node scripts/… --root ../baseline --json reports/document-weight-baseline.json || true`. A distinct `--json` is needed: the default path at `check-document-weight.ts:219` is shared, and the second run would overwrite the first.
4. **Hidden edge: `scripts/verify-static.ts`** (not in the file list). `gateNames()` (`:71-78`) pulls in every new `check:*` unless it is listed in `EXCLUDED` (`:27-56`). Without an entry, the local `verify:static` / `verify:blocking` pre-push command runs the gate. It throws "Brak .output/server/index.mjs" (`artifactServer.ts:175-177`) for anyone without a build, or measures a stale `.output`.
5. **check:workflow-env-contract.** `CHROME_PATH` is read only by chrome-launcher. It is not read through `process.env.CHROME_PATH` anywhere in the repo, so an `env:` declaration would be flagged as orphaned (`workflowEnvContract.ts:135-150`; `TOOL_CONSUMED` does not list it). Set it via `$GITHUB_ENV`, as `lighthouse.yml:255` does, or leave it unset (ubuntu-latest has google-chrome).
6. **The "re-ratchet from first runner log" mitigation cannot raise a budget.** `documentWeight.ts:466` uses `Math.min(previous.max, proposed)`. If node 24.19 on the runner measures above `max`, `--ratchet` cannot fix it. The fix is a one-time hand-edited re-baseline commit with justification, which the budget file's `_comment` requires anyway.
7. **Supabase URL.** The local `.output` has `https://unnltowbgszpdzwpawdu.supabase.co` baked into `index-*.js`; CI builds with `http://127.0.0.1:4199`. This is about −19 B raw per occurrence and does not touch counts. `SUPABASE_PRECONNECT_ORIGIN` is hard-coded (`src/lib/seo/rootHead.ts:30`), so `linkHeaderEntries` is unaffected. The risk note is correct here.
8. **Byte determinism of the LH metrics.** With the current fallback, 47 saved runs give `scriptTransferBytes` = 710.2-710.3 KB and `highPriorityBytesBeforeLcpImage` = 618.3 KB, except `baseline-h2/mobile-2` (0.0, LCP image unresolved). The n=3 median survives one 0. Two zeros on side A, or one on each side with the other run failing, would trip a false +∞ % block. The comparator must skip when `lcpImageUrl` is empty on either side.
9. **Timeout and idle-wait.** `--idle-wait` defaults to 180 s per run whenever loadavg > nCPU (`lighthouse-local.mjs:99,148,229-235`). Expected job time: 13.2 + 6 runs × 60-90 s + npx install + 2 × 6 s ≈ 21-24 min, which fits in 35. In the worst case the idle-wait adds up to 6 × 180 s = 18 min (≈ 42 min > 35). CI must pass `--idle-wait 30` (or `--max-load 8`).
10. **What does work.** The negative control is real: `inlineStyleCount` has max = measured = 50 (exact counts), so one added `<style>` is red. Node 24.19 strips the `.ts` imports. openssl and Chrome are on ubuntu-latest. The baseline uses its own `replayFetch.mjs` (`artifactServer.ts:190-193`). Nothing in the change touches SSR, i18n, CLS or the chunk graph.

## Lens 2: effect realism

- This is a guardrail: **0 score points**. Its value is that regressions which would cost points get blocked. Example: one extra 20 KB-gzip modulepreload, at 1.6 Mb/s ≈ 200 KB/s on the shared h2 pipe ahead of the LCP image, costs ≈ +100 ms mobile LCP. The deterministic static gate already catches it (`preloadedJsCount` is exact, `preloadedJsGzipBytes` is +2 %), in 6 s.
- The LH byte gate is redundant. `highPriorityBytesBeforeLcpImage` (618 KB) is essentially `preloadedJsGzipBytes` (549 KB) plus CSS and fonts, all statically gated. `scriptTransferBytes` overlaps check:bundle. Neither adds coverage worth about 8-10 runner minutes per PR.
- The timing DELTA line is misleading at n=3 on a shared 4-vCPU runner. A/A gives TBT ±464 ms and perf −13. Mobile FCP is bimodal (2.9 s vs 4.1 s, F4), so a 3-run median can move about 1.1 s on one race. Reviewers will read noise as signal, so at minimum print the FCP mode per run, or run n≥5.
- **A cheaper change gets the same protection:** run the static document-weight gate blocking on node, plus the unit test, on every PR (≈ +10 s). Run LH A/B report-only, n=5, only when `src/**`, `vite*.config.ts` or `package.json` change (or on a label), with `--idle-wait 30`. Drop the LH byte block.

## Corrected estimate

- Blocking static gate: ≈ 6 s per side, deterministic. It blocks structural regressions of HTML, inline style/script, state, preloads, boot and the High JS pool.
- LH A/B: +7-10 min per PR (6 × 60-90 s plus setup), 0 additional blocked regression classes, and a noisy timing report.
- Direct score effect: 0.
- Required edits beyond the list:
  - `scripts/verify-static.ts` EXCLUDED entry.
  - A new LH byte comparator script, or drop that block.
  - The package.json script must use `node`, not `bun run`.
  - Candidate invoked via `bun run check:document-weight` exactly once; baseline via `node …` with a distinct `--json`.
  - CHROME_PATH not in `env:`.
  - `--idle-wait 30`.
