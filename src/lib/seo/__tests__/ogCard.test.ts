import { describe, expect, it, vi } from "vitest";
import {
  fitSingleLine,
  layoutOgTitle,
  OG_CARD_MAX_TEXT_WIDTH,
  ogCardStoragePath,
  wrapText,
  type MeasureFn,
} from "@/lib/seo/ogCard";

// Deterministic measurer: every character is 0.5em wide.
const measure: MeasureFn = (text, fontSize) => text.length * fontSize * 0.5;

describe("wrapText", () => {
  it("wraps greedily on the pixel budget", () => {
    // 20px font -> 10px/char; 100px budget -> 10 chars per line.
    expect(wrapText("aaa bbb ccc", 100, 20, measure)).toEqual(["aaa bbb", "ccc"]);
  });
  it("hard-clips single words longer than the budget", () => {
    const lines = wrapText("Superduperlongword", 100, 20, measure);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.endsWith("…")).toBe(true);
    expect(measure(lines[0] ?? "", 20)).toBeLessThanOrEqual(100);
  });
});

describe("layoutOgTitle", () => {
  it("keeps short titles at the largest size", () => {
    const layout = layoutOgTitle("Krótki tytuł", measure);
    expect(layout.fontSize).toBe(72);
    expect(layout.lines).toEqual(["Krótki tytuł"]);
  });
  it("steps the font down for long titles and clamps to 4 lines", () => {
    const layout = layoutOgTitle("słowo ".repeat(60), measure);
    expect(layout.fontSize).toBe(42);
    expect(layout.lines.length).toBeLessThanOrEqual(4);
    expect(layout.lines[layout.lines.length - 1]?.endsWith("…")).toBe(true);
  });
});

describe("ogCardStoragePath", () => {
  it("keys one object per entity", () => {
    expect(ogCardStoragePath("post", "abc")).toBe("og-cards/post-abc.png");
    expect(ogCardStoragePath("page", "def")).toBe("og-cards/page-def.png");
  });
});

// ---------------------------------------------------------------------------
// ETAP 4: gałąź domykania tytułu (ogCard.ts:93 - `last.endsWith("…")`). Ten kod
// wykonuje się TYLKO wtedy, gdy tytuł nie mieści się w 4 liniach nawet na
// najmniejszym stopniu (42 px), więc trzeba go wywołać tytułem, który przy
// każdym rozmiarze daje więcej niż 4 linie.
// Miara: 0.5em na znak, budżet linii = 1200 - 2*80 = 1040 px -> przy 42 px
// linia mieści 49 znaków.
// ---------------------------------------------------------------------------
describe("layoutOgTitle - tytuł, który nie mieści się w budżecie linii", () => {
  const longWord = "z".repeat(140);

  it("nie dokleja drugiej elipsy, gdy czwarta linia już nią kończy", () => {
    // 24 słowa po 5 znaków wypełniają dokładnie 3 linie (8 słów na linię), więc
    // słowo dłuższe niż cała linia trafia na CZWARTĄ i zostaje przycięte z "…";
    // ogon spycha całość do 5 linii, czyli poza budżet MAX_TITLE_LINES.
    const layout = layoutOgTitle(`${"slowo ".repeat(24)}${longWord} ogon`, measure);
    expect(layout.fontSize).toBe(42);
    expect(layout.lines).toHaveLength(4);
    const last = layout.lines[3] ?? "";
    expect(last.endsWith("…")).toBe(true);
    expect(last.endsWith("……")).toBe(false);
    // Przycięta linia nadal mieści się w płótnie (inaczej tekst wychodzi za
    // kadr karty i Facebook/X pokazują obcięty tytuł).
    expect(measure(last, 42)).toBeLessThanOrEqual(1040);
  });

  it("dokleja elipsę i ucina wiszącą interpunkcję, gdy czwarta linia to zwykłe słowa", () => {
    const layout = layoutOgTitle("slowo ".repeat(40), measure);
    expect(layout.fontSize).toBe(42);
    expect(layout.lines).toHaveLength(4);
    expect(layout.lines[3]?.endsWith("…")).toBe(true);
    expect(layout.lines[3]?.endsWith(" …")).toBe(false);
    expect(layout.lines[3]?.endsWith(",…")).toBe(false);
  });

  it("zwija wiszący przecinek przed elipsą", () => {
    // Przecinek musi wypaść na CZWARTEJ linii: 8 słów na linię przy 42 px, więc
    // linie 1-3 zjadają słowa 1-24, a "koniec," jest słowem 32.
    const layout = layoutOgTitle(`${"slowo ".repeat(31)}koniec, ${"slowo ".repeat(4)}`, measure);
    expect(layout.lines).toHaveLength(4);
    expect(layout.lines[3]?.endsWith("koniec…")).toBe(true);
    expect(layout.lines[3]?.includes(",…")).toBe(false);
  });

  it.each([
    { label: "tytuł pusty", title: "" },
    { label: "tytuł z samych spacji", title: "    " },
    { label: "tytuł z samych znaków nowej linii", title: "\n\n" },
  ])("$label daje zero linii przy największym stopniu (brak nagłówka na karcie)", ({ title }) => {
    const layout = layoutOgTitle(title, measure);
    expect(layout.lines).toEqual([]);
    expect(layout.fontSize).toBe(72);
    expect(layout.lineHeight).toBe(84);
  });

  it("normalizuje wielokrotne białe znaki wewnątrz tytułu", () => {
    expect(layoutOgTitle("  Ala   ma\n\tkota  ", measure).lines).toEqual(["Ala ma kota"]);
  });

  it("jedno słowo dłuższe niż cała linia zostaje przycięte, a nie wypuszczone za kadr", () => {
    const layout = layoutOgTitle(longWord, measure);
    // Przy 72 px zmieściłoby się 28 znaków, więc pierwszy stopień już wystarcza:
    // przycięcie daje JEDNĄ linię, a pętla stopni kończy się na 72.
    expect(layout.fontSize).toBe(72);
    expect(layout.lines).toHaveLength(1);
    expect(layout.lines[0]?.endsWith("…")).toBe(true);
    expect(measure(layout.lines[0] ?? "", 72)).toBeLessThanOrEqual(1040);
  });
});

describe("wrapText - budżety brzegowe", () => {
  it("zwraca pustą listę dla tekstu bez słów", () => {
    expect(wrapText("", 100, 20, measure)).toEqual([]);
    expect(wrapText("   \n ", 100, 20, measure)).toEqual([]);
  });

  it("nie zapętla się przy budżecie mniejszym niż jeden znak", () => {
    // Pętla przycinania zatrzymuje się na `clipped.length > 1`, więc nawet
    // budżet, w którym NIC się nie mieści, kończy się jednym znakiem + elipsą.
    const lines = wrapText("abcdef", 1, 20, measure);
    expect(lines).toEqual(["a…"]);
  });

  it("tekst dokładnie na granicy budżetu zostaje w jednej linii", () => {
    // 10 znaków * 20 px * 0.5 = 100 px = budżet: "<=" musi przepuścić.
    expect(wrapText("abcdefghij", 100, 20, measure)).toEqual(["abcdefghij"]);
    // Jeden znak za dużo: elipsa też zajmuje miejsce w budżecie, więc zostaje
    // 9 znaków treści + "…" = dokładnie 100 px.
    expect(wrapText("abcdefghijk", 100, 20, measure)).toEqual(["abcdefghi…"]);
  });
});

describe("ogCardStoragePath - klucze obiektów", () => {
  it.each([
    { kind: "post" as const, entityId: "", expected: "og-cards/post-.png" },
    { kind: "page" as const, entityId: "0", expected: "og-cards/page-0.png" },
    {
      kind: "post" as const,
      entityId: "550e8400-e29b-41d4-a716-446655440000",
      expected: "og-cards/post-550e8400-e29b-41d4-a716-446655440000.png",
    },
  ])("buduje ścieżkę dla $kind / '$entityId'", ({ kind, entityId, expected }) => {
    // FAKT: builder nie waliduje id (nie zna źródła danych). Pusty id daje
    // ścieżkę "og-cards/post-.png" - JEDEN wspólny obiekt dla wszystkich
    // wpisów bez id, więc wołający MUSI podać id.
    expect(ogCardStoragePath(kind, entityId)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// fitSingleLine - jedna linia kickera (nazwa sekcji/kategorii z TREŚCI). Ta
// sama miara 0.5em: przy 20 px znak ma 10 px, budżet 100 px = 10 znaków.
// ---------------------------------------------------------------------------
describe("fitSingleLine", () => {
  it("tekst mieszczący się w budżecie wraca BEZ zmian (także dokładnie na granicy)", () => {
    expect(fitSingleLine("abc", 100, 20, measure)).toBe("abc");
    expect(fitSingleLine("abcdefghij", 100, 20, measure)).toBe("abcdefghij");
  });

  it("za długi tekst: najdłuższy prefiks + elipsa, razem w budżecie", () => {
    // 11 znaków > 10: zostaje 9 znaków treści + "…" = dokładnie 100 px.
    expect(fitSingleLine("abcdefghijk", 100, 20, measure)).toBe("abcdefghi…");
    const line = fitSingleLine("x".repeat(500), 100, 20, measure);
    expect(line).toBe(`${"x".repeat(9)}…`);
    expect(measure(line, 20)).toBeLessThanOrEqual(100);
  });

  it("nie zostawia wiszącej spacji ani interpunkcji przed elipsą", () => {
    // Prefiks 9 znaków to "abcd efg " - spacja przed elipsą jest zwijana.
    expect(fitSingleLine("abcd efg hijk", 100, 20, measure)).toBe("abcd efg…");
    // Za przecinkiem same spacje: zwinięte razem z przecinkiem.
    expect(fitSingleLine("abcd,     ijklmnop", 100, 20, measure)).toBe("abcd…");
  });

  it("nie rozcina emoji z jednego code pointu na samotny surogat", () => {
    // Miara liczy jednostki UTF-16, więc emoji (2 jednostki) „waży" 20 px.
    const line = fitSingleLine("ab🚀🚀🚀🚀🚀🚀", 100, 20, measure);
    expect(line.endsWith("…")).toBe(true);
    expect(line.slice(0, -1)).toMatch(/^ab(?:🚀)*$/u);
    expect(measure(line, 20)).toBeLessThanOrEqual(100);
  });

  // Klastry grafemów. Miara liczy jednostki UTF-16: rodzina 👨‍👩‍👧 to 8
  // jednostek (3 emoji po 2 + 2 ZWJ), flaga 🇵🇱 to 4 (dwie litery regionalne
  // po 2). Cięcie po code pointach (dawne Array.from) dawało tu odpowiednio
  // "AB👨‍👩‍👧" + wiszący ZWJ i samotną literę regionalną (prostokąt z „P").
  it("nie rozcina sekwencji ZWJ: rodzina zostaje cała albo wypada w całości", () => {
    const text = "AB👨‍👩‍👧👨‍👩‍👧";
    // 120 px = 12 jednostek: "AB" + rodzina + "…" = 11 mieści się, druga nie.
    expect(fitSingleLine(text, 120, 20, measure)).toBe("AB👨‍👩‍👧…");
    // 100 px = 10 jednostek: rodzina z elipsą (11) już się nie mieści.
    expect(fitSingleLine(text, 100, 20, measure)).toBe("AB…");
    for (const budget of [40, 60, 80, 100, 120, 140, 160, 180]) {
      const line = fitSingleLine(text, budget, 20, measure);
      expect(line).not.toMatch(/‍…$/u);
      expect(line === text || /^AB(?:👨‍👩‍👧)*…$/u.test(line)).toBe(true);
      expect(measure(line, 20)).toBeLessThanOrEqual(budget);
    }
  });

  it("nie rozcina flagi na samotną literę regionalną", () => {
    // 80 px = 8 jednostek: "A" + 🇵🇱 + "…" = 6; cięcie po code pointach
    // zmieściłoby jeszcze jedną literę regionalną (8) i rozbiło drugą flagę.
    expect(fitSingleLine("A🇵🇱🇵🇱🇵🇱", 80, 20, measure)).toBe("A🇵🇱…");
  });

  it("emoji z selektorem VS16 (❤️) nie traci własnego selektora przed elipsą", () => {
    // ❤️ = U+2764 U+FE0F (2 jednostki). Zwijanie wiszącego U+FE0F działa na
    // CAŁYCH grafemach, więc nie obcina selektora z ❤️ (wersja tekstowa ❤).
    expect(fitSingleLine("ab❤️❤️❤️❤️❤️❤️", 80, 20, measure)).toBe("ab❤️❤️…");
  });

  it("bez Intl.Segmenter: fallback na code pointy bez wiszącego ZWJ przed elipsą", () => {
    const fakeIntl = Object.create(Intl) as typeof Intl;
    Object.defineProperty(fakeIntl, "Segmenter", { value: undefined });
    vi.stubGlobal("Intl", fakeIntl);
    try {
      // 70 px = 7 jednostek: prefiks "AB👨" + ZWJ - ZWJ jest zwijany.
      expect(fitSingleLine("AB👨‍👩‍👧👨‍👩‍👧", 70, 20, measure)).toBe("AB👨…");
      // Bez segmentera zwykły tekst skraca się tak samo jak z nim.
      expect(fitSingleLine("abcd efg hijk", 100, 20, measure)).toBe("abcd efg…");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("budżet, w którym nie mieści się nawet elipsa, daje pusty napis (bez pętli)", () => {
    expect(fitSingleLine("abcdef", 5, 20, measure)).toBe("");
  });

  it("budżet kickera to szerokość karty minus oba marginesy", () => {
    expect(OG_CARD_MAX_TEXT_WIDTH).toBe(1040);
  });
});
