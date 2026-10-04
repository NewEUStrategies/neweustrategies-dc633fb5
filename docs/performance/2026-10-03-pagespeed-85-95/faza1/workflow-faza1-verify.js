export const meta = {
  name: "pagespeed-phase1-verify-only",
  description:
    "PageSpeed 85/95: adversarial double-lens verification (feasibility + effect realism) of selected changes of already-finished diagnosis workstreams; each reviewer reads phase1/<key>.json itself",
  phases: [{ title: "Verify", detail: "one adversarial Opus reviewer per change" }],
};

const SCRATCH =
  "/tmp/claude-0/-home-user-neweustrategies-dc633fb5/8fd9e8e2-d544-5db4-ae5e-c509c5e3ff6c/scratchpad";
const WT = "/home/user/neweustrategies-dc633fb5";
const EVIDENCE = WT + "/docs/performance/2026-10-03-pagespeed-85-95/EVIDENCE.md";
const OUTDIR = SCRATCH + "/phase1";
const ITEMS = (args && args.items) || [];
if (!ITEMS.length) throw new Error("args.items = [{key, id}] required");

const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    change_id: { type: "string" },
    feasibility_verdict: { type: "string", enum: ["confirmed", "weakened", "refuted"] },
    feasibility_reasoning: { type: "string", description: "file:line that decides" },
    blocking_issues: { type: "array", items: { type: "string" } },
    effect_verdict: { type: "string", enum: ["confirmed", "weakened", "refuted"] },
    effect_reasoning: {
      type: "string",
      description: "arithmetic in the Lighthouse simulation model",
    },
    corrected_estimate: { type: "string" },
    better_alternative: { type: "string" },
  },
  required: [
    "change_id",
    "feasibility_verdict",
    "feasibility_reasoning",
    "blocking_issues",
    "effect_verdict",
    "effect_reasoning",
    "corrected_estimate",
  ],
};

function verifyPrompt(key, id) {
  return `You are an adversarial reviewer (Opus) for a web-performance plan. Context pack: ${EVIDENCE} (read section 0-cloud for environment limits: no network, fixture backend, the canonical harness scripts/performance/lighthouse-local.mjs and the score-model notes). Code: ${WT} (read-only).
THE CHANGE UNDER REVIEW: change id "${id}" of workstream "${key}". Read it from ${OUTDIR}/${key}.json (object .changes[] with id "${id}"; also read .findings[] for context) and the full workstream report ${OUTDIR}/${key}.md. The quantitative score model is in ${OUTDIR}/lighthouse-analyst.md (Lantern facts: module chunks finishing before observed FCP/LCP count as render-blocking; document TTFB only moves SI; TBT is threshold-convex; mobile 85 needs pre-LCP set <= ~300 KB AND TBT <= 200-250 ms; desktop 95 needs TBT <= ~110 ms on a ~4x slower host).
Apply TWO lenses and return a verdict for each:
LENS 1 = FEASIBILITY/CORRECTNESS IN THIS CODEBASE. Read the actual files named by the change (and their importers/tests). Try to REFUTE that the mechanism works as described: hidden import edges, SSR/hydration parity breaks, chunk-graph cycles, gate violations (check:bundle, check:chunks, check:entry-purity, check:ssr-budgets, check:loader-policy, noHasSelectors), behaviour regressions for logged-in users/editors, i18n/SEO regressions, CLS, a11y. Default to weakened/refuted if the code contradicts the claim. Give the file:line that decides.
LENS 2 = EFFECT REALISM ON THE LIGHTHOUSE SCORE. Using the evidence pack numbers and Lighthouse simulation semantics (mobile 1.6 Mb/s + 150 ms RTT + 4x CPU; desktop 1x CPU on a slow PSI host; TBT counts only tasks before TTI; LCP needs discovery + download + render), try to REFUTE the claimed effect size and the metric attribution. Is the resource actually on the critical path? Would the bytes/ms saved translate into score points? Is there a cheaper change with the same effect? You may run a what-if without a build: cd ${WT} && node scripts/performance/lighthouse-local.mjs --compare . . --html-transform-b <your-transform.mjs> --runs 2 --forms mobile --label v-${key}-${id} (see POMIAR.md and scripts/performance/whatif/*.mjs; put transforms under ${OUTDIR}/verdicts/${key}-${id}/; the machine is shared, so treat timings as noisy and prefer structural evidence). Provide a corrected estimate with your arithmetic.
Do the work: open the files, trace imports (grep), check tests and gates, run read-only commands. Do NOT edit the repository. Write your reasoning to ${OUTDIR}/verdicts/${key}--${id}.md (create dirs) and return the verdict for change_id="${id}".`;
}

phase("Verify");
log(`Verifying ${ITEMS.length} changes: ${ITEMS.map((i) => i.key + ":" + i.id).join(", ")}`);
const verdicts = await parallel(
  ITEMS.map(
    ({ key, id }) =>
      () =>
        agent(verifyPrompt(key, id), {
          label: `verify:${key}:${id}`,
          phase: "Verify",
          schema: VERDICT_SCHEMA,
          model: "opus",
          effort: "high",
        }).then((v) => ({ key, change_id: id, verdict: v })),
  ),
);
return verdicts.filter(Boolean);
