import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const step = workflow.slice(workflow.indexOf("      - name: Read E2E results for this commit"));
const script = step
  .split("          script: |\n")[1]
  .split(/\n(?= {6}- name:)/)[0]
  .split("\n")
  .map((line) => line.slice(12))
  .join("\n");
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

async function collect(runs: unknown[], jobs: unknown[]) {
  const output = new Map<string, string>();
  const listWorkflowRuns = vi.fn().mockResolvedValue({ data: { workflow_runs: runs } });
  const paginate = vi.fn().mockResolvedValue(jobs);
  const core = { setFailed: vi.fn() };
  const delay = vi.fn((resolve: () => void) => resolve());
  await new AsyncFunction("require", "context", "github", "core", "setTimeout", script)(
    () => ({
      mkdirSync: vi.fn(),
      writeFileSync: (path: string, value: string) => output.set(path, value),
    }),
    { repo: { owner: "owner", repo: "repo" }, sha: "release" },
    { rest: { actions: { listWorkflowRuns, listJobsForWorkflowRun: vi.fn() } }, paginate },
    core,
    delay,
  );
  return {
    report: JSON.parse(output.get("reports/e2e-status.json")!),
    core,
    delay,
    listWorkflowRuns,
    paginate,
  };
}

describe("release workflow evidence", () => {
  it("accepts both E2E jobs from the completed run for this commit", async () => {
    const result = await collect(
      [
        { head_sha: "other", status: "completed" },
        {
          id: 20,
          head_sha: "release",
          status: "completed",
          html_url: "https://example.test/run/20",
        },
      ],
      [
        { name: "e2e", conclusion: "success" },
        { name: "e2e-seeded", conclusion: "success" },
      ],
    );
    expect(result.report).toEqual({
      commit: "release",
      checks: { e2e: "success", "e2e-seeded": "success" },
      runUrl: "https://example.test/run/20",
    });
    expect(result.listWorkflowRuns).toHaveBeenCalledWith(
      expect.objectContaining({
        head_sha: "release",
        event: "push",
        branch: "main",
        workflow_id: "e2e.yml",
      }),
    );
    expect(result.paginate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ run_id: 20 }),
    );
    expect(result.core.setFailed).not.toHaveBeenCalled();
  });
  it.each(
    [
      [],
      [{ name: "e2e", conclusion: "failure" }],
      [
        { name: "e2e", conclusion: "success" },
        { name: "e2e-seeded", conclusion: "skipped" },
      ],
    ].map((jobs) => [jobs]),
  )("fails on absent or unsuccessful E2E jobs", async (jobs) => {
    const result = await collect([{ head_sha: "release", status: "completed" }], jobs);
    expect(result.core.setFailed).toHaveBeenCalledOnce();
  });
  it.each(
    [
      [],
      [{ head_sha: "release", status: "in_progress" }],
      [{ head_sha: "other", status: "completed" }],
    ].map((runs) => [runs]),
  )("bounds waiting for missing evidence and preserves unknown", async (runs) => {
    const result = await collect(runs, []);
    expect(result.delay).toHaveBeenCalledTimes(19);
    expect(result.listWorkflowRuns).toHaveBeenCalledTimes(20);
    expect(result.paginate).not.toHaveBeenCalled();
    expect(result.report.checks).toEqual({ e2e: "unknown", "e2e-seeded": "unknown" });
    expect(result.core.setFailed).toHaveBeenCalledOnce();
  });
  it("keeps the deployed Drizzle routine identical to the pgTAP-tested Supabase routine", () => {
    expect(readFileSync("drizzle/migrations/0003_read_only_schema_contract.sql", "utf8")).toBe(
      readFileSync("supabase/migrations/20260912170000_read_only_schema_contract.sql", "utf8"),
    );
  });
});
