// SERCE DOBORU POWIĄZANYCH WPISÓW: `buildIdf` i `normalizeMap`. Obie funkcje
// stały na zerze, mimo że decydują o tym, KTÓRE trzy artykuły czytelnik zobaczy
// pod tekstem - a `use_idf` jest przełącznikiem w panelu, więc redakcja może je
// włączyć bez wiedzy o tym, jak się zachowują na brzegach.
//
// Cztery reguły, których złamanie widzi czytelnik:
//
//   1. TERMIN W KAŻDYM DOKUMENCIE MA WAGĘ BLISKĄ ZERA. Tag przypięty do
//      wszystkiego (np. „analiza") nie może decydować o podobieństwie - to
//      cała idea IDF. Bez klamrowania od dołu wagą 0,2 taki tag nadal ważyłby
//      tyle samo co unikat.
//   2. WAGA JEST KLAMROWANA DO 0,2..3. Bez górnego ograniczenia jeden termin
//      z jednego dokumentu w korpusie 10 000 wpisów dostałby wagę ~9 i
//      przykryłby wszystkie pozostałe sygnały (kategoria, autor, świeżość).
//   3. NORMALIZACJA JEST WZGLĘDEM MAKSIMUM I ZWRACA 0..1. Sygnały o różnych
//      skalach (odsłony w tysiącach, czas czytania w sekundach) muszą wejść do
//      sumy w tej samej skali, inaczej jeden z nich jest de facto jedynym.
//   4. KORPUS BEZ SYGNAŁU DAJE PUSTĄ MAPĘ, NIE NaN. Dzielenie przez zerowe
//      maksimum wstawiłoby NaN do wyniku i cała lista rekomendacji zniknęłaby
//      (NaN nie przechodzi progu `minScore`).
import { describe, it, expect } from "vitest";
import { buildIdf, normalizeMap, rankRelated } from "@/lib/relatedPosts";
import type { BlogListItem } from "@/lib/queries/public";

/** Górna i dolna granica wagi IDF, wprost z implementacji. */
const IDF_MIN = 0.2;
const IDF_MAX = 3;

function df(entries: [string, number][]): Map<string, number> {
  return new Map(entries);
}

describe("buildIdf - wagi rzadkości terminów", () => {
  it("korpus jednowyrazowy: jedyny termin w jedynym dokumencie dostaje wagę z zakresu", () => {
    const idf = buildIdf(df([["tag-a", 1]]), 1);
    expect(idf.get("tag-a")).toBeCloseTo(Math.log(2), 10);
    expect(idf.get("tag-a")).toBeLessThanOrEqual(IDF_MAX);
  });

  it("TERMIN W KAŻDYM DOKUMENCIE ma wagę bliską zera - i ląduje na dolnej klamrze", () => {
    // df == N: log(1 + N/N) = log(2) ≈ 0,693. Klamra dolna 0,2 nie wchodzi tu w
    // grę, ale waga jest NAJNIŻSZA z możliwych - i to jest reguła.
    const idf = buildIdf(df([["wszedzie", 100]]), 100);
    const unikat = buildIdf(df([["unikat", 1]]), 100);
    expect(idf.get("wszedzie")).toBeCloseTo(Math.log(2), 10);
    expect(idf.get("wszedzie")!).toBeLessThan(unikat.get("unikat")!);
  });

  it("termin rzadszy ma ZAWSZE wagę nie mniejszą niż termin częstszy (monotoniczność)", () => {
    const idf = buildIdf(
      df([
        ["rzadki", 1],
        ["sredni", 10],
        ["czesty", 90],
      ]),
      100,
    );
    expect(idf.get("rzadki")!).toBeGreaterThan(idf.get("sredni")!);
    expect(idf.get("sredni")!).toBeGreaterThan(idf.get("czesty")!);
  });

  it("KLAMRA GÓRNA 3: unikat w wielkim korpusie nie dominuje pozostałych sygnałów", () => {
    // Bez klamry: log(1 + 10000/1) ≈ 9,21.
    const idf = buildIdf(df([["unikat", 1]]), 10_000);
    expect(idf.get("unikat")).toBe(IDF_MAX);
    expect(Math.log(1 + 10_000)).toBeGreaterThan(IDF_MAX);
  });

  it("KLAMRA DOLNA 0,2: żaden termin nie schodzi poniżej, nawet przy df > N", () => {
    // df większe niż N nie powinno się zdarzyć, ale gdy zdarzy się przez
    // niespójny licznik, waga nie może wyjść na zero ani ujemnie.
    const idf = buildIdf(df([["niespojny", 1000]]), 10);
    expect(idf.get("niespojny")).toBeGreaterThanOrEqual(IDF_MIN);
    expect(idf.get("niespojny")).toBe(IDF_MIN);
  });

  it("licznik zerowy jest traktowany jak 1 (bez dzielenia przez zero)", () => {
    const idf = buildIdf(df([["zero", 0]]), 50);
    expect(Number.isFinite(idf.get("zero")!)).toBe(true);
    expect(idf.get("zero")).toBe(IDF_MAX);
  });

  it("totalDocs 0 i ujemne są podnoszone do 1 (korpus nie może być mniejszy)", () => {
    const zero = buildIdf(df([["a", 1]]), 0);
    const ujemny = buildIdf(df([["a", 1]]), -5);
    expect(zero.get("a")).toBeCloseTo(Math.log(2), 10);
    expect(ujemny.get("a")).toEqual(zero.get("a"));
  });

  it("pusta mapa częstości daje pustą mapę wag, nie wyjątek", () => {
    const idf = buildIdf(df([]), 100);
    expect(idf.size).toBe(0);
    expect([...idf.keys()]).toEqual([]);
  });

  it("KAŻDA waga w korpusie mieści się w 0,2..3 (inwariant, nie pojedynczy przypadek)", () => {
    const counts: [string, number][] = Array.from({ length: 40 }, (_, i) => [`t${i}`, i]);
    const idf = buildIdf(df(counts), 40);
    expect(idf.size).toBe(40);
    for (const [, weight] of idf) {
      expect(weight).toBeGreaterThanOrEqual(IDF_MIN);
      expect(weight).toBeLessThanOrEqual(IDF_MAX);
    }
  });

  it("nie mutuje mapy wejściowej", () => {
    const input = df([["a", 3]]);
    buildIdf(input, 10);
    expect(input.get("a")).toBe(3);
    expect(input.size).toBe(1);
  });
});

describe("normalizeMap - wspólna skala sygnałów", () => {
  it("skaluje względem maksimum: największy element dostaje dokładnie 1", () => {
    const out = normalizeMap(
      new Map([
        ["a", 5],
        ["b", 10],
      ]),
    );
    expect(out.get("b")).toBe(1);
    expect(out.get("a")).toBe(0.5);
  });

  it("wszystkie wartości mieszczą się w 0..1", () => {
    const out = normalizeMap(
      new Map([
        ["a", 3],
        ["b", 120],
        ["c", 47],
      ]),
    );
    expect(out.size).toBe(3);
    for (const [, v] of out) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("mapa pusta daje mapę pustą", () => {
    const out = normalizeMap(new Map());
    expect(out.size).toBe(0);
    expect([...out.entries()]).toEqual([]);
  });

  it("SAME ZERA dają PUSTĄ mapę, nie NaN (dzielenie przez zerowe maksimum)", () => {
    const out = normalizeMap(
      new Map([
        ["a", 0],
        ["b", 0],
      ]),
    );
    expect(out.size).toBe(0);
    expect(out.get("a")).toBeUndefined();
  });

  it("same wartości ujemne też dają pustą mapę (maksimum nie przekroczyło zera)", () => {
    const out = normalizeMap(
      new Map([
        ["a", -3],
        ["b", -1],
      ]),
    );
    expect(out.size).toBe(0);
    expect([...out.keys()]).toEqual([]);
  });

  it("wartości ujemne obok dodatnich zostają ujemne po skalowaniu (sygnał nie jest cenzurowany)", () => {
    const out = normalizeMap(
      new Map([
        ["minus", -4],
        ["plus", 8],
      ]),
    );
    expect(out.get("plus")).toBe(1);
    expect(out.get("minus")).toBe(-0.5);
  });

  it("jeden element daje dokładnie 1", () => {
    const out = normalizeMap(new Map([["solo", 42]]));
    expect(out.get("solo")).toBe(1);
    expect(out.size).toBe(1);
  });

  it("nie mutuje mapy wejściowej", () => {
    const input = new Map([
      ["a", 2],
      ["b", 4],
    ]);
    normalizeMap(input);
    expect(input.get("a")).toBe(2);
    expect(input.get("b")).toBe(4);
  });

  it("zachowuje wszystkie klucze wejścia, gdy maksimum jest dodatnie", () => {
    const input = new Map([
      ["a", 1],
      ["b", 0],
      ["c", 2],
    ]);
    const out = normalizeMap(input);
    expect([...out.keys()].sort()).toEqual(["a", "b", "c"]);
    expect(out.get("b")).toBe(0);
  });
});

describe("rankRelated - stabilność rankingu", () => {
  function item(id: string, score: number, publishedAt: string | null) {
    return {
      post: { id, published_at: publishedAt } as BlogListItem,
      score,
    };
  }

  it("REMIS rozstrzyga świeższa data publikacji (kolejność jest deterministyczna)", () => {
    const ranked = rankRelated(
      [
        item("stary", 5, "2026-01-01"),
        item("nowy", 5, "2026-08-01"),
        item("sredni", 5, "2026-04-01"),
      ],
      3,
    );
    expect(ranked.map((r) => r.post.id)).toEqual(["nowy", "sredni", "stary"]);
    expect(ranked).toHaveLength(3);
  });

  it("remis przy BRAKU daty jest stabilny i nie wywala się na null", () => {
    const ranked = rankRelated([item("bez-daty", 5, null), item("z-data", 5, "2026-01-01")], 2);
    expect(ranked.map((r) => r.post.id)).toEqual(["z-data", "bez-daty"]);
    expect(ranked).toHaveLength(2);
  });

  it("wpis o wyniku zero (np. bez tagów) NIE trafia na listę", () => {
    const ranked = rankRelated([item("zero", 0, "2026-08-01"), item("jeden", 1, "2026-01-01")], 5);
    expect(ranked.map((r) => r.post.id)).toEqual(["jeden"]);
    expect(ranked).toHaveLength(1);
  });

  it("próg `minScore` odsiewa wpisy poniżej, granica jest włączna", () => {
    const ranked = rankRelated(
      [item("ponizej", 2, "2026-08-01"), item("na-progu", 3, "2026-08-01")],
      5,
      3,
    );
    expect(ranked.map((r) => r.post.id)).toEqual(["na-progu"]);
    expect(ranked).toHaveLength(1);
  });

  it("limit przycina listę PO sortowaniu, nie przed", () => {
    const ranked = rankRelated(
      [
        item("maly", 1, "2026-08-01"),
        item("duzy", 9, "2026-01-01"),
        item("sredni", 5, "2026-05-01"),
      ],
      2,
    );
    expect(ranked.map((r) => r.post.id)).toEqual(["duzy", "sredni"]);
    expect(ranked).toHaveLength(2);
  });

  it("pusta lista kandydatów daje pustą listę, nie wyjątek", () => {
    expect(rankRelated([], 5)).toEqual([]);
    expect(rankRelated([], 0)).toHaveLength(0);
  });
});
