export const meta = {
  name: "pagespeed-phase2-wave",
  description:
    "PageSpeed 85/95: implement one wave of PLAN.md items in parallel git worktrees (Opus): implement -> adversarial review -> fix -> build + repo gates + interleaved Lighthouse A/B against the baseline artifact",
  phases: [
    {
      title: "Implement",
      detail: "one Opus agent per item in its own worktree, fast gates, commit",
    },
    {
      title: "Review",
      detail: "adversarial reviewer per item (parity, doctrine, gates, i18n, a11y)",
    },
    { title: "Fix", detail: "implementer addresses blocking review findings (max 2 rounds)" },
    {
      title: "Prove",
      detail:
        "build:smoke under the machine mutex, check:* gates, document-weight gate, lighthouse-local --compare vs baseline (3 interleaved runs)",
    },
  ],
};

const SCRATCH =
  "/tmp/claude-0/-home-user-neweustrategies-dc633fb5/8fd9e8e2-d544-5db4-ae5e-c509c5e3ff6c/scratchpad";
const WT = "/home/user/neweustrategies-dc633fb5";
const EVIDENCE = WT + "/docs/performance/2026-10-03-pagespeed-85-95/EVIDENCE.md";
const PLAN = (args && args.plan_path) || SCRATCH + "/phase1/PLAN.md";
const BASE_REF = (args && args.base_ref) || "perf/pagespeed-mobile85-desktop95-t595d6";
const BASELINE_WT = (args && args.baseline_wt) || WT;
const WAVE = (args && args.wave) || 1;
const ITEMS = (args && args.items) || [];
const OUT = SCRATCH + "/phase2/wave" + WAVE;
const MAX_FIX_ROUNDS = 2;

if (!ITEMS.length) throw new Error("args.items is empty");

const TRAILER = `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M84vURVZ4xnvk1AVmdDF5B`;

const COMMON = `
You are a senior engineer (Opus) implementing ONE item of a web-performance plan under a Fable 5.1 orchestrator, in a TanStack Start + React 19 + Vite 7 + Nitro (Cloudflare Workers) + Supabase content platform. Goal of the whole effort: Lighthouse mobile >= 85, desktop >= 95 on https://neweuropeanstrategies.com/.
Read first: ${PLAN} (your item and the file-ownership matrix), ${EVIDENCE} section 0-cloud (environment: no network, fixture backend, 4 CPUs, one build at a time) and the report of the workstream your item comes from (${SCRATCH}/phase1/<workstream>.md).
Repository rules: Polish for comments, docs and commit messages (imperative, like the git log); TypeScript strict; no new dependencies; prettier formatting (bunx prettier --write on files you touch); keep SSR/hydration parity byte-for-byte for chrome; respect chunk-graph doctrine (no manualChunks changes without reading scripts/lib/bootVendorSplit.ts and the 2026-07-20 incident notes; check:chunks must stay acyclic); keep setTimeout(0) before hydrate in router.tsx; i18n via dictionaries only (check:i18n-hardcoded); every behavioural change gets or updates a vitest test; mark bundle-budget moves in the kronika of scripts/check-bundle-size.ts only when a budget line must change and only with measured numbers.
Never touch files outside your item's ownership (the matrix in PLAN.md) — if you must, stop and report it in your output instead.
`;

function implPrompt(item, round, review) {
  const wt = `${SCRATCH}/wt/${item.id}`;
  return `${COMMON}
YOUR ITEM (wave ${WAVE}): ${JSON.stringify(item, null, 2)}
${
  round === 0
    ? `SETUP (do exactly this):
  git -C ${WT} worktree add -B impl/${item.id} ${wt} ${BASE_REF}
  ln -s ${WT}/node_modules ${wt}/node_modules
  mkdir -p ${OUT}/${item.id}
Work ONLY inside ${wt}.`
    : `FIX ROUND ${round}: your worktree ${wt} (branch impl/${item.id}) already holds your implementation. The adversarial reviewer returned the findings below; address every BLOCKING one (and the cheap non-blocking ones), add/adjust tests, re-run the fast gates, and amend by adding a new commit (do not rewrite history).
REVIEW FINDINGS:
${JSON.stringify(review, null, 2)}`
}
IMPLEMENT the item exactly as the plan's mechanism describes (if the code contradicts the plan, implement the closest correct variant and explain the deviation). Then run the FAST gates inside ${wt} and make them green:
  bunx prettier --write <touched files>
  bunx eslint <touched files>
  bun run typecheck            (~3 min; required)
  bunx vitest run <test files related to touched modules>   (the tests you added/changed plus the existing tests of touched modules; the gates relevant to your item from: check:entry-purity, check:ssr-budgets, check:loader-policy, check:chunk-parity, noHasSelectors test — the ones that do not need a build)
Do NOT run a build or Lighthouse in this stage (the Prove stage does it under the machine mutex).
Commit in ${wt} with a Polish message (summary line + body explaining mechanism and measured/expected effect) ending with the trailer:
${TRAILER}
Write ${OUT}/${item.id}/IMPL${round ? "-fix" + round : ""}.md: what changed and why (file by file), gates run with results, deviations from the plan, risks, what the reviewer should look at. Return the structured result.`;
}

const IMPL_SCHEMA = {
  type: "object",
  properties: {
    item_id: { type: "string" },
    worktree: { type: "string" },
    branch: { type: "string" },
    commit: { type: "string" },
    files_changed: { type: "array", items: { type: "string" } },
    gates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          result: { type: "string", enum: ["green", "red", "skipped"] },
          note: { type: "string" },
        },
        required: ["name", "result"],
      },
    },
    deviations: { type: "array", items: { type: "string" } },
    out_of_ownership_needs: { type: "array", items: { type: "string" } },
    report_path: { type: "string" },
    summary: { type: "string" },
    status: { type: "string", enum: ["done", "partial", "blocked"] },
  },
  required: [
    "item_id",
    "worktree",
    "branch",
    "commit",
    "files_changed",
    "gates",
    "report_path",
    "summary",
    "status",
  ],
};

function reviewPrompt(item, impl, round) {
  return `You are an adversarial code reviewer (Opus) for a web-performance change in a TanStack Start + React 19 + Nitro + Supabase platform. Context: ${EVIDENCE} (section 0-cloud), plan ${PLAN}, the item ${JSON.stringify(item)}, the implementer's report ${impl.report_path}.
Review the diff in the worktree ${impl.worktree}: \`git -C ${impl.worktree} diff ${BASE_REF}...HEAD\` (and read the touched files whole). Try hard to REFUTE that the change is correct and safe:
- SSR vs client HTML parity (hydration mismatch), streaming boundaries, document-cache identity, Suspense/lazy semantics;
- chunk graph: new static import edges into the entry/boot closure, cycles, hoistTransitiveImports doctrine, named-chunk expectations of check:bundle/check:chunks;
- behaviour for logged-in users/editors/admins and for EN (/en) pages, i18n keys, a11y (focus, aria), CLS and visual regressions, SEO (links present in HTML, meta/preload correctness);
- tests: do the added tests actually assert the mechanism (not just render)? would they catch a regression?
- repo gates: entry-purity, ssr-budgets, loader-policy, chunk-parity, noHasSelectors, i18n-hardcoded, dangerous-html, ownership (new files need owners in the ownership registry? check scripts/check-ownership.ts conventions);
- commit message and docs in Polish, prettier-clean, no new dependencies, no stray files (worktree junk, logs).
You may run read-only commands and the fast gates in the worktree. Do NOT edit files. Write ${OUT}/${item.id}/REVIEW${round ? "-" + round : ""}.md and return the structured verdict (blocking = must fix before merge).`;
}

const REVIEW_SCHEMA = {
  type: "object",
  properties: {
    item_id: { type: "string" },
    verdict: { type: "string", enum: ["approve", "fix_required", "reject"] },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          severity: { type: "string", enum: ["blocking", "major", "minor"] },
          file: { type: "string" },
          finding: { type: "string" },
          fix: { type: "string" },
        },
        required: ["severity", "finding", "fix"],
      },
    },
    report_path: { type: "string" },
  },
  required: ["item_id", "verdict", "findings", "report_path"],
};

function provePrompt(item, impl) {
  return `You are the measurement engineer (Opus) proving ONE implemented change. Context: ${EVIDENCE} section 0-cloud (read the 'Harness details'), the item ${JSON.stringify(item)}, implementer report ${impl.report_path}.
Worktree with the change: ${impl.worktree} (branch ${impl.branch}, commit ${impl.commit}). Baseline artifact (already built, unchanged base): ${BASELINE_WT}/.output.
STEPS (in this order; everything heavy runs under the machine mutex — take it and hold it for the whole stage):
  until mkdir ${SCRATCH}/.build-lock 2>/dev/null; do sleep 15; done     # wait for the mutex
  trap 'rmdir ${SCRATCH}/.build-lock' EXIT                                 # always release it
  cd ${impl.worktree} && BUNDLE_INVENTORY=1 bun run build:smoke > ${OUT}/${item.id}/build.log 2>&1   (~2-4 min, 8 GB heap)
  then the artifact gates in the worktree: bun run check:bundle (record the full output; it is RED on main by 31.5 KB overall — your job is that this change does not make overall/public/entry/boot WORSE than the baseline numbers, and ideally better; copy the 'Boot closure' and chunk-move lines), bun run check:chunks, bun run check:entry-purity, bun run check:ssr-budgets, bun run check:loader-policy, bun run check:chunk-parity, bunx vitest run src/lib/ci/__tests__/noHasSelectors.test.ts; also the repo's artifact boot tests if they run offline: bunx playwright test --config playwright.artifact.config.ts (skip with a note if it needs network).
  then the document-weight gate on the candidate: cd ${impl.worktree} && node scripts/performance/check-document-weight.ts --json ${OUT}/${item.id}/document-weight.json (ratchet thresholds in scripts/performance/document-weight-budgets.json: it must stay green; if the change legitimately lowers a metric, ratchet the threshold DOWN in the budgets file as part of the item, never up) and the same on the baseline for comparison: cd ${BASELINE_WT} && node scripts/performance/check-document-weight.ts --json ${OUT}/${item.id}/document-weight-baseline.json;
  then the Lighthouse A/B with the canonical harness (h2 same-origin proxy, browser-UA warm-up, fixture images; read POMIAR.md first): cd ${BASELINE_WT} && LIGHTHOUSE_CLI=${SCRATCH}/tools/node_modules/lighthouse/cli/index.js CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node scripts/performance/lighthouse-local.mjs --compare ${BASELINE_WT} ${impl.worktree} --runs 3 --label w${WAVE}-${item.id} --out ${OUT}/${item.id}/lh > ${OUT}/${item.id}/ab.log 2>&1 ; read the MEDIAN and DELTA B-A lines (mobile and desktop) and the per-run lines (spread = noise); compare the two documents from the gate JSONs (raw/gzip bytes, inline <style>/<script> bytes, modulepreload count, preload duplicates, boot closure raw/gzip, High-priority JS pool) and the audits dump of one mobile run per side (request count, transfer bytes, High JS bytes ended before the LCP image, LCP element and breakdown).
  release the mutex (rmdir) BEFORE writing the report.
Judge: does the measured delta match the plan's expected effect (direction and rough size)? Note the noise level (spread of the 3 runs). If a gate is red because of this change, say exactly which and why (the implementer gets one fix round).
Write ${OUT}/${item.id}/PROVE.md with all numbers (tables) and return the structured result.`;
}

const PROVE_SCHEMA = {
  type: "object",
  properties: {
    item_id: { type: "string" },
    gates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          result: { type: "string", enum: ["green", "red", "red_on_main_too", "skipped"] },
          note: { type: "string" },
        },
        required: ["name", "result"],
      },
    },
    bundle: {
      type: "object",
      properties: {
        overall_kb: { type: "number" },
        public_kb: { type: "number" },
        entry_kb: { type: "number" },
        boot_gzip_kb: { type: "number" },
        boot_raw_kb: { type: "number" },
        delta_vs_baseline: { type: "string" },
      },
    },
    lighthouse: {
      type: "object",
      properties: {
        mobile_A: { type: "string" },
        mobile_B: { type: "string" },
        mobile_delta: { type: "string" },
        desktop_A: { type: "string" },
        desktop_B: { type: "string" },
        desktop_delta: { type: "string" },
        noise_note: { type: "string" },
      },
    },
    document: {
      type: "object",
      properties: {
        html_raw_A: { type: "number" },
        html_raw_B: { type: "number" },
        html_gzip_A: { type: "number" },
        html_gzip_B: { type: "number" },
        modulepreload_A: { type: "number" },
        modulepreload_B: { type: "number" },
      },
    },
    effect_matches_plan: { type: "string", enum: ["yes", "partly", "no", "inconclusive"] },
    needs_fix: { type: "boolean" },
    fix_notes: { type: "string" },
    report_path: { type: "string" },
  },
  required: ["item_id", "gates", "lighthouse", "effect_matches_plan", "needs_fix", "report_path"],
};

phase("Implement");
log(`Wave ${WAVE}: ${ITEMS.length} items -> ${ITEMS.map((i) => i.id).join(", ")}`);

const results = await pipeline(
  ITEMS,
  async (item) => {
    let impl = await agent(implPrompt(item, 0), {
      label: `impl:${item.id}`,
      phase: "Implement",
      schema: IMPL_SCHEMA,
      model: "opus",
      effort: "xhigh",
    });
    if (!impl) return { item, status: "no_impl" };
    const reviews = [];
    for (let round = 0; round <= MAX_FIX_ROUNDS; round++) {
      const review = await agent(reviewPrompt(item, impl, round), {
        label: `review:${item.id}${round ? "#" + round : ""}`,
        phase: "Review",
        schema: REVIEW_SCHEMA,
        model: "opus",
        effort: "high",
      });
      reviews.push(review);
      const blocking = review ? review.findings.filter((f) => f.severity === "blocking") : [];
      if (!review || (review.verdict === "approve" && !blocking.length) || round === MAX_FIX_ROUNDS)
        break;
      log(
        `${item.id}: review round ${round} -> ${review.verdict} (${blocking.length} blocking); fixing`,
      );
      const fixed = await agent(implPrompt(item, round + 1, review), {
        label: `fix:${item.id}#${round + 1}`,
        phase: "Fix",
        schema: IMPL_SCHEMA,
        model: "opus",
        effort: "xhigh",
      });
      if (fixed) impl = fixed;
    }
    return { item, impl, reviews };
  },
  async (r) => {
    if (!r || !r.impl) return r;
    let prove = await agent(provePrompt(r.item, r.impl), {
      label: `prove:${r.item.id}`,
      phase: "Prove",
      schema: PROVE_SCHEMA,
      model: "opus",
      effort: "high",
    });
    if (prove && prove.needs_fix) {
      log(`${r.item.id}: prove stage asks for a fix: ${prove.fix_notes}`);
      const fixed = await agent(
        implPrompt(r.item, 9, {
          from: "prove",
          findings: [
            {
              severity: "blocking",
              finding: prove.fix_notes || "gate red after build",
              fix: "see PROVE.md",
            },
          ],
          report: prove.report_path,
        }),
        {
          label: `fix:${r.item.id}#prove`,
          phase: "Fix",
          schema: IMPL_SCHEMA,
          model: "opus",
          effort: "xhigh",
        },
      );
      if (fixed) {
        r.impl = fixed;
        prove = await agent(provePrompt(r.item, r.impl), {
          label: `prove:${r.item.id}#2`,
          phase: "Prove",
          schema: PROVE_SCHEMA,
          model: "opus",
          effort: "high",
        });
      }
    }
    return { ...r, prove };
  },
);

const done = results.filter(Boolean);
log(
  `Wave ${WAVE} finished: ${done.filter((r) => r.prove && !r.prove.needs_fix).length}/${ITEMS.length} items proven`,
);
return done.map((r) => ({
  id: r.item.id,
  status: r.status || (r.impl ? r.impl.status : "no_impl"),
  branch: r.impl && r.impl.branch,
  worktree: r.impl && r.impl.worktree,
  commit: r.impl && r.impl.commit,
  files_changed: r.impl && r.impl.files_changed,
  review_verdicts: (r.reviews || []).filter(Boolean).map((v) => v.verdict),
  prove: r.prove
    ? {
        gates: r.prove.gates,
        lighthouse: r.prove.lighthouse,
        bundle: r.prove.bundle,
        document: r.prove.document,
        effect: r.prove.effect_matches_plan,
        needs_fix: r.prove.needs_fix,
        report: r.prove.report_path,
      }
    : null,
  reports: {
    impl: r.impl && r.impl.report_path,
    reviews: (r.reviews || []).filter(Boolean).map((v) => v.report_path),
  },
}));
