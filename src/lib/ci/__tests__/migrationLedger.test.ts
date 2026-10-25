import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DRIZZLE_DIR,
  JOURNAL_FREEZE_IDX,
  MIRROR_LANE_START_IDX,
  SUPABASE_DIR,
} from "../migrationLaneParity";
import { analyzeSupabaseCoverage } from "../supabaseLaneCoverage";
import { mirrorHeader } from "../../migrations/mirrorHeader";
import {
  DRIZZLE_MISSING_VERDICT,
  DRIZZLE_REGISTRY_PROBE_MIGRATION,
  buildLedgerReport,
  drizzleCarriers,
  drizzleProvenFiles,
  drizzleRegistryKey,
  drizzleRequirements,
  ledgerFailed,
  ledgerReportJson,
  ledgerRequirements,
  parseMigrationFile,
  parseMigrationFiles,
  renderLedgerReport,
  type DrizzleCarrier,
  type DrizzleRegistryAnswer,
  type LedgerConfig,
} from "../migrationLedger";

const CONFIG: LedgerConfig = { baseline: "20260101000000", reconciled: {} };
/** Rejestr migratora potwierdza każdą pytaną parę (`when`, hash). */
const REGISTRY_OK: DrizzleRegistryAnswer = { kind: "answered", missingEntries: [] };
/** sha256 jak w drizzle-orm `readMigrationFiles`: tekst pliku wpisu w UTF-8. */
const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");
/** `when` wpisu o danym idx: jak generator - kolejne wpisy co 60 s. */
const whenOfIdx = (idx: number): number => 1_792_789_946_300 + (idx - 399) * 60_000;
/** Wpis dziennika od 0399 niosący plik `file` (lustro), z `when` wpisu i hashem pliku lustra. */
const carrier = (file: string, idx = 399): DrizzleCarrier => {
  const tag = `${String(idx).padStart(4, "0")}_${file.replace(/^\d{14}_|\.sql$/g, "")}`;
  return { file, tag, when: whenOfIdx(idx), hash: sha256(`${mirrorHeader(file)}-- ${file}\n`) };
};

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
    const report = buildLedgerReport(parsed, malformed, ["20260825210000"], CONFIG, REGISTRY_OK);
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
    const ok = buildLedgerReport(parsed, malformed, ["20260825210000"], config, REGISTRY_OK);
    expect(ledgerFailed(ok)).toBe(false);

    const bad = buildLedgerReport(parsed, malformed, ["20260826101500"], config, REGISTRY_OK);
    expect(bad.missing.map((m) => m.ledgerVersion)).toEqual(["20260826101500"]);
    expect(ledgerFailed(bad)).toBe(true);
  });

  it("martwe uzgodnienie (plik zniknął z gałęzi) wywala bramkę", () => {
    const { parsed, malformed } = parseMigrationFiles(["20260201090000_a.sql"]);
    const report = buildLedgerReport(
      parsed,
      malformed,
      [],
      {
        baseline: "20260101000000",
        reconciled: { "20260101100000_gone.sql": "20260101110000" },
      },
      REGISTRY_OK,
    );
    expect(report.staleReconciliations).toEqual(["20260101100000_gone.sql"]);
    expect(ledgerFailed(report)).toBe(true);
  });

  it("przechodzi, gdy rejestr bazy pokrywa całą gałąź", () => {
    const { parsed, malformed } = parseMigrationFiles(["20260201090000_a.sql"]);
    const report = buildLedgerReport(parsed, malformed, [], CONFIG, REGISTRY_OK);
    expect(ledgerFailed(report)).toBe(false);
    expect(renderLedgerReport(report)).toContain("Wszystkie migracje z gałęzi są wykonane");
  });

  it("plik o złej nazwie sam w sobie wywala bramkę - taka migracja nigdy się nie wykona", () => {
    const { parsed, malformed } = parseMigrationFiles(["hotfix.sql"]);
    const report = buildLedgerReport(parsed, malformed, [], CONFIG, REGISTRY_OK);
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
    const report = buildLedgerReport(parsed, malformed, ["20260826101500"], config, REGISTRY_OK);
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
    const report = buildLedgerReport(parsed, malformed, ["20260825210000"], CONFIG, REGISTRY_OK);
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
  const WITH_MIRROR: LedgerConfig = { ...CONFIG, drizzleProven: [carrier(MIRRORED)] };

  it("plik z lustrem wypada z wymagań - bramka nie pyta o niego rejestru bazy", () => {
    const { parsed, malformed } = parseMigrationFiles([MIRRORED, PLAIN]);
    expect(ledgerRequirements(parsed, WITH_MIRROR).map((r) => r.file)).toEqual([PLAIN]);

    // Baza nie zna wersji pliku z lustrem (migrator nie pisze do schema_migrations) - to nie brak.
    const report = buildLedgerReport(
      parsed,
      malformed,
      ["20261025090000"],
      WITH_MIRROR,
      REGISTRY_OK,
    );
    expect(report.missing).toEqual([]);
    expect(report.drizzleProven).toBe(1);
    expect(report.baselined).toBe(0);
    expect(ledgerFailed(report)).toBe(false);
  });

  it("plik bez lustra nadal jest wymagany, a jego brak w rejestrze wywala bramkę", () => {
    const { parsed, malformed } = parseMigrationFiles([MIRRORED, PLAIN]);
    const report = buildLedgerReport(
      parsed,
      malformed,
      ["20261025090010"],
      WITH_MIRROR,
      REGISTRY_OK,
    );
    expect(report.missing.map((m) => m.file)).toEqual([PLAIN]);
    expect(ledgerFailed(report)).toBe(true);
  });

  it("bez zbioru luster bramka wymaga wszystkiego powyżej bazowej linii, jak dotąd", () => {
    const { parsed, malformed } = parseMigrationFiles([MIRRORED, PLAIN]);
    expect(ledgerRequirements(parsed, CONFIG).map((r) => r.file)).toEqual([MIRRORED, PLAIN]);

    const report = buildLedgerReport(parsed, malformed, ["20261025090000"], CONFIG, REGISTRY_OK);
    expect(report.drizzleProven).toBe(0);
    expect(report.missing.map((m) => m.file)).toEqual([MIRRORED]);
    expect(ledgerFailed(report)).toBe(true);
  });

  it("bazowa linia nadal obowiązuje: plik sprzed niej liczy się do bazowej linii, także z lustrem", () => {
    const OLD_MIRRORED = "20250101090000_old_mirrored.sql";
    const OLD = "20250101100000_old.sql";
    const { parsed, malformed } = parseMigrationFiles([OLD_MIRRORED, OLD, MIRRORED, PLAIN]);
    const config: LedgerConfig = {
      ...CONFIG,
      drizzleProven: [carrier(OLD_MIRRORED), carrier(MIRRORED)],
    };
    const report = buildLedgerReport(parsed, malformed, [], config, REGISTRY_OK);

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
      drizzleProven: [carrier(MIRRORED)],
    };
    expect(ledgerRequirements(parsed, config)).toEqual([
      {
        file: RECONCILED,
        version: "20260825210000",
        ledgerVersion: "20260826101500",
        reconciled: true,
      },
    ]);
    expect(
      ledgerFailed(buildLedgerReport(parsed, malformed, ["20260825210000"], config, REGISTRY_OK)),
    ).toBe(false);

    const bad = buildLedgerReport(parsed, malformed, ["20260826101500"], config, REGISTRY_OK);
    expect(bad.missing.map((m) => m.ledgerVersion)).toEqual(["20260826101500"]);
    expect(ledgerFailed(bad)).toBe(true);
  });

  it("zwolnienie dotyczy nazwy pliku, nie wersji: lustro nie zwalnia sąsiada o tej samej wersji", () => {
    const SAME_VERSION = "20261025090000_other.sql";
    const { parsed, malformed } = parseMigrationFiles([MIRRORED, SAME_VERSION]);
    expect(ledgerRequirements(parsed, WITH_MIRROR).map((r) => r.file)).toEqual([SAME_VERSION]);

    const report = buildLedgerReport(
      parsed,
      malformed,
      ["20261025090000"],
      WITH_MIRROR,
      REGISTRY_OK,
    );
    expect(report.missing.map((m) => m.file)).toEqual([SAME_VERSION]);
    expect(ledgerFailed(report)).toBe(true);
  });

  it("nagłówek wskazujący plik spoza gałęzi niczego nie zwalnia i nie zawyża licznika", () => {
    const { parsed, malformed } = parseMigrationFiles([PLAIN]);
    const config: LedgerConfig = {
      ...CONFIG,
      drizzleProven: [carrier("20261025090000_gone.sql")],
    };
    const report = buildLedgerReport(parsed, malformed, ["20261025090010"], config, REGISTRY_OK);
    expect(report.drizzleProven).toBe(0);
    expect(report.missing.map((m) => m.file)).toEqual([PLAIN]);
    expect(ledgerFailed(report)).toBe(true);
  });

  it("raport podaje liczbę plików z lustrem i wskazuje, gdzie szukać dowodu ich wdrożenia", () => {
    const { parsed, malformed } = parseMigrationFiles([MIRRORED, PLAIN]);
    const report = buildLedgerReport(parsed, malformed, [], WITH_MIRROR, REGISTRY_OK);
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
    const rendered = renderLedgerReport(
      buildLedgerReport(parsed, malformed, [], CONFIG, REGISTRY_OK),
    );
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
  const read = (p: string): string | null => files[p] ?? null;
  const coverage = analyzeSupabaseCoverage(["0300_old", "0399_mirrored", BOT], {
    gaps: [],
    read,
    listSupabase: () => [OLD, MIRRORED, ADOPTED],
    lanes: [],
    preLane: null,
    exceptions: new Set(),
  });

  it("lustro i plik adopcji wpisu bota są poza bramką rejestru; historia (kopia 0300) nadal wymagana", () => {
    expect(coverage.violations).toEqual([]);
    const proven = drizzleProvenFiles(coverage.copies, JOURNAL_FREEZE_IDX);
    expect([...proven].sort()).toEqual([MIRRORED, ADOPTED]);
    const whenByTag = new Map([
      ["0300_old", whenOfIdx(300)],
      ["0399_mirrored", whenOfIdx(399)],
      [BOT, whenOfIdx(JOURNAL_FREEZE_IDX + 5)],
    ]);
    const carriers = drizzleCarriers(coverage.copies, read, whenByTag, JOURNAL_FREEZE_IDX);
    expect(carriers.map((c) => [c.file, c.when])).toEqual([
      [MIRRORED, whenOfIdx(399)],
      [ADOPTED, whenOfIdx(JOURNAL_FREEZE_IDX + 5)],
    ]);
    const { parsed, malformed } = parseMigrationFiles([OLD, MIRRORED, ADOPTED]);
    const config: LedgerConfig = { ...CONFIG, drizzleProven: carriers };
    expect(ledgerRequirements(parsed, config).map((r) => r.file)).toEqual([OLD]);
    // Nikt nie pisze schema_migrations: baza nie zna ani lustra, ani adopcji - i to nie brak.
    const report = buildLedgerReport(parsed, malformed, [], config, REGISTRY_OK);
    expect(report.drizzleProven).toBe(2);
    expect(ledgerFailed(report)).toBe(false);
  });

  // Runbook §5.4 pkt 2 każe podnieść JOURNAL_FREEZE_IDX do idx wpisu bota, którego
  // SQL-a nie da się przenieść do pasa supabase. Gdyby granicą bramki rejestru było
  // zamrożenie, podniesienie wróciłoby wszystkie wcześniejsze lustra do bramki
  // `schema_migrations`, której nikt nie pisze - `check:migration-ledger` byłby
  // czerwony na zawsze, a „naprawą" byłby zakazany ręczny INSERT.
  it("podniesienie JOURNAL_FREEZE_IDX nie wraca luster ani plików adopcji do bramki rejestru (granica to stały start luster)", () => {
    expect(MIRROR_LANE_START_IDX).toBe(399);
    const raised = 405;
    const BOT_401 = "0401_lovable_add_column";
    const filesAfterRaise: Record<string, string> = {
      ...files,
      [`${DRIZZLE_DIR}/${BOT_401}.sql`]: SQL,
    };
    const raisedCoverage = analyzeSupabaseCoverage(["0300_old", "0399_mirrored", BOT_401], {
      gaps: [],
      read: (p) => filesAfterRaise[p] ?? null,
      listSupabase: () => [OLD, MIRRORED, ADOPTED],
      lanes: [],
      preLane: null,
      exceptions: new Set(),
      freezeIdx: raised,
    });
    expect(raisedCoverage.copies.get(MIRRORED)).toBe("0399_mirrored");
    expect(raisedCoverage.copies.get(ADOPTED)).toBe(BOT_401);
    expect([...drizzleProvenFiles(raisedCoverage.copies)].sort()).toEqual([MIRRORED, ADOPTED]);
    // Historia sprzed luster (kopia 0300) nadal wymagana w rejestrze.
    expect(drizzleProvenFiles(raisedCoverage.copies).has(OLD)).toBe(false);
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

// ── Dowód z rejestru migratora (uwaga przeglądu Codex P1) ──
// Plik niesiony przez wpis dziennika od 0399 wypada z `schema_migrations`, ale NIE
// z bramki: jego dowodem jest wiersz `drizzle.__drizzle_migrations` z `when` wpisu
// (`created_at`) i hashem pliku wpisu - para, o którą bramka pyta przez
// `missing_drizzle_migration_hashes`, tak jak `migrations:deploy-sql -- --verify`.
// Bez tego pominięte albo nieudane wdrożenie Lovable dawało zieloną bramkę -
// przydział pliku do wpisu liczy się z dziennika w repozytorium, nie z bazy.

describe("migrationLedger: dowód z rejestru migratora drizzle", () => {
  const MIRRORED = "20261025090000_adopt_a.sql";
  const SECOND = "20261025090030_correction_c.sql";
  const PLAIN = "20260825210000_plain_b.sql";
  const OLD_MIRRORED = "20250101090000_old_mirrored.sql";
  const A = carrier(MIRRORED, 399);
  const C = carrier(SECOND, 402);
  const config: LedgerConfig = {
    ...CONFIG,
    drizzleProven: [C, A, carrier(OLD_MIRRORED, 400), carrier("20261025090050_gone.sql", 404)],
  };
  const { parsed, malformed } = parseMigrationFiles([OLD_MIRRORED, PLAIN, MIRRORED, SECOND]);

  it("pyta rejestr migratora o parę (`when`, hash) wpisu niosącego każdy plik z lustrem w zakresie bramki", () => {
    // Bez pliku spoza gałęzi i bez pliku sprzed bazowej linii; w kolejności plików.
    expect(drizzleRequirements(parsed, config)).toEqual([A, C]);
    expect(drizzleRequirements(parsed, CONFIG)).toEqual([]);
    // Klucz sondy: `when` dziesiętnie, dwukropek, sha256 hex - jak `created_at` i `hash` rejestru.
    expect(drizzleRegistryKey(A)).toBe(`${A.when}:${A.hash}`);
    expect(drizzleRegistryKey(A)).toMatch(/^[1-9]\d{0,15}:[0-9a-f]{64}$/);
  });

  it("wdrożenie pominięte: rejestr schema_migrations bez braków, a pary wpisu nie ma - bramka czerwona", () => {
    const report = buildLedgerReport(parsed, malformed, [], config, {
      kind: "answered",
      missingEntries: [drizzleRegistryKey(C)],
    });
    expect(report.missing).toEqual([]);
    expect(report.drizzleProven).toBe(2);
    expect(report.drizzleMissing).toEqual([C]);
    expect(report.drizzleProbeMissing).toBeNull();
    expect(ledgerFailed(report)).toBe(true);

    const rendered = renderLedgerReport(report);
    expect(rendered).toContain("Niepotwierdzonych w rejestrze migratora: **1**");
    expect(DRIZZLE_MISSING_VERDICT).toBe(
      "brak pary (when, hash) w drizzle.__drizzle_migrations - partia niewdrożona albo wdrożona inną drogą",
    );
    expect(rendered).toContain(
      `- \`${C.tag}\` (\`${SECOND}\`, when \`${C.when}\`, hash \`${C.hash.slice(0, 12)}\`): ${DRIZZLE_MISSING_VERDICT}; runbook §4.4/§4.6`,
    );
    expect(rendered).not.toContain(`\`${A.tag}\``);
    expect(rendered).not.toContain("Wszystkie migracje z gałęzi są wykonane");
  });

  // Ponowna dostawa tych samych bajtów (w dzienniku 15 razy, np. 0308/0310) daje dwa
  // wpisy o jednym hashu. Rejestr ma hash pod `when` WCZEŚNIEJSZEGO wpisu, więc pytanie
  // o sam hash dałoby zieloną bramkę mimo pominiętego późniejszego wpisu, a
  // `--verify` zgłosiłby go jako brak. Bramka pyta parą - jak `--verify`.
  it("dwa wpisy o tym samym hashu (ponowna dostawa): pominięty późniejszy wpis to czerwień, nie zieleń przez hash wcześniejszego", () => {
    const FIRST = "20261101090000_rerun_first.sql";
    const RERUN = "20261101090010_rerun_again.sql";
    const shared = sha256("SELECT 1;\n");
    const first: DrizzleCarrier = {
      file: FIRST,
      tag: "0405_rerun",
      when: whenOfIdx(405),
      hash: shared,
    };
    const again: DrizzleCarrier = {
      file: RERUN,
      tag: "0407_rerun",
      when: whenOfIdx(407),
      hash: shared,
    };
    const rerunConfig: LedgerConfig = { ...CONFIG, drizzleProven: [first, again] };
    const rerun = parseMigrationFiles([FIRST, RERUN]);
    const keys = drizzleRequirements(rerun.parsed, rerunConfig).map(drizzleRegistryKey);
    // Dwa różne pytania mimo jednego hasha - żaden wpis nie znika w deduplikacji.
    expect(new Set(keys).size).toBe(2);

    const report = buildLedgerReport(rerun.parsed, rerun.malformed, [], rerunConfig, {
      kind: "answered",
      missingEntries: [drizzleRegistryKey(again)],
    });
    expect(report.drizzleMissing).toEqual([again]);
    expect(ledgerFailed(report)).toBe(true);
    expect(renderLedgerReport(report)).toContain(`when \`${again.when}\``);
  });

  it("każda para w rejestrze: bramka zielona, raport podaje zero niepotwierdzonych", () => {
    const report = buildLedgerReport(parsed, malformed, [], config, REGISTRY_OK);
    expect(report.drizzleMissing).toEqual([]);
    expect(ledgerFailed(report)).toBe(false);
    const rendered = renderLedgerReport(report);
    expect(rendered).toContain("Niepotwierdzonych w rejestrze migratora: **0**");
    expect(rendered).toContain("`missing_drizzle_migration_hashes`");
    expect(rendered).toContain("Wszystkie migracje z gałęzi są wykonane");
  });

  it("brak samej funkcji sondy na bazie = partia z jej plikiem niewdrożona: czerwień z nazwą pliku, nie zielone przejście", () => {
    const detail = "Deployment probe missing_drizzle_migration_hashes: HTTP 404 (PGRST202)";
    const report = buildLedgerReport(parsed, malformed, [], config, {
      kind: "probe-missing",
      detail,
    });
    expect(report.drizzleProbeMissing).toBe(detail);
    expect(report.drizzleMissing).toEqual([]);
    expect(ledgerFailed(report)).toBe(true);
    const rendered = renderLedgerReport(report);
    expect(DRIZZLE_REGISTRY_PROBE_MIGRATION).toBe(
      "20261025090040_missing_drizzle_migration_hashes.sql",
    );
    expect(rendered).toContain("### Sonda rejestru migratora niedostępna");
    expect(rendered).toContain(
      `partia z lustrem \`${DRIZZLE_REGISTRY_PROBE_MIGRATION}\` nie jest wdrożona`,
    );
    expect(rendered).toContain(detail);
    expect(rendered).toContain("wdrożenia 2 plików z lustrem nie da się potwierdzić");
    expect(rendered).not.toContain("Wszystkie migracje z gałęzi są wykonane");
  });

  it("odpowiedź z wpisem, o który bramka nie pytała, to błąd sondy, nie werdykt", () => {
    for (const unasked of [
      `${A.when}:${sha256("niepytany")}`,
      // Hash pytany, ale pod innym `when` - to inny wpis rejestru.
      `${C.when}:${A.hash}`,
      // Sam hash bez `when` (dawny kontrakt sondy).
      A.hash,
    ]) {
      expect(() =>
        buildLedgerReport(parsed, malformed, [], config, {
          kind: "answered",
          missingEntries: [unasked],
        }),
      ).toThrow("wpis, o który bramka nie pytała");
    }
  });

  it("raport JSON (reports/migration-ledger.json) niesie dowód z rejestru migratora", () => {
    const failed = buildLedgerReport(parsed, malformed, [], config, {
      kind: "answered",
      missingEntries: [drizzleRegistryKey(A)],
    });
    expect(ledgerReportJson(failed, CONFIG.baseline)).toMatchObject({
      status: "failed",
      baseline: CONFIG.baseline,
      required: 1,
      baselined: 1,
      drizzleProven: 2,
      drizzleRegistry: "answered",
      drizzleProbeError: null,
      drizzleMissing: [{ file: MIRRORED, tag: A.tag, when: A.when, hash: A.hash }],
      missing: [],
    });
    const probeMissing = buildLedgerReport(parsed, malformed, [], config, {
      kind: "probe-missing",
      detail: "HTTP 404",
    });
    expect(ledgerReportJson(probeMissing, CONFIG.baseline)).toMatchObject({
      status: "failed",
      drizzleRegistry: "probe-missing",
      drizzleProbeError: "HTTP 404",
      drizzleMissing: [],
    });
    expect(
      ledgerReportJson(buildLedgerReport(parsed, malformed, [], config, REGISTRY_OK), "x"),
    ).toMatchObject({ status: "passed", drizzleRegistry: "answered", drizzleMissing: [] });
  });
});

describe("drizzleCarriers: `when` i hash pliku wpisu, które zapisze migrator", () => {
  const SQL = "ALTER TABLE public.t ADD COLUMN IF NOT EXISTS c int;";
  const MIRRORED = "20261025090000_mirrored.sql";
  const ADOPTED = "20261101120000_adopt_bot_column.sql";
  const BOT = "0401_lovable_add_column";
  const MIRROR_TEXT = `${mirrorHeader(MIRRORED)}CREATE INDEX t_c ON public.t (c);\n`;
  const files: Record<string, string> = {
    [`${DRIZZLE_DIR}/0300_old.sql`]: "REVOKE ALL ON public.t FROM anon;",
    [`${DRIZZLE_DIR}/0399_mirrored.sql`]: MIRROR_TEXT,
    [`${DRIZZLE_DIR}/${BOT}.sql`]: SQL,
  };
  const copies = new Map([
    ["20261001000000_old.sql", "0300_old"],
    [ADOPTED, BOT],
    [MIRRORED, "0399_mirrored"],
  ]);
  const whenByTag = new Map([
    ["0300_old", whenOfIdx(300)],
    ["0399_mirrored", whenOfIdx(399)],
    [BOT, 1_792_800_000_000],
  ]);
  const read = (p: string): string | null => files[p] ?? null;

  it("lustro: sha256 pliku lustra (z nagłówkiem); adopcja: sha256 pliku wpisu bota; `when` z dziennika; historia pominięta", () => {
    expect(drizzleCarriers(copies, read, whenByTag)).toEqual([
      { file: MIRRORED, tag: "0399_mirrored", when: whenOfIdx(399), hash: sha256(MIRROR_TEXT) },
      { file: ADOPTED, tag: BOT, when: 1_792_800_000_000, hash: sha256(SQL) },
    ]);
  });

  it("hash liczy się tak jak w drizzle-orm (`readMigrationFiles`): tekst UTF-8 całego pliku", () => {
    const text = "-- zażółć gęślą jaźń\nSELECT 1;\n";
    const [only] = drizzleCarriers(
      new Map([["20261025090000_utf.sql", "0399_utf"]]),
      (p) => (p === `${DRIZZLE_DIR}/0399_utf.sql` ? text : null),
      new Map([["0399_utf", whenOfIdx(399)]]),
    );
    expect(only!.hash).toBe(createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex"));
  });

  it("brak pliku wpisu niosącego plik to błąd, nie ciche zwolnienie", () => {
    expect(() => drizzleCarriers(copies, () => null, whenByTag)).toThrow("0399_mirrored");
  });

  it.each([
    ["brak wpisu w dzienniku", undefined],
    ["ułamek", 1.5],
    ["ujemny", -1],
    ["poza bezpiecznym zakresem", Number.MAX_SAFE_INTEGER + 1],
  ])(
    "`when` wpisu niosącego plik: %s to błąd - bez niego nie ma o co zapytać rejestru",
    (_, when) => {
      const broken = new Map(whenByTag);
      if (when === undefined) broken.delete(BOT);
      else broken.set(BOT, when);
      expect(() => drizzleCarriers(copies, read, broken)).toThrow(BOT);
    },
  );
});

// Funkcja sondy sama jedzie partią luster: gdyby jej plik nie był niesiony przez wpis
// od 0399, brak funkcji nie znaczyłby „partia niewdrożona", a raport kłamałby o pliku.
describe("sonda rejestru migratora w repozytorium", () => {
  it("plik sondy definiuje funkcję o literalnej nazwie i jest niesiony przez lustro od 0399", () => {
    const source = readFileSync(`${SUPABASE_DIR}/${DRIZZLE_REGISTRY_PROBE_MIGRATION}`, "utf8");
    expect(source).toContain(
      "CREATE OR REPLACE FUNCTION public.missing_drizzle_migration_hashes(_entries text[])",
    );
    const journal = JSON.parse(readFileSync(`${DRIZZLE_DIR}/meta/_journal.json`, "utf8")) as {
      entries: { idx: number; tag: string }[];
    };
    const carriers = journal.entries.filter(
      (e) =>
        e.idx >= MIRROR_LANE_START_IDX &&
        readFileSync(`${DRIZZLE_DIR}/${e.tag}.sql`, "utf8").startsWith(
          mirrorHeader(DRIZZLE_REGISTRY_PROBE_MIGRATION),
        ),
    );
    expect(carriers).toHaveLength(1);
  });
});
