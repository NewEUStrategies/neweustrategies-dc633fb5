// Kontrakt bramki odtwarzalności migracji + jej self-test na REALNYM katalogu.
//
// Bramka powstała po incydencie 2026-08-03, w którym `supabase db start` padał
// DWA RAZY z dwóch różnych powodów, jeden ukryty za drugim:
//   1. trzy pliki dzieliły wersję 20260803090000 -> schema_migrations_pkey,
//   2. dwie migracje miały wykonywane `DELETE FROM storage.objects` bez GUC
//      `storage.allow_delete_query` -> 42501.
// Za każdym razem padały joby pgtap/e2e/e2e-seeded ZANIM cokolwiek się uruchomiło,
// a żadna migracja po feralnej nie była już walidowana. Audyt rekomendował bramkę
// wersji od trzech wydań (korekta 5, P1).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  analyzeMigrationReplay,
  hasUnguardedStorageWrite,
  migrationReplayFailed,
  renderMigrationReplayReport,
  stripFunctionBodies,
  validateTwinLedger,
  type KnownContentTwin,
} from "@/lib/ci/migrationReplay";

const MIGRATIONS_DIR = "supabase/migrations";

describe("inwariant wersji", () => {
  it("przechodzi dla unikalnych, rosnących wersji", () => {
    const report = analyzeMigrationReplay([
      "20260101000000_a.sql",
      "20260101000001_b.sql",
      "20260102000000_c.sql",
    ]);
    expect(report.total).toBe(3);
    expect(migrationReplayFailed(report)).toBe(false);
    expect(renderMigrationReplayReport(report)).toContain("✓");
  });

  it("łapie DOKŁADNIE tę kolizję, która przewróciła CI (trzy pliki, jedna wersja)", () => {
    const report = analyzeMigrationReplay([
      "20260803090000_harden_enqueue_notification_acl.sql",
      "20260803090000_link_monitor_archive_and_alerts.sql",
      "20260803090000_payment_orders_gdpr_retention.sql",
    ]);
    expect(migrationReplayFailed(report)).toBe(true);
    expect(report.duplicates.get("20260803090000")).toHaveLength(3);
    const rendered = renderMigrationReplayReport(report);
    expect(rendered).toContain("KLUCZ GŁÓWNY");
    // Raport musi POWIEDZIEĆ, jak naprawić - inaczej bramka tylko blokuje.
    expect(rendered).toContain("przenumeruj");
  });

  it("wskazuje wszystkie pliki kolizji, nie tylko drugi", () => {
    const report = analyzeMigrationReplay(["20260101000000_a.sql", "20260101000000_b.sql"]);
    expect(report.duplicates.get("20260101000000")).toEqual([
      "20260101000000_a.sql",
      "20260101000000_b.sql",
    ]);
  });

  it("zgłasza nazwę bez parsowalnej wersji", () => {
    const report = analyzeMigrationReplay(["init.sql", "2026_short.sql"]);
    expect(report.unparsable).toEqual(["2026_short.sql", "init.sql"]);
    expect(migrationReplayFailed(report)).toBe(true);
    expect(renderMigrationReplayReport(report)).toContain("14 cyfr");
  });

  it("ignoruje kolejność wejścia - analiza sortuje sama", () => {
    const a = analyzeMigrationReplay(["20260102000000_b.sql", "20260101000000_a.sql"]);
    const b = analyzeMigrationReplay(["20260101000000_a.sql", "20260102000000_b.sql"]);
    expect(migrationReplayFailed(a)).toBe(false);
    expect(a).toEqual(b);
  });
});

describe("stripFunctionBodies", () => {
  it("wycina ciało funkcji, zostawia to, co migracja WYKONUJE", () => {
    const sql = `
      GRANT SELECT ON t TO anon;
      CREATE OR REPLACE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$
      BEGIN DELETE FROM storage.objects; END $$;
      DO $$ BEGIN PERFORM 1; END $$;
    `;
    const out = stripFunctionBodies(sql);
    expect(out).toContain("GRANT SELECT");
    expect(out).toContain("DO $$");
    expect(out).not.toContain("DELETE FROM storage.objects");
  });

  it("radzi sobie ze znacznikiem nazwanym ($fn$), nie tylko $$", () => {
    const sql = `CREATE FUNCTION g() RETURNS void AS $fn$ DELETE FROM storage.objects; $fn$;`;
    expect(stripFunctionBodies(sql)).not.toContain("storage.objects");
  });

  it("nie gubi treści, gdy w pliku nie ma żadnej funkcji", () => {
    const sql = "ALTER TABLE t ADD COLUMN x int;";
    expect(stripFunctionBodies(sql)).toBe(sql);
  });
});

describe("inwariant zapisów do storage.objects", () => {
  it("zgłasza WYKONYWANY DELETE bez furtki (defekt 20260803085428 / 20260803120000)", () => {
    const sql = `
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'tts-cache') THEN
          DELETE FROM storage.objects WHERE bucket_id = 'tts-cache';
        END IF;
      END $$;
    `;
    expect(hasUnguardedStorageWrite(sql)).toBe(true);
  });

  it("nie zgłasza tego samego DELETE z sankcjonowaną furtką", () => {
    const sql = `
      DO $$
      DECLARE v_prev text;
      BEGIN
        v_prev := current_setting('storage.allow_delete_query', true);
        PERFORM set_config('storage.allow_delete_query', 'true', true);
        DELETE FROM storage.objects WHERE bucket_id = 'tts-cache';
        PERFORM set_config('storage.allow_delete_query', coalesce(v_prev,'false'), true);
      END $$;
    `;
    expect(hasUnguardedStorageWrite(sql)).toBe(false);
  });

  it("NIE zgłasza DELETE w ciele funkcji - tam nie wykonuje się przy migracji", () => {
    // Dokładnie kształt 20260712190000 / 20260712192421: bramka fałszywie
    // czerwona na tych plikach czyniłaby ją nieużywalną.
    const sql = `
      CREATE OR REPLACE FUNCTION public.tg_purge() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER AS $$
      BEGIN
        DELETE FROM storage.objects WHERE bucket_id = 'chat-attachments';
        RETURN OLD;
      END;
      $$;
    `;
    expect(hasUnguardedStorageWrite(sql)).toBe(false);
  });

  it("łapie też UPDATE, nie tylko DELETE", () => {
    expect(hasUnguardedStorageWrite("UPDATE storage.objects SET name = 'x';")).toBe(true);
  });

  it("nie reaguje na migracje, które storage.objects w ogóle nie dotykają", () => {
    expect(hasUnguardedStorageWrite("INSERT INTO storage.buckets (id) VALUES ('b');")).toBe(false);
  });

  it("raport mówi, jak naprawić, i odnotowuje wyjątek dla ciała funkcji", () => {
    const report = analyzeMigrationReplay(
      ["20260101000000_a.sql"],
      [{ file: "20260101000000_a.sql", sql: "DELETE FROM storage.objects;" }],
    );
    expect(migrationReplayFailed(report)).toBe(true);
    const rendered = renderMigrationReplayReport(report);
    expect(rendered).toContain("storage.allow_delete_query");
    expect(rendered).toContain("CREATE FUNCTION");
  });
});

describe("self-test na realnym katalogu supabase/migrations", () => {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  const sources = files.map((file) => ({
    file,
    sql: readFileSync(join(MIGRATIONS_DIR, file), "utf8"),
  }));

  it("katalog nie jest pusty (bramka bez wejścia byłaby zawsze zielona)", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("ŻADNA wersja się nie powtarza", () => {
    const report = analyzeMigrationReplay(files, sources);
    expect(
      [...report.duplicates.entries()].map(([v, g]) => `${v}: ${g.join(", ")}`),
      "zduplikowana wersja = supabase db start pada na schema_migrations_pkey",
    ).toEqual([]);
  });

  it("ŻADNA migracja nie zapisuje do storage.objects bez furtki", () => {
    const report = analyzeMigrationReplay(files, sources);
    expect(
      report.unguardedStorageWrites,
      "niezabezpieczony zapis = supabase db start pada na 42501",
    ).toEqual([]);
  });

  it("nazwy są parsowalne i porządek nazw = porządek wersji", () => {
    const report = analyzeMigrationReplay(files, sources);
    expect(report.unparsable).toEqual([]);
    expect(report.outOfOrder).toEqual([]);
  });

  // Asercja zbiorcza MUSI stać osobno, a nie jako trzecia linia testu wyżej.
  // Stała tam i skutek był dokładnie taki, jakiego można się było spodziewać:
  // gdy w katalogu pojawiły się dwie bliźniacze migracje z panelu, padał test
  // o nazwie „nazwy są parsowalne i porządek nazw = porządek wersji" - mimo że
  // `unparsable` i `outOfOrder` były PUSTE. Raport bramki mówił prawdę, ale
  // nazwa czerwonego testu kierowała diagnozę na zupełnie inny inwariant.
  // Tu nazwa nie obiecuje niczego poza tym, co asercja naprawdę mierzy.
  it("bramka jako całość jest zielona na realnym katalogu", () => {
    const report = analyzeMigrationReplay(files, sources);
    expect(
      migrationReplayFailed(report),
      `bramka czerwona - patrz KTÓRY inwariant:\n${renderMigrationReplayReport(report)}`,
    ).toBe(false);
  });
});

describe("inwariant bliźniaków treści", () => {
  const twin = "CREATE TABLE IF NOT EXISTS public.x (id uuid PRIMARY KEY);";

  it("łapie tę samą migrację wpuszczoną dwa razy pod różnymi nazwami", () => {
    const files = ["20260101000000_pisana_w_pr.sql", "20260101000001_wygenerowana.sql"];
    const report = analyzeMigrationReplay(files, [
      { file: files[0], sql: `-- nagłówek z PR-a\n${twin}` },
      { file: files[1], sql: twin },
    ]);

    expect(report.contentTwins).toEqual([[files[0], files[1]]]);
    expect(migrationReplayFailed(report)).toBe(true);
    expect(renderMigrationReplayReport(report)).toContain("DWA RAZY");
  });

  it("nie myli różnych migracji o podobnym kształcie", () => {
    const files = ["20260101000000_a.sql", "20260101000001_b.sql"];
    const report = analyzeMigrationReplay(files, [
      { file: files[0], sql: "CREATE TABLE public.a (id uuid);" },
      { file: files[1], sql: "CREATE TABLE public.b (id uuid);" },
    ]);

    expect(report.contentTwins).toEqual([]);
    expect(migrationReplayFailed(report)).toBe(false);
  });

  it("pomija pliki, z których po odjęciu komentarzy nic nie zostaje", () => {
    const files = ["20260101000000_a.sql", "20260101000001_b.sql"];
    const report = analyzeMigrationReplay(files, [
      { file: files[0], sql: "-- tylko komentarz" },
      { file: files[1], sql: "/* też nic */" },
    ]);

    expect(report.contentTwins).toEqual([]);
    expect(migrationReplayFailed(report)).toBe(false);
  });

  // Ta klasa błędu POŁOŻYŁA CI w sierpniu 2026: dwie migracje zdjęły wariant
  // dwuargumentowy `redeem_gift_link` i obie utworzyły trzyargumentowy. Na bazie
  // już zmigrowanej nic się nie dzieje - błąd wychodzi dopiero przy odtwarzaniu
  // schematu od zera, czyli w jobie pgtap.
  it("łapie CREATE FUNCTION dla sygnatury utworzonej przez wcześniejszą migrację", () => {
    const report = analyzeMigrationReplay(
      ["20260101000000_a.sql", "20260101000001_b.sql"],
      [
        {
          file: "20260101000000_a.sql",
          sql: "DROP FUNCTION IF EXISTS public.f(uuid, text);\nCREATE FUNCTION public.f(a uuid, b text, c uuid DEFAULT NULL) RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;",
        },
        {
          file: "20260101000001_b.sql",
          sql: "DROP FUNCTION IF EXISTS public.f(uuid, text);\nCREATE FUNCTION public.f(a uuid, b text, c uuid DEFAULT NULL) RETURNS void LANGUAGE sql AS $$ SELECT 2 $$;",
        },
      ],
    );

    expect(report.recreatedFunctions).toEqual([
      { signature: "f/3", file: "20260101000001_b.sql", earlier: "20260101000000_a.sql" },
    ]);
    expect(migrationReplayFailed(report)).toBe(true);
  });

  it("zdjęcie DOKŁADNIE tej sygnatury w tym samym pliku jest legalne", () => {
    // Tak zmienia się typ zwracany, którego CREATE OR REPLACE nie przepuszcza.
    const report = analyzeMigrationReplay(
      ["20260101000000_a.sql", "20260101000001_b.sql"],
      [
        {
          file: "20260101000000_a.sql",
          sql: "CREATE FUNCTION public.f(a uuid) RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;",
        },
        {
          file: "20260101000001_b.sql",
          sql: "DROP FUNCTION IF EXISTS public.f(uuid);\nCREATE FUNCTION public.f(a uuid) RETURNS integer LANGUAGE sql AS $$ SELECT 2 $$;",
        },
      ],
    );

    expect(report.recreatedFunctions).toEqual([]);
    expect(migrationReplayFailed(report)).toBe(false);
  });

  it("arność liczy przecinki na poziomie zero, nie wszystkie", () => {
    // numeric(10,2) i DEFAULT z przecinkiem w literale nie mogą zawyżać arności,
    // bo to ona jest całym kluczem tożsamości sygnatury.
    const report = analyzeMigrationReplay(
      ["20260101000000_a.sql", "20260101000001_b.sql"],
      [
        {
          file: "20260101000000_a.sql",
          sql: "CREATE FUNCTION public.f(a numeric(10,2), b text DEFAULT 'x,y') RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;",
        },
        {
          file: "20260101000001_b.sql",
          sql: "CREATE FUNCTION public.f(a numeric(10,2), b text DEFAULT 'x,y') RETURNS void LANGUAGE sql AS $$ SELECT 2 $$;",
        },
      ],
    );

    expect(report.recreatedFunctions.map((r) => r.signature)).toEqual(["f/2"]);
  });

  it("znana para jest raportowana z wpisem rejestru, nie samą nazwą", () => {
    // Bramka ma umieć powiedzieć nie tylko CO jest długiem, ale i skąd się wziął.
    const files = ["20260101000000_a.sql", "20260102000000_b.sql"];
    const ledger: KnownContentTwin[] = [
      {
        files: [files[0], files[1]],
        deployment: "PR #1",
        appliedOn: "2026-01-02",
        rationale: "obie wersje w ledgerze",
      },
    ];
    const report = analyzeMigrationReplay(
      files,
      [
        { file: files[0], sql: twin },
        { file: files[1], sql: twin },
      ],
      ledger,
    );

    expect(report.contentTwins).toEqual([]);
    expect(report.knownContentTwins).toHaveLength(1);
    expect(report.knownContentTwins[0].entry.deployment).toBe("PR #1");
    expect(migrationReplayFailed(report)).toBe(false);
    expect(renderMigrationReplayReport(report)).toContain("dług: PR #1 (2026-01-02)");
  });

  it("ratchet: lista znanego długu odzwierciedla stan repo", () => {
    const repoFiles = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
    const repoSources = repoFiles.map((file) => ({
      file,
      sql: readFileSync(join(MIGRATIONS_DIR, file), "utf8"),
    }));
    const report = analyzeMigrationReplay(repoFiles, repoSources);
    expect(
      report.contentTwins,
      "nowa para bliźniaków - usuń wygenerowany duplikat przed wdrożeniem",
    ).toEqual([]);
    expect(
      report.staleKnownTwins,
      "wpis KNOWN_CONTENT_TWINS bez pokrycia w repo - lista może tylko maleć",
    ).toEqual([]);
    expect(
      report.recreatedFunctions,
      "CREATE FUNCTION dla istniejącej sygnatury - replay od zera padnie na 42723",
    ).toEqual([]);
    expect(
      report.twinLedgerDefects,
      "rejestr długu niespójny sam ze sobą - patrz validateTwinLedger",
    ).toEqual([]);
  });
});

// Rejestr długu jest DANYMI, a dane bez walidacji gniją w jedną stronę. Przez
// pierwsze wydania nośnikiem była płaska lista kluczy, więc wymagana doktryną
// „decyzja operatora + DOWÓD zastosowania" mieszkała w komentarzach - i jeden
// z nich („Wdrożenie PR #191") przeżył wpis, którego dotyczył. Te testy pilnują,
// żeby każde pole wpisu było albo weryfikowalne, albo wymagane.
describe("inwariant rejestru bliźniaków (validateTwinLedger)", () => {
  const entry: KnownContentTwin = {
    files: ["20260101000000_a.sql", "20260102000000_b.sql"],
    deployment: "PR #1",
    appliedOn: "2026-01-02",
    rationale: "obie wersje w `schema_migrations`, SQL idempotentny",
  };

  it("przepuszcza wpis kompletny", () => {
    expect(validateTwinLedger([entry])).toEqual([]);
  });

  it("REALNY rejestr repo jest spójny", () => {
    // Bez wejścia z katalogu: rejestr to stała, jego poprawność nie zależy
    // od tego, co akurat leży w supabase/migrations.
    expect(analyzeMigrationReplay([]).twinLedgerDefects).toEqual([]);
  });

  it("zgłasza nazwę spoza konwencji migracji", () => {
    const defects = validateTwinLedger([{ ...entry, files: ["init.sql", "20260102000000_b.sql"] }]);
    expect(defects.map((d) => d.problem).join(" ")).toContain("konwencji nazw");
  });

  it("zgłasza parę wskazującą dwa razy ten sam plik", () => {
    const defects = validateTwinLedger([
      {
        ...entry,
        files: ["20260101000000_a.sql", "20260101000000_a.sql"],
        appliedOn: "2026-01-01",
      },
    ]);
    expect(defects).toHaveLength(1);
    expect(defects[0].problem).toContain("dwa razy ten sam plik");
  });

  it("zgłasza parę zapisaną malejąco - klucz musi być kanoniczny", () => {
    const defects = validateTwinLedger([
      { ...entry, files: ["20260102000000_b.sql", "20260101000000_a.sql"] },
    ]);
    expect(defects.map((d) => d.problem).join(" ")).toContain("nie stoją rosnąco");
  });

  it("zgłasza wpis powtórzony", () => {
    const defects = validateTwinLedger([entry, entry]);
    expect(defects.map((d) => d.problem)).toContain("wpis powtórzony w rejestrze");
  });

  it("zgłasza rejestr nieposortowany - inaczej diffy rosną, a wpisy się gubią", () => {
    const later: KnownContentTwin = {
      ...entry,
      files: ["20260301000000_c.sql", "20260302000000_d.sql"],
      appliedOn: "2026-03-02",
    };
    expect(
      validateTwinLedger([later, entry])
        .map((d) => d.problem)
        .join(" "),
    ).toContain("nie jest posortowany");
    expect(validateTwinLedger([entry, later])).toEqual([]);
  });

  it("nie przepuszcza wpisu bez decyzji operatora ani bez wdrożenia", () => {
    expect(validateTwinLedger([{ ...entry, rationale: "   " }])[0].problem).toContain("rationale");
    expect(validateTwinLedger([{ ...entry, deployment: "" }])[0].problem).toContain("deployment");
  });

  it("konfrontuje `appliedOn` z wersją PÓŹNIEJSZEGO pliku pary", () => {
    // Jedyne pole opisowe, które da się sprawdzić z rzeczywistością - i jest.
    expect(validateTwinLedger([{ ...entry, appliedOn: "2.01.2026" }])[0].problem).toContain(
      "poza formatem",
    );
    expect(validateTwinLedger([{ ...entry, appliedOn: "2026-01-01" }])[0].problem).toContain(
      "rozjeżdża się z wersją",
    );
  });

  it("wada rejestru CZERWIENI bramkę i mówi, jak ją naprawić", () => {
    const report = analyzeMigrationReplay([], [], [{ ...entry, rationale: "" }]);
    expect(migrationReplayFailed(report)).toBe(true);
    const rendered = renderMigrationReplayReport(report);
    expect(rendered).toContain("niespójny sam ze sobą");
    expect(rendered).toContain("appliedOn");
  });
});
