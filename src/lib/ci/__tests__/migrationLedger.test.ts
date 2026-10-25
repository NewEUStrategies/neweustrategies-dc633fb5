import { describe, expect, it } from "vitest";
import { DRIZZLE_DIR, JOURNAL_FREEZE_IDX, SUPABASE_DIR } from "../migrationLaneParity";
import { analyzeSupabaseCoverage } from "../supabaseLaneCoverage";
import { mirrorHeader } from "../../migrations/mirrorHeader";
import {
  buildLedgerReport,
  drizzleProvenFiles,
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

// ── Lustro drizzle: plik supabase dostarczany wpisem z `bun run migrations:mirror` ──
// Migrator Drizzle zapisuje taki wpis w `drizzle.__drizzle_migrations`, nie
// w `schema_migrations`, a wierszy w tym rejestrze nikt już nie dopisuje ręcznie.
// Gdyby bramka wymagała tych plików, każdy nowy plik paliłby ją na czerwono na
// zawsze; gdyby zwalniała choć jeden plik za dużo, przepuściłaby migrację, która
// nigdy się nie wykonała. Stąd przypadki po obu stronach granicy.

describe("migrationLedger: pliki z lustrem drizzle", () => {
  const MIRRORED = "20261025090000_adopt_a.sql";
  const PLAIN = "20261025090010_plain_b.sql";
  const WITH_MIRROR: LedgerConfig = { ...CONFIG, drizzleProven: new Set([MIRRORED]) };

  it("plik z lustrem wypada z wymagań - bramka nie pyta o niego rejestru bazy", () => {
    const { parsed, malformed } = parseMigrationFiles([MIRRORED, PLAIN]);
    expect(ledgerRequirements(parsed, WITH_MIRROR).map((r) => r.file)).toEqual([PLAIN]);

    // Baza nie zna wersji pliku z lustrem (migrator nie pisze do schema_migrations) - to nie brak.
    const report = buildLedgerReport(parsed, malformed, ["20261025090000"], WITH_MIRROR);
    expect(report.missing).toEqual([]);
    expect(report.drizzleProven).toBe(1);
    expect(report.baselined).toBe(0);
    expect(ledgerFailed(report)).toBe(false);
  });

  it("plik bez lustra nadal jest wymagany, a jego brak w rejestrze wywala bramkę", () => {
    const { parsed, malformed } = parseMigrationFiles([MIRRORED, PLAIN]);
    const report = buildLedgerReport(parsed, malformed, ["20261025090010"], WITH_MIRROR);
    expect(report.missing.map((m) => m.file)).toEqual([PLAIN]);
    expect(ledgerFailed(report)).toBe(true);
  });

  it("bez zbioru luster bramka wymaga wszystkiego powyżej bazowej linii, jak dotąd", () => {
    const { parsed, malformed } = parseMigrationFiles([MIRRORED, PLAIN]);
    expect(ledgerRequirements(parsed, CONFIG).map((r) => r.file)).toEqual([MIRRORED, PLAIN]);

    const report = buildLedgerReport(parsed, malformed, ["20261025090000"], CONFIG);
    expect(report.drizzleProven).toBe(0);
    expect(report.missing.map((m) => m.file)).toEqual([MIRRORED]);
    expect(ledgerFailed(report)).toBe(true);
  });

  it("bazowa linia nadal obowiązuje: plik sprzed niej liczy się do bazowej linii, także z lustrem", () => {
    const OLD_MIRRORED = "20250101090000_old_mirrored.sql";
    const OLD = "20250101100000_old.sql";
    const { parsed, malformed } = parseMigrationFiles([OLD_MIRRORED, OLD, MIRRORED, PLAIN]);
    const config: LedgerConfig = { ...CONFIG, drizzleProven: new Set([OLD_MIRRORED, MIRRORED]) };
    const report = buildLedgerReport(parsed, malformed, [], config);

    expect(report.required.map((r) => r.file)).toEqual([PLAIN]);
    // Każdy plik gałęzi w dokładnie jednej kategorii: bazowa linia, lustro albo wymagany.
    expect(report.baselined).toBe(2);
    expect(report.drizzleProven).toBe(1);
    expect(report.baselined + report.drizzleProven + report.required.length).toBe(parsed.length);
  });

  it("uzgodnienie pliku bez lustra nadal przenosi kontrolę na wersję, pod którą SQL poszedł", () => {
    const RECONCILED = "20260825210000_pr.sql";
    const { parsed, malformed } = parseMigrationFiles([RECONCILED, MIRRORED]);
    const config: LedgerConfig = {
      baseline: "20260101000000",
      reconciled: { [RECONCILED]: "20260826101500" },
      drizzleProven: new Set([MIRRORED]),
    };
    expect(ledgerRequirements(parsed, config)).toEqual([
      {
        file: RECONCILED,
        version: "20260825210000",
        ledgerVersion: "20260826101500",
        reconciled: true,
      },
    ]);
    expect(ledgerFailed(buildLedgerReport(parsed, malformed, ["20260825210000"], config))).toBe(
      false,
    );

    const bad = buildLedgerReport(parsed, malformed, ["20260826101500"], config);
    expect(bad.missing.map((m) => m.ledgerVersion)).toEqual(["20260826101500"]);
    expect(ledgerFailed(bad)).toBe(true);
  });

  it("zwolnienie dotyczy nazwy pliku, nie wersji: lustro nie zwalnia sąsiada o tej samej wersji", () => {
    const SAME_VERSION = "20261025090000_other.sql";
    const { parsed, malformed } = parseMigrationFiles([MIRRORED, SAME_VERSION]);
    expect(ledgerRequirements(parsed, WITH_MIRROR).map((r) => r.file)).toEqual([SAME_VERSION]);

    const report = buildLedgerReport(parsed, malformed, ["20261025090000"], WITH_MIRROR);
    expect(report.missing.map((m) => m.file)).toEqual([SAME_VERSION]);
    expect(ledgerFailed(report)).toBe(true);
  });

  it("nagłówek wskazujący plik spoza gałęzi niczego nie zwalnia i nie zawyża licznika", () => {
    const { parsed, malformed } = parseMigrationFiles([PLAIN]);
    const config: LedgerConfig = {
      ...CONFIG,
      drizzleProven: new Set(["20261025090000_gone.sql"]),
    };
    const report = buildLedgerReport(parsed, malformed, ["20261025090010"], config);
    expect(report.drizzleProven).toBe(0);
    expect(report.missing.map((m) => m.file)).toEqual([PLAIN]);
    expect(ledgerFailed(report)).toBe(true);
  });

  it("raport podaje liczbę plików z lustrem i wskazuje, gdzie szukać dowodu ich wdrożenia", () => {
    const { parsed, malformed } = parseMigrationFiles([MIRRORED, PLAIN]);
    const report = buildLedgerReport(parsed, malformed, [], WITH_MIRROR);
    const rendered = renderLedgerReport(report);

    expect(rendered).toContain("Egzekwowanych migracji: **1**");
    expect(rendered).toMatch(/- Z lustrem drizzle [^\n]*: \*\*1\*\*/);
    expect(rendered).toContain("`drizzle.__drizzle_migrations`");
    expect(rendered).toContain("`bun run migrations:deploy-sql -- --verify`");
    expect(rendered).not.toContain(MIRRORED);
    expect(rendered).toContain("Wszystkie migracje z gałęzi są wykonane");
  });

  it("raport bez plików z lustrem nadal pokazuje tę kategorię (zero)", () => {
    const { parsed, malformed } = parseMigrationFiles([PLAIN]);
    const rendered = renderLedgerReport(buildLedgerReport(parsed, malformed, [], CONFIG));
    expect(rendered).toMatch(/- Z lustrem drizzle [^\n]*: \*\*0\*\*/);
  });
});

// ── Adopcja wpisu bota (runbook §5.4 pkt 1): plik supabase o SQL-u wpisu bota ──
// Wpis bota nie ma nagłówka generatora, a migrator zapisał go w rejestrze
// Drizzle - nie w `schema_migrations`, do którego nikt już nie pisze. Gdyby
// bramka wymagała pliku adopcji, po pierwszej adopcji `check:migration-ledger`
// byłby czerwony na zawsze, a jedyną „naprawą" byłby zakazany ręczny INSERT.

describe("drizzleProvenFiles: przydział z bramki pasów, wpisy po zamrożeniu", () => {
  const SQL = "ALTER TABLE public.t ADD COLUMN IF NOT EXISTS c int;";
  const OLD = "20261001000000_old.sql";
  const MIRRORED = "20261025090000_mirrored.sql";
  const ADOPTED = "20261101120000_adopt_bot_column.sql";
  const BOT = `${String(JOURNAL_FREEZE_IDX + 5).padStart(4, "0")}_lovable_add_column`;
  const files: Record<string, string> = {
    [`${SUPABASE_DIR}/${OLD}`]: "REVOKE ALL ON public.t FROM anon;",
    [`${DRIZZLE_DIR}/0300_old.sql`]: "REVOKE ALL ON public.t FROM anon;",
    [`${SUPABASE_DIR}/${MIRRORED}`]: "CREATE INDEX t_c ON public.t (c);",
    [`${DRIZZLE_DIR}/0399_mirrored.sql`]: `${mirrorHeader(MIRRORED)}CREATE INDEX t_c ON public.t (c);`,
    [`${DRIZZLE_DIR}/${BOT}.sql`]: SQL,
    [`${SUPABASE_DIR}/${ADOPTED}`]: `-- ADOPCJA: drizzle/migrations/${BOT}.sql\n${SQL}`,
  };
  const coverage = analyzeSupabaseCoverage(["0300_old", "0399_mirrored", BOT], {
    gaps: [],
    read: (p) => files[p] ?? null,
    listSupabase: () => [OLD, MIRRORED, ADOPTED],
    lanes: [],
    preLane: null,
    exceptions: new Set(),
  });

  it("lustro i plik adopcji wpisu bota są poza bramką rejestru; historia (kopia 0300) nadal wymagana", () => {
    expect(coverage.violations).toEqual([]);
    const proven = drizzleProvenFiles(coverage.copies, JOURNAL_FREEZE_IDX);
    expect([...proven].sort()).toEqual([MIRRORED, ADOPTED]);
    const { parsed, malformed } = parseMigrationFiles([OLD, MIRRORED, ADOPTED]);
    const config: LedgerConfig = { ...CONFIG, drizzleProven: proven };
    expect(ledgerRequirements(parsed, config).map((r) => r.file)).toEqual([OLD]);
    // Nikt nie pisze schema_migrations: baza nie zna ani lustra, ani adopcji - i to nie brak.
    const report = buildLedgerReport(parsed, malformed, [], config);
    expect(report.drizzleProven).toBe(2);
    expect(ledgerFailed(report)).toBe(false);
  });

  it("granica to idx wpisu: tag o idx równym zamrożeniu to historia, tag bez numeru - po zamrożeniu", () => {
    const at = String(JOURNAL_FREEZE_IDX).padStart(4, "0");
    const copies = new Map([
      ["20261001000000_a.sql", `${at}_history`],
      ["20261001000100_b.sql", `${String(JOURNAL_FREEZE_IDX + 1).padStart(4, "0")}_mirror`],
      ["20261001000200_c.sql", "lovable_untagged"],
    ]);
    expect([...drizzleProvenFiles(copies, JOURNAL_FREEZE_IDX)]).toEqual([
      "20261001000100_b.sql",
      "20261001000200_c.sql",
    ]);
  });
});
