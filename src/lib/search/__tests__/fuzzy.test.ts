import { describe, it, expect } from "vitest";
import { fuzzyMatch, rankItems } from "../fuzzy";

describe("fuzzyMatch", () => {
  it("returns null when characters not in order", () => {
    expect(fuzzyMatch("xyz", "Admin Pages")).toBeNull();
  });
  it("matches subsequence case-insensitively", () => {
    const m = fuzzyMatch("apa", "Admin Pages");
    expect(m).not.toBeNull();
    expect(m!.indexes.length).toBe(3);
  });
  it("scores prefix higher than mid-string", () => {
    const a = fuzzyMatch("pag", "Pages")!;
    const b = fuzzyMatch("pag", "Settings · Pages")!;
    expect(a.score).toBeGreaterThan(b.score);
  });
  it("returns empty match for empty query", () => {
    expect(fuzzyMatch("", "Anything")).toEqual({ score: 0, indexes: [] });
  });
});

describe("rankItems", () => {
  const items = [
    { id: "1", haystack: "Pages admin pages" },
    { id: "2", haystack: "Posts admin posts" },
    { id: "3", haystack: "Pricing public pricing" },
    { id: "4", haystack: "Settings - permalinks" },
  ];
  it("returns all items for empty query", () => {
    expect(rankItems(items, "")).toHaveLength(4);
  });
  it("filters and ranks by query", () => {
    const r = rankItems(items, "pri");
    expect(r[0].id).toBe("3");
  });
  it("respects limit", () => {
    expect(rankItems(items, "", 2)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Składanie diakrytyków (naprawa 2026-08-18)
//
// Wyszukiwarka komend nie znajdowała „Płatności" po wpisaniu „platnosci",
// „Bezpieczeństwo konta" po „bezpieczenstwo" ani „Strona główna" po „glowna" -
// czyli tak, jak Polak pisze najczęściej. Baza składa ogonki od dawna
// (`unaccent` w `search_quick`), więc ta sama fraza znajdowała TREŚĆ, ale nie
// KOMENDĘ prowadzącą do tego samego miejsca.
// ---------------------------------------------------------------------------

describe("fuzzyMatch - diakrytyki", () => {
  it("fraza bez ogonków znajduje cel z ogonkami", () => {
    expect(fuzzyMatch("platnosci", "Płatności")).not.toBeNull();
    expect(fuzzyMatch("bezpieczenstwo", "Bezpieczeństwo konta")).not.toBeNull();
    expect(fuzzyMatch("glowna", "Strona główna")).not.toBeNull();
    expect(fuzzyMatch("wyglad", "Wygląd")).not.toBeNull();
  });

  it("„ł” składa się do „l” - NFD samo tego nie robi, to osobny punkt kodowy", () => {
    expect(fuzzyMatch("lodz", "Łódź")).not.toBeNull();
    expect(fuzzyMatch("l", "Ł")).not.toBeNull();
  });

  it("składanie jest SYMETRYCZNE - fraza z ogonkami znajduje cel bez nich", () => {
    expect(fuzzyMatch("płatności", "Platnosci")).not.toBeNull();
    expect(fuzzyMatch("Łódź", "lodz")).not.toBeNull();
  });

  it("nadal ODRZUCA to, co nie pasuje - składanie nie jest zgodą na wszystko", () => {
    expect(fuzzyMatch("xyz", "Płatności")).toBeNull();
    expect(fuzzyMatch("platnoscix", "Płatności")).toBeNull();
  });

  it("INDEKSY wskazują pozycje w ORYGINALE - podświetlenie trafia w literę z ogonkiem", () => {
    const m = fuzzyMatch("lodz", "Łódź")!;
    expect(m.indexes).toEqual([0, 1, 2, 3]);
    // Podświetlenie bierze znaki z oryginału po tych indeksach.
    expect(m.indexes.map((i) => "Łódź"[i]).join("")).toBe("Łódź");
  });

  it("długość napisu jest zachowana także dla znaków spoza BMP", () => {
    const m = fuzzyMatch("ab", "a🎉b")!;
    expect(m).not.toBeNull();
    // Emoji zajmuje dwie jednostki UTF-16; „b" siedzi na indeksie 3.
    expect(m.indexes).toEqual([0, 3]);
  });

  it("ligatury zostają nietknięte - ß→ss zmieniłoby długość i rozjechało indeksy", () => {
    const m = fuzzyMatch("stra", "Straße")!;
    expect(m.indexes).toEqual([0, 1, 2, 3]);
    expect(fuzzyMatch("strasse", "Straße")).toBeNull();
  });

  it("inne alfabety łacińskie też się składają (NFD)", () => {
    expect(fuzzyMatch("uber", "Über")).not.toBeNull();
    expect(fuzzyMatch("francois", "François")).not.toBeNull();
    expect(fuzzyMatch("ostersund", "Östersund")).not.toBeNull();
  });

  it("znaki poza łaciną przechodzą bez zmian", () => {
    expect(fuzzyMatch("мир", "Мир")).not.toBeNull();
    expect(fuzzyMatch("東京", "東京都")).not.toBeNull();
  });
});

describe("rankItems - diakrytyki", () => {
  it("fraza bez ogonków rankinguje cel z ogonkami", () => {
    const items = [
      { id: "platnosci", haystack: "Płatności Billing /profile/billing" },
      { id: "media", haystack: "Media Media /admin/media" },
    ];
    expect(rankItems(items, "platnosci").map((i) => i.id)).toEqual(["platnosci"]);
  });
});
