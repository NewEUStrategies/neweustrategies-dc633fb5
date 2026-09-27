// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW
//
// Podzial migracji jest bezpieczny tylko wtedy, gdy granica czesci wypada
// MIEDZY instrukcjami najwyzszego poziomu. Kazdy przypadek nizej to miejsce, w
// ktorym naiwne ciecie po `;` rozcina instrukcje: srednik w literale, w E'...'
// z ukosnikiem, w cytowanym identyfikatorze, w ciele $tag$ (takze z innym
// tagiem w srodku), w komentarzu (takze zagniezdzonym), w nawiasie i w
// `BEGIN ATOMIC`. Czesc bez polowy funkcji to migracja, ktora wywraca sie na
// produkcji po tym, jak poprzednia czesc juz weszla. Do tego grupy
// nierozlaczne (RLS i REVOKE przy CREATE, DROP+CREATE, instrukcje sesyjne) -
// bez nich czesc 1 zostawia tabele bez RLS albo funkcje SECURITY DEFINER
// wykonywalna przez PUBLIC do czasu wdrozenia czesci 2. Na koncu dowod
// (`verifySplit`): kazda z jego galezi musi umiec zapalic sie na czerwono.
import { describe, expect, it } from "vitest";
import { executableSql } from "../migrationLaneParity";
import {
  DEFAULT_MAX_BYTES,
  MigrationLexError,
  MigrationSplitError,
  boundaryLocks,
  lexStatements,
  objectName,
  splitAligned,
  statementEffect,
  utf8Length,
  verifySplit,
  type LaneSource,
  type SplitResult,
} from "../migrationSplit";

const texts = (sql: string): string[] => lexStatements(sql).map((s) => s.text);

const lane = (sql: string, extra: Partial<LaneSource> = {}): LaneSource => ({
  sql,
  header: (k, n) => `-- czesc ${k}/${n}\n`,
  trailer: (n) => `-- ciag dalszy: ${n} czesci\n`,
  ...extra,
});

/** Instrukcja o zadanej dlugosci (ASCII), zakonczona `;\n`. */
const stmt = (name: string, bytes: number): string => {
  const head = `SELECT '${name}`;
  return `${head}${"x".repeat(Math.max(0, bytes - head.length - 3))}';\n`;
};

describe("lexStatements - granice instrukcji", () => {
  it("dzieli zwykle instrukcje i skleja sie z powrotem bajt w bajt", () => {
    const sql = "CREATE TABLE a (id int);\nSELECT 1;\n";
    const segs = lexStatements(sql);
    expect(segs.map((s) => s.text)).toEqual(["CREATE TABLE a (id int);\n", "SELECT 1;\n"]);
    expect(segs.map((s) => s.line)).toEqual([1, 2]);
    expect(segs.map((s) => s.terminated)).toEqual([true, true]);
    expect(segs[0]!.skeleton).toBe("CREATE TABLE a (id int);");
    expect(segs.map((s) => s.text).join("")).toBe(sql);
  });

  it("pusty plik to zero instrukcji, plik z samych komentarzy - jeden segment bez kodu", () => {
    expect(lexStatements("")).toEqual([]);
    const only = lexStatements("-- tylko komentarz\n/* i blok */\n");
    expect(only).toHaveLength(1);
    expect(only[0]!.codeStart).toBe(-1);
    expect(only[0]!.terminated).toBe(false);
  });

  it("instrukcja bez `;` na koncu pliku jest ostatnim segmentem", () => {
    const segs = lexStatements("SELECT 1;\nSELECT 2");
    expect(segs.map((s) => s.text)).toEqual(["SELECT 1;\n", "SELECT 2"]);
    expect(segs[1]!.terminated).toBe(false);
  });

  it("komentarz za ostatnim `;` nalezy do ostatniej instrukcji (stopka pliku)", () => {
    expect(texts("SELECT 1;\n\n-- koniec pliku\n")).toEqual(["SELECT 1;\n\n-- koniec pliku\n"]);
  });

  it("komentarz przed instrukcja jedzie z nia, komentarz za `;` w tej samej linii zostaje przy poprzedniej", () => {
    expect(texts("SELECT 1; -- jeden\n-- opis dwojki\nSELECT 2;\n")).toEqual([
      "SELECT 1; -- jeden\n",
      "-- opis dwojki\nSELECT 2;\n",
    ]);
    expect(texts("SELECT 1;\r\nSELECT 2;")).toEqual(["SELECT 1;\r\n", "SELECT 2;"]);
    expect(texts("SELECT 1; SELECT 2;")).toEqual(["SELECT 1;", " SELECT 2;"]);
  });

  it("srednik w literale '...' z escape '' nie konczy instrukcji", () => {
    expect(texts("SELECT 'a;''b;';\nSELECT 2;")).toEqual(["SELECT 'a;''b;';\n", "SELECT 2;"]);
  });

  it("E'...' z ukosnikiem: \\' nie zamyka literalu, a w zwyklym literale zamyka", () => {
    // E'a\';b' to JEDEN literal `a';b`; xe'a\' to nazwa `xe` i zwykly literal `a\`.
    expect(texts("SELECT E'a\\';b';\nSELECT 2;")).toEqual(["SELECT E'a\\';b';\n", "SELECT 2;"]);
    expect(texts("SELECT e'\\\\';SELECT 2;")).toEqual(["SELECT e'\\\\';", "SELECT 2;"]);
    expect(texts("SELECT xe'a\\';\nSELECT 2;")).toEqual(["SELECT xe'a\\';\n", "SELECT 2;"]);
    expect(texts("SELECT E'it''s;';\nSELECT 2;")).toHaveLength(2);
  });

  it('srednik w cytowanym identyfikatorze z escape "" nie konczy instrukcji', () => {
    const segs = lexStatements('CREATE TABLE "a;""b" (id int);\nSELECT 2;');
    expect(segs).toHaveLength(2);
    expect(segs[0]!.skeleton).toBe('CREATE TABLE "a;""b" (id int);');
  });

  it("ciala $$ i $tag$ sa nieprzezroczyste, takze z INNYM tagiem w srodku", () => {
    const fn =
      "CREATE FUNCTION f() RETURNS text LANGUAGE plpgsql AS $fn$\nBEGIN\n  RETURN $x$;$$;$x$;\nEND;\n$fn$;\n";
    expect(texts(`${fn}SELECT 2;`)).toEqual([fn, "SELECT 2;"]);
    expect(texts("DO $$ BEGIN PERFORM 1; END $$;\nSELECT $b$;$b$;")).toEqual([
      "DO $$ BEGIN PERFORM 1; END $$;\n",
      "SELECT $b$;$b$;",
    ]);
    expect(lexStatements(fn)[0]!.skeleton).toBe(
      "CREATE FUNCTION f() RETURNS text LANGUAGE plpgsql AS $$;",
    );
  });

  it("tag dolarowy z literami spoza ASCII i identyfikator spoza ASCII", () => {
    expect(texts("SELECT $żółw$;$żółw$;\nCREATE TABLE żółw (id int);")).toHaveLength(2);
  });

  it("`$` w nazwie (a$b$) nie otwiera ciala, `$1` to parametr, a `1$$` otwiera cialo", () => {
    expect(texts("SELECT a$b$ FROM t;\nSELECT $1;\nSELECT 2;")).toHaveLength(3);
    expect(texts("SELECT 1$$;$$;\nSELECT 2;")).toEqual(["SELECT 1$$;$$;\n", "SELECT 2;"]);
  });

  it("srednik w komentarzu `--` i w ZAGNIEZDZONYM `/* */` nie konczy instrukcji", () => {
    expect(texts("SELECT 1 -- a; b\n;\nSELECT 2;")).toEqual(["SELECT 1 -- a; b\n;\n", "SELECT 2;"]);
    expect(texts("SELECT /* a /* b; */ c; */ 1;\nSELECT 2;")).toEqual([
      "SELECT /* a /* b; */ c; */ 1;\n",
      "SELECT 2;",
    ]);
    expect(texts("SELECT 1; -- ostatni bez nowej linii")).toEqual([
      "SELECT 1; -- ostatni bez nowej linii",
    ]);
    expect(texts("SELECT 1;\nSELECT 2 -- bez srednika i bez nowej linii")).toEqual([
      "SELECT 1;\n",
      "SELECT 2 -- bez srednika i bez nowej linii",
    ]);
  });

  it("srednik w nawiasie nie konczy instrukcji (regula psql, np. CREATE RULE)", () => {
    const rule =
      "CREATE RULE r AS ON INSERT TO t DO ALSO (INSERT INTO a VALUES (1); INSERT INTO b VALUES (2));\n";
    expect(texts(`${rule}SELECT 1;`)).toEqual([rule, "SELECT 1;"]);
    expect(texts("SELECT 1);\nSELECT 2;")).toHaveLength(2);
  });

  it("BEGIN ATOMIC ... END w CREATE [OR REPLACE] FUNCTION|PROCEDURE trzyma sredniki w srodku", () => {
    const f =
      "CREATE FUNCTION f() RETURNS int LANGUAGE sql BEGIN ATOMIC SELECT 1; SELECT CASE WHEN true THEN 1 END; END;\n";
    expect(texts(`${f}SELECT 2;`)).toEqual([f, "SELECT 2;"]);
    const orf =
      "CREATE OR REPLACE FUNCTION g() RETURNS int LANGUAGE sql BEGIN ATOMIC SELECT 1; END;\n";
    expect(texts(`${orf}SELECT 2;`)).toEqual([orf, "SELECT 2;"]);
    const p = "CREATE PROCEDURE p() LANGUAGE sql BEGIN ATOMIC INSERT INTO t VALUES (1); END;\n";
    expect(texts(`${p}SELECT 2;`)).toEqual([p, "SELECT 2;"]);
    const orp =
      "CREATE OR REPLACE PROCEDURE q() LANGUAGE sql BEGIN ATOMIC INSERT INTO t VALUES (1); END;\n";
    expect(texts(`${orp}SELECT 2;`)).toEqual([orp, "SELECT 2;"]);
  });

  it("BEGIN/CASE/END poza trescia funkcji nie zmieniaja granic", () => {
    // Transakcja na najwyzszym poziomie to trzy instrukcje, nie jedna.
    expect(texts("BEGIN;\nSELECT 1;\nCOMMIT;")).toHaveLength(3);
    // CASE ... END w wyrazeniu RETURN (bez BEGIN) nie otwiera bloku.
    expect(
      texts(
        "CREATE FUNCTION f() RETURNS int LANGUAGE sql RETURN CASE WHEN true THEN 1 END;\nSELECT 2;",
      ),
    ).toHaveLength(2);
    // BEGIN w nawiasie (nazwa parametru) nie jest poczatkiem bloku.
    expect(
      texts("CREATE FUNCTION f(begin int) RETURNS int LANGUAGE sql RETURN 1;\nSELECT 2;"),
    ).toHaveLength(2);
    // CREATE OR (bez REPLACE FUNCTION) - wzorzec psql nie pasuje.
    expect(texts("CREATE OR REPLACE VIEW v AS SELECT 1 AS begin;\nSELECT 2;")).toHaveLength(2);
  });

  it("komentarz `--` konczy takze samotny CR (jak w psql) - tekst za nim to znow kod", () => {
    // Repro z przegladu: `-- c\r` zamyka komentarz, wiec `|| 'x\n); SELECT 42 ...; -- \r'`
    // to LITERAL - oryginal jest JEDNA instrukcja, a nie trzy.
    const cr =
      "CREATE TABLE public.cr1 (a text DEFAULT 'a' -- c\r|| 'x\n); SELECT 42 AS leaked; -- \r'\n);\n";
    expect(texts(cr)).toEqual([cr]);
    expect(lexStatements(cr)[0]!.skeleton).not.toContain("SELECT");
    expect(texts("SELECT 1; -- a\rSELECT 2;")).toEqual(["SELECT 1; -- a\r", "SELECT 2;"]);
    expect(texts("SELECT 1;\rSELECT 2;")).toEqual(["SELECT 1;\r", "SELECT 2;"]);
  });

  it("E'...' sklejony przez nowa linie ciagnie tryb E: \\' w dalszym kawalku nie zamyka", () => {
    expect(texts("SELECT E'a'\n'\\';b';\nSELECT 2;")).toEqual([
      "SELECT E'a'\n'\\';b';\n",
      "SELECT 2;",
    ]);
    // Kontynuacja przechodzi przez komentarze `--` (zakonczone koncem linii).
    expect(texts("SELECT E'a' -- c\n  -- d\n'\\';b';\nSELECT 2;")).toHaveLength(2);
    // Zwykly literal: '\' konczy sie na `'` - kontynuacja nie zmienia granic.
    expect(texts("SELECT 'a'\n'\\';\nSELECT 2;")).toEqual(["SELECT 'a'\n'\\';\n", "SELECT 2;"]);
    expect(() => lexStatements("SELECT E'a'\n'\\';")).toThrow(/Niezamkniety literal/);
  });

  it("meta-polecenie psql i COPY ... FROM STDIN to blad leksera, a nie ciecie przez dane", () => {
    expect(() => lexStatements("SELECT 1;\n\\set x 1\nSELECT 2;")).toThrow(
      /Meta-polecenie psql \(\\\.\.\.\) w linii 2/,
    );
    expect(() => lexStatements("COPY t FROM stdin;\n1\t;x\n\\.\nSELECT 2;")).toThrow(
      /COPY \.\.\. FROM STDIN w linii 1/,
    );
    expect(() => lexStatements("SELECT 1;\n  copy public.t (a) from STDIN")).toThrow(
      MigrationLexError,
    );
    // Ukosnik w literale, COPY z pliku serwera i COPY do STDOUT to zwykly SQL.
    expect(texts("SELECT '\\';\nCOPY t FROM '/tmp/x.csv';\nCOPY t TO STDOUT;")).toHaveLength(3);
  });

  it("niezamkniete konstrukcje to blad z numerem linii, a nie ciche ciecie", () => {
    expect(() => lexStatements("SELECT 1;\nSELECT 'abc;")).toThrow(MigrationLexError);
    expect(() => lexStatements("SELECT 1;\nSELECT 'abc;")).toThrow(/linii 2/);
    expect(() => lexStatements("SELECT E'abc\\';")).toThrow(/literal/);
    expect(() => lexStatements('SELECT "abc;')).toThrow(/identyfikator/);
    expect(() => lexStatements("SELECT $x$ abc;")).toThrow(/cialo \$x\$/);
    expect(() => lexStatements("\n\nSELECT /* /* */ 1;")).toThrow(/komentarz.*linii 3/);
  });
});

describe("statementEffect i objectName - czego dotyczy instrukcja", () => {
  it("objectName: schemat domyslny public, nazwy bez cudzyslowow do malych liter", () => {
    expect(objectName("Foo")).toBe("public.foo");
    expect(objectName("Ext.Foo")).toBe("ext.foo");
    expect(objectName('"My.Table"')).toBe("public.My.Table");
    expect(objectName('public."Wiel""ka"')).toBe('public.Wiel"ka');
  });

  const effect = (sql: string) => statementEffect(lexStatements(sql)[0]!.skeleton);

  it("rozpoznaje tworzenie tabel, widokow, funkcji, polityk, triggerow i indeksow", () => {
    expect(effect("CREATE TABLE IF NOT EXISTS public.t (id int);").creates).toEqual([
      "rel:public.t",
    ]);
    expect(effect("CREATE OR REPLACE VIEW v AS SELECT 1;").creates).toEqual(["rel:public.v"]);
    expect(effect("CREATE MATERIALIZED VIEW m AS SELECT 1;").creates).toEqual(["rel:public.m"]);
    expect(
      effect("CREATE OR REPLACE FUNCTION public.f(a int) RETURNS int AS $$ $$;").creates,
    ).toEqual(["routine:public.f"]);
    expect(effect('CREATE POLICY "p x" ON public.t FOR SELECT USING (true);').creates).toEqual([
      "policy:public.t|public.p x",
    ]);
    expect(
      effect("CREATE TRIGGER trg BEFORE UPDATE ON public.t FOR EACH ROW EXECUTE FUNCTION f();")
        .creates,
    ).toEqual(["trigger:public.t|public.trg"]);
    expect(effect("CREATE UNIQUE INDEX IF NOT EXISTS i ON public.t (id);").creates).toEqual([
      "index:public.i",
    ]);
  });

  it("rozpoznaje zdejmowanie obiektow (z ON dla polityk i triggerow)", () => {
    expect(effect('DROP POLICY IF EXISTS "p x" ON public.t;').drops).toEqual([
      "policy:public.t|public.p x",
    ]);
    expect(effect("DROP TRIGGER IF EXISTS trg ON public.t;").drops).toEqual([
      "trigger:public.t|public.trg",
    ]);
    expect(effect("DROP FUNCTION IF EXISTS public.f(uuid, text);").drops).toEqual([
      "routine:public.f",
    ]);
    expect(effect("DROP MATERIALIZED VIEW IF EXISTS m;").drops).toEqual(["rel:public.m"]);
    expect(effect("DROP INDEX i;").drops).toEqual(["index:public.i"]);
  });

  it("rozpoznaje uszczelnienia: RLS, ALTER VIEW, ALTER FUNCTION, REVOKE na tabelach i funkcjach", () => {
    expect(effect("ALTER TABLE ONLY public.t ENABLE ROW LEVEL SECURITY;").secures).toEqual([
      "rel:public.t",
    ]);
    expect(effect("ALTER TABLE t FORCE ROW LEVEL SECURITY;").secures).toEqual(["rel:public.t"]);
    expect(effect("ALTER VIEW v SET (security_invoker = true);").secures).toEqual(["rel:public.v"]);
    expect(effect("ALTER FUNCTION public.f(int) SET search_path = public;").secures).toEqual([
      "routine:public.f",
    ]);
    expect(
      effect("REVOKE ALL ON FUNCTION public.f(numeric(10,2)), g(int) FROM PUBLIC;").secures,
    ).toEqual(["routine:public.f", "routine:public.g"]);
    expect(effect("REVOKE ALL ON TABLE public.t FROM anon;").secures).toEqual(["rel:public.t"]);
    expect(effect("REVOKE UPDATE (a, b) ON t, u FROM authenticated;").secures).toEqual([
      "rel:public.t",
      "rel:public.u",
    ]);
    expect(effect("REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;").secures).toEqual([]);
  });

  it("ALTER TABLE: nowa kolumna, ograniczenia, wylaczenie triggera i RLS - kazda akcja osobno", () => {
    expect(
      effect(
        "ALTER TABLE ONLY public.t ADD COLUMN IF NOT EXISTS a int, ADD b text, ADD CONSTRAINT c CHECK (a > 0), DROP CONSTRAINT IF EXISTS d, DROP CONSTRAINT e;",
      ),
    ).toEqual({
      session: false,
      // Dwie nowe kolumny to jeden klucz tabeli, bez powtorzen.
      creates: ["rel:public.t", "constraint:public.t|public.c"],
      drops: ["constraint:public.t|public.d", "constraint:public.t|public.e"],
      secures: [],
    });
    // ADD PRIMARY KEY/UNIQUE/CHECK/FOREIGN KEY/EXCLUDE to nie nowa kolumna.
    for (const action of [
      "ADD PRIMARY KEY (id)",
      "ADD UNIQUE (a)",
      "ADD CHECK (a > 0)",
      "ADD FOREIGN KEY (a) REFERENCES u (id)",
      "ADD EXCLUDE USING gist (r WITH &&)",
      "ALTER COLUMN a SET DEFAULT 'add x'",
    ]) {
      expect(effect(`ALTER TABLE t ${action};`).creates, action).toEqual([]);
    }
    expect(effect("ALTER TABLE t DISABLE TRIGGER trg;").drops).toEqual([
      "trigger-on:public.t|public.trg",
    ]);
    expect(effect("ALTER TABLE t ENABLE ALWAYS TRIGGER trg;").creates).toEqual([
      "trigger-on:public.t|public.trg",
    ]);
    expect(effect("ALTER TABLE t ENABLE TRIGGER trg;").creates).toEqual([
      "trigger-on:public.t|public.trg",
    ]);
    expect(effect("ALTER TABLE t DISABLE ROW LEVEL SECURITY;").drops).toEqual(["rls:public.t"]);
    // NO FORCE to wylaczenie, a nie wlaczenie - mimo slowa FORCE w srodku.
    expect(effect("ALTER TABLE t NO FORCE ROW LEVEL SECURITY;")).toEqual({
      session: false,
      creates: [],
      drops: ["rls:public.t"],
      secures: [],
    });
    expect(effect("ALTER TABLE t ENABLE ROW LEVEL SECURITY;")).toEqual({
      session: false,
      creates: ["rls:public.t"],
      drops: [],
      secures: ["rel:public.t"],
    });
  });

  it("instrukcje sesyjne i zwykle instrukcje bez skutku dla grup", () => {
    for (const sql of [
      "SET search_path = public;",
      "SET LOCAL role authenticated;",
      "RESET ROLE;",
      "BEGIN;",
      "COMMIT;",
      "START TRANSACTION;",
      "LOCK TABLE t;",
      "CREATE TEMP TABLE x AS SELECT 1;",
      "CREATE TEMPORARY VIEW v AS SELECT 1;",
      "SELECT set_config('a.b', 'c', true);",
      "SELECT pg_catalog.set_config('a.b', 'c', false);",
    ]) {
      expect(effect(sql).session, sql).toBe(true);
    }
    const plain = effect("UPDATE public.t SET a = 1;");
    expect(plain).toEqual({ session: false, creates: [], drops: [], secures: [] });
    expect(effect("GRANT SELECT ON public.t TO authenticated;").secures).toEqual([]);
  });
});

describe("boundaryLocks - grupy nierozlaczne", () => {
  const locked = (sql: string): boolean[] =>
    boundaryLocks(lexStatements(sql)).map((l) => l !== null);

  it("tabela z RLS i REVOKE w jednej grupie; GRANT i komentarz mozna odciac", () => {
    const sql = [
      "CREATE TABLE public.t (id int);",
      "ALTER TABLE public.t ENABLE ROW LEVEL SECURITY;",
      "REVOKE ALL ON public.t FROM anon;",
      "GRANT SELECT ON public.t TO authenticated;",
      "COMMENT ON TABLE public.t IS 'x';",
      "",
    ].join("\n");
    expect(locked(sql)).toEqual([false, true, true, false, false]);
    const locks = boundaryLocks(lexStatements(sql));
    // Granica 1 blokuja dwie reguly naraz - zostaje pierwszy powod.
    expect(locks[1]).toMatch(/rel:public\.t utworzony w linii 1 i uszczelniany w linii 2/);
  });

  it("REVOKE na funkcji skleja wszystko od jej CREATE; REVOKE bez CREATE w pliku nic nie skleja", () => {
    const sql = [
      "CREATE FUNCTION public.f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;",
      "COMMENT ON FUNCTION public.f() IS 'x';",
      "REVOKE ALL ON FUNCTION public.f() FROM PUBLIC;",
      "REVOKE ALL ON FUNCTION public.g() FROM PUBLIC;",
      "ALTER FUNCTION public.f() SET search_path = public;",
      "",
    ].join("\n");
    expect(locked(sql)).toEqual([false, true, true, true, true]);
  });

  it("DROP + CREATE tego samego obiektu to jedna grupa, liczona od PIERWSZEGO DROP", () => {
    const sql = [
      "DROP POLICY IF EXISTS p ON public.t;",
      "DROP POLICY IF EXISTS p ON public.t;",
      "SELECT 1;",
      "CREATE POLICY p ON public.t FOR SELECT USING (true);",
      "CREATE POLICY p ON public.t FOR SELECT USING (true);",
      "",
    ].join("\n");
    expect(locked(sql)).toEqual([false, true, true, true, false]);
  });

  it("kazdy REVOKE siega do PIERWSZEGO utworzenia; nowa wersja po uszczelnieniu to nowa grupa", () => {
    const sql = [
      "CREATE TABLE public.t (id int);",
      "REVOKE ALL ON public.t FROM anon;",
      "SELECT 1;",
      "REVOKE ALL ON public.t FROM authenticated;",
      "SELECT 2;",
      "CREATE OR REPLACE FUNCTION public.f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;",
      "REVOKE ALL ON FUNCTION public.f() FROM PUBLIC;",
      "SELECT 3;",
      "CREATE OR REPLACE FUNCTION public.f() RETURNS int LANGUAGE sql AS $$ SELECT 2 $$;",
      "REVOKE ALL ON FUNCTION public.f() FROM PUBLIC;",
      "",
    ].join("\n");
    expect(locked(sql)).toEqual([false, true, true, true, false, false, true, false, false, true]);
  });

  it("ADD COLUMN otwiera tabele na nowo: REVOKE za nia jest z nia nierozlaczny", () => {
    const sql = [
      "ALTER TABLE public.t ADD COLUMN secret text;",
      "SELECT 1;",
      "REVOKE SELECT (secret) ON public.t FROM anon;",
      "",
    ].join("\n");
    expect(locked(sql)).toEqual([false, true, true]);
  });

  it("DROP CONSTRAINT + ADD CONSTRAINT i DISABLE + ENABLE TRIGGER to jedna grupa", () => {
    const sql = [
      "ALTER TABLE public.t DROP CONSTRAINT IF EXISTS t_a_values;",
      "UPDATE public.t SET a = 'x';",
      "ALTER TABLE public.t ADD CONSTRAINT t_a_values CHECK (a IN ('x'));",
      "ALTER TABLE public.t DISABLE TRIGGER guard;",
      "UPDATE public.t SET b = 1;",
      "ALTER TABLE public.t ENABLE TRIGGER guard;",
      "SELECT 1;",
      "",
    ].join("\n");
    expect(locked(sql)).toEqual([false, true, true, false, true, true, false]);
    expect(boundaryLocks(lexStatements(sql))[2]).toMatch(
      /constraint:public\.t\|public\.t_a_values zdejmowany w linii 1 i tworzony na nowo w linii 3/,
    );
  });

  it("instrukcja sesyjna skleja wszystko po sobie do konca pliku", () => {
    expect(locked("SELECT 1;\nSET search_path = x;\nSELECT 2;\nSELECT 3;\n")).toEqual([
      false,
      false,
      true,
      true,
    ]);
  });

  it("instrukcja przyklejona do `;` bez odstepu nie da sie odciac", () => {
    expect(locked("SELECT 1;SELECT 2;\nSELECT 3;")).toEqual([false, true, false]);
    expect(locked("SELECT 1;/* c */SELECT 2;")).toEqual([false, false]);
  });
});

describe("utf8Length", () => {
  it("liczy bajty UTF-8: 1, 2, 3 i 4 bajty na znak", () => {
    expect(utf8Length("a")).toBe(1);
    expect(utf8Length("ó")).toBe(2);
    expect(utf8Length("€")).toBe(3);
    expect(utf8Length("😀")).toBe(4);
    expect(utf8Length("aó€😀")).toBe(new TextEncoder().encode("aó€😀").length);
  });
});

describe("splitAligned - pakowanie", () => {
  it("plik w limicie wraca bez zmian, jako jedna czesc bez naglowka", () => {
    const sql = "SELECT 1;\n";
    const result = splitAligned([lane(sql)]);
    expect(result.lanes[0]).toEqual([{ text: sql, head: 0, tail: 0, bytes: 10 }]);
    expect(result.oversize).toEqual([]);
    expect(result.statements).toBe(1);
  });

  it("tnie zachlannie w kolejnosci; czesc 1 ma stopke, reszta naglowek; kazda <= limit", () => {
    const sql = `-- NAGLOWEK ORYGINALU\n${stmt("a", 400)}${stmt("b", 400)}${stmt("c", 400)}`;
    const result = splitAligned([lane(sql)], { maxBytes: 900 });
    const parts = result.lanes[0]!;
    expect(parts).toHaveLength(2);
    expect(parts[0]!.text.startsWith("-- NAGLOWEK ORYGINALU\n")).toBe(true);
    expect(parts[0]!.text.endsWith("-- ciag dalszy: 2 czesci\n")).toBe(true);
    expect(parts[1]!.text.startsWith("-- czesc 2/2\n")).toBe(true);
    for (const p of parts) expect(p.bytes).toBeLessThanOrEqual(900);
    expect(parts.map((p) => executableSql(p.text)).join(" ")).toBe(executableSql(sql));
    expect(result.firstLines).toEqual([2, 4]);
  });

  it("bez maxBytes stosuje domyslny limit 45 KiB", () => {
    const sql = Array.from({ length: 8 }, (_, k) => stmt(`s${k}`, 8000)).join("");
    const result = splitAligned([lane(sql)]);
    expect(DEFAULT_MAX_BYTES).toBe(46080);
    expect(result.lanes[0]!.length).toBe(2);
  });

  it("stopka po instrukcji bez konca linii dostaje wlasna linie; pusta stopka nic nie dokleja", () => {
    const sql = `${stmt("a", 300).trimEnd()} ${stmt("b", 300)}`;
    const withTrailer = splitAligned([lane(sql)], { maxBytes: 400 }).lanes[0]!;
    expect(withTrailer[0]!.text).toMatch(/';\n-- ciag dalszy/);
    const noTrailer = splitAligned([lane(sql, { trailer: () => "" })], { maxBytes: 400 }).lanes[0]!;
    expect(noTrailer[0]!.tail).toBe(0);
    expect(noTrailer[0]!.text.endsWith("';")).toBe(true);
  });

  it("dwa pasy tnie w tych samych miejscach - czesc k drizzle jest blizniakiem czesci k supabase", () => {
    const supabase = `-- dlugi naglowek po polsku\n${stmt("a", 300)}-- opis\n${stmt("b", 300)}${stmt("c", 300)}`;
    const drizzle = `${stmt("a", 300)}${stmt("b", 300)}${stmt("c", 300)}`;
    const result = splitAligned([lane(supabase), lane(drizzle)], { maxBytes: 700 });
    expect(result.lanes[0]!.length).toBe(result.lanes[1]!.length);
    result.lanes[0]!.forEach((p, k) =>
      expect(executableSql(p.text)).toBe(executableSql(result.lanes[1]![k]!.text)),
    );
  });

  it("ciecie uwzglednia KAZDY pas: dluzszy pas drizzle wymusza wczesniejsza granice", () => {
    const supabase = `${stmt("a", 200)}${stmt("b", 200)}${stmt("c", 200)}`;
    const drizzle = `-- ${"k".repeat(300)}\n${stmt("a", 200)}${stmt("b", 200)}${stmt("c", 200)}`;
    const result = splitAligned([lane(supabase), lane(drizzle)], { maxBytes: 600 });
    for (const parts of result.lanes)
      for (const p of parts) expect(p.bytes).toBeLessThanOrEqual(600);
  });

  it("pasy o roznym SQL-u albo roznej liczbie instrukcji to blad, nie podzial", () => {
    const a = `${stmt("a", 300)}${stmt("b", 300)}`;
    expect(() =>
      splitAligned([lane(a), lane(`${stmt("a", 300)}${stmt("X", 300)}`)], { maxBytes: 400 }),
    ).toThrow(/instrukcja #2/);
    expect(() => splitAligned([lane(a), lane(stmt("a", 300))], { maxBytes: 400 })).toThrow(
      /instrukcja #2, linia 2/,
    );
    expect(() => splitAligned([lane(a), lane(`${a}${stmt("c", 300)}`)], { maxBytes: 400 })).toThrow(
      /instrukcja #3, linia -/,
    );
  });

  it("za duza pojedyncza instrukcja to blad z linia i poczatkiem instrukcji", () => {
    const sql = `${stmt("a", 100)}${stmt("wielka", 5000)}`;
    expect(() => splitAligned([lane(sql)], { maxBytes: 1000 })).toThrow(MigrationSplitError);
    expect(() => splitAligned([lane(sql)], { maxBytes: 1000 })).toThrow(
      /Instrukcja w linii 2 ma 5000 B i nie miesci sie w czesci o limicie 1000 B \(z naglowkiem\)\. Poczatek: "SELECT '';"\. Podziel/,
    );
    // Dlugi poczatek instrukcji jest skracany do 80 znakow.
    const cols = Array.from({ length: 40 }, (_, k) => `kolumna_${k}`).join(", ");
    const wide = `${stmt("a", 100)}SELECT ${cols}, '${"x".repeat(3000)}' FROM t;\n`;
    expect(() => splitAligned([lane(wide)], { maxBytes: 1000 })).toThrow(
      /Poczatek: "SELECT kolumna_0, kolumna_1, [^"]{40,}\.\.\."\./,
    );
  });

  it("za duza GRUPA mowi, dlaczego jest nierozlaczna", () => {
    const sql = [
      "CREATE TABLE public.t (id int);",
      `COMMENT ON TABLE public.t IS '${"x".repeat(800)}';`,
      "ALTER TABLE public.t ENABLE ROW LEVEL SECURITY;",
      "SELECT 1;",
      "",
    ].join("\n");
    expect(() => splitAligned([lane(sql)], { maxBytes: 600 })).toThrow(
      /grupa nierozlaczna \(linie 1-3\).*Sklejone, bo: rel:public\.t utworzony w linii 1/,
    );
  });

  it("tryb isolate: za duza grupa jest osobna czescia w `oversize`, nastepna zaczyna nowa", () => {
    const sql = `${stmt("a", 100)}${stmt("wielka", 3000)}${stmt("b", 100)}${stmt("c", 100)}`;
    const result = splitAligned([lane(sql)], { maxBytes: 500, onOversize: "isolate" });
    expect(result.lanes[0]!.map((p) => p.bytes > 500)).toEqual([false, true, false]);
    expect(result.oversize).toEqual([1]);
  });

  it("tryb isolate: plik z jedna za duza instrukcja zostaje w calosci i jest oznaczony", () => {
    const sql = stmt("wielka", 3000);
    const result = splitAligned([lane(sql)], { maxBytes: 500, onOversize: "isolate" });
    expect(result.lanes[0]).toHaveLength(1);
    expect(result.lanes[0]![0]!.text).toBe(sql);
    expect(result.oversize).toEqual([0]);
  });

  it("E'a\\';b', zagniezdzony komentarz i komentarz do CR przechodza wlasny dowod", () => {
    // Granice byly dobre juz wczesniej, ale odcisk (1) czytal te konstrukcje
    // inaczej niz lekser i dowod odrzucal poprawny podzial.
    for (const first of [
      "SELECT E'a\\';b';\n",
      "SELECT /* a /* b; */ c' */ 1;\n",
      "SELECT 'a' -- c\r|| 'x  y';\n",
    ]) {
      const result = splitAligned([lane(`${first}SELECT 'x  y';\n`)], {
        maxBytes: 20,
        onOversize: "isolate",
      });
      expect(result.lanes[0], first).toHaveLength(2);
      expect(result.lanes[0]![1]!.text).toContain("SELECT 'x  y';\n");
    }
  });

  it("naglowek, ktory nie jest komentarzem, oblewa dowod - czesc dodalaby SQL", () => {
    const sql = `${stmt("a", 300)}${stmt("b", 300)}`;
    expect(() =>
      splitAligned([lane(sql, { header: () => "SELECT 'wtracone';\n" })], { maxBytes: 400 }),
    ).toThrow(/wlasnego dowodu[\s\S]*SQL wykonywalny czesci rozni sie/);
  });

  it("naglowek dluzszy przy mniejszym n niz zarezerwowany oblewa dowod limitem bajtow", () => {
    const sql = `${stmt("a", 300)}${stmt("b", 300)}${stmt("c", 300)}`;
    // Rezerwa liczona jest dla n = liczby grup (3); tu faktycznie wyjdzie mniej czesci.
    const sneaky = (k: number, n: number) => (n < 3 ? `-- ${"z".repeat(500)}\n` : `-- ${k}\n`);
    expect(() => splitAligned([lane(sql, { header: sneaky })], { maxBytes: 700 })).toThrow(
      /czesc 2: \d+ B > limit 700 B/,
    );
  });
});

describe("verifySplit - kazda galaz dowodu umie zapalic sie na czerwono", () => {
  const sources = [`${stmt("a", 300)}${stmt("b", 300)}`, `${stmt("a", 300)}${stmt("b", 300)}`];
  const good = splitAligned(
    sources.map((s) => lane(s)),
    { maxBytes: 400 },
  );

  const tamper = (lanes: SplitResult["lanes"], oversize: number[] = []): SplitResult => ({
    ...good,
    lanes,
    oversize,
  });

  it("poprawny podzial nie ma naruszen", () => {
    expect(verifySplit(sources, good, 400)).toEqual([]);
  });

  it("lapie czesc, ktora nie sklada sie w oryginal bajt w bajt", () => {
    const [p0, p1] = good.lanes[0]!;
    const changed = { ...p1!, text: p1!.text.replace("SELECT", "SELECT  ") };
    const problems = verifySplit(sources, tamper([[p0!, changed], good.lanes[1]!]), 400);
    expect(problems).toContain(
      "pas 0: czesci bez naglowkow nie skladaja sie w oryginal bajt w bajt",
    );
  });

  it("lapie rozna liczbe czesci w pasach i czesc bez odpowiednika w pasie 0", () => {
    const lane1 = [...good.lanes[1]!, good.lanes[1]![1]!];
    const problems = verifySplit(sources, tamper([good.lanes[0]!, lane1]), 400);
    expect(problems).toContain("pas 1: 3 czesci wobec 2 w pasie 0");
  });

  it("lapie czesc ponad limitem, chyba ze jest jawnie w `oversize`", () => {
    expect(verifySplit(sources, good, 100).some((p) => p.includes("> limit 100 B"))).toBe(true);
    expect(verifySplit(sources, tamper(good.lanes as SplitResult["lanes"], [0, 1]), 100)).toEqual(
      [],
    );
  });

  const part = (text: string, head = 0, tail = 0) => ({
    text,
    head,
    tail,
    bytes: utf8Length(text),
  });
  const single = (parts: ReturnType<typeof part>[]): SplitResult => ({
    lanes: [parts],
    oversize: [],
    statements: 2,
    firstLines: parts.map(() => 1),
  });

  it("lapie ciecie W SRODKU ciala $$ - odcisk (1) i bajty (2) tego nie widza, struktura (5) tak", () => {
    const src =
      "CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$\nBEGIN\n  PERFORM 1;\n  PERFORM 2;\nEND\n$$;\n";
    const cut = src.indexOf("  PERFORM 2");
    const head = "-- part 2/2\n";
    const result = single([part(src.slice(0, cut)), part(head + src.slice(cut), head.length)]);
    expect(verifySplit([src], result, 1e6)).toEqual([
      expect.stringMatching(
        /^pas 0, czesc 1: MigrationLexError: Niezamkniety cialo \$\$ od linii 1/,
      ),
    ]);
  });

  it("struktura: oryginal, ktory sie nie leksuje, i czesci z brakujaca instrukcja", () => {
    expect(verifySplit(["SELECT 'x"], single([part("SELECT 'x")]), 1e6)).toContain(
      "pas 0: oryginal - MigrationLexError: Niezamkniety literal '...' od linii 1 - nie da sie wyznaczyc granic instrukcji.",
    );
    const src = "SELECT 'a';\nSELECT 'b';\n";
    expect(verifySplit([src], single([part("SELECT 'a';\n")]), 1e6)).toContain(
      "pas 0: czesci niosa 1 instrukcji z 2 instrukcji oryginalu",
    );
  });

  it("struktura: SQL w naglowku, zmieniony literal i instrukcja spoza oryginalu", () => {
    const src = "SELECT 'a';\nSELECT 'b';\n";
    const structure = (problems: string[]) =>
      problems.filter((p) => p.includes("nie jest instrukcja"));
    // Naglowek bez `;` wkleja sie w pierwsza instrukcje czesci - tekst sie zgadza, szkielet nie.
    const head = "-- h\nSELECT 0 AS\n";
    const glued = single([part("SELECT 'a';\n"), part(`${head}SELECT 'b';\n`, head.length)]);
    expect(structure(verifySplit([src], glued, 1e6))).toEqual([
      "pas 0, czesc 2: instrukcja 1 czesci (linia 2) nie jest instrukcja #2 oryginalu - granica czesci nie lezy miedzy instrukcjami najwyzszego poziomu albo naglowek/stopka wkleily sie w instrukcje",
    ]);
    // Inna tresc literalu: szkielet ten sam, tekst nie.
    const changed = single([part("SELECT 'a';\n"), part("SELECT 'B';\n")]);
    expect(structure(verifySplit([src], changed, 1e6))).toHaveLength(1);
    // Instrukcja, ktorej w oryginale nie ma.
    const extra = single([part("SELECT 'a';\n"), part("SELECT 'b';\nSELECT 'c';\n")]);
    expect(structure(verifySplit([src], extra, 1e6))).toEqual([
      expect.stringContaining(
        "czesc 2: instrukcja 2 czesci (linia 2) nie jest instrukcja #3 oryginalu",
      ),
    ]);
  });

  it("lapie czesc k pasa drizzle o innym SQL-u niz czesc k pasa supabase", () => {
    const swapped = [good.lanes[1]![1]!, good.lanes[1]![0]!];
    const problems = verifySplit(sources, tamper([good.lanes[0]!, swapped]), 400);
    expect(problems).toContain("pas 1, czesc 1: SQL wykonywalny rozny od czesci 1 pasa 0");
  });
});
