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

  // ── Raport tekstowy: sekcje, które widzi wyłącznie człowiek czytający log ──
  // `ledgerFailed` zwraca jeden bit, więc bramka świeci na czerwono nawet wtedy,
  // gdy render gubi całe sekcje. Poniższe przypadki pilnują treści raportu:
  // bez nich zniknięcie listy plików o złej nazwie, listy martwych uzgodnień
  // albo adnotacji o uzgodnionej wersji przeszłoby bez jednego czerwonego testu,
  // a autor zmiany zobaczyłby w CI samo „coś jest nie tak".

  it("raport wymienia pliki o złej nazwie i martwe uzgodnienia w nagłówku ORAZ w osobnych sekcjach", () => {
    const { parsed, malformed } = parseMigrationFiles(["20260825210000_pr.sql", "hotfix.sql"]);
    const config: LedgerConfig = {
      baseline: "20260101000000",
      reconciled: {
        // Uzgodnienie żywe: SQL poszedł pod inną wersją, której baza nie zna.
        "20260825210000_pr.sql": "20260826101500",
        // Uzgodnienie martwe: plik zniknął z gałęzi.
        "20260101100000_gone.sql": "20260101110000",
      },
    };
    const report = buildLedgerReport(parsed, malformed, ["20260826101500"], config);
    const rendered = renderLedgerReport(report);

    expect(ledgerFailed(report)).toBe(true);
    // Nagłówek liczbowy - obie kategorie pojawiają się WYŁĄCZNIE, gdy są niepuste.
    expect(rendered).toContain("Plików o złej nazwie: **1**");
    expect(rendered).toContain("Martwych uzgodnień: **1**");
    // Sekcje szczegółowe z nazwami plików do naprawy.
    for (const fragment of [
      "### Pliki spoza konwencji",
      "- `hotfix.sql`",
      "### Uzgodnienia wskazujące nieistniejące pliki",
      "- `20260101100000_gone.sql`",
    ]) {
      expect(rendered).toContain(fragment);
    }
    // Migracja uzgodniona musi podać wersję, KTÓREJ naprawdę brakuje w
    // rejestrze - inaczej czytelnik szuka w bazie wersji z nazwy pliku,
    // której pipeline nigdy tam nie zapisał.
    expect(rendered).toContain(
      "`20260825210000_pr.sql` (uzgodniona wersja `20260826101500` też nie istnieje w rejestrze)",
    );
    expect(rendered).not.toContain("Wszystkie migracje z gałęzi są wykonane");
  });

  it("brakująca migracja BEZ uzgodnienia jest wypisana samą nazwą pliku", () => {
    // Kontrapunkt dla przypadku wyżej: gdyby render dopisywał adnotację
    // o uzgodnionej wersji zawsze, raport kłamałby o istnieniu wpisu
    // uzgodnienia przy każdej zwykłej niewykonanej migracji.
    const { parsed, malformed } = parseMigrationFiles(["20260825210000_zwykla.sql"]);
    const report = buildLedgerReport(parsed, malformed, ["20260825210000"], CONFIG);
    const rendered = renderLedgerReport(report);

    expect(rendered).toContain("- `20260825210000_zwykla.sql`");
    expect(rendered).not.toContain("uzgodniona wersja");
    expect(rendered).not.toContain("Plików o złej nazwie");
    expect(rendered).not.toContain("Martwych uzgodnień");
  });
});
