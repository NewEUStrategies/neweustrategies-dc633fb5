// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "billing-cli-"));
  // Compile the complete CLI and its pure dependency, not an extracted main().
  const compile = (source: string) =>
    ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    }).outputText;
  writeFileSync(
    join(directory, "logic.mjs"),
    compile(readFileSync("src/lib/ci/billingRenewalProbe.ts", "utf8")),
  );
  writeFileSync(
    join(directory, "probe.mjs"),
    compile(
      readFileSync("scripts/billing-renewal-probe.ts", "utf8").replace(
        '"../src/lib/ci/billingRenewalProbe"',
        '"./logic.mjs"',
      ),
    ),
  );
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

function run(
  mode: string,
  env: Record<string, string> = {},
): Promise<{ code: number; output: string }> {
  return new Promise((resolveResult) => {
    execFile(
      process.execPath,
      [
        "--import",
        resolve("src/test/billing/probeGateway.mjs"),
        join(directory, "probe.mjs"),
        mode,
      ],
      {
        timeout: 5000,
        env: {
          PROBE_GATEWAY_URL: "https://probe.invalid/stripe",
          STRIPE_SANDBOX_API_KEY: "fixture-connection",
          LOVABLE_API_KEY: "fixture-platform",
          PROBE_STATE_FILE: join(directory, "state.json"),
          PROBE_REPORT_FILE: join(directory, "report.json"),
          PROBE_FIXTURE_GATEWAY_STATE: join(directory, "gateway.json"),
          PROBE_FIXTURE_CALLS: join(directory, "calls.jsonl"),
          GITHUB_OUTPUT: join(directory, "output.txt"),
          PROBE_STRICT: "true",
          PROBE_WAIT_TIMEOUT_MS: "20",
          PROBE_WAIT_POLL_MS: "1",
          // Nasza baza (krok `verify`) - ta sama atrapa transportu, inna ścieżka.
          PROBE_SUPABASE_URL: "https://probe.invalid/supabase",
          PROBE_SUPABASE_SERVICE_ROLE_KEY: "fixture-service-role",
          PROBE_DB_WAIT_TIMEOUT_MS: "20",
          PROBE_DB_POLL_MS: "1",
          ...env,
        },
      },
      (error, stdout, stderr) =>
        resolveResult({ code: error ? Number(error.code) || 1 : 0, output: stdout + stderr }),
    );
  });
}

describe("billing renewal CLI contract", () => {
  it("runs arm -> wait -> verify and emits outputs used by the nightly workflow", async () => {
    expect(await run("arm")).toMatchObject({ code: 0 });
    expect(await run("wait")).toMatchObject({ code: 0 });
    expect(await run("verify")).toMatchObject({ code: 0 });
    const report = JSON.parse(readFileSync(join(directory, "report.json"), "utf8"));
    expect(report).toMatchObject({
      outcome: "renewed",
      renewalInvoiceId: "in_new",
      periodMoved: true,
    });
    expect(readFileSync(join(directory, "output.txt"), "utf8")).toBe(
      "outcome=armed\noutcome=ready\noutcome=renewed\n",
    );
    // Werdykt naszej strony trafia do raportu razem z werdyktem operatora.
    expect(report).toMatchObject({
      stripeOutcome: "renewed",
      local: { outcome: "synced", processedEvents: 1, failedEventIds: [] },
    });
  });

  // KRYTERIUM PAY-17c: sonda czerwona, gdy nasza strona nie odebrała odnowienia.
  it.each([
    ["brak przetworzonego zdarzenia w dzienniku", "missing", "PRZETWORZONEGO"],
    ["porażka obsługi w dzienniku", "failed", "PADŁA"],
    ["okres w bazie nieprzesunięty", "stale", "NIE nadąża"],
  ])(
    "operator odnowił, a nasza strona nie (%s) - weryfikacja CZERWONA",
    async (_label, mode, reason) => {
      expect(await run("arm")).toMatchObject({ code: 0 });
      expect(await run("wait")).toMatchObject({ code: 0 });

      const result = await run("verify", { PROBE_FIXTURE_LOCAL: mode });

      expect(result.code).toBe(1);
      const report = JSON.parse(readFileSync(join(directory, "report.json"), "utf8"));
      expect(report).toMatchObject({ outcome: "failed", stripeOutcome: "renewed" });
      expect(report.local.outcome).toBe("failed");
      expect(report.local.reason).toContain(reason);
      expect(result.output).toContain("Nasza strona nie odebrała odnowienia");
    },
  );

  it("tryb ścisły bez dostępu do naszej bazy: weryfikacja jest błędem konfiguracji, jak brak kluczy", async () => {
    expect(await run("arm")).toMatchObject({ code: 0 });

    const result = await run("verify", { PROBE_SUPABASE_SERVICE_ROLE_KEY: "" });

    expect(result.code).toBe(1);
    expect(result.output).toContain("PROBE_SUPABASE_SERVICE_ROLE_KEY");
    expect(readFileSync(join(directory, "output.txt"), "utf8")).toContain("outcome=skipped");
  });

  it("przebieg ręczny bez dostępu do naszej bazy: ostrzeżenie i werdykt samego operatora", async () => {
    expect(await run("arm", { PROBE_STRICT: "false" })).toMatchObject({ code: 0 });

    const result = await run("verify", {
      PROBE_STRICT: "false",
      PROBE_SUPABASE_URL: "",
    });

    expect(result.code).toBe(0);
    expect(result.output).toContain("Sonda nie widzi naszej strony");
    const report = JSON.parse(readFileSync(join(directory, "report.json"), "utf8"));
    expect(report).toMatchObject({ outcome: "renewed", local: null });
  });

  it("sonda NIGDY nie pisze do naszej bazy i nie wysyła tam klucza bramki operatora", async () => {
    expect(await run("arm")).toMatchObject({ code: 0 });
    expect(await run("verify")).toMatchObject({ code: 0 });

    const calls = readFileSync(join(directory, "calls.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { path: string; method: string });
    const ours = calls.filter((call) => call.path.startsWith("/supabase/"));
    expect(ours.map((call) => call.path).sort()).toEqual([
      "/supabase/rest/v1/payment_webhook_events",
      "/supabase/rest/v1/subscriptions",
    ]);
    expect(ours.every((call) => call.method === "GET")).toBe(true);
  });

  it("does not retry a clock-advance POST after an ambiguous operator failure", async () => {
    expect(await run("arm", { PROBE_FIXTURE_FAIL_POST: "1" })).toMatchObject({ code: 1 });
    const calls = readFileSync(join(directory, "calls.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { method: string });
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
  });

  it("fails strict monitoring when configuration is absent, but allows an explicit non-strict run", async () => {
    expect(await run("arm", { STRIPE_SANDBOX_API_KEY: "" })).toMatchObject({ code: 1 });
    expect(await run("arm", { STRIPE_SANDBOX_API_KEY: "", PROBE_STRICT: "false" })).toMatchObject({
      code: 0,
    });
  });

  it("rejects an unknown command without falling back to a clock-advance mutation", async () => {
    const result = await run("typo");
    expect(result.code).toBe(1);
    expect(result.output).toContain("Unknown probe mode");
  });

  it("reports internal clock failure and a wait deadline as failures in strict mode", async () => {
    expect(await run("arm")).toMatchObject({ code: 0 });
    expect(await run("wait", { PROBE_FIXTURE_CLOCK_STATUS: "internal_failure" })).toMatchObject({
      code: 1,
    });
    expect(await run("await", { PROBE_FIXTURE_CLOCK_STATUS: "advancing" })).toMatchObject({
      code: 1,
    });
  });
});
