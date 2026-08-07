// Bramka CI + self-test parserów: katalog intencji i wagi kompletności profilu
// mają JEDNĄ definicję w dwóch językach (SQL i TypeScript).
//
// Dlaczego bramka, a nie „pamiętajmy o tym": wynik kompletności liczą OBA
// światy - baza jako sygnał rankingu katalogu i bramkę kolejki embeddingów,
// klient jako listę „czego brakuje". Rozjazd wag nie psuje kompilacji ani
// testów jednostkowych żadnej strony; psuje wyłącznie zgodność liczby, którą
// widzi użytkownik, z liczbą, która sortuje katalog.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  COMPLETENESS_FN,
  INTENT_CATALOG_FN,
  diffCodeLists,
  diffWeights,
  latestFunctionBody,
  parseCompletenessWeights,
  parseIntentCatalog,
  type MigrationSource,
} from "@/lib/ci/profileDomainParity";
import { PROFILE_INTENT_CODES } from "@/lib/profile/intents";
import {
  PROFILE_COMPLETENESS_FIELDS,
  PROFILE_COMPLETENESS_WEIGHTS,
  profileCompleteness,
  type ProfileCompletenessInput,
} from "@/lib/profile/completeness";

const MIGRATIONS_DIR = "supabase/migrations";

function migrations(): MigrationSource[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => ({ file, sql: readFileSync(join(MIGRATIONS_DIR, file), "utf8") }));
}

describe("parsery bramki (self-test)", () => {
  it("czyta NAJNOWSZĄ definicję funkcji, nie pierwszą", () => {
    const body = latestFunctionBody(
      [
        { file: "a.sql", sql: "CREATE FUNCTION public.f() RETURNS text AS $$ SELECT 'old' $$;" },
        {
          file: "b.sql",
          sql: "CREATE OR REPLACE FUNCTION public.f() RETURNS text AS $$ SELECT 'new' $$;",
        },
      ],
      "f",
    );
    expect(body).toContain("new");
    expect(body).not.toContain("old");
  });

  it("zwraca null dla funkcji, której nie definiuje żadna migracja", () => {
    expect(latestFunctionBody([{ file: "a.sql", sql: "SELECT 1;" }], "nie_ma")).toBeNull();
  });

  it("odsiewa komentarze z literału ARRAY[...] katalogu", () => {
    const codes = parseIntentCatalog(`
      SELECT ARRAY[
        'consortium',   -- konsorcja projektowe
        'media'         -- kontakt dla dziennikarzy
      ]::text[];
    `);
    expect(codes).toEqual(["consortium", "media"]);
  });

  it("czyta wagi ze znaczników weight:<klucz>=<waga>", () => {
    expect(
      parseCompletenessWeights(`
        CASE WHEN x THEN 10 ELSE 0 END  -- weight:avatar=10
      + CASE WHEN y THEN 4 ELSE 0 END   -- weight:education=4
      `),
    ).toEqual({ avatar: 10, education: 4 });
  });

  it("wykrywa rozjazd kolejności przy identycznym zbiorze kodów", () => {
    expect(diffCodeLists(["a", "b"], ["b", "a"])?.orderMismatch).toBe(true);
    expect(diffCodeLists(["a", "b"], ["a", "b"])).toBeNull();
  });

  it("wykrywa różnicę wag i brakujący klucz", () => {
    expect(diffWeights({ a: 1, b: 2 }, { a: 1, b: 3 })).toEqual([{ key: "b", sql: 2, ts: 3 }]);
    expect(diffWeights({ a: 1 }, { a: 1, c: 5 })).toEqual([{ key: "c", sql: null, ts: 5 }]);
  });
});

describe("parytet domeny profilu SQL <-> TypeScript", () => {
  const files = migrations();

  it("katalog kodów intencji jest identyczny (zbiór i kolejność)", () => {
    const body = latestFunctionBody(files, INTENT_CATALOG_FN);
    expect(body, `brak definicji public.${INTENT_CATALOG_FN} w migracjach`).not.toBeNull();
    const sqlCodes = parseIntentCatalog(body ?? "");
    expect(sqlCodes.length).toBeGreaterThan(0);

    const diff = diffCodeLists(sqlCodes, [...PROFILE_INTENT_CODES]);
    expect(
      diff,
      diff
        ? `katalog intencji rozjechany: tylko w SQL [${diff.onlyInSql.join(", ")}], ` +
            `tylko w TS [${diff.onlyInTs.join(", ")}]` +
            (diff.orderMismatch ? ", różna kolejność" : "")
        : "",
    ).toBeNull();
  });

  it("wagi kompletności są identyczne", () => {
    const body = latestFunctionBody(files, COMPLETENESS_FN);
    expect(body, `brak definicji public.${COMPLETENESS_FN} w migracjach`).not.toBeNull();
    const sqlWeights = parseCompletenessWeights(body ?? "");
    expect(Object.keys(sqlWeights).length).toBeGreaterThan(0);

    const drift = diffWeights(sqlWeights, PROFILE_COMPLETENESS_WEIGHTS);
    expect(
      drift,
      drift.length > 0
        ? `wagi kompletności rozjechane: ` +
            drift.map((d) => `${d.key} SQL=${d.sql ?? "-"} TS=${d.ts ?? "-"}`).join("; ")
        : "",
    ).toEqual([]);
  });
});

describe("punktacja kompletności", () => {
  const EMPTY: ProfileCompletenessInput = {
    avatar_url: null,
    display_name: null,
    first_name: null,
    last_name: null,
    job_title: null,
    current_company: null,
    location: null,
    specialization: null,
    bio_pl: null,
    bio_en: null,
    open_to: null,
    seeking_pl: null,
    seeking_en: null,
    skills: 0,
    experiences: 0,
    education: 0,
  };

  it("wagi sumują się do 100", () => {
    const total = PROFILE_COMPLETENESS_FIELDS.reduce(
      (sum, field) => sum + PROFILE_COMPLETENESS_WEIGHTS[field],
      0,
    );
    expect(total).toBe(100);
  });

  it("pusty profil to 0 punktów i ocena thin", () => {
    const status = profileCompleteness(EMPTY);
    expect(status.score).toBe(0);
    expect(status.grade).toBe("thin");
    expect(status.missing).toHaveLength(PROFILE_COMPLETENESS_FIELDS.length);
    // Największa luka prowadzi: bio (14) przed intencją „czego szukam" (12).
    expect(status.nextField).toBe("bio");
    expect(status.nextGain).toBe(14);
  });

  it("pełny profil to 100 punktów, ocena strong i brak podpowiedzi", () => {
    const status = profileCompleteness({
      avatar_url: "https://example.test/a.png",
      display_name: "Anna Kowalska",
      first_name: "Anna",
      last_name: "Kowalska",
      job_title: "Head of EU Affairs",
      current_company: "NES",
      location: "Bruksela",
      specialization: "CBAM",
      bio_pl: "x".repeat(120),
      bio_en: null,
      open_to: ["consortium"],
      seeking_pl: "Szukam partnerow do konsorcjum Horizon w obszarze CBAM i handlu.",
      seeking_en: null,
      skills: 3,
      experiences: 1,
      education: 1,
    });
    expect(status.score).toBe(100);
    expect(status.grade).toBe("strong");
    expect(status.missing).toEqual([]);
    expect(status.nextField).toBeNull();
    expect(status.nextGain).toBe(0);
  });

  it("progi jakościowe działają: krótkie bio i krótka intencja nie liczą się", () => {
    const status = profileCompleteness({
      ...EMPTY,
      bio_pl: "Ekspert.",
      seeking_pl: "Kontaktu.",
      skills: 2,
    });
    expect(status.fields.bio).toBe(false);
    expect(status.fields.seeking).toBe(false);
    expect(status.fields.skills).toBe(false);
    expect(status.score).toBe(0);
  });

  it("imię i nazwisko zastępują display_name", () => {
    const status = profileCompleteness({ ...EMPTY, first_name: "Jan", last_name: "Nowak" });
    expect(status.fields.name).toBe(true);
    expect(status.score).toBe(PROFILE_COMPLETENESS_WEIGHTS.name);
  });

  it("ocena partial zaczyna się od 50 punktów", () => {
    // avatar 10 + nazwa 8 + stanowisko 8 + firma 6 + lokalizacja 6 +
    // specjalizacja 6 + doświadczenie 6 = 50.
    const status = profileCompleteness({
      ...EMPTY,
      avatar_url: "a",
      display_name: "A",
      job_title: "B",
      current_company: "C",
      location: "D",
      specialization: "E",
      experiences: 1,
    });
    expect(status.score).toBe(50);
    expect(status.grade).toBe("partial");
  });
});
