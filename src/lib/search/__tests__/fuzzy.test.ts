import { describe, it, expect } from "vitest";
import { foldDiacritics, foldQuery, fuzzyMatch, rankItems } from "../fuzzy";

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

// Postać kanoniczna. „ś” da się zapisać dwojako: jednym punktem kodowym (NFC)
// albo „s” plus znak łączący U+0301 (NFD). Renderują się IDENTYCZNIE, więc
// użytkownik nie ma jak zobaczyć różnicy - a wklejka potrafi przynieść NFD
// (nazwy plików HFS+, część aplikacji macOS). Zgłoszone w recenzji PR #258.
describe("fuzzyMatch - postać kanoniczna frazy (NFC/NFD)", () => {
  const NFC = "Płatności";
  const NFD = NFC.normalize("NFD");

  it("NFD i NFC to naprawdę różne napisy, mimo identycznego wyglądu", () => {
    expect(NFD).not.toBe(NFC);
    expect(NFD.length).toBe(NFC.length + 1);
  });

  it("fraza ROZŁOŻONA trafia w cel ZŁOŻONY (regresja: zwracało null)", () => {
    expect(fuzzyMatch(NFD, NFC)).not.toBeNull();
  });

  it("pozostałe trzy kombinacje NFC/NFD nadal trafiają", () => {
    expect(fuzzyMatch(NFC, NFC)).not.toBeNull();
    expect(fuzzyMatch(NFC, NFD)).not.toBeNull();
    expect(fuzzyMatch(NFD, NFD)).not.toBeNull();
  });

  it("cel ROZŁOŻONY podświetla właściwe litery - indeksy omijają znak łączący", () => {
    // U+0301 stoi w celu pod indeksem 7; dopasowanie jest podciągiem, więc
    // zostaje pominięte, a `indexes` dalej wskazują litery oryginału - trafiony
    // jest goły „s”, nie kreska nad nim. To jedyny efekt uboczny celu w NFD
    // i jest KOSMETYCZNY: kreska wypada poza zakres podświetlenia. Cele w tym
    // repo (słownik i18n, rejestr komend, tytuły z bazy) są zapisane w NFC.
    const m = fuzzyMatch("platnosci", NFD);
    expect(m?.indexes).toEqual([0, 1, 2, 3, 4, 5, 6, 8, 9]);
    expect(m!.indexes.map((i) => NFD[i]).join("")).toBe("Płatnosci");
  });

  it("osierocony znak łączący nie blokuje frazy", () => {
    // Kreska bez litery, której mogłaby dotyczyć - po NFC nie ma formy złożonej.
    expect(fuzzyMatch("platnosci\u0301", NFC)).not.toBeNull();
  });
});

describe("foldQuery vs foldDiacritics - dwie różne umowy", () => {
  it("foldDiacritics ZACHOWUJE długość, bo indeksy celu muszą się zgadzać", () => {
    const decomposed = "Płatności".normalize("NFD");
    expect(foldDiacritics(decomposed)).toHaveLength(decomposed.length);
    expect(foldDiacritics("Płatności")).toHaveLength("Płatności".length);
  });

  it("foldQuery NIE musi - i dlatego usuwa znaki łączące", () => {
    expect(foldQuery("Płatności".normalize("NFD"))).toBe("Platnosci");
    expect(foldQuery("Płatności")).toBe("Platnosci");
  });

  it("foldQuery jest idempotentne", () => {
    const once = foldQuery("Płatności".normalize("NFD"));
    expect(foldQuery(once)).toBe(once);
  });

  it("nie zjada znaków spoza łaciny", () => {
    expect(foldQuery("Мир 東京")).toBe("Мир 東京");
  });
});

describe("rankItems - fraza rozłożona kanonicznie", () => {
  it("wklejone NFD rankinguje cel zapisany w NFC", () => {
    const items = [
      { id: "platnosci", haystack: "Płatności Billing /profile/billing" },
      { id: "media", haystack: "Media Media /admin/media" },
    ];
    expect(rankItems(items, "Płatności".normalize("NFD")).map((i) => i.id)).toEqual(["platnosci"]);
  });
});
