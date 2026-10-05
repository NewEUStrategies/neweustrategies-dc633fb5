export const meta = {
  name: "pagespeed-phase2-wave",
  description:
    "PageSpeed 85/95: implement one wave of PLAN items in parallel git worktrees: implement -> adversarial review -> fix -> (optional) build + repo gates + Lighthouse A/B against the wave base",
  phases: [
    {
      title: "Implement",
      detail: "one agent per item in its own worktree, fast gates, commit",
    },
    {
      title: "Review",
      detail: "adversarial reviewer per item (parity, doctrine, gates, i18n, a11y, tests)",
    },
    { title: "Fix", detail: "implementer addresses blocking review findings (max 2 rounds)" },
    {
      title: "Prove",
      detail:
        "build:smoke under the machine mutex, artifact gates, document-weight gate, lighthouse-local --compare vs the wave base",
    },
  ],
};

// Konfiguracja z `args` (fala 1: sesja 2026-10-04 wieczór). Wartości domyślne opisują sesję, w której skrypt
// uruchomiono ostatnio; każdą można nadpisać w `args`, bez edycji skryptu.
const A = args || {};
const SCRATCH =
  A.scratch ||
  "/tmp/claude-0/-home-user-neweustrategies-dc633fb5/fa91b100-2697-58dd-a286-b191421816ad/scratchpad";
const WT = A.repo || "/home/user/neweustrategies-dc633fb5";
const DOCS = WT + "/docs/performance/2026-10-03-pagespeed-85-95";
const PLAN_MD = DOCS + "/faza1/PLAN.md";
const PLAN_JSON = DOCS + "/faza1/PLAN.json";
const PLAN_W12 = DOCS + "/faza2/PLAN-FALE-1-2.md";
const PROMPTS_W1 = DOCS + "/faza2/PROMPTY-FALA-1.md";
const P05 = DOCS + "/faza2/P0.5-diagnoza-dlugich-zadan.md";
const W0_REPORTS = DOCS + "/faza2/raporty";
const NOTES = DOCS + "/faza1/ORCHESTRATOR-NOTES.md";
const EVIDENCE = DOCS + "/EVIDENCE.md";
const POMIAR = DOCS + "/POMIAR.md";
const BASE_REF = A.base_ref || "claude/zen-johnson-wpzoxv";
const BASELINE_WT = A.baseline_wt || SCRATCH + "/base-w1";
const BASE_STATE = A.base_state || "(orchestrator did not pass the base state)";
const WAVE = A.wave == null ? 1 : A.wave;
const ITEMS = A.items || []; // [{id, prove?, runs?, forms?, lh_flags?, notes?, resume?}]
const OUT = SCRATCH + "/phase2/wave" + WAVE;
const MAX_FIX_ROUNDS = 2;
const LH_ENV = `LIGHTHOUSE_CLI=${SCRATCH}/tools/node_modules/lighthouse/cli/index.js CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`;
if (!ITEMS.length) throw new Error("args.items = [{id, prove?, notes?}] is required");

const TRAILER =
  A.trailer ||
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016UV8PvuQeQ32sRo7fzGpmn`;

const ENV = `
ENVIRONMENT OF THIS SESSION (overrides older notes in EVIDENCE.md §0-cloud and wave-0 reports):
  - Main checkout ${WT} is the PR branch ${BASE_REF} (= origin/main with wave 0 and PR #469). NEVER edit, build or commit there; the orchestrator merges item branches into it.
  - Scratchpad: ${SCRATCH} (below $SCRATCH). Paths in older docs under /tmp/claude-0/.../8fd9e8e2-.../scratchpad belong to a previous session and DO NOT EXIST; production reference files live in ${DOCS}/lighthouse/ (gzipped) and ${DOCS}/faza1/measurement/.
  - Lighthouse 13.5.0 CLI: ${SCRATCH}/tools/node_modules/lighthouse/cli/index.js; Chromium: /opt/pw-browsers/chromium-1194/chrome-linux/chrome (Playwright finds it via PLAYWRIGHT_BROWSERS_PATH). Harness: node scripts/performance/lighthouse-local.mjs (P0.1; it serves fixture images itself).
  - Network: the npm registry works; production, Supabase and CDNs do not. Dependencies come from the lockfile (xlsx 0.20.3 is the real package, no substitution), so check:bundle numbers are comparable with CI.
  - Base state measured by the orchestrator before the wave: ${BASE_STATE}
  - Owner decisions in force: everything in ${NOTES} "Owner decision"; on 2026-10-04 the owner additionally APPROVED F1 and F1b of the P0.5 report (visible micro-changes in styles.css) for P1.2.
MACHINE (4 CPUs, 15 GB RAM, shared by up to 4 agents) - MUTEX DISCIPLINE, no exceptions (two overlapping tsc runs were OOM-killed in wave 0):
  - HEAVY steps = bun run typecheck (7-9 GB, ~6-7 min), bun run build:smoke (8 GB heap, ~4-5 min), any Lighthouse run, any Playwright/e2e run. Run them ONLY through the machine mutex helper, in the SAME command as the step:
      cd <worktree> && ${SCRATCH}/heavy.sh bun run typecheck > <log> 2>&1; echo exit=$?
    A tool call is killed after 10 minutes, and waiting for the mutex can take longer, so for typecheck/build/Lighthouse/e2e prefer the background form and then poll:
      ${SCRATCH}/heavy-bg.sh <log> bash -c 'cd <worktree> && bun run typecheck'      (returns at once; exit code lands in <log>.exit)
      ${SCRATCH}/wait-for.sh <log>.exit        (waits up to 9 min; exit 124 = still waiting, just call it again; meanwhile you may do other non-heavy work)
    Never take the mutex by hand and never leave a stale lock; the helpers handle traps and stale-lock recovery. The current holder is in ${SCRATCH}/.heavy-lock/what.
  - CPU-noticeable light steps (bunx vitest run <files>, bunx eslint <many files>, bun run verify:static) run OUTSIDE the mutex but through ${SCRATCH}/light.sh <command> (it waits while a Lighthouse/Playwright measurement holds the mutex; exit 75 = measurement still running, retry later). Never run the whole vitest suite; run targeted files.
  - typecheck at most once per implementation/fix round. Lighthouse: the harness itself waits for load < 2.4 and excludes noisy runs; traces taken under load are discarded, never reported.
`;

const COMMON = `
You are a senior engineer implementing ONE item of a web-performance plan under an orchestrator, in a TanStack Start + React 19 + Vite 7 + Nitro (Cloudflare Workers) + Supabase content platform. Goal of the whole effort: Lighthouse/PSI mobile >= 85, desktop >= 95 on https://neweuropeanstrategies.com/.
Read first, in this order:
  (1) ${PLAN_W12} §0, §1, §2 (your item: goal, FILE LIST = the only files you may touch, mechanism after wave 0, run order, Definition of Done), §4 and §6 (corrections after the P0.5 report) - this document is AUTHORITATIVE where it differs from faza1/PLAN.*; and your item's block in ${PROMPTS_W1} (sections 2 and 3);
  (2) your item in ${PLAN_JSON} (waves[].items[] with your id: mechanism details, gates, verification) and the same item plus §1.3 Lantern invariants, §2 agent protocol and §4 file-ownership matrix in ${PLAN_MD} (large file: grep for your id and read those sections);
  (3) ${NOTES} (owner decision, verdict ledger, corrections);
  (4) ${P05} §0, §2.4, §2.5 and §8 (long-task ledger with file:line causes, the F-list per owner item);
  (5) wave-0 reports in ${W0_REPORTS}/ that define the APIs you build on: P0.3-IMPL.md + P0.3-FIX.md (performance primitives: onQuiescent, onFirstInteraction, enqueue with release interaction|immediate|urgent, gesture guard), P0.6-IMPL.md + P0.6-FIX.md (RUM payload, data-island-state contract), P0.4-IMPL.md + P0.4-FIX.md (Server-Timing), P0.1-IMPL.md + P0.1-FIX.md (harness);
  (6) the workstream reports and verdicts your item cites (${DOCS}/faza1/raporty/<workstream>.md, ${DOCS}/faza1/raporty/werdykty/<workstream>--<id>.md) - the verdicts' blocking issues are requirements;
  (7) ${EVIDENCE} section 0-cloud only for harness details (the environment below overrides it).
Repository rules: Polish for comments, docs and commit messages (imperative, like the git log); TypeScript strict; no new dependencies; prettier formatting (bunx prettier --write on files you touch); keep SSR/hydration parity byte-for-byte for chrome; respect chunk-graph doctrine (no manualChunks/hoistTransitiveImports changes without check:chunks and the 2026-07-20 incident notes in scripts/lib/bootVendorSplit.ts); keep the setTimeout(0) literal before hydrate in src/router.tsx; i18n via dictionaries only; every behavioural change gets or updates a vitest test; AGENTS.md rules apply. Budget moves in scripts/check-bundle-size.ts only with measured numbers and a kronika entry.
Never touch files outside your item's file list. If a change truly needs another file, stop that part and report it in out_of_ownership_needs instead of editing it.
${ENV}`;

function implPrompt(item, round, review) {
  const wt = `${SCRATCH}/wt/${item.id}`;
  return `${COMMON}
YOUR ITEM: ${item.id} (wave ${WAVE}). ${item.notes ? "Orchestrator notes for this item (binding): " + item.notes : ""}
${
  round === 0
    ? item.resume
      ? `RESUME: the worktree ${wt} (branch perf/w${WAVE}-${item.id}, base ${BASE_REF}) ALREADY EXISTS with partial work of an interrupted attempt. Do NOT run git worktree add. First run \`git -C ${wt} status --short\`, \`git -C ${wt} log --oneline ${BASE_REF}..HEAD\` and \`git -C ${wt} diff\`, read every modified/new file whole, decide what is correct and complete, fix or finish the rest, then continue with the normal gates and commit. mkdir -p ${OUT}/${item.id}. Work ONLY inside ${wt}.`
      : `SETUP (do exactly this, once; if the worktree already exists from an interrupted run, reuse it instead and inspect its state first):
  git -C ${WT} worktree add -B perf/w${WAVE}-${item.id} ${wt} ${BASE_REF}
  ln -s ${WT}/node_modules ${wt}/node_modules
  mkdir -p ${OUT}/${item.id}
Work ONLY inside ${wt} (never edit ${WT} itself).`
    : `FIX ROUND ${round}: your worktree ${wt} (branch perf/w${WAVE}-${item.id}) already holds your implementation (an interrupted earlier attempt of this round may have left UNCOMMITTED changes: run 'git -C ${wt} status --short' and 'git -C ${wt} diff' first, read them and build on what is correct). The findings below came back; address every BLOCKING one (and the cheap non-blocking ones; for a non-blocking finding you reject, say why in the report), add/adjust tests, re-run the fast gates, and add a new commit (do not rewrite history).
FINDINGS:
${JSON.stringify(review, null, 2)}`
}
IMPLEMENT the item exactly as its mechanism describes (if the code contradicts the plan, implement the closest correct variant and explain the deviation). Then run the FAST gates inside ${wt} and make them green:
  bunx prettier --write <touched files>
  ${SCRATCH}/light.sh bunx eslint <touched files>
  bun run typecheck            (required; ONLY via the mutex helpers above; once per round)
  ${SCRATCH}/light.sh bunx vitest run <test files of touched modules + the tests you added>  (plus src/lib/ci/__tests__/noHasSelectors.test.ts when you touch CSS, and bun run check:chunk-parity when you touch vite configs)
  ${SCRATCH}/light.sh bun run verify:static        (format:check + every check:* gate outside EXCLUDED, incl. check:feature-taxonomy, check:dangerous-html, check:clock-freeze, check:unknown-casts, check:ssr-budgets, check:loader-policy, check:ownership; it skips artifact gates when no .output exists)
  e2e specs you add or change: run them only via the mutex helpers (they need a build of the worktree; if the item has a Prove stage you may leave the build + e2e run to it and say so in the report).
Do NOT run a production build or Lighthouse in this stage unless your item's mechanism itself is a measurement/diagnosis task (then follow the mechanism, under the mutex).
Commit in ${wt} with a Polish message (summary line in the style of the repo log, e.g. "Wydajność PSI 85/95, fala ${WAVE}: ${item.id} ..."; body: mechanism, measured/expected effect, gates run) ending with EXACTLY this two-line trailer, verbatim (it is the attribution required by the session's harness; do not replace it and do not add other attribution lines):
${TRAILER}
Write ${OUT}/${item.id}/IMPL${round ? "-fix" + round : ""}.md (Polish): what changed and why (file by file), gates run with results, deviations from the plan, risks, what the reviewer should look at. Return the structured result.`;
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
  return `You are an adversarial code reviewer for a web-performance change in a TanStack Start + React 19 + Nitro + Supabase platform. Context: ${PLAN_W12} (§2 item ${item.id}: file list, mechanism after wave 0; §6 corrections), its block in ${PROMPTS_W1} (incl. the reviewer lens for this item in section 3), the item in ${PLAN_JSON} and ${PLAN_MD}, ${NOTES}, the verdict(s) it cites under ${DOCS}/faza1/raporty/werdykty/, the wave-0 reports it builds on in ${W0_REPORTS}/, and the implementer's report ${impl.report_path}.${item.notes ? "\nOrchestrator notes given to the implementer (binding scope): " + item.notes : ""}
Review the diff in the worktree ${impl.worktree}: \`git -C ${impl.worktree} diff ${BASE_REF}...HEAD\` and read the touched files whole. Try hard to REFUTE that the change is correct, safe, complete and within scope:
- files outside the item's list = blocking; mechanism deviating from the plan without a stated reason = blocking; a required part of the notes silently skipped = blocking;
- SSR vs client HTML parity (hydration mismatch), streaming boundaries, document-cache identity, Suspense/lazy semantics, React 19 specifics (identity-compared props, dangerouslySetInnerHTML rewrites, startTransition vs useSyncExternalStore);
- chunk graph: new static import edges into the entry/boot closure, cycles, hoistTransitiveImports doctrine, named-chunk expectations of check:bundle/check:chunks;
- behaviour for logged-in users/editors/admins and for EN (/en) pages, i18n keys, a11y (focus, aria), CLS, SEO (links present in HTML, meta/preload correctness), consent and privacy semantics;
- Lantern realism: will the change actually remove/split the targeted long tasks in the simulated trace, or just move them?
- tests: do the added tests assert the mechanism (not just render)? would they catch a regression (try mentally reverting the change)? negative controls where the notes require them; Polish comments/commit message, prettier-clean, no new dependencies, no stray files, commit trailer exactly as required;
- repo gates: run in the worktree what is cheap (${SCRATCH}/light.sh bunx eslint <touched files>, ${SCRATCH}/light.sh bunx vitest run <touched tests>, ${SCRATCH}/light.sh bun run verify:static) and report results. No typecheck, build or Lighthouse.
${ENV}
You may run read-only commands and the fast gates in the worktree. Do NOT edit files. Every finding: severity (blocking/major/minor), file:line, evidence, concrete fix. Write ${OUT}/${item.id}/REVIEW${round ? "-" + round : ""}.md (Polish) and return the structured verdict (blocking = must fix before merge).`;
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

function provePrompt(item, impl, attempt) {
  const dir = `${OUT}/${item.id}${attempt ? "/prove" + attempt : ""}`;
  return `You are the measurement engineer proving ONE implemented change. Context: ${EVIDENCE} section 0-cloud ('Harness details'), ${POMIAR} (incl. the W1 baseline and A/A section written by the orchestrator), ${PLAN_W12} §2 (item ${item.id}: expected effect, Definition of Done) and the verification row for the item in the wave plan, the item in ${PLAN_JSON} (expected_effect, verification) and the implementer report ${impl.report_path}.${item.notes ? "\nOrchestrator notes for the item (they include the proof criteria): " + item.notes : ""}
Worktree with the change: ${impl.worktree} (branch ${impl.branch}, commit ${impl.commit}). Wave base (already built, .output present, do not rebuild it): ${BASELINE_WT}.
${ENV}
STEPS, in this order (mkdir -p ${dir}); every heavy step through the mutex helpers:
  1. Build:  ${SCRATCH}/heavy-bg.sh ${dir}/build.log bash -c 'cd ${impl.worktree} && BUNDLE_INVENTORY=1 bun run build:smoke'  then wait-for.sh until it exits 0.
  2. Artifact gates in the worktree (light gates via light.sh, e2e via the mutex): bun run check:bundle (record the full output; compare with the base state above - this change must not make overall/public/entry/boot WORSE than the base; copy the 'Boot closure' line and the moves list), bun run check:chunks, bun run check:entry-purity, bun run check:server-entry-purity, bun run test:e2e:artifact (via heavy-bg.sh; it runs offline with the fixture), the item's own e2e specs if it added/changed any (via heavy-bg.sh, with the config the spec belongs to), node scripts/performance/check-document-weight.ts --json ${dir}/document-weight.json (ratchet: must stay green; if the change legitimately lowers a metric, only the item that owns the document-weight files may ratchet a threshold DOWN, never up) and the same gate on the base: cd ${BASELINE_WT} && node scripts/performance/check-document-weight.ts --json ${dir}/document-weight-base.json
  3. Lighthouse A/B (one command, via heavy-bg.sh; it takes 20-45 min, keep polling wait-for.sh):
     ${SCRATCH}/heavy-bg.sh ${dir}/ab.log bash -c 'cd ${BASELINE_WT} && ${LH_ENV} node scripts/performance/lighthouse-local.mjs --compare ${BASELINE_WT} ${impl.worktree} --runs ${item.runs || 3} --forms ${item.forms || "mobile,desktop4x"} --label w${WAVE}-${item.id} --out ${dir}/lh ${item.lh_flags || "--client-backend fixture --save-artifacts"}'
Read the MEDIAN and DELTA B-A lines per form, the VALID / PAIRS (σΔ, MDE) lines and the per-run spread; the per-task Lantern ledger of both sides (does the targeted task class disappear or split below 50 ms simulated in B in all valid runs?); compare the two document-weight JSONs (raw/gzip, inline style/script, modulepreload count, duplicates, boot closure, High JS pool, imgFetchpriorityHigh) and the audits dump of one mobile run per side (requests, transfer, LCP element and breakdown, CLS).
Judge against the item's proof criteria: does the measured delta match the plan's expected effect (direction and rough size) relative to the A/A noise / MDE recorded in POMIAR.md? A result inside the noise with the targeted tasks gone from the ledger is 'yes' for structure + 'inconclusive' for size - say so explicitly. If a gate is red because of this change, say exactly which and why (the implementer gets one fix round); a gate that is red on the base too is 'red_on_main_too'.
Write ${dir}/PROVE.md (Polish) with all numbers (tables) and return the structured result.`;
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
        ledger_note: { type: "string" },
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
  `Wave ${WAVE}: ${ITEMS.length} items -> ${ITEMS.map((i) => i.id).join(", ")} (base ${BASE_REF}, baseline ${BASELINE_WT})`,
);

const results = await pipeline(
  ITEMS,
  async (item) => {
    // Wznowienie po przerwie (restart kontenera): `start: "fix"` = runda poprawek z `item.findings`
    // na istniejącym worktree, potem recenzja; `start: "prove-fix"` = poprawka po dowodzie i nowy dowód;
    // `start: "review"` = sama recenzja istniejącego commitu (np. po przerwanej rundzie recenzji).
    const resumed = item.start === "fix" || item.start === "prove-fix" || item.start === "review";
    let impl = resumed
      ? {
          item_id: item.id,
          worktree: `${SCRATCH}/wt/${item.id}`,
          branch: `perf/w${WAVE}-${item.id}`,
          commit: "HEAD",
          report_path: item.report || `${OUT}/${item.id}/IMPL.md`,
        }
      : await agent(implPrompt(item, 0), {
          label: `impl:${item.id}`,
          phase: "Implement",
          schema: IMPL_SCHEMA,
          effort: "xhigh",
        });
    if (!impl) return { item, status: "no_impl" };
    if (item.start === "prove-fix")
      return { item, impl, reviews: [], proveFindings: item.findings };
    const firstRound = item.start === "fix" || item.start === "review" ? item.fix_round || 1 : 0;
    if (item.start === "fix") {
      const fixed = await agent(implPrompt(item, firstRound, item.findings), {
        label: `fix:${item.id}#${firstRound}`,
        phase: "Fix",
        schema: IMPL_SCHEMA,
        effort: "xhigh",
      });
      if (fixed) impl = fixed;
    }
    const reviews = [];
    for (let round = firstRound; round <= Math.max(MAX_FIX_ROUNDS, firstRound + 1); round++) {
      const review = await agent(reviewPrompt(item, impl, round), {
        label: `review:${item.id}${round ? "#" + round : ""}`,
        phase: "Review",
        schema: REVIEW_SCHEMA,
        effort: "high",
      });
      reviews.push(review);
      const blocking = review ? review.findings.filter((f) => f.severity === "blocking") : [];
      if (
        !review ||
        (review.verdict === "approve" && !blocking.length) ||
        round === Math.max(MAX_FIX_ROUNDS, firstRound + 1)
      )
        break;
      log(
        `${item.id}: review round ${round} -> ${review.verdict} (${blocking.length} blocking); fixing`,
      );
      const fixed = await agent(implPrompt(item, round + 1, review), {
        label: `fix:${item.id}#${round + 1}`,
        phase: "Fix",
        schema: IMPL_SCHEMA,
        effort: "xhigh",
      });
      if (fixed) impl = fixed;
    }
    return { item, impl, reviews };
  },
  async (r) => {
    if (!r || !r.impl || r.item.prove === false) return r;
    if (r.proveFindings) {
      const fixed = await agent(implPrompt(r.item, 9, r.proveFindings), {
        label: `fix:${r.item.id}#prove`,
        phase: "Fix",
        schema: IMPL_SCHEMA,
        effort: "xhigh",
      });
      if (fixed) r.impl = fixed;
    }
    let prove = await agent(provePrompt(r.item, r.impl, r.proveFindings ? 2 : 0), {
      label: `prove:${r.item.id}`,
      phase: "Prove",
      schema: PROVE_SCHEMA,
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
          effort: "xhigh",
        },
      );
      if (fixed) {
        r.impl = fixed;
        prove = await agent(provePrompt(r.item, r.impl, 2), {
          label: `prove:${r.item.id}#2`,
          phase: "Prove",
          schema: PROVE_SCHEMA,
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
  deviations: r.impl && r.impl.deviations,
  out_of_ownership_needs: r.impl && r.impl.out_of_ownership_needs,
  review_verdicts: (r.reviews || []).filter(Boolean).map((v) => v.verdict),
  open_findings: (r.reviews || [])
    .filter(Boolean)
    .slice(-1)
    .flatMap((v) =>
      v.findings
        .filter((f) => f.severity !== "minor")
        .map((f) => `[${f.severity}] ${f.file || ""}: ${f.finding}`),
    ),
  prove: r.prove
    ? {
        gates: r.prove.gates,
        lighthouse: r.prove.lighthouse,
        bundle: r.prove.bundle,
        document: r.prove.document,
        effect: r.prove.effect_matches_plan,
        needs_fix: r.prove.needs_fix,
        fix_notes: r.prove.fix_notes,
        report: r.prove.report_path,
      }
    : null,
  reports: {
    impl: r.impl && r.impl.report_path,
    reviews: (r.reviews || []).filter(Boolean).map((v) => v.report_path),
  },
}));
