export const meta = {
  name: "pagespeed-phase1c-synthesis",
  description:
    "PageSpeed 85/95: integrate the ten verified diagnosis reports into PLAN.md (waves, file ownership, score model), then a completeness critic; one revision round if the critic finds blocking gaps",
  phases: [
    { title: "Plan", detail: "planning lead (Opus, xhigh) writes PLAN.md" },
    { title: "Critique", detail: "completeness critic (Opus, xhigh) writes CRITIQUE.md" },
    { title: "Revise", detail: "planner addresses blocking/major gaps" },
  ],
};

const SCRATCH =
  "/tmp/claude-0/-home-user-neweustrategies-dc633fb5/8fd9e8e2-d544-5db4-ae5e-c509c5e3ff6c/scratchpad";
const WT = "/home/user/neweustrategies-dc633fb5";
const EVIDENCE = WT + "/docs/performance/2026-10-03-pagespeed-85-95/EVIDENCE.md";
const OUTDIR = SCRATCH + "/phase1";
const KEYS = (args && args.keys) || [
  "boot-js",
  "hydration",
  "html-weight",
  "css",
  "lcp-path",
  "server-cache",
  "third-party",
  "measurement",
  "lighthouse-analyst",
  "prior-art",
];
const ORCH_NOTES = (args && args.orchestrator_notes) || "";

const PLAN_SCHEMA = {
  type: "object",
  properties: {
    plan_path: { type: "string" },
    targets: {
      type: "object",
      properties: { mobile: { type: "string" }, desktop: { type: "string" } },
    },
    waves: {
      type: "array",
      items: {
        type: "object",
        properties: {
          wave: { type: "integer" },
          goal: { type: "string" },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                workstream: { type: "string" },
                title: { type: "string" },
                files: { type: "array", items: { type: "string" } },
                mechanism: { type: "string" },
                expected_effect: { type: "string" },
                risk: { type: "string" },
                gates: { type: "array", items: { type: "string" } },
                verification: { type: "string" },
                depends_on: { type: "array", items: { type: "string" } },
                parallel_group: { type: "string" },
                effort: { type: "string" },
              },
              required: [
                "id",
                "workstream",
                "title",
                "files",
                "mechanism",
                "expected_effect",
                "risk",
                "gates",
                "verification",
                "parallel_group",
                "effort",
              ],
            },
          },
          expected_scores_after: { type: "string" },
        },
        required: ["wave", "goal", "items"],
      },
    },
    file_ownership: {
      type: "array",
      items: {
        type: "object",
        properties: {
          path_pattern: { type: "string" },
          owner_item_ids: { type: "array", items: { type: "string" } },
        },
        required: ["path_pattern", "owner_item_ids"],
      },
    },
    dropped_or_deferred: { type: "array", items: { type: "string" } },
    decisions_for_human: { type: "array", items: { type: "string" } },
  },
  required: ["plan_path", "waves", "file_ownership", "decisions_for_human"],
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
          gap: { type: "string" },
          suggested_fix: { type: "string" },
        },
        required: ["severity", "gap", "suggested_fix"],
      },
    },
    score_arithmetic_closes: { type: "boolean" },
    verdict: { type: "string" },
  },
  required: ["critique_path", "gaps", "score_arithmetic_closes", "verdict"],
};

const INPUTS = `Inputs (read ALL of them fully, they are the product of ten Opus workstreams plus adversarial verification):
- Evidence pack: ${EVIDENCE} (section 0-cloud = environment limits of this sandbox: no network, fixture backend, 4 CPUs; §1-10 = production and laptop measurements).
- Team's own plan: ${WT}/docs/performance/2026-10-02-pagespeed-przyczyny.md §8, §8a, §9.
- Workstream reports: ${KEYS.map((k) => `${OUTDIR}/${k}.md`).join(", ")} and their structured copies ${OUTDIR}/<key>.json (findings + changes).
- Adversarial verdicts per verified change: ${OUTDIR}/verdicts/<key>--<change_id>.md (feasibility + effect lenses; drop refuted changes unless you can argue the refutation is wrong; use corrected estimates). Structured copies: ${WT}/docs/performance/2026-10-03-pagespeed-85-95/faza1/raporty/werdykty/<key>--<id>.json. Change ids are only unique per workstream (boot-js C1..C13 vs css C1..C11): always write them as <workstream>:<id> in the plan.
- Local baseline of this sandbox (fixture backend, slow CPU comparable to PSI's host): ${SCRATCH}/lh/results-baseline.log (MEDIAN lines) and ${SCRATCH}/lh/results/baseline-*.summary.txt.
- Orchestrator notes (Fable 5.1, authoritative constraints and corrections; READ FIRST): ${OUTDIR}/ORCHESTRATOR-NOTES.md${ORCH_NOTES ? " Additional notes: " + ORCH_NOTES : ""}`;

phase("Plan");
const plan = await agent(
  `You are the planning lead (Opus, maximum rigour) under a Fable 5.1 orchestrator. Integrate the diagnosis reports into ONE implementation plan that reaches Lighthouse mobile >= 85 and desktop >= 95 for https://neweuropeanstrategies.com/ with world-class engineering quality (durable mechanisms + CI gates, not hacks), executable by parallel Opus implementation agents in separate git worktrees of ${WT}.
${INPUTS}
Produce ${OUTDIR}/PLAN.md (Polish, the repo's house language for docs, with English identifiers) containing:
1. Root-cause statement ranked by score impact with numbers, and the score model (metric targets per form factor, from the lighthouse-analyst report).
2. Waves of work ordered by effect/risk with explicit parallelism: Wave 1 = highest-impact low-risk items that do not conflict in files; later waves build on them. For each item: id, workstream, title, exact files, mechanism (2-5 sentences, concrete enough that an implementation agent does not need to re-diagnose), expected effect with basis, risk + mitigation, gates/tests to add or keep green, verification command/measurement (local A/B protocol: node scripts/performance/lighthouse-local.mjs --compare <baseline-worktree> <candidate-worktree> --runs 3 — interleaved runs, medians, DELTA B-A; plus node scripts/performance/check-document-weight.ts; see POMIAR.md), depends_on, parallel_group (items in the same group must not be implemented concurrently because they touch the same files).
3. A file-ownership matrix so implementation agents can work in parallel worktrees without merge conflicts (every file touched by any item appears exactly once per wave).
4. Cumulative expected score trajectory after each wave (mobile/desktop), honest about uncertainty, and which items are "must" vs "stretch" for the targets.
5. Items deliberately dropped/deferred and why; decisions that need the human (analytics policy, cache TTL vs editorial freshness, consent UX, /~flock.js, etc.) — mark what the plan assumes meanwhile.
6. Definition of done for the whole effort: local A/B medians + production PSI confirmation protocol after deploy (what the human runs, what numbers to expect).
Also write the structured plan to ${OUTDIR}/PLAN.json. Return the structured plan (same content, compact).`,
  { label: "synthesis:plan", phase: "Plan", schema: PLAN_SCHEMA, model: "opus", effort: "xhigh" },
);

phase("Critique");
const critique = await agent(
  `You are the completeness critic (Opus, maximum rigour). Read ${EVIDENCE}, ${plan.plan_path}, and every report in ${OUTDIR}/*.md plus the verdicts in ${OUTDIR}/verdicts/. Answer: what is MISSING or WRONG in the plan for reaching mobile 85 / desktop 95 on PSI? Check: (1) every byte/ms bucket in the evidence pack has an owner item or an explicit drop; (2) the score arithmetic closes (sum of expected effects actually reaches the metric targets with margin, considering PSI's slow desktop host and Lighthouse simulation) — redo the arithmetic yourself with the lighthouse-analyst score model; (3) no two items in the same wave/parallel group touch the same files; (4) each item has a measurable verification; (5) risks to logged-in users/editors/SEO/i18n/CLS/a11y are addressed; (6) anything the production evidence shows that no workstream explained (e.g. the FCP->LCP gap on PSI mobile, desktop TBT 740 ms on PSI); (7) each item's mechanism is concrete enough for an implementation agent (names the files, the functions, the gate) — flag vague ones; (8) refuted changes did not survive into the plan without rebuttal. Write ${OUTDIR}/CRITIQUE.md (Polish) and return the structured list.`,
  {
    label: "synthesis:critic",
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
  log(`Critic found ${serious.length} blocking/major gaps; planner revises PLAN.md`);
  revised = await agent(
    `You are the planning lead again (Opus, xhigh). The completeness critic reviewed your plan ${plan.plan_path} and wrote ${critique.critique_path}. Address EVERY blocking and major gap listed below (and the minor ones where cheap): fix the plan in place (edit ${OUTDIR}/PLAN.md and ${OUTDIR}/PLAN.json), add a short "Zmiany po krytyce" section at the end listing gap -> what changed. Keep the structure. Do not weaken verification or gates to make arithmetic close; if the arithmetic genuinely does not close, say so and mark the shortfall and the stretch items that would close it.
GAPS:
${JSON.stringify(serious, null, 2)}
${INPUTS}
Return the revised structured plan.`,
    {
      label: "synthesis:revise",
      phase: "Revise",
      schema: PLAN_SCHEMA,
      model: "opus",
      effort: "xhigh",
    },
  );
}

return { plan: revised || plan, critique, revised: Boolean(revised) };
