export const meta = {
  name: "pagespeed-phase2-wave",
  description:
    "PageSpeed 85/95: implement one wave of PLAN.md items in parallel git worktrees (Opus): implement -> adversarial review -> fix -> (optional) build + repo gates + Lighthouse A/B against the wave base",
  phases: [
    {
      title: "Implement",
      detail: "one Opus agent per item in its own worktree, G-std gates, commit",
    },
    {
      title: "Review",
      detail: "adversarial reviewer per item (parity, doctrine, gates, i18n, a11y)",
    },
    { title: "Fix", detail: "implementer addresses blocking review findings (max 2 rounds)" },
    {
      title: "Prove",
      detail:
        "build:smoke under the machine mutex, artifact gates, document-weight gate, lighthouse-local --compare vs the wave base",
    },
  ],
};

const SCRATCH =
  "/tmp/claude-0/-home-user-neweustrategies-dc633fb5/8fd9e8e2-d544-5db4-ae5e-c509c5e3ff6c/scratchpad";
const WT = "/home/user/neweustrategies-dc633fb5";
const DOCS = WT + "/docs/performance/2026-10-03-pagespeed-85-95";
const PLAN_MD = DOCS + "/faza1/PLAN.md";
const PLAN_JSON = DOCS + "/faza1/PLAN.json";
const NOTES = DOCS + "/faza1/ORCHESTRATOR-NOTES.md";
const EVIDENCE = DOCS + "/EVIDENCE.md";
const BASE_REF = (args && args.base_ref) || "perf/pagespeed-mobile85-desktop95-t595d6";
const BASELINE_WT = (args && args.baseline_wt) || WT;
const WAVE = (args && args.wave) == null ? 1 : args.wave;
const ITEMS = (args && args.items) || []; // [{id, prove?: boolean, notes?: string}]
const OUT = SCRATCH + "/phase2/wave" + WAVE;
const MAX_FIX_ROUNDS = 2;
if (!ITEMS.length) throw new Error("args.items = [{id, prove?, notes?}] is required");

const TRAILER = `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M84vURVZ4xnvk1AVmdDF5B`;

const COMMON = `
You are a senior engineer (Opus) implementing ONE item of a web-performance plan under a Fable 5.1 orchestrator, in a TanStack Start + React 19 + Vite 7 + Nitro (Cloudflare Workers) + Supabase content platform. Goal of the whole effort: Lighthouse/PSI mobile >= 85, desktop >= 95 on https://neweuropeanstrategies.com/.
Read first, in this order: (1) your item in ${PLAN_JSON} (waves[].items[] with your id: files = the ONLY files you may touch, mechanism, gates, verification, depends_on) and the same item plus its wave context, §1.3 Lantern invariants, §2 agent protocol and §4 file-ownership matrix in ${PLAN_MD}; (2) ${NOTES} (owner decision, verdict ledger, corrections); (3) ${EVIDENCE} section 0-cloud (environment: no network, fixture backend, 4 CPUs, one build at a time); (4) the workstream report and the verdict your item cites (${DOCS}/faza1/raporty/<workstream>.md, ${DOCS}/faza1/raporty/werdykty/<workstream>--<id>.md) — the verdicts' blocking issues are requirements.
Repository rules: Polish for comments, docs and commit messages (imperative, like the git log); TypeScript strict; no new dependencies; prettier formatting (bunx prettier --write on files you touch); keep SSR/hydration parity byte-for-byte for chrome; respect chunk-graph doctrine (no manualChunks/hoistTransitiveImports changes without check:chunks and the 2026-07-20 incident notes in scripts/lib/bootVendorSplit.ts); keep setTimeout(0) before hydrate in src/router.tsx; i18n via dictionaries only; every behavioural change gets or updates a vitest test; AGENTS.md rules apply. Budget moves in scripts/check-bundle-size.ts only with measured numbers and a kronika entry.
Never touch files outside your item's file list (PLAN.md §4). If a change truly needs another file, stop that part and report it in out_of_ownership_needs instead of editing it.
Machine: 4 CPUs, 15 GB RAM. Builds: at most one at a time (mutex: until mkdir ${SCRATCH}/.build-lock 2>/dev/null; do sleep 15; done ... rmdir ${SCRATCH}/.build-lock — ALWAYS release it, also on failure). Lighthouse: one at a time (mutex ${SCRATCH}/.lh-lock), never while .build-lock exists. Treat timings on this shared machine as noisy; structural evidence and per-task ledgers decide.
`;

function implPrompt(item, round, review) {
  const wt = `${SCRATCH}/wt/${item.id}`;
  return `${COMMON}
YOUR ITEM: ${item.id} (wave ${WAVE}). ${item.notes ? "Orchestrator notes for this item: " + item.notes : ""}
${
  round === 0
    ? item.resume
      ? `RESUME: the worktree ${wt} (branch perf/w${WAVE}-${item.id}, base ${BASE_REF}) ALREADY EXISTS with partial, uncommitted work of a previous attempt that was interrupted by a usage limit. Do NOT run git worktree add. First run \`git -C ${wt} status --short\` and \`git -C ${wt} diff\`, read every modified/new file whole, decide what is correct and complete, fix or finish the rest, and then continue with the normal gates and commit. mkdir -p ${OUT}/${item.id}. Work ONLY inside ${wt} (never edit ${WT} itself).`
      : `SETUP (do exactly this, once):
  git -C ${WT} worktree add -B perf/w${WAVE}-${item.id} ${wt} ${BASE_REF}
  ln -s ${WT}/node_modules ${wt}/node_modules
  mkdir -p ${OUT}/${item.id}
Work ONLY inside ${wt} (never edit ${WT} itself).`
    : `FIX ROUND ${round}: your worktree ${wt} (branch perf/w${WAVE}-${item.id}) already holds your implementation. The adversarial reviewer returned the findings below; address every BLOCKING one (and the cheap non-blocking ones), add/adjust tests, re-run the fast gates, and add a new commit (do not rewrite history).
REVIEW FINDINGS:
${JSON.stringify(review, null, 2)}`
}
IMPLEMENT the item exactly as its mechanism describes (if the code contradicts the plan, implement the closest correct variant and explain the deviation). Then run the FAST gates inside ${wt} and make them green:
  bunx prettier --write <touched files>
  bunx eslint <touched files>
  bun run typecheck            (required; ~3-4 min)
  bunx vitest run <test files of touched modules + the tests you added>  (plus src/lib/ci/__tests__/noHasSelectors.test.ts when you touch CSS, and bun run check:chunk-parity when you touch vite configs)
  bun run verify:static        (format:check + every check:* gate outside EXCLUDED, incl. check:feature-taxonomy, check:dangerous-html, check:clock-freeze, check:unknown-casts, check:ssr-budgets, check:loader-policy; it skips artifact gates when no .output exists)
Do NOT run a production build or Lighthouse in this stage unless your item's mechanism itself is a measurement/diagnosis task (then follow the mechanism, under the mutexes).
Commit in ${wt} with a Polish message (summary line + body: mechanism, measured/expected effect, gates run) ending with the trailer:
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
  return `You are an adversarial code reviewer (Opus) for a web-performance change in a TanStack Start + React 19 + Nitro + Supabase platform. Context: ${NOTES}, the item ${item.id} in ${PLAN_JSON} and ${PLAN_MD} (its mechanism, file list in §4, gates), the verdict(s) it cites under ${DOCS}/faza1/raporty/werdykty/, the implementer's report ${impl.report_path}.
Review the diff in the worktree ${impl.worktree}: \`git -C ${impl.worktree} diff ${BASE_REF}...HEAD\` and read the touched files whole. Try hard to REFUTE that the change is correct, safe and within scope:
- files outside the item's list (PLAN.md §4) = blocking; mechanism deviating from the plan without a stated reason = blocking;
- SSR vs client HTML parity (hydration mismatch), streaming boundaries, document-cache identity, Suspense/lazy semantics, React 19 specifics (identity-compared props, dangerouslySetInnerHTML rewrites, startTransition vs useSyncExternalStore);
- chunk graph: new static import edges into the entry/boot closure, cycles, hoistTransitiveImports doctrine, named-chunk expectations of check:bundle/check:chunks;
- behaviour for logged-in users/editors/admins and for EN (/en) pages, i18n keys, a11y (focus, aria), CLS, SEO (links present in HTML, meta/preload correctness), consent semantics;
- tests: do the added tests assert the mechanism (not just render)? would they catch a regression? Polish comments/commit message, prettier-clean, no new dependencies, no stray files;
- repo gates: run in the worktree what is cheap (bunx eslint on touched files, bunx vitest run <touched tests>, bun run verify:static) and report results.
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
  return `You are the measurement engineer (Opus) proving ONE implemented change. Context: ${EVIDENCE} section 0-cloud (read 'Harness details'), ${DOCS}/POMIAR.md, the item ${item.id} in ${PLAN_JSON} (expected_effect, verification) and the implementer report ${impl.report_path}.
Worktree with the change: ${impl.worktree} (branch ${impl.branch}, commit ${impl.commit}). Wave base artifact (already built): ${BASELINE_WT}/.output.
STEPS, in this order, under the machine mutexes (ALWAYS release them, also on failure; trap 'rmdir ...' EXIT):
  until mkdir ${SCRATCH}/.build-lock 2>/dev/null; do sleep 15; done
  cd ${impl.worktree} && BUNDLE_INVENTORY=1 bun run build:smoke > ${OUT}/${item.id}/build.log 2>&1   (~2.5-4 min, 8 GB heap)
  artifact gates in the worktree: bun run check:bundle (record the full output; main is RED by +31.5 KB overall from spreadsheet.worker — your job is that this change does not make overall/public/entry/boot WORSE than the base; copy the 'Boot closure' line and the moves list), bun run check:chunks, bun run check:entry-purity, bun run check:server-entry-purity, bun run test:e2e:artifact (skip with a note if it needs network), node scripts/performance/check-document-weight.ts --json ${OUT}/${item.id}/document-weight.json (ratchet: must stay green; if the change legitimately lowers a metric, the item may ratchet the threshold DOWN in document-weight-budgets.json, never up) and the same gate on the base: cd ${BASELINE_WT} && node scripts/performance/check-document-weight.ts --json ${OUT}/${item.id}/document-weight-base.json
  rmdir ${SCRATCH}/.build-lock
  until mkdir ${SCRATCH}/.lh-lock 2>/dev/null; do sleep 30; done   (and wait while .build-lock exists)
  cd ${BASELINE_WT} && LIGHTHOUSE_CLI=${SCRATCH}/tools/node_modules/lighthouse/cli/index.js CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node scripts/performance/lighthouse-local.mjs --compare ${BASELINE_WT} ${impl.worktree} --runs ${item.runs || 3} --forms ${item.forms || "mobile,desktop"} --label w${WAVE}-${item.id} --out ${OUT}/${item.id}/lh ${item.lh_flags || ""} > ${OUT}/${item.id}/ab.log 2>&1
  rmdir ${SCRATCH}/.lh-lock
Read the MEDIAN and DELTA B-A lines per form and the per-run spread (noise); compare the two document-weight JSONs (raw/gzip, inline style/script, modulepreload count, duplicates, boot closure, High JS pool) and the audits dump of one mobile run per side (requests, transfer, High JS bytes ended before the LCP image, LCP element and breakdown). If the harness supports the flags the item's verification names (--client-backend, --third-party, --save-artifacts, lanternTasks), use them; if not yet (P0.1 not merged), say so.
Judge: does the measured delta match the plan's expected effect (direction and rough size), within the A/A noise (FCP/LCP ±0.02 s; TBT up to ±464 ms at n=3)? If a gate is red because of this change, say exactly which and why (the implementer gets one fix round).
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
        delta_vs_base: { type: "string" },
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
log(
  `Wave ${WAVE}: ${ITEMS.length} items -> ${ITEMS.map((i) => i.id).join(", ")} (base ${BASE_REF})`,
);

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
    if (!r || !r.impl || r.item.prove === false) return r;
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
  `Wave ${WAVE} finished: ${done.filter((r) => r.impl && (!r.prove || !r.prove.needs_fix)).length}/${ITEMS.length} items ready for merge review`,
);
return done.map((r) => ({
  id: r.item.id,
  status: r.status || (r.impl ? r.impl.status : "no_impl"),
  branch: r.impl && r.impl.branch,
  worktree: r.impl && r.impl.worktree,
  commit: r.impl && r.impl.commit,
  files_changed: r.impl && r.impl.files_changed,
  out_of_ownership_needs: r.impl && r.impl.out_of_ownership_needs,
  review_verdicts: (r.reviews || []).filter(Boolean).map((v) => v.verdict),
  open_blocking: (r.reviews || [])
    .filter(Boolean)
    .slice(-1)
    .flatMap((v) => v.findings.filter((f) => f.severity === "blocking").map((f) => f.finding)),
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
