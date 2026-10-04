export const meta = {
  name: "pagespeed-plan-waves-1-2",
  description:
    "PageSpeed 85/95: write the refined plan for waves 1 and 2 plus ready-to-run agent prompts (no implementation), then a completeness critic and one revision round",
  phases: [
    {
      title: "Plan",
      detail: "planning lead (Opus, xhigh) writes PLAN-FALE-1-2.md and the prompt files",
    },
    { title: "Critique", detail: "completeness critic (Opus, xhigh)" },
    { title: "Revise", detail: "planner addresses blocking/major gaps" },
  ],
};

const WT = "/home/user/neweustrategies-dc633fb5";
const DOCS = WT + "/docs/performance/2026-10-03-pagespeed-85-95";
const F1 = DOCS + "/faza1";
const F2 = DOCS + "/faza2";
const OUT_PLAN = F2 + "/PLAN-FALE-1-2.md";
const OUT_P1 = F2 + "/PROMPTY-FALA-1.md";
const OUT_P2 = F2 + "/PROMPTY-FALA-2.md";
const OUT_JSON = F2 + "/PLAN-FALE-1-2.json";
const OUT_CRIT = F2 + "/KRYTYKA-FAL-1-2.md";

const INPUTS = `INPUTS (read ALL of them fully before writing; they are the product of the diagnosis, the plan synthesis and wave 0):
- Master plan: ${F1}/PLAN.md (waves W1 and W2 = sections of Fala 1 / Fala 2, §1.3 Lantern invariants, §1.5 score model, §2 agent protocol, §4 file-ownership matrix, §5 trajectory, §7 decisions D1-D13, §8 DoD, "Zmiany po krytyce") and ${F1}/PLAN.json (waves[].items[]), ${F1}/CRITIQUE.md, ${F1}/ORCHESTRATOR-NOTES.md (owner decision: every optimisation that does not break the platform is approved; verdict ledger; corrected facts).
- Environment limits: ${DOCS}/EVIDENCE.md section 0-cloud (no network, fixture backend, 4 CPUs/15 GB, ONE heavy step at a time through the mutex $SCRATCH/.heavy-lock, Lighthouse only when 1-min load <= 4).
- Wave 0 outcome: ${F2}/STAN-FALI-0.md (state; P0.1, P0.2, P0.3, P0.4, P0.6 merged WITHOUT review on the owner's instruction, P0.5 artifacts saved, P0.7 deferred), ${F2}/raporty/P0.1-IMPL.md, P0.2-IMPL.md, P0.3-IMPL.md, P0.4-IMPL.md, P0.6-IMPL.md (what each item really implemented: exported APIs, flags, contracts, deviations, risks), ${F2}/raporty/P0.3-REVIEW.md (fix_required: 1 significant + 4 minor findings, none blocking; they are NOT fixed yet), ${F2}/raporty/W0-wyniki.json (structured agent results incl. out_of_ownership_needs: vitals API + migration for P0.6 fields, Server-Timing nes-layer/colo contract for P0.4, data-island-state contract for P1.6, P1.3 click-loss risk, P1.1 element-scroll negative test, psi mode-A browser decision, psi-baseline.json).
- P0.5 diagnosis artifacts (the REPORT.md was never written; you must mine the raw material): ${F2}/raporty/P0.5-robocze/rep-mobile.md, rep-desktop.md, sum-w0q-mobile.md, sum-w0q-desktop.md, classmap.json, dump-w0q-*.json, art2/*-summary.txt (ONLY runs with load <= 3 are valid: w0q 1-5, hints 2-3, nofade 1-3; runs 6-8 and prof-* were taken under load and must be ignored), ledgers/*.txt|json (per-task Lantern ledgers, regimes m4/m4c3/d4/d4c3/d5/d1), and the scripts (ledger.mjs, gather.mjs, summarize.py, perftracks.py, layers.mjs) to understand what the columns mean.
- The new harness after P0.1: ${WT}/scripts/performance/lighthouse-local.mjs (read its option parsing / help text for the exact flags: forms incl. desktop4x/desktop5x, client-backend fixture, fake gtag third-party, re-warm per run, n_valid, save-artifacts, lanternTasks ledger, A/A sigma + MDE, k calibration), ${WT}/scripts/performance/lanternTasks.ts, ${DOCS}/POMIAR.md, ${WT}/scripts/performance/check-document-weight.ts and document-weight-budgets.json (P0.2 gate).
- The P0.3 primitives as merged: ${WT}/src/lib/performance/whenQuiescent.ts, firstInteraction.ts, postInteractionQueue.ts (exact exported names, options, priorities) and the P0.6 payload: ${WT}/src/lib/webVitals.ts. The P0.4 server observability: ${WT}/src/lib/http/ssrTiming.ts, documentCache.server.ts, src/server.ts.
- How prompts are consumed: ${F2}/workflow-faza2-wave.js (args {wave, base_ref, baseline_wt, items:[{id, prove?, resume?, notes?, runs?, forms?, lh_flags?}]}; COMMON rules; impl -> review -> fix -> prove stages; the implementer reads its item from PLAN.json by id, so refined mechanism text must be delivered through the item notes or through PLAN-FALE-1-2.md which the notes point to).
Git facts: PR branch perf/pagespeed-mobile85-desktop95-t595d6 (PR #467), head after wave 0 = commit cc43efd; wave-1 worktrees branch from that head. Repository conventions: Polish docs/comments/commit messages, TypeScript strict, prettier, gates listed in PLAN.md §2 and §8.`;

const RULES = `HARD RULES FOR YOU: this is a PLANNING task. Do NOT implement anything, do NOT edit any repository file except the deliverables named below, do NOT run builds, typecheck, vitest or Lighthouse (read-only commands like cat/grep/node script --help are fine). Write in Polish with English identifiers (repo house style). Be concrete: names of files, functions, flags, exported APIs, numbers with their source. No invented numbers: when a value is unknown write "do zmierzenia" and say which command measures it.`;

const PLAN_SCHEMA = {
  type: "object",
  properties: {
    plan_path: { type: "string" },
    prompts_paths: { type: "array", items: { type: "string" } },
    json_path: { type: "string" },
    wave1_items: { type: "array", items: { type: "string" } },
    wave2_items: { type: "array", items: { type: "string" } },
    w0_leftovers_assigned: { type: "array", items: { type: "string" } },
    human_decisions: { type: "array", items: { type: "string" } },
    launch_order: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
  required: [
    "plan_path",
    "prompts_paths",
    "json_path",
    "wave1_items",
    "wave2_items",
    "w0_leftovers_assigned",
    "human_decisions",
    "launch_order",
    "summary",
  ],
};

const CRITIQUE_SCHEMA = {
  type: "object",
  properties: {
    critique_path: { type: "string" },
    gaps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          severity: { type: "string", enum: ["blocking", "major", "minor"] },
          where: { type: "string" },
          gap: { type: "string" },
          suggested_fix: { type: "string" },
        },
        required: ["severity", "where", "gap", "suggested_fix"],
      },
    },
    verdict: { type: "string" },
  },
  required: ["critique_path", "gaps", "verdict"],
};

phase("Plan");
const plan = await agent(
  `You are the planning lead (Opus, maximum rigour) under a Fable 5.1 orchestrator for the effort "Lighthouse/PSI mobile >= 85, desktop >= 95 on https://neweuropeanstrategies.com/". Wave 0 (measurement, CI gates, primitives, observability, RUM, diagnosis) is merged. The owner asked for: a refined plan for WAVE 1 and WAVE 2 and ready-to-run prompts for the agents, WITHOUT executing them. ${RULES}
${INPUTS}

DELIVERABLES:
1. ${OUT_PLAN} - the refined plan for waves 1 and 2. Structure:
   §0 Stan po fali 0: what landed (per item, with the exported APIs/flags the next waves rely on), what did NOT land and where it goes (P0.7 warm cron; P0.5 REPORT.md never written -> fold its findings into §1 and name a W1 item that finishes the report from the saved ledgers; P0.6 vitals API + migration; P0.4 Server-Timing nes-layer/colo contract; P0.3 review findings 1-5; P0.2 human decisions; psi-baseline.json), each as an explicit W1 item or an explicit deferral with reason.
   §1 Wnioski z diagnozy P0.5 for the plan: the ranked long-task ledger of W0 (mobile m4 and desktop d4/d5, baseline and C3 regime) built ONLY from valid runs, with class -> file:line -> owner item (P1.7, P1.2, P2.x...), expected duration after the fix, and the arithmetic against the §1.5 score model (what TBT remains after W1, after W2). State clearly which numbers are medians of how many runs.
   §2 Fala 1 and §3 Fala 2: for EVERY item (keep PLAN.md ids: P1.1, P1.2, P1.3, P1.4, P1.6, P1.7 and the W2 items P2.1-P2.6; add W1.0-style ids for the W0 leftovers, e.g. P1.0a..): title; goal in one sentence; mechanism refined with wave-0 facts (exact P0.3 APIs: onQuiescent/enqueue/onFirstInteraction options and priorities; P0.6 contracts; P0.4 contract; harness flags); exact file list = ownership (no file in two items of the same wave; check against PLAN.md §4 and against what W0 already changed); gates to keep green and tests to add; verification = exact commands with the new harness flags (A/B vs the wave base, forms, runs, which ledger/MDE output decides) and the acceptance threshold; depends_on; parallel_group; effort; risk + mitigation; deviations from PLAN.md with reason.
   §4 Kolejność uruchomienia: given concurrency 2 agents per workflow on a 4-CPU box and the heavy-lock, propose the batches (which items run together, which wait), the base-rebuild/re-measure step before each wave (PLAN.md §2), the merge protocol into the PR branch (the owner decided: merge without review stage when told; otherwise review), and the Definition of Done per wave (expected fixture medians and expected PSI effect).
   §5 Decyzje człowieka (open questions with the plan's default assumption meanwhile).
2. ${OUT_P1} and ${OUT_P2} - prompts. For EVERY item of the wave: (a) the implementer prompt, self-contained (Polish; may reference repo paths; must restate the mechanism, file ownership, gates, verification commands, acceptance threshold, commit trailer rule = verbatim session attribution), (b) the reviewer prompt (adversarial lenses: SSR/hydration parity, chunk-graph doctrine, i18n, a11y, CLS, logged-in users/editors, gates, effect realism), (c) the ready args JSON block for ${F2}/workflow-faza2-wave.js (wave, base_ref, items with id, prove, runs, forms, lh_flags, notes = the refined mechanism in <= 25 lines) and the exact Workflow invocation line; plus at the top of each file the batch order and the pre-wave steps (rebase/merge origin/main? base rebuild, base re-measure commands, heavy-lock). Prompts must be consistent with the COMMON block of the wave script (do not contradict it; extend it).
3. ${OUT_JSON} - the structured plan (waves[] with items[] in the same shape as PLAN.json: id, workstream, title, files, mechanism, expected_effect, risk, gates, verification, depends_on, parallel_group, effort; plus w0_leftovers[] and launch_batches[]).
Return the structured summary.`,
  { label: "plan:waves-1-2", phase: "Plan", schema: PLAN_SCHEMA, model: "opus", effort: "xhigh" },
);

phase("Critique");
const critique = await agent(
  `You are the completeness critic (Opus, maximum rigour). ${RULES}
Read the deliverables ${plan.plan_path}, ${plan.prompts_paths.join(", ")}, ${plan.json_path} and ALL inputs below, then answer: what is MISSING, WRONG or NOT EXECUTABLE in the plan and prompts for waves 1 and 2?
Check at least: (1) every wave-0 leftover in STAN-FALI-0.md and W0-wyniki.json (out_of_ownership_needs of P0.2, P0.3, P0.4, P0.6; P0.3-REVIEW findings 1-5; P0.5 report; P0.7) has an owner item or an explicit deferral; (2) the P0.5 ledger was mined correctly (only valid runs; classes map to real file:line in the repo - spot-check 5 of them with grep) and the TBT arithmetic after W1/W2 is consistent with PLAN.md §1.5; (3) no two items in the same wave touch the same file (build the matrix yourself from the prompts' file lists), and no item touches a file W0 changed without saying how it builds on it; (4) every verification command exists: run \`node ${WT}/scripts/performance/lighthouse-local.mjs --help\` (or read its arg parser) and check every flag the prompts use; check package.json scripts named in gates; (5) the prompts restate the P0.3 APIs correctly (open the three modules and compare names/options), the P0.6 contracts and the P0.4 contract; (6) prompts are self-contained and consistent with ${F2}/workflow-faza2-wave.js (args shape, COMMON rules, trailer rule, heavy-lock); (7) risks to logged-in users/editors, SEO, i18n, CLS, a11y, consent law (banner shell) are addressed per item; (8) nothing refuted in the verdict ledger survived; (9) the launch order respects depends_on and the 2-agents-per-workflow cap; (10) human decisions are listed with defaults. Write ${OUT_CRIT} (Polish) and return the structured list. Severity: blocking = the wave cannot start or would do wrong work; major = a real gap an agent would hit; minor = polish.
${INPUTS}`,
  {
    label: "critic:waves-1-2",
    phase: "Critique",
    schema: CRITIQUE_SCHEMA,
    model: "opus",
    effort: "xhigh",
  },
);

const serious = (critique.gaps || []).filter(
  (g) => g.severity === "blocking" || g.severity === "major",
);
let revised = null;
if (serious.length) {
  phase("Revise");
  log(`Critic found ${serious.length} blocking/major gaps; planner revises the deliverables`);
  revised = await agent(
    `You are the planning lead again (Opus, xhigh). ${RULES}
The completeness critic reviewed your deliverables (${plan.plan_path}, ${plan.prompts_paths.join(", ")}, ${plan.json_path}) and wrote ${critique.critique_path}. Address EVERY blocking and major gap below (and minor ones where cheap) by editing the deliverables in place; add a short "Zmiany po krytyce" section at the end of ${OUT_PLAN} (gap -> what changed). Keep ids and structure. Do not weaken verification, gates or acceptance thresholds to make the arithmetic close; if it does not close, say so and mark the stretch items.
GAPS:
${JSON.stringify(serious, null, 2)}
${INPUTS}
Return the structured summary.`,
    { label: "plan:revise", phase: "Revise", schema: PLAN_SCHEMA, model: "opus", effort: "xhigh" },
  );
}

return {
  plan: revised || plan,
  critique: { path: critique.critique_path, verdict: critique.verdict, gaps: critique.gaps },
  revised: Boolean(revised),
};
