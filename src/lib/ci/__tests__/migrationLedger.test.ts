import { describe, expect, it } from "vitest";
import {
  buildLedgerReport,
  ledgerFailed,
  ledgerRequirements,
  parseMigrationFile,
  parseMigrationFiles,
  renderLedgerReport,
  type LedgerConfig,
} from "../migrationLedger";

const CONFIG: LedgerConfig = { baseline: "20260101000000", reconciled: {} };

describe("migrationLedger", () => {
  it("wyciąga 14-cyfrową wersję z nazwy pliku", () => {
    expect(parseMigrationFile("20260825210000_event_registration.sql")).toEqual({
      file: "20260825210000_event_registration.sql",
      version: "20260825210000",
      label: "event_registration",
    });
  });

  it("odrzuca nazwy spoza konwencji", () => {
    expect(parseMigrationFile("fixup.sql")).toBeNull();
    expect(parseMigrationFile("2026_short.sql")).toBeNull();
  });

  it("sortuje migracje i zbiera pliki o złej nazwie", () => {
    const { parsed, malformed } = parseMigrationFiles([
      "20260825210000_b.sql",
      "readme.md",
      "20260101090000_a.sql",
      "hotfix.sql",
    ]);
    expect(parsed.map((m) => m.version)).toEqual(["20260101090000", "20260825210000"]);
    expect(malformed).toEqual(["hotfix.sql"]);
  });

  it("nie egzekwuje migracji sprzed bazowej linii", () => {
    const { parsed } = parseMigrationFiles(["20250101090000_old.sql", "20260825210000_new.sql"]);
    const required = ledgerRequirements(parsed, { baseline: "20260101000000", reconciled: {} });
    expect(required.map((r) => r.file)).toEqual(["20260825210000_new.sql"]);
  });

  it("raportuje migracje, których baza nie zna", () => {
    const { parsed, malformed } = parseMigrationFiles([
      "20260201090000_a.sql",
      "20260825210000_b.sql",
    ]);
    const report = buildLedgerReport(parsed, malformed, ["20260825210000"], CONFIG);
    expect(report.missing.map((m) => m.file)).toEqual(["20260825210000_b.sql"]);
    expect(ledgerFailed(report)).toBe(true);
    expect(renderLedgerReport(report)).toContain("20260825210000_b.sql");
  });

  it("uzgodnienie przenosi kontrolę na wersję, pod którą SQL faktycznie poszedł", () => {
    const { parsed, malformed } = parseMigrationFiles(["20260825210000_pr.sql"]);
    const config: LedgerConfig = {
      baseline: "20260101000000",
      reconciled: { "20260825210000_pr.sql": "20260826101500" },
    };
    const ok = buildLedgerReport(parsed, malformed, ["20260825210000"], config);
    expect(ledgerFailed(ok)).toBe(false);

    const bad = buildLedgerReport(parsed, malformed, ["20260826101500"], config);
    expect(bad.missing.map((m) => m.ledgerVersion)).toEqual(["20260826101500"]);
    expect(ledgerFailed(bad)).toBe(true);
  });

  it("martwe uzgodnienie (plik zniknął z gałęzi) wywala bramkę", () => {
    const { parsed, malformed } = parseMigrationFiles(["20260201090000_a.sql"]);
    const report = buildLedgerReport(parsed, malformed, [], {
      baseline: "20260101000000",
      reconciled: { "20260101100000_gone.sql": "20260101110000" },
    });
    expect(report.staleReconciliations).toEqual(["20260101100000_gone.sql"]);
    expect(ledgerFailed(report)).toBe(true);
  });

  it("przechodzi, gdy rejestr bazy pokrywa całą gałąź", () => {
    const { parsed, malformed } = parseMigrationFiles(["20260201090000_a.sql"]);
    const report = buildLedgerReport(parsed, malformed, [], CONFIG);
    expect(ledgerFailed(report)).toBe(false);
    expect(renderLedgerReport(report)).toContain("Wszystkie migracje z gałęzi są wykonane");
  });

  it("plik o złej nazwie sam w sobie wywala bramkę - taka migracja nigdy się nie wykona", () => {
    const { parsed, malformed } = parseMigrationFiles(["hotfix.sql"]);
    const report = buildLedgerReport(parsed, malformed, [], CONFIG);
    expect(ledgerFailed(report)).toBe(true);
  });
});
