// Kontrakt bramki planu pgTAP + jej self-test na REALNEJ suicie.
//
// Bramka powstała po 2026-08-06, gdy `profiles_verification_guard_test.sql` był
// zlepkiem dwóch suit: `plan(20)` przy 33 asercjach, seed w ŚRODKU pliku (pierwsze
// 17 asercji odwoływało się do fixture'ów, których jeszcze nie było) i dwie
// wzajemnie sprzeczne asercje dla tego samego zapisu. Rozjazd był niewidoczny,
// bo job `pgtap` padał WCZEŚNIEJ - dwie migracje dzieliły wersję 20260806150000,
// a `schema_migrations.version` to klucz główny, więc `supabase db start` nie
// dobiegał do pierwszej asercji z 74 plików (w tym jedynych testów izolacji
// prywatności czatu).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  analyzePgTapFile,
  analyzePgTapPlans,
  isPgTapFileBroken,
  pgTapPlanFailed,
  renderPgTapPlanReport,
  stripDollarQuoted,
  stripSqlLineComments,
} from "@/lib/ci/pgTapPlan";

const TESTS_DIR = "supabase/tests";

function file(sql: string) {
  return analyzePgTapFile("probe_test.sql", sql);
}

describe("liczenie asercji", () => {
  it("liczy każdą funkcję asercyjną raz, niezależnie od zagnieżdżenia argumentów", () => {
    const finding = file(`
      BEGIN;
      SELECT plan(3);
      SELECT ok(EXISTS (SELECT 1 FROM pg_class), 'ok');
      SELECT is((SELECT count(*)::int FROM pg_class), 1, 'is');
      SELECT isnt((SELECT 1), 2, 'isnt');
      SELECT * FROM finish();
      ROLLBACK;
    `);
    expect(finding.counted).toBe(3);
    expect(finding.planned).toBe(3);
    expect(isPgTapFileBroken(finding)).toBe(false);
  });

  it("liczy is_empty/isnt_empty - pgTAP je wykonuje, więc plan je obejmuje", () => {
    // Regresja: `is_empty` nie było na liście funkcji asercyjnych, więc pliki,
    // które go używają, raportowały rozjazd planu nieistniejący w rzeczywistym
    // przebiegu (pięć plików modułu klubów naraz). Gorszy kierunek tej samej
    // luki: plan(N) zawyżony dokładnie o liczbę `is_empty` przechodziłby cicho.
    const finding = file(`
      BEGIN;
      SELECT plan(3);
      SELECT is_empty('SELECT 1 WHERE false', 'nic nie wychodzi');
      SELECT isnt_empty('SELECT 1', 'coś wychodzi');
      SELECT ok(true, 'ok');
      SELECT * FROM finish();
      ROLLBACK;
    `);
    expect(finding.counted).toBe(3);
    expect(isPgTapFileBroken(finding)).toBe(false);
  });

  it("nie liczy nazw zagnieżdżonych ani funkcji aplikacji w argumentach", () => {
    // `isnt(` to JEDNA asercja (nie `is` + `isnt`), `is_definer(` też jedna,
    // a `is_super_admin(` w argumencie `ok(...)` to funkcja aplikacji - nie asercja.
    const finding = file(`
      SELECT plan(3);
      SELECT isnt(1, 2, 'pierwsza');
      SELECT is_definer('public', 'foo', 'druga');
      SELECT ok(public.is_super_admin('00000000-0000-0000-0000-000000000000'), 'trzecia');
      SELECT * FROM finish();
    `);
    expect(finding.counted).toBe(3);
    expect(isPgTapFileBroken(finding)).toBe(false);
  });

  it("nie liczy `ok` wewnątrz throws_ok/lives_ok", () => {
    const finding = file(`
      SELECT plan(2);
      SELECT throws_ok($$ SELECT 1/0 $$, '22012', NULL, 'pierwsza');
      SELECT lives_ok($$ SELECT 1 $$, 'druga');
      SELECT * FROM finish();
    `);
    expect(finding.counted).toBe(2);
  });

  it("nie liczy asercji CYTOWANYCH w komentarzu nagłówka", () => {
    // Nagłówki plików w tym repo obficie cytują naprawiane wzorce - bramka, która
    // by ich nie wycinała, byłaby fałszywie czerwona na własnej dokumentacji.
    const finding = file(`
      -- Ten plik zamienia SELECT ok(...) na SELECT is(...) i dokłada throws_ok(...).
      /* blok: lives_ok(...) też się nie liczy */
      SELECT plan(1);
      SELECT ok(true, 'jedyna asercja');
      SELECT * FROM finish();
    `);
    expect(finding.counted).toBe(1);
  });

  it("nie liczy asercji ze WNĘTRZA zapytania przekazanego do throws_ok", () => {
    const finding = file(`
      SELECT plan(1);
      SELECT throws_ok(
        $$ SELECT is(1, 1, 'to jest treść testowanego zapytania, nie asercja') $$,
        '42501', NULL, 'jedna asercja');
      SELECT * FROM finish();
    `);
    expect(finding.counted).toBe(1);
  });
});

describe("rozjazd planu", () => {
  it("wywala plik, w którym dopisano asercję bez podniesienia planu", () => {
    const finding = file(`
      SELECT plan(1);
      SELECT ok(true, 'pierwsza');
      SELECT ok(true, 'dopisana bez planu');
      SELECT * FROM finish();
    `);
    expect(isPgTapFileBroken(finding)).toBe(true);
    expect(finding.planned).toBe(1);
    expect(finding.counted).toBe(2);
  });

  it("wywala plik bez plan() i plik bez finish()", () => {
    const noPlan = file("SELECT ok(true, 'x');\nSELECT * FROM finish();");
    expect(noPlan.planned).toBeNull();
    expect(isPgTapFileBroken(noPlan)).toBe(true);

    const noFinish = file("SELECT plan(1);\nSELECT ok(true, 'x');");
    expect(noFinish.hasFinish).toBe(false);
    expect(isPgTapFileBroken(noFinish)).toBe(true);
  });

  it("nazywa zlepek dwóch suit dużą różnicą, nie jedną brakującą asercją", () => {
    // Dokładny kształt, który położył profiles_verification_guard_test.sql:
    // dwie suity w jednym pliku, plan z pierwszej.
    const finding = file(`
      SELECT plan(2);
      ${Array.from({ length: 7 }, (_, i) => `SELECT ok(true, 'suita A ${i}');`).join("\n")}
      ${Array.from({ length: 6 }, (_, i) => `SELECT is(1, 1, 'suita B ${i}');`).join("\n")}
      SELECT * FROM finish();
    `);
    expect(finding.planned).toBe(2);
    expect(finding.counted).toBe(13);
    expect(isPgTapFileBroken(finding)).toBe(true);
  });

  it("przepuszcza kanoniczny układ pliku: seed, asercje, doseedowanie, asercje", () => {
    // 26 z 73 plików tej suity przeplata zapisy z asercjami - to poprawny pgTAP
    // i bramka NIE MOŻE tego zgłaszać.
    const finding = file(`
      BEGIN;
      SELECT plan(2);
      ALTER TABLE auth.users DISABLE TRIGGER USER;
      INSERT INTO public.tenants (id, slug, name) VALUES (gen_random_uuid(), 's', 'n');
      SELECT ok(true, 'pierwsza faza');
      INSERT INTO public.tenants (id, slug, name) VALUES (gen_random_uuid(), 's2', 'n2');
      SELECT ok(true, 'druga faza');
      SELECT * FROM finish();
      ROLLBACK;
    `);
    expect(isPgTapFileBroken(finding)).toBe(false);
  });
});

describe("wycinanie tekstu", () => {
  it("stripSqlLineComments zachowuje podział na linie", () => {
    const stripped = stripSqlLineComments("-- a\nSELECT 1;\n/* b\n c */\nSELECT 2;");
    expect(stripped.split("\n")).toHaveLength(5);
    expect(stripped).toContain("SELECT 1;");
    expect(stripped).not.toContain("a");
  });

  it("stripSqlLineComments nie tnie `--` wewnątrz literału", () => {
    const stripped = stripSqlLineComments("SELECT '-- nie komentarz', ok(true);");
    expect(stripped).toContain("-- nie komentarz");
    expect(stripped).toContain("ok(true)");
  });

  it("stripDollarQuoted radzi sobie z tagiem i z niedomkniętym cytatem", () => {
    expect(stripDollarQuoted("a $tag$ ok(1) $tag$ b")).not.toContain("ok(");
    expect(stripDollarQuoted("a $$ ok(1)")).not.toContain("ok(");
  });
});

describe("raport", () => {
  it("nazywa plik, liczby i kierunek naprawy", () => {
    const report = analyzePgTapPlans([
      {
        file: "broken_test.sql",
        sql: "SELECT plan(1); SELECT ok(1); SELECT ok(2); SELECT * FROM finish();",
      },
      { file: "fine_test.sql", sql: "SELECT plan(1); SELECT ok(1); SELECT * FROM finish();" },
    ]);
    expect(pgTapPlanFailed(report)).toBe(true);
    expect(report.checked).toBe(2);

    const rendered = renderPgTapPlanReport(report);
    expect(rendered).toContain("broken_test.sql");
    expect(rendered).not.toContain("fine_test.sql");
    expect(rendered).toContain("podnieś plan do 2");
  });

  it("na czysto raportuje liczbę sprawdzonych plików", () => {
    const report = analyzePgTapPlans([
      { file: "fine_test.sql", sql: "SELECT plan(1); SELECT ok(1); SELECT * FROM finish();" },
    ]);
    expect(pgTapPlanFailed(report)).toBe(false);
    expect(renderPgTapPlanReport(report)).toContain("1 plików");
  });
});

describe("self-test na realnej suicie supabase/tests", () => {
  const sources = readdirSync(TESTS_DIR)
    .filter((entry) => entry.endsWith(".sql"))
    .sort()
    .map((entry) => ({ entry, sql: readFileSync(join(TESTS_DIR, entry), "utf8") }));

  it("suita nie jest pusta (bramka mierzy realne pliki, nie zero plików)", () => {
    expect(sources.length).toBeGreaterThan(50);
  });

  it("KAŻDY plik ma plan(N) zgodny z liczbą asercji oraz finish()", () => {
    const report = analyzePgTapPlans(sources.map((s) => ({ file: s.entry, sql: s.sql })));
    expect(renderPgTapPlanReport(report)).toContain("✓");
    expect(report.findings).toEqual([]);
  });
});
