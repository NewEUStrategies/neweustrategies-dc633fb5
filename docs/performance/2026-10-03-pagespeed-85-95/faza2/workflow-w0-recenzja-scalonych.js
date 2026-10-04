export const meta = {
  name: "pagespeed-w0-review-merged",
  description:
    "PageSpeed 85/95: overdue adversarial review of the five wave-0 items merged into main without review (P0.3, P0.6, P0.4, P0.1, P0.2), fixes for blocking/major findings in per-item worktrees, and a recheck",
  phases: [
    {
      title: "Review",
      detail: "one adversarial Opus reviewer per merged item, on the merged tree",
    },
    {
      title: "Fix",
      detail: "implementer fixes blocking/major findings in a worktree (only items that need it)",
    },
    { title: "Recheck", detail: "reviewer confirms the fix commit" },
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

const ITEMS = [
  {
    id: "P0.3",
    commits: "fa26999",
    files:
      "src/lib/performance/whenQuiescent.ts, firstInteraction.ts, postInteractionQueue.ts and their __tests__",
    notes:
      "A first review already exists (" +
      F2 +
      "/raporty/P0.3-REVIEW.md: fix_required, 1 significant + 4 minor, none blocking) and NONE of its findings is fixed yet. Re-verify each of them on the merged code, add what it missed (API fitness for the wave-1 consumers P1.1 gtag, P1.3 consent shell, P1.6 islands; fake-timer test realism; SSR safety; memory), and classify: a finding that would make a wave-1 consumer misbehave in a Lighthouse trace or lose a user click is blocking.",
  },
  {
    id: "P0.6",
    commits: "cac56cf",
    files: "src/lib/webVitals.ts, src/lib/__tests__/webVitals.test.ts",
    notes:
      "Payload fields edgeCache/edgeLayer/colo/inpEvent/inpPreHydration/inpSinceLoad. Check: beacon byte budget vs the ingest MAX_BODY (8000) with worst-case batches, privacy (no identifiers), the Server-Timing parser against what src/lib/http/ssrTiming.ts + src/server.ts actually emit after P0.4 (nes-layer;desc, colo;desc), behaviour when the ingest API still ignores the new fields (src/routes/api/public/vitals.ts), soft navigations, SSR safety.",
  },
  {
    id: "P0.4",
    commits: "32d8ee0 and the test patch in cc43efd",
    files:
      "src/server.ts, src/lib/http/ssrTiming.ts, src/lib/http/documentCache.server.ts, src/lib/http/__tests__/ssrTiming.server.test.ts, src/lib/http/__tests__/documentCache.server.test.ts, src/__tests__/serverEntryRequestOptions.test.ts",
    notes:
      "The implementer was cut off before its final gates, so this review is also a COMPLETENESS check: compare the merged code with the mechanism in " +
      F1 +
      "/PLAN.json (item P0.4) and the three corrections of the SC-1 verdict (" +
      F1 +
      "/raporty/werdykty/server-cache--SC-1.md): streamMs from a body wrapper (not the tee), cold flag from isoReq plus a lazy first-request marker, no Server-Timing 'stream' metric, privacy-safe (no IPs, UA only as a class). Verify the log line is emitted exactly once per HTML document, never blocks streaming, HEAD/no-body paths, background revalidation, and that Workers runtime constraints hold (no Node APIs). Run the three test files. If you can, start the built artifact like playwright.performance.config.ts does (only if " +
      WT +
      "/.output exists) and curl -s -D - the document to see the Server-Timing header.",
  },
  {
    id: "P0.1",
    commits: "1ec5d75 and a0c28f9",
    files:
      "scripts/performance/lighthouse-local.mjs, artifactServer.ts, lighthouseReport.ts, homeFixture.ts, clientBackend.ts, fakeGoogle.ts, lanternTasks.ts, harness-ext.test.mjs, playwright.artifact.config.ts, docs narzedzia/measure-*.sh (stubs), lighthouse-local-baseline.json, EVIDENCE.md, POMIAR.md",
    notes:
      "The IMPL report is a stub, so reconstruct what landed from git show of the commits and from node scripts/performance/lighthouse-local.mjs --help. Verify: re-warm before every run and the exclusion/repeat of STALE/MISS runs (n_valid) cannot silently drop all runs; the Lantern ledger (lanternTasks.ts) reconciles with the audit TBT; A/A sigma and MDE arithmetic; desktop4x/desktop5x forms are PSI-like; default flags keep comparability with the saved baseline json; the fake gtag cannot leak into non-fake runs; no secrets or machine paths in committed files; measure-*.sh stubs exit 1 with a pointer; node --test scripts/performance/harness-ext.test.mjs passes. A one-run smoke of the harness is optional and ONLY under the heavy lock with 1-min load <= 4 (node scripts/performance/lighthouse-local.mjs --runs 1 --forms mobile --label review-p01, needs " +
      WT +
      "/.output and LIGHTHOUSE_CLI=" +
      SCRATCH +
      "/tools/node_modules/lighthouse/cli/index.js CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome).",
  },
  {
    id: "P0.2",
    commits: "868b2a6 and psi-sample.test.mjs in cc43efd",
    files:
      "package.json (scripts only), .github/workflows/first-visit.yml, .github/workflows/lighthouse.yml, .github/workflows/psi.yml, scripts/verify-static.ts, scripts/performance/psi-sample.mjs, scripts/performance/psi-sample.test.mjs",
    notes:
      "Read the three workflow YAMLs as a strict reviewer (step ordering, ids/if conditions, shells and pipefail, env vs secrets, artifact names, timeouts, the lighthouse-scope path filter logic, continue-on-error only where intended, check:document-weight blocking exactly once on the candidate). Run bun run check:gate-coverage, bun run check:workflow-env-contract and node --test scripts/performance/psi-sample.test.mjs. psi.yml must stay green with a warning when PSI_API_KEY is missing and must fail when the sampler exits 1.",
  },
];

const COMMON = `Repository: ${WT} (TanStack Start + React 19 + Vite 7 + Nitro on Cloudflare Workers + Supabase). Branch ${BASE_REF} = main (d466993) + one docs commit; wave 0 of the PageSpeed 85/95 effort was merged there WITHOUT the planned adversarial review, on the owner's instruction, and the owner now asks for that review to be done on the merged code. Context: ${F1}/PLAN.md (§1.3 Lantern invariants, §2 agent protocol, §4 ownership), ${F1}/PLAN.json (item mechanisms, gates, verification), ${F1}/ORCHESTRATOR-NOTES.md (owner decision, verdict ledger), ${F2}/STAN-FALI-0.md, ${F2}/raporty/<id>-IMPL.md (what the implementer says it did), ${F2}/raporty/W0-wyniki.json (structured agent results incl. out_of_ownership_needs), ${DOCS}/EVIDENCE.md §0-cloud (environment: no network, fixture backend, 4 CPUs / 15 GB).
Machine discipline: HEAVY = bun run typecheck (tsc needs 7-9 GB), bun run build / build:smoke, any Lighthouse or Playwright run. Exactly ONE heavy step machine-wide, through the mutex: until mkdir ${SCRATCH}/.heavy-lock 2>/dev/null; do sleep 20; done; trap 'rmdir ${SCRATCH}/.heavy-lock 2>/dev/null' EXIT; <step>; rmdir ${SCRATCH}/.heavy-lock. Targeted vitest files and node --test are light and run outside the lock. Never run bun install. Treat timings as noisy; structural evidence decides.
Repository rules: Polish for comments, docs and commit messages (imperative, like the git log), TypeScript strict, no new dependencies, prettier on touched files, SSR/hydration parity, chunk-graph doctrine (scripts/lib/bootVendorSplit.ts notes), i18n via dictionaries only, every behavioural change gets or updates a vitest test, AGENTS.md rules apply.`;

const REVIEW_SCHEMA = {
  type: "object",
  properties: {
    item_id: { type: "string" },
    verdict: { type: "string", enum: ["approve", "fix_required", "block"] },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          severity: { type: "string", enum: ["blocking", "major", "minor"] },
          title: { type: "string" },
          file_line: { type: "string" },
          evidence: { type: "string" },
          fix: { type: "string" },
        },
        required: ["severity", "title", "file_line", "evidence", "fix"],
      },
    },
    tests_run: { type: "array", items: { type: "string" } },
    report_path: { type: "string" },
  },
  required: ["item_id", "verdict", "findings", "tests_run", "report_path"],
};

const FIX_SCHEMA = {
  type: "object",
  properties: {
    item_id: { type: "string" },
    worktree: { type: "string" },
    branch: { type: "string" },
    commit: { type: "string" },
    files_changed: { type: "array", items: { type: "string" } },
    findings_addressed: { type: "array", items: { type: "string" } },
    not_addressed: {
      type: "array",
      items: {
        type: "object",
        properties: { title: { type: "string" }, reason: { type: "string" } },
        required: ["title", "reason"],
      },
    },
    gates: { type: "array", items: { type: "string" } },
    out_of_ownership_needs: { type: "array", items: { type: "string" } },
    report_path: { type: "string" },
  },
  required: [
    "item_id",
    "worktree",
    "branch",
    "commit",
    "files_changed",
    "findings_addressed",
    "not_addressed",
    "gates",
    "report_path",
  ],
};

const RECHECK_SCHEMA = {
  type: "object",
  properties: {
    item_id: { type: "string" },
    verdict: { type: "string", enum: ["approve", "fix_required", "block"] },
    remaining: { type: "array", items: { type: "string" } },
    notes: { type: "string" },
  },
  required: ["item_id", "verdict", "remaining", "notes"],
};

function reviewPrompt(item) {
  return `You are an adversarial reviewer (Opus, high rigour) under a Fable 5.1 orchestrator. ${COMMON}
ITEM UNDER REVIEW: ${item.id}. Merged commits: ${item.commits} (git -C ${WT} show <sha> --stat and the diffs). Files: ${item.files}. Orchestrator notes: ${item.notes}
Read the item's mechanism in ${F1}/PLAN.json, the IMPL report ${F2}/raporty/${item.id}-IMPL.md, its entry in ${F2}/raporty/W0-wyniki.json, and the verdict(s) the item cites in ${F1}/raporty/werdykty/. Then read the merged code line by line and TRY TO REFUTE that it is correct, complete and safe. Lenses: (1) correctness and completeness vs the mechanism; (2) SSR/hydration parity and client/server boundaries (Workers runtime, no Node APIs on the edge); (3) regressions for logged-in users, editors, i18n, SEO, CLS, a11y; (4) privacy and security of any telemetry; (5) test quality (does the test actually exercise the behaviour; fake timers; negative controls) and gates (verify:static families, check:gate-coverage, chunk doctrine); (6) effect realism on the Lighthouse score where the item claims one; (7) fitness of the exported API/contract for the next waves (P1.1, P1.3, P1.6, P1.7). Run the item's own tests (bunx vitest run <files> or node --test) and any light read-only command; NO typecheck, NO build (the fixer does those). Do NOT edit ${WT}.
Severity rules: blocking = wrong behaviour in production or in a Lighthouse trace, data loss, privacy leak, a gate that CI will fail, or an API that the wave-1 consumers cannot use safely; major = real defect an engineer would fix before relying on the item; minor = polish. Each finding needs file:line and evidence (what you ran or read), and a concrete fix.
Write ${OUT}/${item.id}/REVIEW.md (Polish; create dirs; verdict first, then findings with severities, then what you checked and found correct) and return the structured review (report_path = that file).`;
}

function fixPrompt(item, review) {
  const wt = `${SCRATCH}/wt/fix-${item.id}`;
  const serious = review.findings.filter((f) => f.severity !== "minor");
  return `You are a senior engineer (Opus, xhigh) under a Fable 5.1 orchestrator. ${COMMON}
TASK: fix the blocking and major findings of the adversarial review of merged item ${item.id} (review: ${review.report_path}). Minor findings only when the fix is a few lines in a file you already touch.
FINDINGS TO FIX:
${JSON.stringify(serious, null, 2)}
SETUP (exactly once): git -C ${WT} worktree add -B perf/w0fix-${item.id} ${wt} ${BASE_REF} && ln -s ${WT}/node_modules ${wt}/node_modules. Work ONLY inside ${wt}; never edit ${WT}. Files you may touch: ${item.files} (plus the tests of those modules). A fix that truly needs another file goes to out_of_ownership_needs instead of being made.
GATES before the commit: bunx prettier --write on touched files; bunx eslint on touched files; bunx vitest run <tests of touched modules> (add or extend tests for every behaviour you change); bun run typecheck ONCE under the heavy lock; bun run verify:static (light, outside the lock). For .github workflow YAML edits also bun run check:gate-coverage and bun run check:workflow-env-contract.
Commit in ${wt} with a Polish message (summary + body: which review findings, what changed, gates run) ending with EXACTLY this two-line trailer, verbatim (it is the session's attribution required by the repository owner's harness, not a statement about which model typed the code; never replace the name with your own model name and add no other attribution line):
${TRAILER}
Write ${OUT}/${item.id}/FIX.md (Polish: finding -> change, gates with results, what you did not fix and why) and return the structured result.`;
}

function recheckPrompt(item, review, fix) {
  return `You are the adversarial reviewer again (Opus, high). ${COMMON}
Item ${item.id}: your review ${review.report_path} listed these non-minor findings: ${JSON.stringify(review.findings.filter((f) => f.severity !== "minor").map((f) => f.title))}. The fixer answered with commit ${fix.commit} on branch ${fix.branch} in worktree ${fix.worktree} (report ${fix.report_path}; not addressed: ${JSON.stringify(fix.not_addressed)}). Read the diff (git -C ${fix.worktree} show ${fix.commit}) and run the touched tests (bunx vitest run <files> inside the worktree; no typecheck, no build). Decide per finding whether it is really fixed, and whether the fix introduced a new problem. Append a "Ponowna kontrola" section to ${review.report_path} (Polish) and return the verdict with the list of findings that remain blocking or major.`;
}

phase("Review");
log(`Reviewing ${ITEMS.length} merged items: ${ITEMS.map((i) => i.id).join(", ")}`);
const results = await pipeline(
  ITEMS,
  (item) =>
    agent(reviewPrompt(item), {
      label: `review:${item.id}`,
      phase: "Review",
      schema: REVIEW_SCHEMA,
      model: "opus",
      effort: "high",
    }).then((r) => ({ item, review: r })),
  async ({ item, review }) => {
    if (!review) return { item, review: null, fix: null, recheck: null };
    const serious = (review.findings || []).filter((f) => f.severity !== "minor");
    if (!serious.length) return { item, review, fix: null, recheck: null };
    const fix = await agent(fixPrompt(item, review), {
      label: `fix:${item.id}`,
      phase: "Fix",
      schema: FIX_SCHEMA,
      model: "opus",
      effort: "xhigh",
    });
    if (!fix) return { item, review, fix: null, recheck: null };
    const recheck = await agent(recheckPrompt(item, review, fix), {
      label: `recheck:${item.id}`,
      phase: "Recheck",
      schema: RECHECK_SCHEMA,
      model: "opus",
      effort: "high",
    });
    return { item, review, fix, recheck };
  },
);

return results.filter(Boolean).map((r) => ({
  id: r.item.id,
  review_verdict: r.review ? r.review.verdict : "no_review",
  findings: r.review ? r.review.findings.map((f) => `${f.severity}: ${f.title}`) : [],
  review_path: r.review ? r.review.report_path : null,
  fix: r.fix
    ? {
        branch: r.fix.branch,
        commit: r.fix.commit,
        files: r.fix.files_changed,
        not_addressed: r.fix.not_addressed,
        out_of_ownership_needs: r.fix.out_of_ownership_needs || [],
        report: r.fix.report_path,
      }
    : null,
  recheck: r.recheck ? { verdict: r.recheck.verdict, remaining: r.recheck.remaining } : null,
}));
