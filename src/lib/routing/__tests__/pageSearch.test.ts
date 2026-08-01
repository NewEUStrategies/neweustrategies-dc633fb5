// Kontrakt URL-a paginacji (?page=N) współdzielony przez stronę główną
// w trybie "najnowsze wpisy" i /blog: wartości domyślne zostają niejawne
// (kanoniczny adres bez parametrów), śmieciowe wejście znika zamiast mnożyć
// warianty cache CDN i klucze zapytań.
import { describe, expect, it } from "vitest";
import { parsePageSearch } from "@/lib/routing/pageSearch";

describe("parsePageSearch", () => {
  it("brak parametru i strona 1 zostają niejawne (czysty kanoniczny URL)", () => {
    expect(parsePageSearch({})).toEqual({});
    expect(parsePageSearch({ page: 1 })).toEqual({});
    expect(parsePageSearch({ page: "1" })).toEqual({});
  });

  it("strony > 1 przechodzą jako liczby całkowite (floor)", () => {
    expect(parsePageSearch({ page: 2 })).toEqual({ page: 2 });
    expect(parsePageSearch({ page: "7" })).toEqual({ page: 7 });
    expect(parsePageSearch({ page: 3.9 })).toEqual({ page: 3 });
  });

  it("śmieciowe wejście znika z adresu", () => {
    expect(parsePageSearch({ page: "abc" })).toEqual({});
    expect(parsePageSearch({ page: -4 })).toEqual({});
    expect(parsePageSearch({ page: 0 })).toEqual({});
    expect(parsePageSearch({ page: Infinity })).toEqual({});
    expect(parsePageSearch({ page: null })).toEqual({});
    expect(parsePageSearch({ page: {} })).toEqual({});
  });

  it("nie przenosi obcych parametrów do stanu wyszukiwania", () => {
    expect(parsePageSearch({ page: 2, utm_source: "x" })).toEqual({ page: 2 });
  });
});
