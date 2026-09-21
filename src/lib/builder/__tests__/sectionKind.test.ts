import { describe, it, expect } from "vitest";
import { isPeopleSectionKind, peopleColumnCount } from "@/lib/builder/sectionKind";
import type { ColumnNode, SectionChild, WidgetNode, WidgetType } from "@/lib/builder/types";

function w(type: WidgetType): WidgetNode {
  return { id: `${type}-1`, kind: "widget", type, content: {} };
}

const col = (widgets: WidgetNode[]): ColumnNode => ({
  id: "col-1",
  kind: "column",
  span: { desktop: 3, mobile: 12 },
  children: widgets,
});

const inner = (columns: ColumnNode[]): SectionChild => ({
  id: "inner-1",
  kind: "inner-section",
  columns,
});

describe("isPeopleSectionKind", () => {
  it("returns true for a section with only team-member widgets", () => {
    expect(isPeopleSectionKind([col([w("team-member")])])).toBe(true);
  });

  it("returns true for a section with only author-profile-card widgets", () => {
    expect(isPeopleSectionKind([col([w("author-profile-card")])])).toBe(true);
  });

  it("keeps a people section when cards have supporting text widgets", () => {
    expect(isPeopleSectionKind([col([w("team-member"), w("text")])])).toBe(true);
  });

  it("returns false when a column has only non-people widgets", () => {
    expect(isPeopleSectionKind([col([w("heading"), w("text")])])).toBe(false);
  });

  it("returns true for nested inner-sections that contain only people widgets", () => {
    expect(isPeopleSectionKind([inner([col([w("team-member")]), col([w("team-member")])])])).toBe(
      true,
    );
  });

  it("returns false for empty sections", () => {
    expect(isPeopleSectionKind([])).toBe(false);
  });

  it("returns false for empty columns", () => {
    expect(isPeopleSectionKind([col([])])).toBe(false);
  });
});

describe("peopleColumnCount", () => {
  it("counts columns directly", () => {
    expect(peopleColumnCount([col([w("team-member")]), col([w("team-member")])])).toBe(2);
  });

  it("counts columns inside nested inner-sections", () => {
    expect(
      peopleColumnCount([
        inner([col([w("team-member")]), col([w("team-member")]), col([w("team-member")])]),
      ]),
    ).toBe(3);
  });
});

// ODMOWY OBU FUNKCJI - galezie, ktore decyduja, czy sekcja dostanie uklad
// siatki osob, czy zwykly.
//
// `isPeopleSectionKind` i `peopleColumnCount` sterują WYGLADEM sekcji
// (siatka kart osob kontra uklad domyslny), wiec ich falszywe "tak" psuje
// gotowa strone. Testy wyzej pokrywaja potwierdzenia; ponizsze pokrywaja
// PRZYPADKI PUSTE, ktore w obu funkcjach maja osobne galezie i ktore zdarzaja
// sie realnie: sekcja wewnetrzna zaklada sie z zerem kolumn i dopiero potem
// redaktor je dokłada.
//
// GRANICA DOWODU: `containsPeopleWidget` konczy sie zapasowym `return false`
// (src/lib/builder/sectionKind.ts:16) dla dziecka, ktore nie jest ani kolumna,
// ani sekcja wewnetrzna. Z typu `SectionChild` (suma DOKLADNIE tych dwoch)
// ta linia jest NIEOSIAGALNA i swiadomie nie ma tu na nia testu - dosiegniecie
// jej wymagaloby rzutowania, ktore dowodzilo by tylko tego, ze rzutowanie
// dziala. Zostaje jako oslona na wypadek rozszerzenia sumy typow.

describe("isPeopleSectionKind - sekcja wewnetrzna bez kolumn", () => {
  it("sekcja wewnetrzna z PUSTA lista kolumn nie robi z sekcji siatki osob", () => {
    // `every` na pustej tablicy zwraca prawde, wiec bez jawnego warunku
    // `columns.length > 0` swiezo dodana, jeszcze pusta sekcja wewnetrzna
    // przelaczalaby cala sekcje w uklad kart osob.
    expect(isPeopleSectionKind([inner([])])).toBe(false);
  });

  it("jedna pusta sekcja wewnetrzna psuje wynik calej sekcji osob", () => {
    expect(isPeopleSectionKind([inner([col([w("team-member")])]), inner([])])).toBe(false);
  });
});

describe("peopleColumnCount - przypadki dajace zero", () => {
  it("pusta lista dzieci daje zero", () => {
    expect(peopleColumnCount([])).toBe(0);
  });

  it("sekcja wewnetrzna bez kolumn daje zero, a nie liczbe dzieci sekcji", () => {
    // Rekurencja schodzi w `columns`, dostaje pusta liste i wraca z zerem;
    // zero NIE moze byc uznane za "znalezione", bo wtedy funkcja zwrocilaby
    // liczbe kolumn warstwy, ktorej wcale nie ma.
    expect(peopleColumnCount([inner([])])).toBe(0);
  });

  it("pusta sekcja wewnetrzna nie przerywa szukania - liczy sie pierwsza warstwa z kolumnami", () => {
    expect(peopleColumnCount([inner([]), inner([col([w("team-member")]), col([w("text")])])])).toBe(
      2,
    );
  });

  it("kolumna w pierwszej warstwie liczy WSZYSTKIE dzieci tej warstwy", () => {
    // Warunek `child.kind === "column"` konczy petle przy pierwszej kolumnie
    // i zwraca `children.length` - czyli takze sekcje wewnetrzne stojace obok.
    expect(peopleColumnCount([col([w("team-member")]), inner([col([w("team-member")])])])).toBe(2);
  });
});
