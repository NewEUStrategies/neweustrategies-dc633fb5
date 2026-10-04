export const meta = {
  name: "pagespeed-w0-finish",
  description:
    "PageSpeed 85/95: finish wave 0 - write the P0.5 long-task diagnosis report from the saved ledgers, and get check:bundle green without moving thresholds by shrinking the spreadsheet worker (or equivalent savings)",
  phases: [
    {
      title: "Finish",
      detail: "P0.5 report (Opus, xhigh) and bundle-budget fix (Opus, xhigh) in parallel worktrees",
    },
  ],
};

const SCRATCH =
  "/tmp/claude-0/-home-user-neweustrategies-dc633fb5/8fd9e8e2-d544-5db4-ae5e-c509c5e3ff6c/scratchpad";
const WT = "/home/user/neweustrategies-dc633fb5";
const DOCS = WT + "/docs/performance/2026-10-03-pagespeed-85-95";
const F1 = DOCS + "/faza1";
const F2 = DOCS + "/faza2";
const OUT = SCRATCH + "/phase2/w0fix";
const BASE_REF = "perf/pagespeed-mobile85-desktop95-t595d6";
const TRAILER = `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M84vURVZ4xnvk1AVmdDF5B`;

const COMMON = `Repository: ${WT} (TanStack Start + React 19 + Vite 7 + Nitro on Cloudflare Workers + Supabase). Branch ${BASE_REF} = main (d466993) + one docs commit; wave 0 of the PageSpeed 85/95 effort is merged. Context: ${F1}/PLAN.md and ${F1}/PLAN.json (item mechanisms), ${F1}/ORCHESTRATOR-NOTES.md (owner decision: every optimisation that does not break the platform is approved; verdict ledger), ${F2}/STAN-FALI-0.md, ${F2}/raporty/, ${DOCS}/EVIDENCE.md §0-cloud (no network, fixture backend, 4 CPUs / 15 GB).
Machine discipline: HEAVY = bun run typecheck (tsc needs 7-9 GB), bun run build / build:smoke, any Lighthouse or Playwright run. Exactly ONE heavy step machine-wide, through the mutex: until mkdir ${SCRATCH}/.heavy-lock 2>/dev/null; do sleep 20; done; trap 'rmdir ${SCRATCH}/.heavy-lock 2>/dev/null' EXIT; <step>; rmdir ${SCRATCH}/.heavy-lock. Lighthouse additionally only when the 1-min load average is <= 4. Light commands (vitest files, node --test, grep, node scripts) run outside the lock. Never run bun install.
Repository rules: Polish for comments, docs and commit messages (imperative, like the git log), TypeScript strict, no new dependencies, prettier on touched files, chunk-graph doctrine (scripts/lib/bootVendorSplit.ts notes), every behavioural change gets or updates a vitest test, AGENTS.md rules apply. Worktrees: git -C ${WT} worktree add -B <branch> <dir> ${BASE_REF} && ln -s ${WT}/node_modules <dir>/node_modules; work ONLY inside your worktree, never edit ${WT}.
Commit messages end with EXACTLY this two-line trailer, verbatim (the session's attribution required by the repository owner's harness, not a statement about which model typed the code; never replace the name with your own model name, add no other attribution line):
${TRAILER}`;

const P05_SCHEMA = {
  type: "object",
  properties: {
    worktree: { type: "string" },
    branch: { type: "string" },
    commit: { type: "string" },
    report_path: { type: "string" },
    n_tasks_mobile: { type: "integer" },
    n_tasks_desktop: { type: "integer" },
    valid_runs_used: { type: "array", items: { type: "string" } },
    owners_summary: { type: "array", items: { type: "string" } },
    open_questions: { type: "array", items: { type: "string" } },
  },
  required: [
    "worktree",
    "branch",
    "commit",
    "report_path",
    "n_tasks_mobile",
    "n_tasks_desktop",
    "valid_runs_used",
    "owners_summary",
    "open_questions",
  ],
};

const BUNDLE_SCHEMA = {
  type: "object",
  properties: {
    worktree: { type: "string" },
    branch: { type: "string" },
    commit: { type: "string" },
    approach: { type: "string" },
    local_overall_before_kb: { type: "number" },
    local_overall_after_kb: { type: "number" },
    local_worker_before_kb: { type: "number" },
    local_worker_after_kb: { type: "number" },
    expected_ci_overall_kb: { type: "number" },
    thresholds_changed: { type: "boolean" },
    gates: { type: "array", items: { type: "string" } },
    files_changed: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
    report_path: { type: "string" },
  },
  required: [
    "worktree",
    "branch",
    "commit",
    "approach",
    "local_overall_before_kb",
    "local_overall_after_kb",
    "local_worker_before_kb",
    "local_worker_after_kb",
    "expected_ci_overall_kb",
    "thresholds_changed",
    "gates",
    "files_changed",
    "risks",
    "report_path",
  ],
};

phase("Finish");
const [p05, bundle] = await parallel([
  () =>
    agent(
      `You are the diagnosis lead (Opus, xhigh) under a Fable 5.1 orchestrator. ${COMMON}
TASK: finish wave-0 item P0.5 - the long-task diagnosis report that the previous agent never wrote. Read the mechanism and the mandatory questions of item P0.5 in ${F1}/PLAN.json and ${F1}/PLAN.md (and the score model §1.5, the ownership matrix §4). The raw material already exists and MUST be used instead of new measurements:
- ${F2}/raporty/P0.5-robocze/: rep-mobile.md, rep-desktop.md, sum-w0q-mobile.md, sum-w0q-desktop.md, classmap.json, dump-w0q-*.json, art2/*-summary.txt (per-run metrics with the machine load at run time), ledgers/*.txt|json (Lantern ledgers per task, regimes m4 / m4c3 for mobile, d4 / d4c3 / d5 / d5c3 / d1 for desktop; c3 = the what-if "no script before LCP"), and the scripts that produced them (ledger.mjs, gather.mjs, summarize.py, perftracks.py, layers.mjs, attrib.py, reptable.py) - read them to understand every column.
- ${SCRATCH}/phase2/p05/: the same plus the raw Lighthouse artifacts (art/, art2/ with traces and devtools logs), build-maps/ (source maps of the W0 build) and build-prof/ (React profiling build) if you need to re-attribute a task to file:line.
VALIDITY RULE (non-negotiable): only runs recorded with a 1-min load average <= 3 are valid - per art2/w0q-summary.txt that is w0q-mobile-1..5 and w0q-desktop-1..5, per hints-summary.txt hints-*-2 and hints-*-3, per nofade-summary.txt nofade-mobile-1..3; runs 6-8 and every prof-*/profhook-* run were taken under load and must be excluded and said to be excluded. State for every number how many runs it is a median of.
DELIVERABLE: ${F2}/P0.5-diagnoza-dlugich-zadan.md (Polish, English identifiers) with: (1) the method and the validity filter; (2) the ranked ledger of long tasks for mobile (m4) and desktop (d4 and d5) - observed and simulated start and duration, optimistic/pessimistic blocking share, class, file:line (resolve through the source maps; name React components/layers where the profiling build shows them), owner item from PLAN.md §4 (P1.2, P1.7, P2.2, P2.3, P2.4, P2.5, ... or "brak właściciela" with a proposal), expected duration after the fix with the basis; (3) the same ledger in the C3 regime and what it says about P2.1; (4) the arithmetic: TBT today vs after W1 vs after W2 on fixture and the mapping to PSI (use §1.5 and the k calibration notes of P0.1 if present in ${WT}/scripts/performance/lighthouse-local.mjs --help); (5) answers to every mandatory question of the item; (6) reproduction commands (which script, which artifact, which flags); (7) an ordered fix list grouped by owner item, ready to paste into the wave-1/2 plan. Also replace the stub text of ${F2}/raporty/P0.5-IMPL.md with a short IMPL note (what the report is based on, what was excluded, what remains open).
Worktree: ${SCRATCH}/wt/fix-P0.5 on branch perf/w0fix-P0.5 (docs only; no product files). Run bunx prettier --write on the two markdown files, commit with a Polish message and the trailer, write ${OUT}/P0.5/IMPL.md (create dirs) and return the structured result.`,
      {
        label: "finish:P0.5-report",
        phase: "Finish",
        schema: P05_SCHEMA,
        model: "opus",
        effort: "xhigh",
      },
    ),
  () =>
    agent(
      `You are a senior build engineer (Opus, xhigh) under a Fable 5.1 orchestrator. ${COMMON}
TASK: make the CI gate check:bundle green WITHOUT changing any threshold in scripts/check-bundle-size.ts and without excluding files from its accounting. Facts: on main (and therefore on ${BASE_REF}) CI prints "Bundle budget exceeded: overall total 4806.9 KB > 4772 KB"; the move list vs baseline b006c2e names "+157.1 KB spreadsheet.worker (NOWY)" as the dominant cause (then +10.1 i18n-event-front, +7.4 admin.seo, +5.8 publicEventErrors, +5.4 glossary, +3.1 index). Public budget (2865.3 <= 2877) and boot closure (473.9 <= 579) are fine; only overall is over, by ~35 KB gzip. The kronika inside scripts/check-bundle-size.ts (entries around lines 1400-1490, "spreadsheet.worker 120,9 -> 157,1", "vendor-jszip") records how the team has reasoned about this chunk - read it first and respect its decisions (the owner's instruction: thresholds stay).
The worker: src/lib/files/spreadsheet.worker.ts (started from src/lib/files/spreadsheetWorker.ts via new Worker(new URL(...))), protocol in src/lib/files/spreadsheetProtocol.ts, tests src/lib/files/__tests__/spreadsheet.worker.test.ts and spreadsheetWorker.test.ts. It bundles the xlsx (SheetJS) library. IMPORTANT environment caveat: package.json pins "xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz" but this sandbox has no network, so node_modules/xlsx is the npm build 0.18.5 substituted at install time; local sizes of this chunk are NOT identical to CI. Measure locally before/after anyway, and extrapolate to CI from the ratio (CI worker = 157.1 KB gzip); the orchestrator will confirm on CI. Do not edit package.json or bun.lock.
METHOD: (1) read how CI's build job runs the budget (.github/workflows/ci.yml, job "build": which build command, then bun run check:bundle) and reproduce it locally under the heavy lock (one build at a time; set the same NODE_OPTIONS if the job sets them); run BUNDLE_INVENTORY=1 bun run build && bun run report:chunk-inventory spreadsheet.worker (and vendor-jszip / any sibling the kronika names) to see the module-level composition; (2) find a real reduction >= 40 KB gzip in overall that keeps every spreadsheet feature the app uses (check which formats/operations the app accepts: the uploader's accept list, spreadsheetProtocol operations preview/rows/..., any export paths): candidates in order of preference - import the SheetJS mini build (xlsx/dist/xlsx.mini.min.js) if its format support covers everything the app accepts (verify against node_modules/xlsx/README or dist contents; 0.20.3's mini drops the same families as 0.18.5's), a smaller SheetJS entry or codepage trimming (cpexcel), removing a duplicated zip/codepage implementation between spreadsheet.worker and vendor-jszip (dedupe through the chunk graph, respecting scripts/lib/bootVendorSplit.ts doctrine and check:chunks), or other admin-only savings the inventory shows; (3) if NO option reaches >= 35 KB without a behaviour change, stop and report the measured options with numbers instead of weakening the gate. Never add a dependency, never raise or restructure budgets, never exclude workers from accounting.
GATES: after the change run (under the lock, one at a time) the same build as CI and bun run check:bundle, bun run check:chunks, bun run check:entry-purity, bun run check:chunk-parity; outside the lock bunx vitest run src/lib/files (all spreadsheet tests) and any e2e-light test that exercises spreadsheet import if one exists; bun run typecheck ONCE under the lock; bun run verify:static. Add a short kronika entry in scripts/check-bundle-size.ts only as a comment describing the measured reduction (no number in the budgets changes).
Worktree: ${SCRATCH}/wt/fix-bundle on branch perf/w0fix-bundle. Commit with a Polish message and the trailer. Write ${OUT}/bundle/IMPL.md (Polish: composition before, the chosen approach and why, numbers local before/after, extrapolated CI number, gates, risks) and return the structured result (thresholds_changed must be false).`,
      {
        label: "finish:bundle-budget",
        phase: "Finish",
        schema: BUNDLE_SCHEMA,
        model: "opus",
        effort: "xhigh",
      },
    ),
]);

return { p05, bundle };
