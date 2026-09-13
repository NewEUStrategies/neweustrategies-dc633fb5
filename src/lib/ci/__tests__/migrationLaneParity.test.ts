// Test bramki dwóch pasów migracji.
//
// Najpierw na źródłach syntetycznych - bo bramka, która widzi tylko stan
// faktyczny, nie ma jak umrzeć na czerwono, gdy przestanie cokolwiek widzieć,
// a pusta bramka brzmi identycznie jak zielona. Potem przebieg na PRAWDZIWYCH
// katalogach, żeby rejestr nie rozjechał się z dyskiem.
import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DRIZZLE_DIR,
  MIGRATION_LANES,
  analyzeMigrationLanes,
  executableSql,
  laneParityFailed,
  renderLaneReport,
  type LaneEntry,
} from "../migrationLaneParity";

/** Odczyt z mapy zamiast z dysku - testy syntetyczne nie dotykają repozytorium. */
const fromMap =
  (files: Record<string, string>) =>
  (path: string): string | null =>
    files[path] ?? null;

describe("analyzeMigrationLanes", () => {
  it("przepuszcza bliźniaka o tym samym SQL-u", () => {
    const entries: LaneEntry[] = [{ tag: "0000_x", twin: "20260101000000_x.sql" }];
    const report = analyzeMigrationLanes(
      ["0000_x"],
      entries,
      fromMap({
        "drizzle/migrations/0000_x.sql": "ALTER TABLE a;\n",
        "supabase/migrations/20260101000000_x.sql": "ALTER TABLE a;\n",
      }),
    );
    expect(laneParityFailed(report)).toBe(false);
    expect(report.twins).toBe(1);
  });

  it("ŁAPIE rozjazd SQL-u bliźniaków - to jest cała stawka tej bramki", () => {
    // Dwa pasy jadą na produkcję. Ten sam plik o różnym SQL-u znaczy, że pgTAP
    // testuje inną bazę, niż dostaje produkcja.
    const entries: LaneEntry[] = [{ tag: "0000_x", twin: "20260101000000_x.sql" }];
    const report = analyzeMigrationLanes(
      ["0000_x"],
      entries,
      fromMap({
        "drizzle/migrations/0000_x.sql": "ALTER TABLE a;\n",
        "supabase/migrations/20260101000000_x.sql": "ALTER TABLE b;\n",
      }),
    );
    expect(report.violations.map((v) => v.kind)).toEqual(["rozjazd-sql"]);
  });

  it("ŁAPIE plik dołożony do drizzle/ bez wpisu w rejestrze", () => {
    // Dokładnie tą drogą przeszło 0001_profiles_discoverable_default_true:
    // plik w jednym pasie, zero śladu w drugim, zero bramek po drodze.
    const report = analyzeMigrationLanes(["0001_nowy"], [], fromMap({}));
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]).toMatchObject({ kind: "brak-wpisu", tag: "0001_nowy" });
  });

  it("ŁAPIE wpis wskazujący na nieistniejącego bliźniaka", () => {
    const entries: LaneEntry[] = [{ tag: "0000_x", twin: "20260101000000_nie_ma.sql" }];
    const report = analyzeMigrationLanes(
      ["0000_x"],
      entries,
      fromMap({ "drizzle/migrations/0000_x.sql": "ALTER TABLE a;\n" }),
    );
    expect(report.violations.map((v) => v.kind)).toEqual(["brak-blizniaka"]);
  });

  it("ŁAPIE martwy wpis bez pliku - inaczej maskowałby zniknięcie migracji", () => {
    const entries: LaneEntry[] = [{ tag: "0000_znikniety", drizzleOnly: "powód" }];
    const report = analyzeMigrationLanes([], entries, fromMap({}));
    expect(report.violations.map((v) => v.kind)).toEqual(["wpis-bez-pliku"]);
  });

  it("przepuszcza plik świadomie bez bliźniaka i NIE czyta wtedy dysku", () => {
    const entries: LaneEntry[] = [
      { tag: "0002_tylko_drizzle", drizzleOnly: "operacja jednorazowa" },
    ];
    const report = analyzeMigrationLanes(["0002_tylko_drizzle"], entries, () => {
      throw new Error("czytanie pliku przy wpisie drizzleOnly");
    });
    expect(laneParityFailed(report)).toBe(false);
    expect(report.drizzleOnly).toBe(1);
  });

  it("NAGŁÓWEK i diakrytyki nie są rozjazdem - taka jest konwencja obu pasów", () => {
    // ZMIERZONE na wszystkich parach: pas supabase niesie długi nagłówek po
    // polsku, pas drizzle zaczyna od pierwszej instrukcji, a literały w drizzle
    // mają złożone diakrytyki. Bramka, która zapala się na tym, zapala się
    // zawsze - i zostaje wyłączona.
    const entries: LaneEntry[] = [{ tag: "0000_x", twin: "20260101000000_x.sql" }];
    const report = analyzeMigrationLanes(
      ["0000_x"],
      entries,
      fromMap({
        "drizzle/migrations/0000_x.sql":
          "COMMENT ON COLUMN a.b IS 'Najemca, do ktorego nalezy wiersz.';\n",
        "supabase/migrations/20260101000000_x.sql":
          "-- Długi nagłówek po polsku.\n--\n-- PRZYCZYNA ŹRÓDŁOWA. Cokolwiek.\nCOMMENT ON COLUMN a.b IS 'Najemca, do którego należy wiersz.';\n",
      }),
    );
    expect(laneParityFailed(report)).toBe(false);
    expect(report.twins).toBe(1);
  });

  it("ŁAPIE rozjazd, gdy jeden pas GUBI instrukcję", () => {
    // Granica poprzedniego przypadku: znacznik zastępuje TREŚĆ literału
    // `COMMENT ON`, ale nie całą instrukcję - zniknięcie komentarza z jednego
    // pasa nadal jest rozjazdem.
    const entries: LaneEntry[] = [{ tag: "0000_x", twin: "20260101000000_x.sql" }];
    const report = analyzeMigrationLanes(
      ["0000_x"],
      entries,
      fromMap({
        "drizzle/migrations/0000_x.sql": "ALTER TABLE a ADD COLUMN b int;\n",
        "supabase/migrations/20260101000000_x.sql":
          "ALTER TABLE a ADD COLUMN b int;\nCOMMENT ON COLUMN a.b IS 'cokolwiek';\n",
      }),
    );
    expect(report.violations.map((v) => v.kind)).toEqual(["rozjazd-sql"]);
  });

  it("executableSql zostawia DDL, a wycina samą prozę", () => {
    const sql = executableSql(
      "-- nagłówek\nALTER TABLE a ADD COLUMN b int;\nCOMMENT ON COLUMN a.b IS 'TRESC-DOKUMENTACJI';",
    );
    expect(sql).toContain("ALTER TABLE a ADD COLUMN b int");
    // Instrukcja zostaje, znika sama treść - stąd znacznik zamiast wycięcia.
    expect(sql).toContain("COMMENT ON COLUMN a.b IS");
    expect(sql).not.toContain("TRESC-DOKUMENTACJI");
  });

  it("raport nazywa każde naruszenie po tagu", () => {
    const report = analyzeMigrationLanes(["0009_obcy"], [], fromMap({}));
    expect(renderLaneReport(report)).toContain("0009_obcy");
  });
});

describe("rejestr kontra stan faktyczny", () => {
  const tags = readdirSync(DRIZZLE_DIR)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => f.replace(/\.sql$/, ""))
    .sort();

  it("pas drizzle jest zgodny z rejestrem i z pasem supabase", () => {
    const report = analyzeMigrationLanes(tags);
    expect(renderLaneReport(report)).toContain("Zgodne.");
    expect(report.violations).toEqual([]);
  });

  it("bramka faktycznie coś widzi - pusty skan nie może być zielony", () => {
    expect(tags.length).toBeGreaterThan(0);
    expect(MIGRATION_LANES.length).toBe(tags.length);
  });

  it("profiles.discoverable wraca do DEFAULT false w OBU pasach", () => {
    // REGRESJA. Pas drizzle przestawił kolumnę na DEFAULT true i przepisał
    // wszystkie wiersze, podczas gdy pas supabase trzymał DEFAULT false, a
    // 20260826182500 opierało na tym drugim argument prawny listy uczestników.
    // Naprawa ma sens tylko wtedy, gdy stoi w OBU pasach - stąd bliźniak.
    const entry = MIGRATION_LANES.find(
      (e) => e.tag === "0011_profiles_discoverable_opt_in_restore",
    );
    expect(entry).toBeDefined();
    expect(entry && "twin" in entry ? entry.twin : null).toBe(
      "20260913090000_profiles_discoverable_opt_in_restore.sql",
    );
    // Pełna lista tagów, nie sam 0006: rejestr sprawdza też wpisy bez pliku,
    // więc skan jednego tagu zgłosiłby pozostałe sześć jako martwe wpisy.
    const report = analyzeMigrationLanes(tags);
    expect(report.violations.filter((v) => v.tag.includes("discoverable"))).toEqual([]);
  });
});
