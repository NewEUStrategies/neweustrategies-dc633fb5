// Model stanu URL katalogu osób - jeden walidator dla trzech wejść (adres
// w przeglądarce, snapshot zapisanego wyszukiwania z bazy, lustro nazw
// parametrów w gałęzi `people` producenta alertów).
//
// Test pilnuje własności, które realnie psują funkcję, a nie kompilację:
// kanonizacji flag (dwa adresy o tym samym znaczeniu = jeden wpis w cache'u
// zapytań), odsiewu nieznanych kodów intencji (URL nie może wprowadzić
// wartości, której `search_people` nie przyjmie) i tego, że sam przełącznik
// trybu semantycznego NIE czyni ze stanu wyszukiwania wartego zapisania.
import { describe, expect, it } from "vitest";
import {
  clearedPeopleFacets,
  hasPeopleFacetFilters,
  isPeopleSearchSaveable,
  parsePeopleSearchParams,
} from "@/lib/profile/peopleSearchParams";

describe("parsePeopleSearchParams", () => {
  it("czysty adres daje pusty stan (brak pól, nie pola z pustymi stringami)", () => {
    expect(parsePeopleSearchParams({})).toEqual({
      q: undefined,
      specialization: undefined,
      company: undefined,
      location: undefined,
      role: undefined,
      open: undefined,
      verified: undefined,
      sem: undefined,
    });
  });

  it("przycina białe znaki i traktuje puste pole jak brak filtra", () => {
    expect(parsePeopleSearchParams({ q: "  CBAM  ", company: "   " })).toMatchObject({
      q: "CBAM",
      company: undefined,
    });
  });

  it("odrzuca wartości nie-stringowe zamiast wpuszczać je do zapytania", () => {
    expect(
      parsePeopleSearchParams({ q: 42, specialization: null, location: { a: 1 } }),
    ).toMatchObject({ q: undefined, specialization: undefined, location: undefined });
  });

  it("kanonizuje flagi do postaci '1'", () => {
    expect(parsePeopleSearchParams({ verified: "true", sem: true })).toMatchObject({
      verified: "1",
      sem: "1",
    });
    expect(parsePeopleSearchParams({ verified: "0", sem: "yes" })).toMatchObject({
      verified: undefined,
      sem: undefined,
    });
  });

  it("preserves canonical flags through the router's URL serializer and parser", async () => {
    const { defaultParseSearch, defaultStringifySearch } = await import("@tanstack/react-router");
    const expected = parsePeopleSearchParams({ verified: "1", sem: true });
    expect(parsePeopleSearchParams(defaultParseSearch(defaultStringifySearch(expected)))).toEqual(
      expected,
    );
    expect(parsePeopleSearchParams({ verified: 0, sem: 2 })).toMatchObject({
      verified: undefined,
      sem: undefined,
    });
  });

  it("odsiewa nieznane kody intencji i porządkuje resztę wg katalogu", () => {
    expect(parsePeopleSearchParams({ open: "media,banana,consortium" }).open).toBe(
      "consortium,media",
    );
    expect(parsePeopleSearchParams({ open: "banana" }).open).toBeUndefined();
  });

  it("jest idempotentny (kanoniczne wejście = kanoniczne wyjście)", () => {
    const once = parsePeopleSearchParams({ q: "cbam", open: "media,consortium", sem: true });
    expect(parsePeopleSearchParams({ ...once })).toEqual(once);
  });
});

describe("hasPeopleFacetFilters", () => {
  it("fraza sama nie jest filtrem fasetowym", () => {
    expect(hasPeopleFacetFilters({ q: "cbam" })).toBe(false);
  });

  it("każda faseta liczy się osobno", () => {
    expect(hasPeopleFacetFilters({ specialization: "CBAM" })).toBe(true);
    expect(hasPeopleFacetFilters({ open: "consortium" })).toBe(true);
    expect(hasPeopleFacetFilters({ verified: "1" })).toBe(true);
  });

  it("tryb semantyczny nie jest filtrem", () => {
    expect(hasPeopleFacetFilters({ sem: "1" })).toBe(false);
  });
});

describe("isPeopleSearchSaveable", () => {
  it("fraza albo faseta czyni stan wartym zapisania", () => {
    expect(isPeopleSearchSaveable({ q: "cbam" })).toBe(true);
    expect(isPeopleSearchSaveable({ open: "consortium" })).toBe(true);
  });

  it("sam przełącznik trybu semantycznego to jeszcze nie wyszukiwanie", () => {
    expect(isPeopleSearchSaveable({ sem: "1" })).toBe(false);
    expect(isPeopleSearchSaveable({})).toBe(false);
  });
});

describe("clearedPeopleFacets", () => {
  it("zeruje wszystkie fasety i NIE dotyka frazy ani trybu", () => {
    const cleared = clearedPeopleFacets();
    expect(hasPeopleFacetFilters({ ...cleared })).toBe(false);
    expect(cleared).not.toHaveProperty("q");
    expect(cleared).not.toHaveProperty("sem");
  });
});
