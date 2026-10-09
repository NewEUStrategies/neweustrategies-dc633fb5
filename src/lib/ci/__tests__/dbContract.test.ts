import { describe, expect, it } from "vitest";
import { loadMigrationFiles } from "../../../../scripts/lib/sqlMigrations";
import {
  KNOWN_COLUMN_DRIFT,
  columnDriftFailed,
  columnDriftRegistry,
  compareColumnDrift,
  contractFailed,
  dbColumnKey,
  expectedColumns,
  extractExpectedContract,
  inconclusiveColumnDrift,
  parseContractTarget,
  renderColumnDriftReport,
  renderContractReport,
} from "../dbContract";

describe("extractExpectedContract", () => {
  it("recreates an object dropped earlier in the same migration", () => {
    const result = extractExpectedContract([
      {
        file: "001.sql",
        sql: "CREATE TABLE public.items(id int); DROP TABLE public.items; CREATE TABLE public.items(id bigint);",
      },
    ]);
    expect(result.tables).toEqual([{ name: "items", kind: "table", file: "001.sql" }]);
  });
  it("ignores managed-schema drops and renames, including quoted empty names", () => {
    const result = extractExpectedContract([
      {
        file: "001.sql",
        sql: 'CREATE TABLE public.visible(id int); CREATE TABLE public.""(id int); DROP TABLE auth.visible; ALTER TABLE auth.users RENAME TO people; ALTER TABLE public.visible RENAME TO "";',
      },
    ]);
    expect(result.tables).toEqual([]);
  });
  it("zbiera tabele, widoki i funkcje ze schematu public", () => {
    const contract = extractExpectedContract([
      {
        file: "0001.sql",
        sql: `CREATE TABLE public.posts (id uuid);
              CREATE VIEW public.posts_public AS SELECT 1;
              CREATE OR REPLACE FUNCTION public.has_role(a uuid, b app_role) RETURNS boolean AS $$ select true $$ LANGUAGE sql;`,
      },
    ]);
    expect(contract.tables.map((t) => t.name)).toEqual(["posts"]);
    expect(contract.views.map((v) => v.name)).toEqual(["posts_public"]);
    expect(contract.functions.map((f) => f.name)).toEqual(["has_role"]);
  });

  it("pomija funkcje wyzwalaczy (nie są wystawiane przez Data API)", () => {
    const contract = extractExpectedContract([
      {
        file: "0001.sql",
        sql: `CREATE FUNCTION public.touch_updated_at() RETURNS trigger AS $$ begin return new; end $$ LANGUAGE plpgsql;`,
      },
    ]);
    expect(contract.functions).toHaveLength(0);
  });

  it("uwzględnia DROP i RENAME z późniejszych migracji", () => {
    const contract = extractExpectedContract([
      {
        file: "0001.sql",
        sql: "CREATE TABLE public.old_table (id uuid); CREATE TABLE public.gone (id uuid);",
      },
      { file: "0002.sql", sql: "DROP TABLE IF EXISTS public.gone;" },
      { file: "0003.sql", sql: "ALTER TABLE public.old_table RENAME TO new_table;" },
    ]);
    expect(contract.tables.map((t) => t.name)).toEqual(["new_table"]);
  });

  it("ignoruje schematy zarządzane (auth/storage)", () => {
    const contract = extractExpectedContract([
      {
        file: "0001.sql",
        sql: "CREATE TABLE auth.sessions (id uuid); CREATE TABLE storage.objects (id uuid);",
      },
    ]);
    expect(contract.tables).toHaveLength(0);
  });
});

describe("raport kontraktu", () => {
  it("distinguishes an inconclusive probe from a proven missing object", () => {
    const report = {
      checked: 1,
      missing: [],
      inconclusive: [{ kind: "view" as const, name: "public_feed", file: "001.sql" }],
    };
    expect(contractFailed(report)).toBe(true);
    expect(renderContractReport(report)).toContain("view public_feed");
    expect(renderContractReport(report)).toContain("Nierozstrzygnięte");
    expect(renderContractReport({ checked: 0, missing: [], inconclusive: [] })).not.toContain(
      "Brakujące obiekty",
    );
  });
  it("blocks missing objects and an empty contract", () => {
    expect(contractFailed({ checked: 3, missing: [], inconclusive: [] })).toBe(false);
    const failing = {
      checked: 3,
      missing: [{ kind: "table" as const, name: "posts", file: "0001.sql" }],
      inconclusive: [],
    };
    expect(contractFailed(failing)).toBe(true);
    expect(contractFailed({ checked: 0, missing: [], inconclusive: [] })).toBe(true);
    expect(renderContractReport(failing)).toContain("table posts");
  });
});

describe("kontrakt kolumn", () => {
  // 2026-10-09: 20260725090500 dodała 20 kolumn i nigdy nie poszła na
  // produkcję; kontrakt obiektowy był zielony, katalog /podcasts - martwy.
  const migrations = [
    {
      file: "0001.sql",
      sql: `CREATE TABLE public.podcasts (id uuid, title text);
            CREATE TABLE public.legacy (id uuid);`,
    },
    {
      file: "0002.sql",
      sql: `ALTER TABLE public.podcasts ADD COLUMN IF NOT EXISTS explicit boolean,
              ADD COLUMN IF NOT EXISTS episode_type text;
            ALTER TABLE auth.users ADD COLUMN nickname text;
            ALTER TABLE public.legacy ADD COLUMN note text;
            ALTER TABLE public.Podcasts RENAME COLUMN title TO title_pl;`,
    },
    { file: "0003.sql", sql: "DROP TABLE public.legacy;" },
  ];

  it("oczekuje kolumn dopisanych ALTER-em do żywych tabel - bez kolumn z CREATE TABLE", () => {
    const contract = extractExpectedContract(migrations);
    expect(expectedColumns(migrations, contract.tables)).toEqual([
      { table: "podcasts", column: "episode_type", file: "0002.sql" },
      { table: "podcasts", column: "explicit", file: "0002.sql" },
      { table: "podcasts", column: "title_pl", file: "0002.sql" },
    ]);
  });

  it("nie zgłasza fantomów: schemat zarządzany ani tabela skasowana nie są oczekiwane", () => {
    const contract = extractExpectedContract(migrations);
    const keys = expectedColumns(migrations, contract.tables).map(dbColumnKey);
    expect(keys).not.toContain("auth.nickname");
    expect(keys.some((key) => key.startsWith("legacy."))).toBe(false);
  });

  const expected = [
    { table: "podcasts", column: "explicit", file: "0002.sql" },
    { table: "podcasts", column: "episode_type", file: "0002.sql" },
    { table: "notifications", column: "meta", file: "0003.sql" },
  ];

  it("brak kolumny spoza rejestru to NOWY dryf i blokuje bramkę", () => {
    const report = compareColumnDrift(expected, [expected[0]], {});
    expect(report.missing).toEqual([expected[0]]);
    expect(columnDriftFailed(report)).toBe(true);
    const markdown = renderColumnDriftReport(report);
    expect(markdown).toContain("`podcasts.explicit` (migracja: 0002.sql)");
    expect(markdown).toContain("NOWEJ wersji");
  });

  it("znany dryf z uzasadnieniem nie blokuje, ale jest w raporcie", () => {
    const report = compareColumnDrift(expected, [expected[2]], {
      "notifications.meta": "zmierzone",
    });
    expect(report.missing).toEqual([]);
    expect(report.known).toEqual([expected[2]]);
    expect(columnDriftFailed(report)).toBe(false);
    expect(renderColumnDriftReport(report)).toContain("Znany dryf");
  });

  it("wpis rejestru, którego baza nie potwierdza, jest martwy i blokuje bramkę", () => {
    // Kolumna doszła (albo przestała być oczekiwana) - wpis musi zniknąć,
    // inaczej zostaje zgodą na brak, o którym nikt już nie pamięta.
    const report = compareColumnDrift(expected, [], {
      "notifications.meta": "zmierzone",
      "removed.column": "migracja wycofana",
    });
    expect(report.resolved).toEqual(["notifications.meta", "removed.column"]);
    expect(columnDriftFailed(report)).toBe(true);
    expect(renderColumnDriftReport(report)).toContain("do usunięcia");
  });

  it("KONTROLA DODATNIA: komplet kolumn i pusty rejestr przechodzą", () => {
    expect(columnDriftFailed(compareColumnDrift(expected, [], {}))).toBe(false);
  });

  it("sonda niewykonana ani pusty kontrakt nie są zielone", () => {
    const report = inconclusiveColumnDrift(
      expected,
      "Na bazie nie ma RPC `missing_schema_columns`",
    );
    expect(columnDriftFailed(report)).toBe(true);
    expect(renderColumnDriftReport(report)).toContain("Sonda kolumn nie wykonana");
    expect(columnDriftFailed(compareColumnDrift([], [], {}))).toBe(true);
  });

  it("baza odtworzona z migracji (replay) nie stosuje rejestru dryfu produkcji", () => {
    // e2e-seeded sonduje bazę z migracji: kolumny z rejestru tam SĄ - to nie
    // martwe wpisy, a brak dowolnej kolumny jest błędem, także z rejestru.
    const known = { "notifications.meta": "zmierzone na produkcji" };
    expect(columnDriftRegistry("production")).toBe(KNOWN_COLUMN_DRIFT);
    const replay = columnDriftRegistry("replay");
    expect(columnDriftFailed(compareColumnDrift(expected, [], replay))).toBe(false);
    expect(compareColumnDrift(expected, [expected[2]], replay).missing).toEqual([expected[2]]);
    // KONTROLA DODATNIA: ten sam stan z rejestrem produkcji oblewa jako martwy wpis.
    expect(compareColumnDrift(expected, [], known).resolved).toEqual(["notifications.meta"]);
  });

  it("cel sondy: domyślnie produkcja, literówka to błąd", () => {
    expect(parseContractTarget(undefined)).toBe("production");
    expect(parseContractTarget("")).toBe("production");
    expect(parseContractTarget("production")).toBe("production");
    expect(parseContractTarget("replay")).toBe("replay");
    expect(() => parseContractTarget("Replay")).toThrow("DB_CONTRACT_TARGET");
  });

  it("każdy wpis KNOWN_COLUMN_DRIFT to kolumna, której migracje naprawdę oczekują", () => {
    // Literówka we wpisie byłaby zgodą na brak kolumny, której nikt nie sonduje.
    const files = loadMigrationFiles();
    const keys = new Set(
      expectedColumns(files, extractExpectedContract(files).tables).map(dbColumnKey),
    );
    for (const key of Object.keys(KNOWN_COLUMN_DRIFT)) expect(keys.has(key), key).toBe(true);
    for (const reason of Object.values(KNOWN_COLUMN_DRIFT))
      expect(reason.length).toBeGreaterThan(40);
  });
});
