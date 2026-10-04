export const meta = {
  name: "pagespeed-phase1-structure-report",
  description:
    "PageSpeed 85/95: turn an already-written workstream report (phase1/<key>.md) into the structured WS_SCHEMA JSON (phase1/<key>.json) when the original agent died before returning it",
  phases: [{ title: "Structure", detail: "one Opus agent per report" }],
};

const SCRATCH =
  "/tmp/claude-0/-home-user-neweustrategies-dc633fb5/8fd9e8e2-d544-5db4-ae5e-c509c5e3ff6c/scratchpad";
const OUTDIR = SCRATCH + "/phase1";
const KEYS = (args && args.keys) || [];
if (!KEYS.length) throw new Error("args.keys required");

const WS_SCHEMA = {
  type: "object",
  properties: {
    key: { type: "string" },
    report_path: { type: "string" },
    summary: { type: "string", description: "<= 150 words, the diagnosis in numbers" },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          claim: { type: "string" },
          evidence: { type: "string" },
          metric: { type: "string" },
          severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
        },
        required: ["id", "claim", "evidence", "metric", "severity"],
      },
    },
    changes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          files: { type: "array", items: { type: "string" } },
          mechanism: { type: "string" },
          metric: { type: "string" },
          expected_effect: { type: "string" },
          estimate_basis: { type: "string" },
          risk: { type: "string", enum: ["low", "medium", "high"] },
          risk_notes: { type: "string" },
          gates: { type: "array", items: { type: "string" } },
          verification: { type: "string" },
          depends_on: { type: "array", items: { type: "string" } },
          effort: { type: "string", enum: ["S", "M", "L", "XL"] },
        },
        required: [
          "id",
          "title",
          "files",
          "mechanism",
          "metric",
          "expected_effect",
          "estimate_basis",
          "risk",
          "gates",
          "verification",
          "effort",
        ],
      },
    },
    conflicts_with_other_workstreams: { type: "array", items: { type: "string" } },
    open_questions: { type: "array", items: { type: "string" } },
  },
  required: ["key", "report_path", "summary", "findings", "changes"],
};

phase("Structure");
const out = await parallel(
  KEYS.map(
    (key) => () =>
      agent(
        `Read the finished web-performance diagnosis report ${OUTDIR}/${key}.md completely (it was written by another agent who then died before returning its structured summary). Produce the structured summary faithfully: every finding in the report becomes a findings[] item (keep the report's own ids where it has them, e.g. F1/CS-F1; otherwise number them ${key}-F1...), every proposed change in its ordered change list becomes a changes[] item in the SAME ORDER with the report's own ids (e.g. CS-1 or whatever the report uses), with files, mechanism, metric, expected_effect, estimate_basis, risk, gates, verification, depends_on and effort copied or condensed from the report (do not invent numbers; if the report gives none write 'not stated'). summary <= 150 words with the key numbers. Also write the exact same object as JSON to ${OUTDIR}/${key}.json. Return it (key = "${key}", report_path = "${OUTDIR}/${key}.md").`,
        {
          label: `structure:${key}`,
          phase: "Structure",
          schema: WS_SCHEMA,
          model: "opus",
          effort: "medium",
        },
      ),
  ),
);
return out
  .filter(Boolean)
  .map((r) => ({ key: r.key, n_findings: r.findings.length, changes: r.changes.map((c) => c.id) }));
