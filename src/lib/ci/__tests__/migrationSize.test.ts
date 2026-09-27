// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW
//
// Bramka rozmiaru ma trzy drogi do falszywej zieleni i kazda jest tu
// zamknieta: (1) linia bazowa zwalniajaca HURTEM wszystko pod soba - przez nia
// przeszedlby 203 KB `20260926100000_event_cfp.sql`, ktory dzieli wersje
// z wdrozonym plikiem grup; (2) zwolnienie, ktore przezylo zmiane albo
// znikniecie pliku (martwy wpis maskuje, ze wdrozona migracja sie zmienila);
// (3) blizniak drizzle - Lovable czyta tez pas drizzle, wiec pociety plik
// supabase z niepocietym blizniakiem nadal sie nie wdrozy.
import { describe, expect, it } from "vitest";
import {
  DEPLOYED_OVERSIZE,
  MIGRATION_MAX_BYTES,
  MIGRATION_SIZE_BASELINE,
  SIZE_CONFIG,
  analyzeMigrationSizes,
  collectMigrationSizes,
  nodeMigrationFs,
  readLogicalMigration,
  renderSizeReport,
  type MigrationFs,
  type SizeConfig,
} from "../migrationSize";

const CONFIG: SizeConfig = {
  baseline: "20260101000000",
  limit: 100,
  deployed: {
    "20251201000000_stara.sql": 500,
    "20251202000000_zmieniona.sql": 500,
  },
};

const kinds = (report: ReturnType<typeof analyzeMigrationSizes>) =>
  report.violations.map((v) => `${v.kind} ${v.file}`);

describe("analyzeMigrationSizes - pas supabase", () => {
  it("przepuszcza male pliki i zwalnia wdrozony duzy plik o DOKLADNIE zapisanym rozmiarze", () => {
    const report = analyzeMigrationSizes(
      {
        supabase: [
          { name: "20251201000000_stara.sql", bytes: 500 },
          { name: "20251202000000_zmieniona.sql", bytes: 500 },
          { name: "20260201000000_mala.sql", bytes: 100 },
        ],
        drizzle: [],
        lanes: [],
      },
      CONFIG,
    );
    expect(report).toEqual({ checked: 3, exempt: 2, violations: [] });
    expect(renderSizeReport(report)).toMatch(/3 plikow, 2 wdrozonych.*Zgodne\./);
  });

  it("LAPIE duzy plik ponad linia i mowi, czym go pociac", () => {
    const report = analyzeMigrationSizes(
      {
        supabase: [...deployedFiles(), { name: "20260201000000_duza.sql", bytes: 101 }],
        drizzle: [],
        lanes: [],
      },
      CONFIG,
    );
    expect(kinds(report)).toEqual(["za-duza supabase/migrations/20260201000000_duza.sql"]);
    expect(report.violations[0]!.detail).toContain(
      "bun run scripts/split-migration.ts supabase/migrations/20260201000000_duza.sql",
    );
    expect(renderSizeReport(report)).toMatch(/NARUSZENIA \(1\):\n {2}\[za-duza\]/);
  });

  it("LAPIE duzy plik pod linia, ktorego nie ma na liscie wdrozonych (np. wersja rowna linii)", () => {
    const report = analyzeMigrationSizes(
      {
        supabase: [...deployedFiles(), { name: "20260101000000_cfp.sql", bytes: 900 }],
        drizzle: [],
        lanes: [],
      },
      CONFIG,
    );
    expect(kinds(report)).toEqual(["za-duza-pod-linia supabase/migrations/20260101000000_cfp.sql"]);
  });

  it("plik o nazwie spoza konwencji traktuje jak plik ponad linia", () => {
    const report = analyzeMigrationSizes(
      {
        supabase: [...deployedFiles(), { name: "zla_nazwa.sql", bytes: 900 }],
        drizzle: [],
        lanes: [],
      },
      CONFIG,
    );
    expect(kinds(report)).toEqual(["za-duza supabase/migrations/zla_nazwa.sql"]);
  });

  it("LAPIE zwolnienie nieaktualne: zmieniony rozmiar, brak pliku, wpis ponad linia albo spoza konwencji", () => {
    const config: SizeConfig = {
      ...CONFIG,
      deployed: {
        ...CONFIG.deployed,
        "20260301000000_ponad.sql": 500,
        "zla_nazwa.sql": 500,
        "20251203000000_nie_ma.sql": 500,
      },
    };
    const report = analyzeMigrationSizes(
      {
        supabase: [
          { name: "20251201000000_stara.sql", bytes: 500 },
          { name: "20251202000000_zmieniona.sql", bytes: 501 },
          { name: "20260301000000_ponad.sql", bytes: 500 },
          { name: "zla_nazwa.sql", bytes: 500 },
        ],
        drizzle: [],
        lanes: [],
      },
      config,
    );
    expect(kinds(report)).toEqual([
      "za-duza-pod-linia supabase/migrations/20251202000000_zmieniona.sql",
      "za-duza supabase/migrations/20260301000000_ponad.sql",
      "za-duza supabase/migrations/zla_nazwa.sql",
      "zwolnienie-nieaktualne supabase/migrations/20251202000000_zmieniona.sql",
      "zwolnienie-nieaktualne supabase/migrations/20260301000000_ponad.sql",
      "zwolnienie-nieaktualne supabase/migrations/zla_nazwa.sql",
      "zwolnienie-nieaktualne supabase/migrations/20251203000000_nie_ma.sql",
    ]);
    const details = report.violations
      .filter((v) => v.kind === "zwolnienie-nieaktualne")
      .map((v) => v.detail);
    expect(details[0]).toMatch(/\(500 B\) nie pasuje do pliku \(501 B\)/);
    expect(details[3]).toMatch(/bez pliku/);
  });
});

function deployedFiles() {
  return [
    { name: "20251201000000_stara.sql", bytes: 500 },
    { name: "20251202000000_zmieniona.sql", bytes: 500 },
  ];
}

describe("analyzeMigrationSizes - blizniaki drizzle", () => {
  const lanes = [
    { tag: "0001_stara", twin: "20251201000000_stara.sql" },
    { tag: "0002_nowa", twin: "20260201000000_nowa.sql" },
    { tag: "0003_pod_linia", twin: "20251205000000_pod_linia.sql" },
    { tag: "0004_zla", twin: "zla_nazwa.sql" },
    { tag: "0005_zapis_lovable", drizzleOnly: "zapis wykonania z panelu" },
  ];

  it("blizniak wdrozonego pliku jest zwolniony, blizniak pliku ponad linia - nie", () => {
    const report = analyzeMigrationSizes(
      {
        supabase: deployedFiles(),
        drizzle: [
          { name: "0001_stara.sql", bytes: 900 },
          { name: "0002_nowa.sql", bytes: 900 },
          { name: "0003_pod_linia.sql", bytes: 900 },
          { name: "0004_zla.sql", bytes: 900 },
          { name: "0005_zapis_lovable.sql", bytes: 900 },
          { name: "0006_bez_wpisu.sql", bytes: 900 },
          { name: "0007_mala.sql", bytes: 10 },
        ],
        lanes: [...lanes, { tag: "0007_mala", twin: "20260201000001_mala.sql" }],
      },
      CONFIG,
    );
    expect(report.exempt).toBe(3);
    expect(kinds(report)).toEqual([
      "za-duzy-blizniak drizzle/migrations/0002_nowa.sql",
      "za-duzy-blizniak drizzle/migrations/0003_pod_linia.sql",
      "za-duzy-blizniak drizzle/migrations/0004_zla.sql",
    ]);
    expect(report.violations[0]!.detail).toContain("supabase/migrations/20260201000000_nowa.sql");
  });
});

describe("konfiguracja bramki", () => {
  it("lista wdrozonych duzych plikow lezy pod linia i ponad limitem; linia = najnowszy z nich", () => {
    expect(MIGRATION_MAX_BYTES).toBe(46080);
    expect(SIZE_CONFIG).toEqual({
      baseline: MIGRATION_SIZE_BASELINE,
      limit: MIGRATION_MAX_BYTES,
      deployed: DEPLOYED_OVERSIZE,
    });
    const versions = Object.keys(DEPLOYED_OVERSIZE).map((f) => f.slice(0, 14));
    for (const [file, bytes] of Object.entries(DEPLOYED_OVERSIZE)) {
      expect(file.slice(0, 14) <= MIGRATION_SIZE_BASELINE, file).toBe(true);
      expect(bytes, file).toBeGreaterThan(MIGRATION_MAX_BYTES);
    }
    expect(versions.sort().at(-1)).toBe(MIGRATION_SIZE_BASELINE);
    // Najwiekszy plik, ktory Lovable wdrozyl - kotwica limitu.
    expect(DEPLOYED_OVERSIZE["20260926100000_event_group_guests_follow_lead.sql"]).toBe(52653);
    expect(analyzeMigrationSizes({ supabase: [], drizzle: [], lanes: [] }).violations).toHaveLength(
      Object.keys(DEPLOYED_OVERSIZE).length,
    );
  });
});

const memoryFs = (files: Record<string, string>): MigrationFs => ({
  list: (dir) =>
    Object.keys(files)
      .filter((p) => p.startsWith(`${dir}/`))
      .map((p) => p.slice(dir.length + 1)),
  size: (path) => new TextEncoder().encode(files[path]!).length,
  read: (path) => files[path] ?? null,
});

describe("odczyt z dysku (wstrzykiwany)", () => {
  it("collectMigrationSizes mierzy tylko pliki .sql obu pasow, w bajtach UTF-8", () => {
    const fs = memoryFs({
      "supabase/migrations/20260101000000_b.sql": "ó",
      "supabase/migrations/20250101000000_a.sql": "a",
      "supabase/migrations/README.md": "x",
      "drizzle/migrations/0000_a.sql": "abc",
    });
    expect(collectMigrationSizes(fs)).toEqual({
      supabase: [
        { name: "20250101000000_a.sql", bytes: 1 },
        { name: "20260101000000_b.sql", bytes: 2 },
      ],
      drizzle: [{ name: "0000_a.sql", bytes: 3 }],
    });
  });

  it("readLogicalMigration skleja czesc 1 z czesciami 2..n, a brak pliku to blad", () => {
    const file = "20260101000000_x.sql";
    const fs = memoryFs({
      [`d/${file}`]: "SELECT 1;\n",
      "d/20260101000001_x_part2.sql": `-- migration-split: part 2/2 of ${file}\nSELECT 2;\n`,
    });
    expect(readLogicalMigration("d", file, fs)).toBe(
      `SELECT 1;\n\n-- migration-split: part 2/2 of ${file}\nSELECT 2;\n`,
    );
    expect(() => readLogicalMigration("d", "20260101000009_brak.sql", fs)).toThrow(/Brak migracji/);
  });

  it("nodeMigrationFs czyta prawdziwy dysk, a brak pliku to null", () => {
    expect(nodeMigrationFs.list("src/lib/ci")).toContain("migrationSize.ts");
    expect(nodeMigrationFs.size("src/lib/ci/migrationSize.ts")).toBeGreaterThan(0);
    expect(nodeMigrationFs.read("src/lib/ci/migrationSize.ts")).toContain("DEPLOYED_OVERSIZE");
    expect(nodeMigrationFs.read("src/lib/ci/nie-ma-takiego-pliku.ts")).toBeNull();
    expect(readLogicalMigration("src/lib/ci", "migrationSize.ts")).toContain("DEPLOYED_OVERSIZE");
    const real = collectMigrationSizes();
    expect(real.supabase.every((f) => f.name.endsWith(".sql") && f.bytes > 0)).toBe(true);
    expect(real.drizzle.length).toBeGreaterThan(0);
  });
});
