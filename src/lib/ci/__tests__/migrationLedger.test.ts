import { describe, expect, it } from "vitest";
import {
  buildLedgerReport,
  ledgerFailed,
  parseMigrationFile,
  parseMigrationFiles,
  renderLedgerReport,
} from "../migrationLedger";

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

  it("raportuje migracje, których baza nie zna", () => {
    const { parsed, malformed } = parseMigrationFiles([
      "20260101090000_a.sql",
      "20260825210000_b.sql",
    ]);
    const report = buildLedgerReport(parsed, malformed, ["20260825210000"]);
    expect(report.missing.map((m) => m.file)).toEqual(["20260825210000_b.sql"]);
    expect(ledgerFailed(report)).toBe(true);
    expect(renderLedgerReport(report)).toContain("20260825210000_b.sql");
  });

  it("przechodzi, gdy rejestr bazy pokrywa całą gałąź", () => {
    const { parsed, malformed } = parseMigrationFiles(["20260101090000_a.sql"]);
    const report = buildLedgerReport(parsed, malformed, []);
    expect(ledgerFailed(report)).toBe(false);
    expect(renderLedgerReport(report)).toContain("Wszystkie migracje z gałęzi są wykonane");
  });

  it("plik o złej nazwie sam w sobie wywala bramkę - taka migracja nigdy się nie wykona", () => {
    const { parsed, malformed } = parseMigrationFiles(["hotfix.sql"]);
    const report = buildLedgerReport(parsed, malformed, []);
    expect(ledgerFailed(report)).toBe(true);
  });
});
