// Treść testowa: jedna reguła dla meta robots, map strony, llms.txt,
// podpowiedzi wyszukiwarki, zapisu stron i migracji SQL.
//
// CO MA TU DOWÓD:
//   1. wzorzec łapie CAŁY pierwszy człon slugu (`test`, `test-*`, `test_*`,
//      `e2e`, `e2e-*`), a nie słowa, które tylko zaczynają się tymi literami
//      (`testament`, `testy-nato`) - fałszywy alarm wyciąłby z indeksu treść,
//   2. reguła „strona albo przodek" działa po segmentach ścieżki,
//   3. wpis jest testowy WYŁĄCZNIE przez sekcję, nie przez własny slug,
//   4. migracje SQL niosą DOKŁADNIE ten sam wzorzec (rozjazd = baza
//      odpublikowuje inne strony niż te, które aplikacja wyklucza).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  TEST_CONTENT_SLUG_PATTERN,
  isTestContentPath,
  isTestContentSlug,
  isTestContentTrail,
  testPageNeedsNoindex,
} from "../testContent";

describe("isTestContentSlug", () => {
  it.each([
    "test",
    "test-e2e-zakup",
    "test-e2e-zakup-2",
    "test_druk",
    "e2e",
    "e2e-kongres",
    "TEST-x",
  ])("%s to treść testowa", (slug) => expect(isTestContentSlug(slug)).toBe(true));

  it.each([
    "testament",
    "testy-nato",
    "testowanie-ai",
    "e2ee",
    "kontest",
    "o-nas",
    "",
    null,
    undefined,
  ])("%s NIE jest treścią testową", (slug) => expect(isTestContentSlug(slug)).toBe(false));
});

describe("isTestContentPath", () => {
  it("dowolny segment ścieżki rozstrzyga (strona albo przodek)", () => {
    expect(isTestContentPath("test/podstrona")).toBe(true);
    expect(isTestContentPath("/sekcja/e2e-kongres/agenda")).toBe(true);
    expect(isTestContentPath("/en/test-e2e-zakup")).toBe(true);
    expect(isTestContentPath("https://example.com/test?x=1")).toBe(true);
  });

  it("zwykłe ścieżki i prefiks języka nie są treścią testową", () => {
    expect(isTestContentPath("/en/analizy/testament")).toBe(false);
    expect(isTestContentPath("/o-nas?ref=test")).toBe(false);
    expect(isTestContentPath("")).toBe(false);
    expect(isTestContentPath(null)).toBe(false);
  });
});

describe("isTestContentTrail", () => {
  it("strona: własny slug albo okruszek przodka", () => {
    expect(isTestContentTrail("page", "test-e2e-zakup", [])).toBe(true);
    expect(isTestContentTrail("page", "agenda", [{ slug: "test" }, { slug: "agenda" }])).toBe(true);
    expect(isTestContentTrail("page", "o-nas", [{ slug: "o-nas" }])).toBe(false);
  });

  it("wpis: wyłącznie sekcja - artykuł o teście rakietowym nie jest testowy", () => {
    expect(isTestContentTrail("post", "test-rakietowy-korei", [{ slug: "analizy" }])).toBe(false);
    expect(isTestContentTrail("post", "artykul", [{ slug: "test" }])).toBe(true);
  });
});

describe("testPageNeedsNoindex", () => {
  const base = { status: "published", seoNoindex: false, slug: "o-nas", parentPath: null };

  it("publiczna strona testowa (slug albo przodek) wymaga noindex", () => {
    expect(testPageNeedsNoindex({ ...base, slug: "test-e2e-zakup" })).toBe(true);
    expect(testPageNeedsNoindex({ ...base, parentPath: "test" })).toBe(true);
    expect(testPageNeedsNoindex({ ...base, status: "scheduled", slug: "e2e-x" })).toBe(true);
  });

  it("szkic, archiwum, strona już noindex i zwykła strona - bez wymuszenia", () => {
    expect(testPageNeedsNoindex({ ...base, status: "draft", slug: "test" })).toBe(false);
    expect(testPageNeedsNoindex({ ...base, status: "archived", slug: "test" })).toBe(false);
    expect(testPageNeedsNoindex({ ...base, seoNoindex: true, slug: "test" })).toBe(false);
    expect(testPageNeedsNoindex(base)).toBe(false);
  });
});

describe("parytet wzorca z migracjami SQL", () => {
  const sqlLiteral = `'${TEST_CONTENT_SLUG_PATTERN}'`;

  it.each([
    "supabase/migrations/20261011090100_event_seed_test_pages_noindex.sql",
    "supabase/migrations/20261011090200_unpublish_test_pages.sql",
  ])("%s używa tego samego wzorca (bez rozróżniania wielkości liter)", (file) => {
    const sql = readFileSync(file, "utf8");
    expect(sql).toContain(`~* ${sqlLiteral}`);
  });
});
