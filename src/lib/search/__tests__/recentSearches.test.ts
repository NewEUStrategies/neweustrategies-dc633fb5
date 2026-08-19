// Historia wyszukiwań w localStorage. Trzy funkcje, każda z ramieniem
// obronnym, i wszystkie trzy ramiona były do dziś niewykonane (58,3% gałęzi
// przy 100% funkcji - klasyczny obraz pokrycia ubocznego).
//
// DLACZEGO TE RAMIONA MAJĄ ZNACZENIE. Moduł jest wołany podczas RENDERU strony
// wyszukiwarki i widgetu nagłówka. Rzut z `localStorage` - a rzuca on realnie:
// tryb prywatny Safari, wyczerpany limit, zablokowane ciasteczka firmowe -
// wywróciłby stronę, a nie tylko listę ostatnich fraz. Ta sama zasada dotyczy
// treści zapisanej przez STARSZĄ wersję aplikacji: klucz `recent-searches:v1`
// przeżywa wdrożenia, więc kod musi znieść dowolny JSON, jaki tam zastanie.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  addRecentSearch,
  clearRecentSearches,
  getRecentSearches,
} from "@/lib/search/recentSearches";

const KEY = "recent-searches:v1";
const read = () => window.localStorage.getItem(KEY);

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getRecentSearches", () => {
  it("bez zapisanej historii zwraca pustą listę", () => {
    expect(getRecentSearches()).toEqual([]);
  });

  it("czyta zapisane frazy w kolejności zapisu", () => {
    window.localStorage.setItem(KEY, JSON.stringify(["gaz", "ropa"]));
    expect(getRecentSearches()).toEqual(["gaz", "ropa"]);
  });

  it("USZKODZONY JSON nie wywraca strony - historia po prostu jest pusta", () => {
    window.localStorage.setItem(KEY, "{to nie jest json");
    expect(getRecentSearches()).toEqual([]);
  });

  it("wartość INNEGO KSZTAŁTU (starsza wersja modelu) jest ignorowana", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ ostatnie: ["gaz"] }));
    expect(getRecentSearches()).toEqual([]);
  });

  it("wpisy niebędące napisami są ODSIEWANE, reszta zostaje", () => {
    window.localStorage.setItem(KEY, JSON.stringify(["gaz", 42, null, "ropa", { q: "x" }]));
    expect(getRecentSearches()).toEqual(["gaz", "ropa"]);
  });

  it("PRZYCINA do sześciu pozycji, nawet gdy w magazynie jest ich więcej", () => {
    window.localStorage.setItem(KEY, JSON.stringify(["1", "2", "3", "4", "5", "6", "7", "8"]));
    expect(getRecentSearches()).toEqual(["1", "2", "3", "4", "5", "6"]);
  });

  it("NIEDOSTĘPNY magazyn (tryb prywatny) daje pustą listę, a nie rzut", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => getRecentSearches()).not.toThrow();
    expect(getRecentSearches()).toEqual([]);
  });
});

describe("addRecentSearch", () => {
  it("dopisuje frazę na POCZĄTEK - ostatnia wyszukiwana jest najbliżej", () => {
    addRecentSearch("gaz");
    addRecentSearch("ropa");
    expect(getRecentSearches()).toEqual(["ropa", "gaz"]);
  });

  it("przycina frazę przed zapisem", () => {
    addRecentSearch("  gaz ziemny  ");
    expect(getRecentSearches()).toEqual(["gaz ziemny"]);
  });

  it("IGNORUJE frazy krótsze niż dwa znaki - historia to nie literówki", () => {
    addRecentSearch("g");
    addRecentSearch(" ");
    addRecentSearch("");
    expect(getRecentSearches()).toEqual([]);
  });

  it("POWTÓRZONA fraza wskakuje na górę, zamiast dublować wpis", () => {
    addRecentSearch("gaz");
    addRecentSearch("ropa");
    addRecentSearch("gaz");
    expect(getRecentSearches()).toEqual(["gaz", "ropa"]);
  });

  it("powtórzenie jest NIEWRAŻLIWE NA WIELKOŚĆ LITER", () => {
    addRecentSearch("Gaz Ziemny");
    addRecentSearch("gaz ziemny");
    expect(getRecentSearches()).toEqual(["gaz ziemny"]);
  });

  it("trzyma sufit sześciu pozycji, wypychając najstarszą", () => {
    for (const q of ["a1", "a2", "a3", "a4", "a5", "a6", "a7"]) addRecentSearch(q);
    const out = getRecentSearches();
    expect(out).toHaveLength(6);
    expect(out[0]).toBe("a7");
    expect(out).not.toContain("a1");
  });

  it("NIEDOSTĘPNY magazyn nie wywraca zapisu frazy", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => addRecentSearch("gaz")).not.toThrow();
  });
});

describe("clearRecentSearches", () => {
  it("usuwa historię z magazynu, a nie tylko z widoku", () => {
    addRecentSearch("gaz");
    expect(read()).not.toBeNull();
    clearRecentSearches();
    expect(read()).toBeNull();
    expect(getRecentSearches()).toEqual([]);
  });

  it("czyszczenie pustej historii jest bezpiecznym no-opem", () => {
    expect(() => clearRecentSearches()).not.toThrow();
  });

  it("NIEDOSTĘPNY magazyn nie wywraca czyszczenia", () => {
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => clearRecentSearches()).not.toThrow();
  });
});
