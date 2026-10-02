import { describe, expect, it } from "vitest";
import {
  estimateTextWidthPx,
  serpDescriptionMetric,
  serpTitleMetric,
  truncateToPx,
  SERP_DESCRIPTION_LIMIT_PX,
  SERP_TITLE_LIMIT_PX,
} from "@/lib/seo/serp";

describe("estimateTextWidthPx", () => {
  it("scales with font size and character class", () => {
    const narrow = estimateTextWidthPx("iiii", 20);
    const wide = estimateTextWidthPx("MMMM", 20);
    expect(wide).toBeGreaterThan(narrow * 2);
    // Linear in font size (within integer rounding).
    const ratio = estimateTextWidthPx("abc", 40) / estimateTextWidthPx("abc", 20);
    expect(ratio).toBeGreaterThan(1.9);
    expect(ratio).toBeLessThan(2.1);
    expect(estimateTextWidthPx("", 20)).toBe(0);
  });
});

describe("serp metrics", () => {
  it("grades empty, short, good and long", () => {
    expect(serpTitleMetric("").grade).toBe("empty");
    expect(serpTitleMetric("Krótko").grade).toBe("short");
    expect(serpTitleMetric("Strategiczne myślenie o bezpieczeństwie Europy dziś").grade).toBe(
      "good",
    );
    expect(serpTitleMetric("x".repeat(120)).grade).toBe("long");
  });
  it("description uses the wider budget", () => {
    const d = serpDescriptionMetric(
      "Solidny, konkretny opis artykułu o geopolityce i strategii bezpieczeństwa Europy Środkowej, pisany z myślą o wynikach wyszukiwania.",
    );
    expect(d.grade).toBe("good");
    expect(d.limitPx).toBe(960);
  });
});

describe("truncateToPx", () => {
  it("returns short strings unchanged and truncates long ones with ellipsis", () => {
    expect(truncateToPx("Krótki", 20, SERP_TITLE_LIMIT_PX)).toBe("Krótki");
    const long = "Bardzo ".repeat(30);
    const cut = truncateToPx(long, 20, SERP_TITLE_LIMIT_PX);
    expect(cut.endsWith("…")).toBe(true);
    expect(estimateTextWidthPx(cut, 20)).toBeLessThanOrEqual(SERP_TITLE_LIMIT_PX);
  });
});

// Obcinka na granicy słowa. Google urywa snippet na CAŁYM słowie i dokleja
// wielokropek; podgląd w panelu, który rozrywa wyraz („przyszlos…"), pokazuje
// redakcji snippet, jakiego w wynikach wyszukiwania nigdy nie będzie. Fixture'y
// są dobrane po jednostkach tabeli szerokości (budżet tytułu: 600 px / 20 px =
// 30 em minus 1 em rezerwy na „…" = 29 em; „a" = 0,56, „f" = 0,42, „i" = 0,28,
// spacja = 0,42, „W" = 0,92).
describe("truncateToPx - granica słowa", () => {
  /** Ostatnie słowo wyniku (bez wielokropka) jest CAŁYM słowem oryginału. */
  function endsOnWholeWord(original: string, cut: string): boolean {
    const kept = cut.replace(/…$/, "");
    const lastWord = kept.split(" ").pop() ?? "";
    return original.split(" ").includes(lastWord);
  }

  it("budżet kończący się w środku słowa cofa cięcie do poprzedniej spacji", () => {
    const text =
      "Polska prezydencja w Radzie Unii Europejskiej i przyszlosc wspolnej polityki rolnej po 2027 roku";
    const cut = truncateToPx(text, 20, SERP_TITLE_LIMIT_PX);
    expect(cut).toBe("Polska prezydencja w Radzie Unii Europejskiej i…");
    expect(endsOnWholeWord(text, cut)).toBe(true);
  });

  it("wynik RAZEM z wielokropkiem mieści się w budżecie (tytuł i opis)", () => {
    const title = "Strategia ".repeat(20);
    const description = "Bezpieczeństwo energetyczne Europy Środkowej ".repeat(10);
    const t = truncateToPx(title, 20, SERP_TITLE_LIMIT_PX);
    const d = truncateToPx(description, 14, SERP_DESCRIPTION_LIMIT_PX);
    expect(estimateTextWidthPx(t, 20)).toBeLessThanOrEqual(SERP_TITLE_LIMIT_PX);
    expect(estimateTextWidthPx(d, 14)).toBeLessThanOrEqual(SERP_DESCRIPTION_LIMIT_PX);
    expect(endsOnWholeWord(title, t)).toBe(true);
    expect(endsOnWholeWord(description, d)).toBe(true);
  });

  it("budżet kończący się NA spacji: całe słowo + wielokropek, bez wiszącego odstępu", () => {
    // 50 × „a" (28) + spacja (28,42) mieszczą się w 29 em, następne „W" już nie.
    const text = `${"a".repeat(50)} WWWWW`;
    expect(truncateToPx(text, 20, SERP_TITLE_LIMIT_PX)).toBe(`${"a".repeat(50)}…`);
  });

  it("znak, który się nie zmieścił, JEST spacją: słowo przed nim zostaje całe", () => {
    // 50 × „a" + „f" + „i" = 28,70 em; spacja dobija do 29,12 > 29.
    const text = `${"a".repeat(50)}fi WWW`;
    expect(truncateToPx(text, 20, SERP_TITLE_LIMIT_PX)).toBe(`${"a".repeat(50)}fi…`);
  });

  it("jedno słowo dłuższe niż cały budżet spada na twarde cięcie po znaku", () => {
    // Nie ma granicy słowa, do której można by się cofnąć - pusty podgląd
    // albo sam „…" byłby gorszy niż ucięty ciąg.
    const word = "W".repeat(80);
    const cut = truncateToPx(word, 20, SERP_TITLE_LIMIT_PX);
    // 31 × 0,92 = 28,52 em ≤ 29; 32. „W" przekracza budżet.
    expect(cut).toBe(`${"W".repeat(31)}…`);
    expect(estimateTextWidthPx(cut, 20)).toBeLessThanOrEqual(SERP_TITLE_LIMIT_PX);
  });

  it("ciąg bez spacji poprzedzony samym odstępem też spada na twarde cięcie", () => {
    // Cofnięcie do wiodącej spacji dałoby pusty napis - zostaje cięcie po
    // znaku. Początek napisu NIE jest przycinany (obcinka rusza tylko ogon),
    // a wiodąca spacja (0,42 em) wciąż zostawia miejsce na 31 × „W".
    const cut = truncateToPx(` ${"W".repeat(80)}`, 20, SERP_TITLE_LIMIT_PX);
    expect(cut).toBe(` ${"W".repeat(31)}…`);
  });

  it.each([
    ["przecinek", "Europa, "],
    ["dwukropek", "Europa: "],
    ["myślnik", "Europa - "],
    ["pauza", "Europa — "],
  ])("wisząca interpunkcja łącząca (%s) znika przed wielokropkiem", (_opis, head) => {
    // Drugie słowo jest dłuższe niż budżet, więc cięcie cofa się za `head`.
    const cut = truncateToPx(`${head}${"x".repeat(60)}`, 20, SERP_TITLE_LIMIT_PX);
    expect(cut).toBe("Europa…");
  });

  it("kropka i nawias zamykający zostają - kończą pełną jednostkę tekstu", () => {
    // Kontrola przed nadgorliwością: zdjęcie kropki z „U.S." albo nawiasu
    // z „(2027)" zmieniłoby treść, a nie tylko usunęło wiszący znak.
    expect(truncateToPx(`Raport U.S. ${"x".repeat(60)}`, 20, SERP_TITLE_LIMIT_PX)).toBe(
      "Raport U.S.…",
    );
    expect(truncateToPx(`Plan (2027) ${"x".repeat(60)}`, 20, SERP_TITLE_LIMIT_PX)).toBe(
      "Plan (2027)…",
    );
  });

  // Wielokropek wpisany przez redakcję już sygnalizuje urwanie. KONSEKWENCJA
  // drugiego: podgląd pokazuje „Europa……", którego Google nigdy nie wyświetli -
  // czyli znów inny snippet niż w wynikach wyszukiwania.
  it.each([
    ["„…”", "Europa… ", "Europa…"],
    ["„...”", "Co dalej... ", "Co dalej..."],
    ["„…” z wiszącym przecinkiem", "Europa…, ", "Europa…"],
  ])("ucięty fragment kończący się wielokropkiem %s nie dostaje drugiego", (_o, head, out) => {
    expect(truncateToPx(`${head}${"x".repeat(60)}`, 20, SERP_TITLE_LIMIT_PX)).toBe(out);
  });

  it("kontrola negatywna: dwie kropki to nie wielokropek - „…” zostaje doklejony", () => {
    expect(truncateToPx(`Co dalej.. ${"x".repeat(60)}`, 20, SERP_TITLE_LIMIT_PX)).toBe(
      "Co dalej..…",
    );
  });

  it("wielokrotne odstępy na granicy nie zostają przed wielokropkiem", () => {
    const cut = truncateToPx(`Europa   ${"x".repeat(60)}`, 20, SERP_TITLE_LIMIT_PX);
    expect(cut).toBe("Europa…");
  });

  it("spacja nierozdzielająca NIE jest granicą słowa (redakcja spina nią „10 km”)", () => {
    // „bbbb…b" kończy się w środku budżetu; NBSP przed nim spina go z „10".
    // Złamanie na NBSP rozdzieliłoby to, co redakcja celowo skleiła, więc
    // cięcie cofa się do ZWYKŁEJ spacji przed „10".
    const text = `Trasa 10\u00a0${"b".repeat(60)}`;
    expect(truncateToPx(text, 20, SERP_TITLE_LIMIT_PX)).toBe("Trasa…");
  });

  it("napis mieszczący się w budżecie wraca BEZ ZMIAN - także z odstępem na końcu", () => {
    // Kontrola negatywna: obcinka nie może „sprzątać" napisów, których nie
    // ucina - podgląd ma pokazać dokładnie to, co pójdzie do head().
    expect(truncateToPx("Krótki tytuł, ", 20, SERP_TITLE_LIMIT_PX)).toBe("Krótki tytuł, ");
    expect(truncateToPx("", 20, SERP_TITLE_LIMIT_PX)).toBe("");
  });

  it("budżet węższy niż sam wielokropek daje pusty napis, nie „…” ponad limit", () => {
    expect(truncateToPx("Europa", 20, 10)).toBe("");
  });

  it("pamięć klas szerokości nie zmienia pomiaru przy powtórzeniu", () => {
    // Optymalizacja (Map zamiast czterech regexów na znak) musi być
    // przezroczysta: drugi i trzeci pomiar tego samego napisu = pierwszy.
    const text = "Zażółć gęślą jaźń - WWW iii @ 100%";
    const first = estimateTextWidthPx(text, 20);
    expect(estimateTextWidthPx(text, 20)).toBe(first);
    expect(estimateTextWidthPx(text, 20)).toBe(first);
    // Kontrola wartości: klasy nadal się różnią po pamięci podręcznej.
    expect(estimateTextWidthPx("W", 100)).toBe(92);
    expect(estimateTextWidthPx("i", 100)).toBe(28);
  });
});
