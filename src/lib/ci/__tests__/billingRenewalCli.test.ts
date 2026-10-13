// @vitest-environment node
//
// KONTRAKT CLI nocnej sondy rozliczeń (`scripts/billing-renewal-probe.ts`):
// pełna ścieżka arm -> wait -> verify przez atrapę transportu
// (`src/test/billing/probeGateway.mjs`) - bez żadnego żądania do sieci.
//
// Od przeglądu 7.6 nasza strona jest czytana WYŁĄCZNIE RPC
// `billing_probe_status` kluczem publikowalnym i tokenem sondy - atrapa
// odrzuca każdy inny dostęp do bazy (tabela po REST, klucz `service_role`,
// token w adresie). Od przeglądu 7.12 `verify` oblewa sondę, gdy punkt odbioru
// webhooków piaskownicy nie subskrybuje któregoś z obsługiwanych typów.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";

import { STRIPE_WEBHOOK_EVENT_TYPES } from "@/lib/billing/stripeEventTypes";

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
    join(directory, "eventTypes.mjs"),
    compile(readFileSync("src/lib/billing/stripeEventTypes.ts", "utf8")),
  );
  writeFileSync(
    join(directory, "probe.mjs"),
    compile(
      readFileSync("scripts/billing-renewal-probe.ts", "utf8")
        .replace('"../src/lib/ci/billingRenewalProbe"', '"./logic.mjs"')
        .replace('"../src/lib/billing/stripeEventTypes"', '"./eventTypes.mjs"'),
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
          // Nasza baza (krok `verify`) - ta sama atrapa transportu, inna ścieżka;
          // klucz PUBLIKOWALNY i token sondy, nigdy `service_role`.
          PROBE_SUPABASE_URL: "https://probe.invalid/supabase",
          PROBE_SUPABASE_PUBLISHABLE_KEY: "fixture-publishable",
          BILLING_PROBE_TOKEN: "fixture-probe-token",
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
      webhookEndpoint: { outcome: "ok", checked: 1, gaps: [] },
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

    const result = await run("verify", { BILLING_PROBE_TOKEN: "" });

    expect(result.code).toBe(1);
    expect(result.output).toContain("BILLING_PROBE_TOKEN");
    expect(result.output).toContain("billing_probe_rotate_token");
    expect(readFileSync(join(directory, "output.txt"), "utf8")).toContain("outcome=skipped");
  });

  // KRYTERIUM przeglądu 7.6: klucz `service_role` produkcji nie jest już
  // potrzebny ani używany - nawet pozostawiony w środowisku nie wychodzi.
  it("klucz service_role nie jest ani wymagany, ani wysyłany - sonda czyta tylko RPC sondy", async () => {
    expect(await run("arm")).toMatchObject({ code: 0 });

    const result = await run("verify", {
      PROBE_SUPABASE_SERVICE_ROLE_KEY: "fixture-service-role-leftover",
    });

    expect(result.code).toBe(0);
    const ours = readFileSync(join(directory, "calls.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { path: string; method: string; body?: string })
      .filter((call) => call.path.startsWith("/supabase/"));
    expect(ours.length).toBeGreaterThan(0);
    for (const call of ours) {
      expect(call).toMatchObject({
        path: "/supabase/rest/v1/rpc/billing_probe_status",
        method: "POST",
      });
      // Token w ciele (nie w adresie, który ląduje w logach pośredników),
      // zakres: badana subskrypcja od chwili zbrojenia.
      expect(JSON.parse(call.body ?? "{}")).toMatchObject({
        p_token: "fixture-probe-token",
        p_subscription_id: "sub_probe",
      });
      expect(call.body).not.toContain("fixture-service-role-leftover");
    }
  });

  it("zły token sondy: weryfikacja CZERWONA z nazwą RPC i kodem odmowy", async () => {
    expect(await run("arm")).toMatchObject({ code: 0 });

    const result = await run("verify", { BILLING_PROBE_TOKEN: "zly-token" });

    expect(result.code).toBe(1);
    expect(result.output).toContain("/rest/v1/rpc/billing_probe_status -> 403");
    expect(result.output).not.toContain("zly-token");
  });

  it("odpowiedź RPC w nieoczekiwanym kształcie to błąd kontraktu, nie „nic nie dotarło”", async () => {
    expect(await run("arm")).toMatchObject({ code: 0 });

    const result = await run("verify", { PROBE_FIXTURE_LOCAL: "malformed" });

    expect(result.code).toBe(1);
    expect(result.output).toContain("billing_probe_status zwróciła nieoczekiwany kształt");
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

  it("sonda NIGDY nie dotyka tabel naszej bazy i nie wysyła tam klucza bramki operatora", async () => {
    expect(await run("arm")).toMatchObject({ code: 0 });
    expect(await run("verify")).toMatchObject({ code: 0 });

    const calls = readFileSync(join(directory, "calls.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { path: string; method: string; body?: string });
    const ours = calls.filter((call) => call.path.startsWith("/supabase/"));
    // Jedyna ścieżka do naszej bazy to RPC sondy (STABLE, wyłącznie odczyt);
    // atrapa odrzuca każdą tabelę po REST.
    expect([...new Set(ours.map((call) => call.path))]).toEqual([
      "/supabase/rest/v1/rpc/billing_probe_status",
    ]);
    for (const call of ours) {
      expect(call.body).not.toContain("fixture-connection");
      expect(call.body).not.toContain("fixture-platform");
    }
  });

  // KRYTERIUM przeglądu 7.12: punkt odbioru piaskownicy bez obsługiwanego typu
  // oblewa sondę z jasnym komunikatem - wcześniej sprawdzał to tylko panel.
  it("punkt odbioru piaskownicy bez `checkout.session.expired` i `charge.dispute.closed` - weryfikacja CZERWONA", async () => {
    expect(await run("arm")).toMatchObject({ code: 0 });
    const enabled = STRIPE_WEBHOOK_EVENT_TYPES.filter(
      (type) => type !== "checkout.session.expired" && type !== "charge.dispute.closed",
    );

    const result = await run("verify", { PROBE_FIXTURE_ENABLED_EVENTS: JSON.stringify(enabled) });

    expect(result.code).toBe(1);
    expect(result.output).toContain(
      "Punkt odbioru webhooków piaskownicy nie subskrybuje obsługiwanych zdarzeń",
    );
    const report = JSON.parse(readFileSync(join(directory, "report.json"), "utf8"));
    // Odnowienie i nasza strona są zielone - czerwień bierze się WYŁĄCZNIE
    // z punktu odbioru.
    expect(report).toMatchObject({
      outcome: "failed",
      stripeOutcome: "renewed",
      local: { outcome: "synced" },
      webhookEndpoint: {
        outcome: "failed",
        gaps: [
          {
            id: "we_probe",
            missingTypes: ["checkout.session.expired", "charge.dispute.closed"],
          },
        ],
      },
    });
    expect(report.webhookEndpoint.reason).toContain("`charge.dispute.closed`");
  });

  it("punkt odbioru z JAWNĄ pełną listą typów przechodzi", async () => {
    expect(await run("arm")).toMatchObject({ code: 0 });

    const result = await run("verify", {
      PROBE_FIXTURE_ENABLED_EVENTS: JSON.stringify(STRIPE_WEBHOOK_EVENT_TYPES),
    });

    expect(result.code).toBe(0);
  });

  it("brak naszego punktu odbioru w piaskownicy - weryfikacja CZERWONA", async () => {
    expect(await run("arm")).toMatchObject({ code: 0 });

    const result = await run("verify", { PROBE_FIXTURE_ENDPOINTS: "none" });

    expect(result.code).toBe(1);
    expect(result.output).toContain("nie ma punktu odbioru webhooków");
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
