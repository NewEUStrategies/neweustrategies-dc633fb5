// Dowody dla indeksu dokumentów prawnych i przełącznika.
//
// Trzy klasy regresji, które ten plik zamyka:
//
// 1. ROZJAZD INDEKS <-> REJESTR. Ścieżki żyją teraz w `documentIndex`, a treść
//    w `registry`. Gdyby ktoś zmienił adres w jednym miejscu, przełącznik
//    prowadziłby na 404, a strona renderowałaby się normalnie - defekt
//    niewidoczny na ekranie dokumentu, w który się patrzy.
//
// 2. DOKUMENT WYPADAJĄCY Z KOKPITU. Nowy dokument dopisany do rejestru bez
//    wpisu w indeksie istniałby pod własnym adresem, ale nie dałoby się do
//    niego przejść z żadnej innej strony prawnej.
//
// 3. ZGUBIONY JĘZYK. Przełącznik na /en musi prowadzić do /en pozostałych
//    dokumentów. Rozjazd tutaj wyrzuca czytelnika EN na polską wersję.
import { describe, it, expect } from "vitest";
import {
  LEGAL_DOC_GROUPS,
  LEGAL_DOC_INDEX,
  legalDocIndexEntry,
  resolveLegalNav,
} from "../documentIndex";
import { LEGAL_DOCS } from "../registry";
import { LEGAL_DOC_KEYS } from "../types";

const ALL_ITEMS = (pathname: string) => resolveLegalNav(pathname).groups.flatMap((g) => g.items);

describe("indeks dokumentów prawnych", () => {
  it("pokrywa DOKŁADNIE zbiór kluczy dokumentów - ani mniej, ani więcej", () => {
    expect([...LEGAL_DOC_INDEX.map((e) => e.key)].sort()).toEqual([...LEGAL_DOC_KEYS].sort());
  });

  it("nie ma dwóch dokumentów pod tym samym adresem", () => {
    const paths = LEGAL_DOC_INDEX.map((e) => e.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("każdy adres jest ścieżką bezwzględną bez końcowego ukośnika", () => {
    for (const entry of LEGAL_DOC_INDEX) {
      expect(entry.path.startsWith("/")).toBe(true);
      expect(entry.path.endsWith("/")).toBe(false);
    }
  });

  it("każdy dokument należy do zadeklarowanej grupy", () => {
    const groupIds = new Set(LEGAL_DOC_GROUPS.map((g) => g.id));
    for (const entry of LEGAL_DOC_INDEX) {
      expect(groupIds.has(entry.group)).toBe(true);
    }
  });

  it("żadna zadeklarowana grupa nie jest pusta", () => {
    for (const group of LEGAL_DOC_GROUPS) {
      expect(LEGAL_DOC_INDEX.some((e) => e.group === group.id)).toBe(true);
    }
  });

  it("rzuca na nieznanym kluczu zamiast oddać undefined", () => {
    // @ts-expect-error - celowo klucz spoza unii: to jest ten błąd, który ma
    // się wywrócić przy imporcie rejestru, a nie po cichu dać `undefined`.
    expect(() => legalDocIndexEntry("nie-ma-takiego")).toThrow(/LEGAL_DOC_INDEX/);
  });
});

describe("indeks kontra rejestr - jedno źródło prawdy", () => {
  it("rejestr niesie ścieżki i etykiety dokładnie z indeksu", () => {
    for (const entry of LEGAL_DOC_INDEX) {
      const fromRegistry = LEGAL_DOCS[entry.key];
      expect(fromRegistry.path).toBe(entry.path);
      expect(fromRegistry.labelPl).toBe(entry.labelPl);
      expect(fromRegistry.labelEn).toBe(entry.labelEn);
    }
  });
});

describe("przełącznik dokumentów", () => {
  it("wystawia wszystkie trzynaście dokumentów niezależnie od tego, na którym stoi", () => {
    expect(ALL_ITEMS("/polityka-prywatnosci")).toHaveLength(LEGAL_DOC_KEYS.length);
    expect(ALL_ITEMS("/statut")).toHaveLength(LEGAL_DOC_KEYS.length);
  });

  it("zaznacza dokładnie jedną pozycję - tę spod bieżącego adresu", () => {
    const nav = resolveLegalNav("/rodo");
    expect(nav.activeKey).toBe("rodo");
    expect(ALL_ITEMS("/rodo").filter((i) => i.active)).toHaveLength(1);
    expect(ALL_ITEMS("/rodo").find((i) => i.active)?.key).toBe("rodo");
  });

  it("rozpoznaje adres z końcowym ukośnikiem", () => {
    expect(resolveLegalNav("/rodo/").activeKey).toBe("rodo");
  });

  it("pod PL prowadzi do adresów bez prefiksu i podaje polskie etykiety", () => {
    const nav = resolveLegalNav("/polityka-prywatnosci");
    expect(nav.lang).toBe("pl");
    expect(nav.label).toBe("Dokumenty prawne");
    const rodo = ALL_ITEMS("/polityka-prywatnosci").find((i) => i.key === "rodo");
    expect(rodo?.href).toBe("/rodo");
    expect(rodo?.label).toBe("RODO - Twoje prawa");
  });

  it("pod /en prowadzi do /en pozostałych dokumentów i podaje angielskie etykiety", () => {
    const nav = resolveLegalNav("/en/polityka-prywatnosci");
    expect(nav.lang).toBe("en");
    expect(nav.activeKey).toBe("privacy");
    expect(nav.label).toBe("Legal documents");
    const rodo = ALL_ITEMS("/en/polityka-prywatnosci").find((i) => i.key === "rodo");
    expect(rodo?.href).toBe("/en/rodo");
    expect(rodo?.label).toBe("GDPR - your rights");
    // Żadna pozycja nie może wyprowadzać czytelnika EN poza /en.
    for (const item of ALL_ITEMS("/en/rodo")) {
      expect(item.href.startsWith("/en/")).toBe(true);
    }
  });

  it("poza stronami prawnymi nie zaznacza niczego, ale nadal buduje pełną listę", () => {
    const nav = resolveLegalNav("/blog");
    expect(nav.activeKey).toBeNull();
    expect(ALL_ITEMS("/blog").some((i) => i.active)).toBe(false);
    expect(ALL_ITEMS("/blog")).toHaveLength(LEGAL_DOC_KEYS.length);
  });

  it("nie myli dokumentu z adresem, który tylko zaczyna się tak samo", () => {
    // /regulamin vs /regulamin-klubow-dyskusyjnych - dopasowanie musi być
    // pełne, a nie po prefiksie.
    expect(resolveLegalNav("/regulamin").activeKey).toBe("terms");
    expect(resolveLegalNav("/regulamin-klubow-dyskusyjnych").activeKey).toBe("clubs");
  });

  it("zachowuje kolejność grup zadeklarowaną w indeksie", () => {
    const ids = resolveLegalNav("/rodo").groups.map((g) => g.id);
    expect(ids).toEqual(LEGAL_DOC_GROUPS.map((g) => g.id));
  });
});
