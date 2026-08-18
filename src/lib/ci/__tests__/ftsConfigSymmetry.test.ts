// Bramka: symetria konfiguracji FTS (wektor <-> zapytanie <-> podświetlenie).
//
// Test ma dwie warstwy i obie są potrzebne:
//   1. JEDNOSTKOWA - syntetyczne migracje dowodzą, że analiza ŁAPIE dokładnie
//      ten defekt, który przeżył siedem wydań audytu (wektor z fleksją,
//      zapytanie bez) i NIE zgłasza fałszywych alarmów na legalnej
//      niesymetrycznej-ale-spójnej powierzchni (`simple` + `simple`).
//   2. BRAMKOWA - ta sama analiza puszczona na PRAWDZIWYM katalogu migracji
//      repo. Bez niej test dowodziłby tylko, że regexpy działają na własnych
//      przykładach.
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  analyzeFtsSymmetry,
  CHAT_FTS_DEBT_PAID_IN,
  collectFtsFacts,
  effectiveScopeFile,
  gateFailed,
  isStemless,
  renderFtsSymmetryReport,
  stripSqlComments,
  surfaceQueryConfigs,
  SYMMETRY_ENFORCED_FROM,
  type MigrationSource,
} from "../ftsConfigSymmetry";

const MIGRATIONS_DIR = resolve(process.cwd(), "supabase/migrations");

function realMigrations(): MigrationSource[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => ({ file, sql: readFileSync(join(MIGRATIONS_DIR, file), "utf8") }));
}

/** Migracja stawiająca kolumnę wektorową przez trigger. */
function triggerVectorMigration(config: string, file = "20260901000000_vector.sql") {
  return {
    file,
    sql: `
CREATE OR REPLACE FUNCTION public.demo_search_vector()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_vector := to_tsvector('${config}', coalesce(NEW.body, ''));
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_demo_search_vector
  BEFORE INSERT OR UPDATE OF body ON public.demo_messages
  FOR EACH ROW EXECUTE FUNCTION public.demo_search_vector();
`,
  };
}

/** Migracja z budowniczym zapytań o zadanej konfiguracji. */
function builderMigration(config: string, file = "20260901000001_builder.sql") {
  return {
    file,
    sql: `
CREATE OR REPLACE FUNCTION public.demo_tsquery(_q text)
RETURNS tsquery LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN to_tsquery('${config}', _q);
END;
$$;
`,
  };
}

/** Migracja z powierzchnią szukającą (zapytanie + podświetlenie). */
function searchMigration(
  options: { builder?: string; queryConfig?: string; headline: string },
  file = "20260901000002_search.sql",
) {
  const queryExpression = options.builder
    ? `public.${options.builder}(_q)`
    : `websearch_to_tsquery('${options.queryConfig}', _q)`;
  return {
    file,
    sql: `
CREATE OR REPLACE FUNCTION public.demo_search(_q text)
RETURNS TABLE (id uuid, snippet text) LANGUAGE sql STABLE AS $$
  WITH tq AS (SELECT ${queryExpression} AS q)
  SELECT m.id,
         ts_headline('${options.headline}', m.body, tq.q) AS snippet
    FROM public.demo_messages m CROSS JOIN tq
   WHERE m.search_vector @@ tq.q;
$$;
`,
  };
}

function analyze(sources: MigrationSource[]) {
  return analyzeFtsSymmetry(collectFtsFacts(sources), "20260901000000");
}

describe("stripSqlComments", () => {
  it("zdejmuje komentarze liniowe i blokowe", () => {
    const stripped = stripSqlComments("SELECT 1; -- komentarz\n/* blok */ SELECT 2;");
    expect(stripped).not.toContain("komentarz");
    expect(stripped).not.toContain("blok");
    expect(stripped).toContain("SELECT 1;");
    expect(stripped).toContain("SELECT 2;");
  });

  it("NIE zdejmuje treści z napisów (podwójny minus w danych)", () => {
    expect(stripSqlComments("SELECT '-- to nie komentarz';")).toContain("-- to nie komentarz");
  });

  it("ZACHOWUJE ciało w cudzysłowach dolarowych - to kod, nie napis", () => {
    const sql = "CREATE FUNCTION f() RETURNS int AS $$ SELECT to_tsvector('simple', 'x') $$;";
    expect(stripSqlComments(sql)).toContain("to_tsvector('simple'");
  });

  it("zdejmuje nagłówek migracji, który KŁAMIE o konfiguracji", () => {
    // To jest sedno defektu z 20.07: nagłówek obiecywał fleksję, kod jej nie miał.
    const sql = "-- FTS z polska fleksja\nSELECT to_tsvector('simple', body);";
    const stripped = stripSqlComments(sql);
    expect(stripped).not.toContain("fleksja");
    expect(stripped).toContain("to_tsvector('simple'");
  });
});

describe("collectFtsFacts", () => {
  it("rozwiązuje budowniczego zapytań na jego konfigurację", () => {
    const facts = collectFtsFacts([builderMigration("public.nes_polish")]);
    expect(facts.queryBuilders.get("demo_tsquery")?.config).toBe("public.nes_polish");
    // Fakt niesie PLIK - zakres bramki liczy z niego datę zależności.
    expect(facts.queryBuilders.get("demo_tsquery")?.file).toBe("20260901000001_builder.sql");
  });

  it("wiąże kolumnę wektorową z tabelą przez trigger", () => {
    const facts = collectFtsFacts([triggerVectorMigration("public.nes_polish")]);
    expect(facts.vectorColumns.get("demo_messages.search_vector")).toEqual({
      config: "public.nes_polish",
      file: "20260901000000_vector.sql",
    });
  });

  it("czyta kolumnę GENERATED ALWAYS AS wprost z definicji tabeli", () => {
    const facts = collectFtsFacts([
      {
        file: "20260901000000_generated.sql",
        sql: `CREATE TABLE public.club_replies (
  body text,
  search_vector tsvector GENERATED ALWAYS AS (to_tsvector('public.nes_polish', coalesce(body, ''))) STORED
);`,
      },
    ]);
    expect(facts.vectorColumns.get("club_replies.search_vector")?.config).toBe("public.nes_polish");
  });

  it("PÓŹNIEJSZA migracja nadpisuje wcześniejszą (jak CREATE OR REPLACE)", () => {
    const facts = collectFtsFacts([
      triggerVectorMigration("simple", "20260901000000_a.sql"),
      triggerVectorMigration("public.nes_polish", "20260902000000_b.sql"),
    ]);
    expect(facts.vectorColumns.get("demo_messages.search_vector")).toEqual({
      config: "public.nes_polish",
      file: "20260902000000_b.sql",
    });
  });

  it("rejestruje powierzchnię szukającą z kolumną, zapytaniem i podświetleniem", () => {
    const facts = collectFtsFacts([
      triggerVectorMigration("public.nes_polish"),
      builderMigration("public.nes_polish"),
      searchMigration({ builder: "demo_tsquery", headline: "public.nes_polish" }),
    ]);
    const surface = facts.searchSurfaces.get("demo_search");
    // Konfiguracja strony zapytania siedzi w BUDOWNICZYM, nie w literale -
    // powierzchnia nosi tylko jego nazwę, wartość rozwiązuje analiza.
    expect(surface?.literalQueryConfigs).toEqual([]);
    expect(surface?.builderNames).toEqual(["demo_tsquery"]);
    expect(surface && surfaceQueryConfigs(surface, facts)).toEqual(["public.nes_polish"]);
    expect(surface?.headlineConfigs).toEqual(["public.nes_polish"]);
    expect(surface?.vectorColumns).toEqual(["demo_messages.search_vector"]);
    expect(surface?.unresolvedVectorRefs).toEqual([]);
    expect(surface?.unresolvedBuilders).toEqual([]);
  });
});

describe("analyzeFtsSymmetry - łapie defekt z 20.07.2026", () => {
  it("ZGŁASZA wektor z fleksją odpytywany bez fleksji", () => {
    const report = analyze([
      triggerVectorMigration("public.nes_polish"),
      searchMigration({ queryConfig: "simple", headline: "simple" }),
    ]);
    expect(report.violations.map((v) => v.kind)).toContain("vector-query-mismatch");
    expect(report.violations[0]?.detail).toContain("public.nes_polish");
    expect(report.violations[0]?.detail).toContain("simple");
  });

  it("ZGŁASZA podświetlenie w innej konfiguracji niż zapytanie", () => {
    const report = analyze([
      triggerVectorMigration("public.nes_polish"),
      builderMigration("public.nes_polish"),
      searchMigration({ builder: "demo_tsquery", headline: "simple" }),
    ]);
    expect(report.violations.map((v) => v.kind)).toContain("query-headline-mismatch");
  });

  it("ZGŁASZA dwie różne konfiguracje na stronie zapytania w jednym ciele", () => {
    const report = analyze([
      triggerVectorMigration("public.nes_polish"),
      {
        file: "20260901000002_mixed.sql",
        sql: `
CREATE OR REPLACE FUNCTION public.demo_search(_q text)
RETURNS TABLE (id uuid) LANGUAGE sql STABLE AS $$
  SELECT m.id FROM public.demo_messages m
   WHERE m.search_vector @@ to_tsquery('public.nes_polish', _q)
      OR m.search_vector @@ plainto_tsquery('simple', _q);
$$;
`,
      },
    ]);
    expect(report.violations.map((v) => v.kind)).toContain("mixed-query-configs");
  });

  it("NIE zgłasza spójnej powierzchni bez fleksji (simple + simple)", () => {
    const report = analyze([
      triggerVectorMigration("simple"),
      searchMigration({ queryConfig: "simple", headline: "simple" }),
    ]);
    expect(report.violations).toEqual([]);
    // Brak fleksji jest DIAGNOZĄ, nie naruszeniem: platforma ma legalną
    // powierzchnię na `simple` z własnym lekkim stemmerem.
    expect(isStemless("simple")).toBe(true);
    expect(isStemless("public.nes_polish")).toBe(false);
  });

  it("NIE zgłasza spójnej powierzchni z fleksją", () => {
    const report = analyze([
      triggerVectorMigration("public.nes_polish"),
      builderMigration("public.nes_polish"),
      searchMigration({ builder: "demo_tsquery", headline: "public.nes_polish" }),
    ]);
    expect(report.violations).toEqual([]);
  });

  it("NIE ocenia migracji starszych niż progowa - historii się nie przepisuje", () => {
    const legacy = analyzeFtsSymmetry(
      collectFtsFacts([
        triggerVectorMigration("public.nes_polish", "20260101000000_old.sql"),
        searchMigration({ queryConfig: "simple", headline: "simple" }, "20260101000001_old.sql"),
      ]),
      "20260901000000",
    );
    expect(legacy.violations).toEqual([]);
    expect(legacy.surfacesChecked).toBe(0);
  });

  it("mówi wprost, czego nie rozstrzygnął, zamiast udawać zieleń", () => {
    const report = analyze([
      triggerVectorMigration("public.nes_polish"),
      searchMigration({ builder: "nieznany_tsquery", headline: "public.nes_polish" }),
    ]);
    expect(report.unresolved.join(" ")).toContain("nieznany_tsquery");
    expect(gateFailed(report)).toBe(true);
  });
});

describe("NIEROZSTRZYGNIĘCIE JEST BŁĘDEM BRAMKI (uwaga z przeglądu, P2)", () => {
  // Pierwsza wersja raportowała „OK", gdy tylko lista NARUSZEŃ była pusta -
  // więc powierzchnia, której konfiguracji analizator nie odczytał, przechodziła
  // CI bez sprawdzenia symetrii. Bramka, która nie widzi, musi zatrzymać CI.
  it("nieznany budowniczy zapytań objęty zakresem CZERWIENI bramkę", () => {
    const report = analyze([
      triggerVectorMigration("public.nes_polish"),
      searchMigration({ builder: "nieznany_tsquery", headline: "public.nes_polish" }),
    ]);
    expect(report.violations).toEqual([]);
    expect(report.unresolved.join(" ")).toContain("nieznany_tsquery");
    expect(gateFailed(report)).toBe(true);
  });

  it("raport NIE ogłasza zieleni, gdy czegoś nie rozstrzygnął", () => {
    const report = analyze([
      triggerVectorMigration("public.nes_polish"),
      searchMigration({ builder: "nieznany_tsquery", headline: "public.nes_polish" }),
    ]);
    const rendered = renderFtsSymmetryReport(report);
    expect(rendered).not.toContain("OK");
    expect(rendered).toContain("NIEROZSTRZYGNIETE");
    // Raport ma powiedzieć, CO zrobić - inaczej czytający nie wie, czy to
    // awaria kodu, czy ograniczenie analizatora.
    expect(rendered).toContain("Rozszerz analizator");
  });

  it("wektor, którego budowy bramka nie widziała, też czerwieni", () => {
    const report = analyze([
      // Sama powierzchnia, bez żadnej migracji budującej wektor.
      searchMigration({ queryConfig: "public.nes_polish", headline: "public.nes_polish" }),
    ]);
    expect(report.unresolved.join(" ")).toContain("wektor: demo_messages.search_vector");
    expect(gateFailed(report)).toBe(true);
  });

  it("czysta powierzchnia NIE czerwieni bramki", () => {
    const report = analyze([
      triggerVectorMigration("public.nes_polish"),
      builderMigration("public.nes_polish"),
      searchMigration({ builder: "demo_tsquery", headline: "public.nes_polish" }),
    ]);
    expect(gateFailed(report)).toBe(false);
    expect(renderFtsSymmetryReport(report)).toContain("OK");
  });

  it("wbudowane `websearch_to_tsquery` NIE jest nieznanym budowniczym", () => {
    // Pierwsza wersja allowlisty używała wzorca
    // `^(?:to|plainto|websearch|phraseto)_tsquery$`, który NIE dopasowywał
    // `websearch_to_tsquery` - dwie realne wyszukiwarki klubów lądowały
    // w `unresolved`, a po zaostrzeniu bramki byłby to fałszywy alarm.
    const facts = collectFtsFacts([
      triggerVectorMigration("public.nes_polish"),
      searchMigration({ queryConfig: "public.nes_polish", headline: "public.nes_polish" }),
    ]);
    const surface = facts.searchSurfaces.get("demo_search");
    expect(surface?.unresolvedBuilders).toEqual([]);
    expect(surface && surfaceQueryConfigs(surface, facts)).toEqual(["public.nes_polish"]);
  });
});

describe("ZAKRES LICZONY Z ZALEŻNOŚCI (uwaga z przeglądu, P2)", () => {
  // Sama data definicji funkcji nie wystarcza: nowa migracja może przebudować
  // wektor i zepsuć STARĄ funkcję szukającą, która po własnej dacie wypadłaby
  // z zakresu bramki.
  const OLD_SEARCH = "20260101000002_search.sql";
  const OLD_VECTOR = "20260101000000_vector.sql";
  const OLD_BUILDER = "20260101000001_builder.sql";
  const THRESHOLD = "20260901000000";

  it("stara powierzchnia ze starymi zależnościami zostaje POZA zakresem", () => {
    const facts = collectFtsFacts([
      triggerVectorMigration("public.nes_polish", OLD_VECTOR),
      builderMigration("public.nes_polish", OLD_BUILDER),
      searchMigration({ builder: "demo_tsquery", headline: "public.nes_polish" }, OLD_SEARCH),
    ]);
    const surface = facts.searchSurfaces.get("demo_search");
    expect(surface && effectiveScopeFile(surface, facts)).toBe(OLD_SEARCH);
    expect(analyzeFtsSymmetry(facts, THRESHOLD).surfacesChecked).toBe(0);
  });

  it("NOWA migracja przebudowująca WEKTOR wciąga starą powierzchnię w zakres i łapie asymetrię", () => {
    const facts = collectFtsFacts([
      triggerVectorMigration("public.nes_polish", OLD_VECTOR),
      builderMigration("public.nes_polish", OLD_BUILDER),
      searchMigration({ builder: "demo_tsquery", headline: "public.nes_polish" }, OLD_SEARCH),
      // Ktoś przebudował wektor na `simple` - funkcja szukająca została stara.
      triggerVectorMigration("simple", "20260902000000_rebuild.sql"),
    ]);
    const surface = facts.searchSurfaces.get("demo_search");
    expect(surface && effectiveScopeFile(surface, facts)).toBe("20260902000000_rebuild.sql");

    const report = analyzeFtsSymmetry(facts, THRESHOLD);
    expect(report.surfacesChecked).toBe(1);
    expect(report.violations.map((v) => v.kind)).toContain("vector-query-mismatch");
    // Komunikat wskazuje MIGRACJĘ, która przebudowała wektor - bez tego
    // czytający szukałby winnego w starej funkcji.
    expect(report.violations[0]?.detail).toContain("20260902000000_rebuild.sql");
    expect(gateFailed(report)).toBe(true);
  });

  it("NOWA migracja zmieniająca BUDOWNICZEGO też wciąga starą powierzchnię w zakres", () => {
    const facts = collectFtsFacts([
      triggerVectorMigration("public.nes_polish", OLD_VECTOR),
      builderMigration("public.nes_polish", OLD_BUILDER),
      searchMigration({ builder: "demo_tsquery", headline: "public.nes_polish" }, OLD_SEARCH),
      // Budowniczy przestawiony na `simple` - wektor został z fleksją.
      builderMigration("simple", "20260903000000_builder.sql"),
    ]);
    const surface = facts.searchSurfaces.get("demo_search");
    expect(surface && effectiveScopeFile(surface, facts)).toBe("20260903000000_builder.sql");

    const report = analyzeFtsSymmetry(facts, THRESHOLD);
    expect(report.surfacesChecked).toBe(1);
    expect(report.violations.map((v) => v.kind)).toContain("vector-query-mismatch");
  });
});

describe("aliasy CTE", () => {
  // Wyszukiwarki tej platformy porównują wektor przez CTE (`base.search_vector`
  // nad `posts`, `visible.search_vector` nad `club_threads`). Bez rozwiązania
  // CTE bramka zgłaszałaby „nie rozstrzygnąłem" dla KAŻDEJ realnej wyszukiwarki.
  it("rozwiązuje CTE po jawnej projekcji kolumny wektora", () => {
    const facts = collectFtsFacts([
      triggerVectorMigration("public.nes_polish"),
      {
        file: "20260901000002_cte.sql",
        sql: `
CREATE OR REPLACE FUNCTION public.demo_search(_q text)
RETURNS TABLE (id uuid) LANGUAGE sql STABLE AS $$
  WITH base AS (
    SELECT m.id, m.search_vector FROM public.demo_messages m WHERE m.id IS NOT NULL
  )
  SELECT b.id FROM base b
   WHERE b.search_vector @@ websearch_to_tsquery('public.nes_polish', _q);
$$;
`,
      },
    ]);
    const surface = facts.searchSurfaces.get("demo_search");
    expect(surface?.vectorColumns).toEqual(["demo_messages.search_vector"]);
    expect(surface?.unresolvedVectorRefs).toEqual([]);
  });

  it("rozwiązuje CTE po gwiazdce aliasu (`t.*`)", () => {
    const facts = collectFtsFacts([
      triggerVectorMigration("public.nes_polish"),
      {
        file: "20260901000002_cte.sql",
        sql: `
CREATE OR REPLACE FUNCTION public.demo_search(_q text)
RETURNS TABLE (id uuid) LANGUAGE sql STABLE AS $$
  WITH visible AS (
    SELECT t.* FROM public.demo_messages t WHERE t.id IS NOT NULL
  )
  SELECT v.id FROM visible v
   WHERE v.search_vector @@ websearch_to_tsquery('public.nes_polish', _q);
$$;
`,
      },
    ]);
    expect(facts.searchSurfaces.get("demo_search")?.vectorColumns).toEqual([
      "demo_messages.search_vector",
    ]);
  });

  it("aliasu, którego NIE UMIE rozwiązać, nie zgaduje - mówi wprost", () => {
    // Podzapytanie z własnym aliasem (`FROM (SELECT …) x`) nie jest tabelą ani
    // CTE. Bramka nie ma prawa zgadywać, że `x` to `demo_messages` - ma
    // powiedzieć „nie wiem" i zatrzymać CI (uwaga z przeglądu, P2).
    const facts = collectFtsFacts([
      triggerVectorMigration("public.nes_polish"),
      {
        file: "20260901000002_subquery.sql",
        sql: `
CREATE OR REPLACE FUNCTION public.demo_search(_q text)
RETURNS TABLE (id uuid) LANGUAGE sql STABLE AS $$
  SELECT x.id FROM (SELECT id, search_vector FROM public.demo_messages) x
   WHERE x.search_vector @@ websearch_to_tsquery('public.nes_polish', _q);
$$;
`,
      },
    ]);
    const surface = facts.searchSurfaces.get("demo_search");
    expect(surface?.vectorColumns).toEqual([]);
    expect(surface?.unresolvedVectorRefs).toEqual(["x.search_vector"]);

    const report = analyzeFtsSymmetry(facts, "20260901000000");
    expect(report.unresolved).toEqual(["demo_search (alias: x.search_vector)"]);
    expect(gateFailed(report)).toBe(true);
    expect(renderFtsSymmetryReport(report)).not.toContain("OK");
  });

  it("CTE nie przesłania REALNEJ tabeli o tej samej nazwie", () => {
    const facts = collectFtsFacts([
      triggerVectorMigration("public.nes_polish"),
      {
        file: "20260901000002_cte.sql",
        sql: `
CREATE OR REPLACE FUNCTION public.demo_search(_q text)
RETURNS TABLE (id uuid) LANGUAGE sql STABLE AS $$
  SELECT m.id FROM public.demo_messages m
   WHERE m.search_vector @@ websearch_to_tsquery('public.nes_polish', _q);
$$;
`,
      },
    ]);
    expect(facts.searchSurfaces.get("demo_search")?.vectorColumns).toEqual([
      "demo_messages.search_vector",
    ]);
  });
});

describe("budowniczy WEKTORÓW (`RETURNS tsvector`)", () => {
  // `posts` i `pages` nie wołają `to_tsvector` w triggerze - wołają funkcję
  // pomocniczą. Bez tej ścieżki cztery realne wyszukiwarki treści były dla
  // bramki nieczytelne, a nieczytelna powierzchnia objęta zakresem to od
  // zaostrzenia bramki czerwone CI.
  function helperVectorMigration(config: string, file = "20260901000000_vector.sql") {
    return {
      file,
      sql: `
CREATE OR REPLACE FUNCTION public.nes_demo_search_vector(_body text)
RETURNS tsvector LANGUAGE sql IMMUTABLE AS $$
  SELECT setweight(to_tsvector('${config}', coalesce(_body, '')), 'A');
$$;
CREATE OR REPLACE FUNCTION public.demo_search_vector()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_vector := public.nes_demo_search_vector(NEW.body);
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_demo_search_vector
  BEFORE INSERT OR UPDATE OF body ON public.demo_messages
  FOR EACH ROW EXECUTE FUNCTION public.demo_search_vector();
`,
    };
  }

  it("rozwiązuje kolumnę przez funkcję pomocniczą", () => {
    const facts = collectFtsFacts([helperVectorMigration("public.nes_polish")]);
    expect(facts.vectorBuilders.get("nes_demo_search_vector")?.config).toBe("public.nes_polish");
    expect(facts.vectorColumns.get("demo_messages.search_vector")?.config).toBe(
      "public.nes_polish",
    );
  });

  it("łapie asymetrię ukrytą W FUNKCJI POMOCNICZEJ, nie w triggerze", () => {
    const report = analyze([
      helperVectorMigration("public.nes_polish"),
      searchMigration({ queryConfig: "simple", headline: "simple" }),
    ]);
    expect(report.violations.map((v) => v.kind)).toContain("vector-query-mismatch");
  });

  it("PRZESTAWIENIE funkcji pomocniczej przesuwa datę zależności kolumny", () => {
    // Bez tego migracja ruszająca tylko pomocnika nie ruszała daty kolumny,
    // więc stara powierzchnia zostawała poza zakresem - ta sama pułapka,
    // którą `effectiveScopeFile` zamyka po stronie powierzchni.
    const facts = collectFtsFacts([
      helperVectorMigration("public.nes_polish", "20260101000000_vector.sql"),
      helperVectorMigration("simple", "20260905000000_rebuild.sql"),
    ]);
    const fact = facts.vectorColumns.get("demo_messages.search_vector");
    expect(fact?.config).toBe("simple");
    expect(fact?.file).toBe("20260905000000_rebuild.sql");
  });

  it("ZGŁASZA kolumnę zszytą z DWÓCH konfiguracji jako naruszenie, nie lukę", () => {
    const report = analyze([
      {
        file: "20260901000000_vector.sql",
        sql: `
CREATE OR REPLACE FUNCTION public.demo_search_vector()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_vector :=
    to_tsvector('public.nes_polish', coalesce(NEW.title, '')) ||
    to_tsvector('simple', coalesce(NEW.body, ''));
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_demo_search_vector
  BEFORE INSERT OR UPDATE ON public.demo_messages
  FOR EACH ROW EXECUTE FUNCTION public.demo_search_vector();
`,
      },
      searchMigration({ queryConfig: "public.nes_polish", headline: "public.nes_polish" }),
    ]);
    expect(report.violations.map((v) => v.kind)).toContain("mixed-vector-configs");
    expect(report.violations[0]?.detail).toContain("simple");
    expect(report.violations[0]?.detail).toContain("public.nes_polish");
    expect(gateFailed(report)).toBe(true);
  });

  it("wektora budowanego przez NIEZNANĄ funkcję nie udaje, że zna", () => {
    const report = analyze([
      {
        file: "20260901000000_vector.sql",
        sql: `
CREATE OR REPLACE FUNCTION public.demo_search_vector()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_vector := external.magic_search_vector(NEW.body);
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_demo_search_vector
  BEFORE INSERT OR UPDATE ON public.demo_messages
  FOR EACH ROW EXECUTE FUNCTION public.demo_search_vector();
`,
      },
      searchMigration({ queryConfig: "public.nes_polish", headline: "public.nes_polish" }),
    ]);
    expect(report.violations).toEqual([]);
    expect(report.unresolved).toEqual(["demo_search (wektor: demo_messages.search_vector)"]);
    expect(gateFailed(report)).toBe(true);
  });
});

describe("wiązanie triggerów z tabelami", () => {
  it("dwa triggery W JEDNYM PLIKU trafiają do WŁASNYCH tabel", () => {
    // Regresja własna: wzorzec biegł przez cały plik i brał tabelę
    // z PIERWSZEGO `CREATE TRIGGER`, więc druga kolumna nadpisywała pierwszą.
    const facts = collectFtsFacts([
      {
        file: "20260901000000_two.sql",
        sql: `
CREATE OR REPLACE FUNCTION public.posts_refresh()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_vector := to_tsvector('simple', coalesce(NEW.body, ''));
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.pages_refresh()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_vector := to_tsvector('public.nes_polish', coalesce(NEW.body, ''));
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS posts_tg ON public.demo_posts;
CREATE TRIGGER posts_tg BEFORE INSERT ON public.demo_posts
  FOR EACH ROW EXECUTE FUNCTION public.posts_refresh();
DROP TRIGGER IF EXISTS pages_tg ON public.demo_pages;
CREATE TRIGGER pages_tg BEFORE INSERT ON public.demo_pages
  FOR EACH ROW EXECUTE FUNCTION public.pages_refresh();
`,
      },
    ]);
    expect(facts.vectorColumns.get("demo_posts.search_vector")?.config).toBe("simple");
    expect(facts.vectorColumns.get("demo_pages.search_vector")?.config).toBe("public.nes_polish");
  });

  it("JEDNA funkcja triggera na DWÓCH tabelach buduje obie kolumny", () => {
    const facts = collectFtsFacts([
      {
        file: "20260901000000_shared.sql",
        sql: `
CREATE OR REPLACE FUNCTION public.shared_refresh()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_vector := to_tsvector('public.nes_polish', coalesce(NEW.body, ''));
  RETURN NEW;
END;
$$;
CREATE TRIGGER a_tg BEFORE INSERT ON public.demo_a
  FOR EACH ROW EXECUTE FUNCTION public.shared_refresh();
CREATE TRIGGER b_tg BEFORE INSERT ON public.demo_b
  FOR EACH ROW EXECUTE PROCEDURE public.shared_refresh();
`,
      },
    ]);
    expect(facts.vectorColumns.get("demo_a.search_vector")?.config).toBe("public.nes_polish");
    expect(facts.vectorColumns.get("demo_b.search_vector")?.config).toBe("public.nes_polish");
  });
});

describe("KOLEJNOŚĆ definicji nie decyduje o rozstrzygnięciu", () => {
  it("powierzchnia zdefiniowana PRZED swoim budowniczym nadal jest rozstrzygnięta", () => {
    // Ciało plpgsql nie jest walidowane przy tworzeniu, więc taka kolejność
    // jest legalna. Jednoprzebiegowa klasyfikacja wrzucała ją w `unresolved`,
    // czyli w czerwone CI za poprawną migrację.
    const facts = collectFtsFacts([
      triggerVectorMigration("public.nes_polish", "20260901000000_vector.sql"),
      searchMigration(
        { builder: "demo_tsquery", headline: "public.nes_polish" },
        "20260901000001_search.sql",
      ),
      builderMigration("public.nes_polish", "20260901000002_builder.sql"),
    ]);
    const surface = facts.searchSurfaces.get("demo_search");
    expect(surface?.unresolvedBuilders).toEqual([]);
    expect(surface?.builderNames).toEqual(["demo_tsquery"]);
    expect(surface && surfaceQueryConfigs(surface, facts)).toEqual(["public.nes_polish"]);
    expect(gateFailed(analyzeFtsSymmetry(facts, "20260901000000"))).toBe(false);
  });

  it("łańcuch CTE nad CTE też prowadzi do realnej tabeli", () => {
    const facts = collectFtsFacts([
      triggerVectorMigration("public.nes_polish"),
      {
        file: "20260901000002_chain.sql",
        sql: `
CREATE OR REPLACE FUNCTION public.demo_search(_q text)
RETURNS TABLE (id uuid) LANGUAGE sql STABLE AS $$
  WITH raw AS (
    SELECT m.* FROM public.demo_messages m
  ), visible AS (
    SELECT r.* FROM raw r WHERE r.id IS NOT NULL
  )
  SELECT v.id FROM visible v
   WHERE v.search_vector @@ websearch_to_tsquery('public.nes_polish', _q);
$$;
`,
      },
    ]);
    expect(facts.searchSurfaces.get("demo_search")?.vectorColumns).toEqual([
      "demo_messages.search_vector",
    ]);
  });
});

describe("renderFtsSymmetryReport", () => {
  it("raportuje zasięg i zieleń", () => {
    const rendered = renderFtsSymmetryReport({
      violations: [],
      unresolved: [],
      surfacesChecked: 3,
    });
    expect(rendered).toContain("3");
    expect(rendered).toContain("OK");
  });

  it("wypisuje każde naruszenie z plikiem i funkcją", () => {
    const rendered = renderFtsSymmetryReport({
      violations: [
        {
          kind: "vector-query-mismatch",
          fn: "search_messages",
          file: "20260901000000_x.sql",
          detail: "wektor messages.search_vector budowany w 'public.nes_polish'",
        },
      ],
      unresolved: ["foo (bar)"],
      surfacesChecked: 1,
    });
    expect(rendered).toContain("vector-query-mismatch");
    expect(rendered).toContain("search_messages");
    expect(rendered).toContain("20260901000000_x.sql");
    expect(rendered).toContain("foo (bar)");
  });
});

describe("BRAMKA: prawdziwe migracje repo", () => {
  const facts = collectFtsFacts(realMigrations());
  const report = analyzeFtsSymmetry(facts);

  it("nie ma ANI JEDNEJ asymetrii FTS ani nierozstrzygnięcia w migracjach od progu", () => {
    // `gateFailed` obejmuje OBA warunki - samo „violations puste" przepuszczało
    // powierzchnię, której bramka nie sprawdziła (uwaga z przeglądu, P2).
    expect(renderFtsSymmetryReport(report)).toContain("OK");
    expect(report.violations).toEqual([]);
    expect(report.unresolved).toEqual([]);
    expect(gateFailed(report)).toBe(false);
  });

  it("sprawdza WSZYSTKIE powierzchnie szukające repo, nie tylko czat", () => {
    // Zasięg bramki jest jej wartością: liczba tu MUSI równać się liczbie
    // wykrytych powierzchni, inaczej część wyszukiwarek nie jest kryta.
    expect(report.surfacesChecked).toBe(facts.searchSurfaces.size);
    expect(facts.searchSurfaces.size).toBeGreaterThanOrEqual(7);
    expect([...facts.searchSurfaces.keys()]).toEqual(
      expect.arrayContaining([
        "search_posts",
        "search_quick",
        "search_facets",
        "search_messages",
        "run_saved_search_alerts",
        "club_search",
        "club_thread_search",
      ]),
    );
  });

  it("czyta wektor `posts` przez funkcję pomocniczą, nie tylko przez literał", () => {
    // `posts_search_vector_refresh` woła `public.nes_posts_search_vector(…)`;
    // konfiguracja siedzi WEWNĄTRZ tej funkcji. Bez tej ścieżki cztery
    // wyszukiwarki treści były dla bramki nieczytelne.
    expect(facts.vectorBuilders.get("nes_posts_search_vector")?.config).toBe("simple");
    expect(facts.vectorColumns.get("posts.search_vector")?.config).toBe("simple");
  });

  it("wiąże `pages` z WŁASNYM triggerem, choć stoi w pliku obok `posts`", () => {
    // Regresja własna: wzorzec biegnący przez cały plik brał tabelę
    // z PIERWSZEGO `CREATE TRIGGER`, więc wektor `pages` lądował pod kluczem
    // `posts.search_vector`, a `pages.search_vector` nie istniała dla bramki.
    expect(facts.vectorColumns.get("pages.search_vector")?.config).toBe("simple");
  });

  it("żadna realna kolumna nie jest zszyta z dwóch konfiguracji", () => {
    expect([...facts.mixedVectorColumns.keys()]).toEqual([]);
  });

  it("wyszukiwarki klubów czyta przez CTE - obie są rozstrzygnięte", () => {
    expect(facts.searchSurfaces.get("club_search")?.unresolvedVectorRefs).toEqual([]);
    expect(facts.searchSurfaces.get("club_thread_search")?.unresolvedVectorRefs).toEqual([]);
  });

  it("wyszukiwarka czatu stoi na konfiguracji z fleksją po obu stronach", () => {
    // Dług z 20260720160000: wektor i podświetlenie na `simple` przy nagłówku
    // obiecującym fleksję. Spłacony w 20260815090000 - tu jest przypięty.
    expect(facts.vectorColumns.get("messages.search_vector")?.config).toBe("public.nes_polish");
    expect(facts.queryBuilders.get("nes_polish_tsquery")?.config).toBe("public.nes_polish");
    const surface = facts.searchSurfaces.get("search_messages");
    expect(surface && surfaceQueryConfigs(surface, facts)).toEqual(["public.nes_polish"]);
    expect(surface?.headlineConfigs).toEqual(["public.nes_polish"]);
  });

  it("próg NIE wyłącza żadnej powierzchni - obejmuje całą historię", () => {
    // Próg został po to, żeby dało się zawęzić zakres, gdyby kiedyś wjechał
    // legacy import. Dziś obejmuje wszystko - i test tego pilnuje, bo cichy
    // powrót progu skasowałby zasięg bramki bez ani jednego czerwonego testu.
    expect(SYMMETRY_ENFORCED_FROM).toBe("00000000000000");
    expect(CHAT_FTS_DEBT_PAID_IN).toBe("20260815090000");
    expect(analyzeFtsSymmetry(facts, CHAT_FTS_DEBT_PAID_IN).surfacesChecked).toBeLessThan(
      report.surfacesChecked,
    );
  });
});
