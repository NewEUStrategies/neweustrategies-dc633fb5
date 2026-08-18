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
  collectFtsFacts,
  isStemless,
  renderFtsSymmetryReport,
  stripSqlComments,
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
    expect(facts.queryBuilders.get("demo_tsquery")).toBe("public.nes_polish");
  });

  it("wiąże kolumnę wektorową z tabelą przez trigger", () => {
    const facts = collectFtsFacts([triggerVectorMigration("public.nes_polish")]);
    expect(facts.vectorColumns.get("demo_messages.search_vector")).toBe("public.nes_polish");
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
    expect(facts.vectorColumns.get("club_replies.search_vector")).toBe("public.nes_polish");
  });

  it("PÓŹNIEJSZA migracja nadpisuje wcześniejszą (jak CREATE OR REPLACE)", () => {
    const facts = collectFtsFacts([
      triggerVectorMigration("simple", "20260901000000_a.sql"),
      triggerVectorMigration("public.nes_polish", "20260902000000_b.sql"),
    ]);
    expect(facts.vectorColumns.get("demo_messages.search_vector")).toBe("public.nes_polish");
  });

  it("rejestruje powierzchnię szukającą z kolumną, zapytaniem i podświetleniem", () => {
    const facts = collectFtsFacts([
      triggerVectorMigration("public.nes_polish"),
      builderMigration("public.nes_polish"),
      searchMigration({ builder: "demo_tsquery", headline: "public.nes_polish" }),
    ]);
    const surface = facts.searchSurfaces.get("demo_search");
    expect(surface?.queryConfigs).toEqual(["public.nes_polish"]);
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

  it("nie ma ANI JEDNEJ asymetrii FTS w migracjach od progu", () => {
    expect(renderFtsSymmetryReport(report)).toContain("OK");
    expect(report.violations).toEqual([]);
  });

  it("faktycznie coś sprawdza - próg nie zjada całego zasięgu", () => {
    expect(report.surfacesChecked).toBeGreaterThan(0);
  });

  it("wyszukiwarka czatu stoi na konfiguracji z fleksją po obu stronach", () => {
    // Dług z 20260720160000: wektor i podświetlenie na `simple` przy nagłówku
    // obiecującym fleksję. Spłacony w 20260815090000 - tu jest przypięty.
    expect(facts.vectorColumns.get("messages.search_vector")).toBe("public.nes_polish");
    expect(facts.queryBuilders.get("nes_polish_tsquery")).toBe("public.nes_polish");
    const surface = facts.searchSurfaces.get("search_messages");
    expect(surface?.queryConfigs).toEqual(["public.nes_polish"]);
    expect(surface?.headlineConfigs).toEqual(["public.nes_polish"]);
  });

  it("próg bramki wskazuje migrację spłacającą dług czatu", () => {
    expect(SYMMETRY_ENFORCED_FROM).toBe("20260815090000");
  });
});
