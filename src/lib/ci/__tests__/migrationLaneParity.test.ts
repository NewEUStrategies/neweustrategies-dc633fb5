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
  readFileOrNull,
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

  it("komentarz na samym końcu pliku (bez nowej linii) i niedomknięty /* też są prozą", () => {
    expect(executableSql("ALTER TABLE a ADD COLUMN b int; -- ostatnia linia")).toBe(
      executableSql("ALTER TABLE a ADD COLUMN b int;"),
    );
    expect(executableSql("ALTER TABLE a ADD COLUMN b int; /* niedomknięty")).toBe(
      executableSql("ALTER TABLE a ADD COLUMN b int;"),
    );
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

  // -------------------------------------------------------------------------
  // Normalizacja NIE MOŻE uzgadniać plików, które naprawdę się różnią.
  //
  // Poprzednia wersja składała diakrytyki i zwierała spację GLOBALNIE, a literał
  // komentarza łapała wyrażeniem regularnym. Każdy z poniższych przypadków
  // przechodził wtedy jako "zgodny", mimo że zmienia schemat albo zachowanie.
  // -------------------------------------------------------------------------
  it("diakrytyki w literale NIE-komentarzowym zostają - to wartość, nie proza", () => {
    const a = executableSql("ALTER TABLE t ADD CONSTRAINT c CHECK (typ = 'złożony');");
    const b = executableSql("ALTER TABLE t ADD CONSTRAINT c CHECK (typ = 'zlozony');");
    expect(a).not.toBe(b);
    expect(a).toContain("'złożony'");
  });

  it("spacja W ŚRODKU literału zostaje - zwieranie jej zmieniałoby wartość", () => {
    const a = executableSql("INSERT INTO t (v) VALUES ('a  b');");
    const b = executableSql("INSERT INTO t (v) VALUES ('a b');");
    expect(a).not.toBe(b);
    expect(a).toContain("'a  b'");
  });

  it("`COMMENT ON ... IS` WEWNĄTRZ ciała cytowanego dolarami to nie proza", () => {
    const body = (x: string) =>
      `CREATE FUNCTION f() RETURNS text LANGUAGE sql AS $fn$ SELECT 'COMMENT ON x IS ${x}' $fn$;`;
    const a = executableSql(body("foo"));
    const b = executableSql(body("bar"));
    // To jest RÓŻNICA ZACHOWANIA funkcji, a nie rozjazd dokumentacji.
    expect(a).not.toBe(b);
    expect(a).not.toContain("<proza>");
  });

  it("literał w ciele funkcji przeżywa, ale spacja wokół niego się zwiera", () => {
    // Ciało jest KODEM: `stripSqlComments` wycina z niego komentarze `--`,
    // zostawiając same nowe linie, więc spacja musi się zewrzeć. Wartości w
    // środku nie wolno przy tym ruszyć.
    const a = executableSql("CREATE FUNCTION f() RETURNS text AS $fn$\n\n  SELECT 'a  b';\n$fn$;");
    const b = executableSql("CREATE FUNCTION f() RETURNS text AS $fn$ SELECT 'a  b'; $fn$;");
    expect(a).toBe(b);
    expect(a).toContain("'a  b'");
  });

  it("spacja POZA literałami nadal się zwiera", () => {
    expect(executableSql("ALTER   TABLE\n\n a  ADD COLUMN b int;")).toBe(
      "ALTER TABLE a ADD COLUMN b int;",
    );
  });

  it("diakrytyki POZA literałami nadal się składają - tym różnią się pasy", () => {
    expect(executableSql("COMMENT ON COLUMN a.b IS 'którego';")).toBe(
      executableSql("COMMENT ON COLUMN a.b IS 'ktorego';"),
    );
  });

  // -------------------------------------------------------------------------
  // PROZA SKLEJANA Z KILKU LITERAŁÓW. SQL widzi w `'a' 'b'` JEDNĄ wartość, więc
  // dla bramki to ta sama proza, co `'ab'`. Tak właśnie rozjechała się para
  // 0016: pas supabase zapisał komentarz kilkoma literałami w kolejnych
  // wierszach, pas drizzle jednym - i sama proza zapalała `rozjazd-sql`,
  // którego ta bramka świadomie nie pilnuje.
  // -------------------------------------------------------------------------
  it("operand COMMENT ON sklejony przez koniec wiersza to jedna proza", () => {
    expect(executableSql("COMMENT ON COLUMN a.b IS 'ab';")).toBe(
      executableSql("COMMENT ON COLUMN a.b IS 'a'\n'b';"),
    );
  });

  it("sklejanie nie przeskakuje poza operand - kolejna instrukcja zostaje", () => {
    const sql = executableSql("COMMENT ON COLUMN a.b IS 'a'\n'b'; INSERT INTO z VALUES ('c');");
    expect(sql).toContain("'<proza>'");
    expect(sql).toContain("INSERT INTO z VALUES ('c')");
    // Dokładnie JEDEN znacznik: sklejony operand to jedna wartość.
    expect(sql.match(/<proza>/g)).toHaveLength(1);
  });

  // PostgreSQL skleja stałe napisowe TYLKO przez koniec wiersza; `'a' 'b'`
  // w jednej linii to błąd składni. Bramka nie ma prawa udawać, że taki plik
  // jest równy poprawnemu bliźniakowi - pas drizzle nie jest przez nic innego
  // wykonywany, bo `check:sql-*` czytają wyłącznie pas supabase.
  it("w JEDNEJ linii sąsiadujące literały to NIE jest sklejanie", () => {
    expect(executableSql("COMMENT ON COLUMN a.b IS 'ab';")).not.toBe(
      executableSql("COMMENT ON COLUMN a.b IS 'a' 'b';"),
    );
  });

  it("sklejanie nie zrównuje RÓŻNIĄCEGO SIĘ DDL-u obok prozy", () => {
    expect(executableSql("ALTER TABLE a ADD b int; COMMENT ON COLUMN a.b IS 'x' 'y';")).not.toBe(
      executableSql("ALTER TABLE a ADD b text; COMMENT ON COLUMN a.b IS 'x';"),
    );
  });

  it("literały sklejane POZA komentarzem zostają bajt w bajt", () => {
    // To jest wartość, nie proza: dwa różne napisy nie mogą się zrównać.
    expect(executableSql("INSERT INTO z VALUES ('a'\n'b');")).not.toBe(
      executableSql("INSERT INTO z VALUES ('a'\n'c');"),
    );
  });

  it("apostrof podwojony w prozie nie urywa literału", () => {
    const sql = executableSql("COMMENT ON COLUMN a.b IS 'to ''jest'' proza'; ALTER TABLE z;");
    expect(sql).toContain("'<proza>'");
    // Gdyby skaner zgubił escape, druga instrukcja wpadłaby do literału.
    expect(sql).toContain("ALTER TABLE z");
  });

  // -------------------------------------------------------------------------
  // SQL USZKODZONY. Skaner nie parsuje składni, tylko cytowanie, więc plik
  // z niezamkniętym literałem MUSI się skończyć - a nie zawiesić pętli ani
  // rzucić. Bramka, która wywraca się na wejściu, jest bramką wyłączoną, a
  // niezamknięty literał w migracji to dokładnie ten przypadek, w którym
  // ktoś najbardziej potrzebuje odpowiedzi.
  // -------------------------------------------------------------------------
  it("niezamknięty literał pojedynczy domyka się na końcu pliku", () => {
    const sql = executableSql("ALTER TABLE t ADD COLUMN c text; SELECT 'bez konca");
    expect(sql).toContain("ALTER TABLE t ADD COLUMN c text;");
    expect(sql).toContain("'bez konca");
  });

  it("niezamknięte ciało cytowane dolarami domyka się na końcu pliku", () => {
    const sql = executableSql("CREATE FUNCTION f() AS $fn$ SELECT 1;");
    expect(sql).toContain("$fn$");
    expect(sql).toContain("SELECT 1;");
  });

  it("niezamknięty identyfikator cytowany domyka się na końcu pliku", () => {
    const sql = executableSql('ALTER TABLE t RENAME TO "bez konca');
    expect(sql).toContain("ALTER TABLE t RENAME TO");
    expect(sql).toContain('"bez konca');
  });

  it("tekst WYGLĄDAJĄCY na komentarz w zagnieżdżonej wartości przeżywa", () => {
    // REGRESJA. Komentarze wycinał wcześniej `stripSqlComments` PRZED skanerem,
    // a ta funkcja nie zna cytowania dolarami - kasowała więc `-- A` ze środka
    // zagnieżdżonej WARTOŚCI `$b$...$b$`, zanim rekurencja miała czego bronić.
    // Obie funkcje zwracają RÓŻNE napisy, a odcisk wychodził ten sam.
    const body = (x: string) =>
      `CREATE FUNCTION f() RETURNS text AS $a$ BEGIN RETURN $b$foo -- ${x}\nbar$b$; END $a$;`;
    const a = executableSql(body("A"));
    const b = executableSql(body("B"));
    expect(a).not.toBe(b);
    // Wartość przechodzi nietknięta, razem z tym, co wygląda na komentarz.
    expect(a).toContain("-- A");
  });

  it("komentarz w KODZIE ciała funkcji nadal znika - to proza", () => {
    // Druga strona tej samej reguły i powód, dla którego rekurencja istnieje:
    // pas supabase komentuje ciała obficie, pas drizzle wcale.
    const a = executableSql("CREATE FUNCTION f() AS $fn$\n  -- po polsku\n  SELECT 1;\n$fn$;");
    const b = executableSql("CREATE FUNCTION f() AS $fn$ SELECT 1; $fn$;");
    expect(a).toBe(b);
    expect(a).not.toContain("po polsku");
  });

  it("komentarz na najwyższym poziomie też znika, a instrukcje zostają", () => {
    const sql = executableSql("-- nagłówek\nALTER TABLE a;\n/* blok */\nALTER TABLE b;");
    expect(sql).toBe("ALTER TABLE a; ALTER TABLE b;");
    expect(sql).not.toContain("nagłówek");
  });

  it("`--` w zwykłym literale pojedynczym nie jest komentarzem", () => {
    const a = executableSql("INSERT INTO t (v) VALUES ('a -- A');");
    const b = executableSql("INSERT INTO t (v) VALUES ('a -- B');");
    expect(a).not.toBe(b);
    expect(a).toContain("'a -- A'");
  });

  it("`$1` NIE jest otwarciem cytowania dolarami - to placeholder", () => {
    // `$` w SQL-u to najczęściej odwołanie do parametru, a nie tag cytowania.
    // Wzięcie `$1` za otwarcie zjadłoby resztę pliku jako „ciało funkcji".
    const sql = executableSql("SELECT * FROM t WHERE a = $1 AND b = 'x'; ALTER TABLE z;");
    expect(sql).toContain("$1");
    // Dowód, że skaner nie połknął reszty: dalsza instrukcja jest widoczna.
    expect(sql).toContain("ALTER TABLE z;");
  });

  it("pusty plik i sam biały znak dają pusty odcisk", () => {
    expect(executableSql("")).toBe("");
    expect(executableSql("\n\n   \n")).toBe("");
  });

  it("readFileOrNull oddaje null zamiast rzucać na brakującym pliku", () => {
    // Kontrakt tej funkcji jest tym, na czym stoi rozróżnienie „brak pliku"
    // od „plik pusty" w raporcie.
    expect(readFileOrNull("drizzle/migrations/nie-ma-takiego-pliku.sql")).toBeNull();
    // Kontrola przeciwna, żeby test nie przechodził przy funkcji zawsze-null.
    expect(readFileOrNull(`${DRIZZLE_DIR}/${MIGRATION_LANES[0]!.tag}.sql`)).not.toBeNull();
  });

  it("znikniętego pliku drizzle nie raportuje dwa razy", () => {
    // Wpis wskazuje bliźniaka, ale pliku pasa drizzle nie ma. To łapie pętla
    // `wpis-bez-pliku`, więc gałąź bliźniaka ma go PRZEPUŚCIĆ, a nie dokładać
    // drugiego naruszenia o tym samym.
    const entries: LaneEntry[] = [{ tag: "0000_x", twin: "20260101000000_x.sql" }];
    const report = analyzeMigrationLanes(
      ["0000_x"],
      entries,
      fromMap({ "supabase/migrations/20260101000000_x.sql": "ALTER TABLE a;" }),
    );
    expect(report.violations).toHaveLength(0);
    expect(report.twins).toBe(1);
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
      "20260913150000_profiles_discoverable_opt_in_restore.sql",
    );
    // Pełna lista tagów, nie sam 0006: rejestr sprawdza też wpisy bez pliku,
    // więc skan jednego tagu zgłosiłby pozostałe sześć jako martwe wpisy.
    const report = analyzeMigrationLanes(tags);
    expect(report.violations.filter((v) => v.tag.includes("discoverable"))).toEqual([]);
  });
});
