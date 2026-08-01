// Snapshot cytowań Chicago po hydratacji (PL/EN). Sprawdzamy trzy niezmienniki
// tego formatu w wariancie NES: (1) tytuł otoczony <em>...</em> w wersji HTML,
// (2) separatory to przecinki - nigdy kropki - między segmentami, (3) wersja
// plain-text (schowek) jest identyczna po usunięciu <em>. Test symuluje
// hydratację przez wielokrotne wywołanie tych samych czystych funkcji -
// wynik musi być deterministyczny w obu językach.
import { describe, expect, it } from "vitest";
import { formatChicago, formatChicagoPlain, type CitationSource } from "../format";

const AUTHORS = [
  { firstName: "Anna", lastName: "Kowalska", displayName: null },
  { firstName: "Jan", lastName: "Nowak", displayName: null },
] as const;

function makeSource(lang: "pl" | "en"): CitationSource {
  return {
    authors: AUTHORS,
    title: lang === "pl" ? "Nowa strategia energetyczna UE" : "The new EU energy strategy",
    siteName: "New European Strategies",
    publishedAt: "2026-07-20T10:00:00Z",
    url: "https://neweustrategies.eu/analiza",
    lang,
    accessedOn: null,
  };
}

describe("Chicago citation snapshots (PL/EN, hydratacja)", () => {
  it("PL - HTML: kursywa tytułu, przecinki jako separatory", () => {
    expect(formatChicago(makeSource("pl"))).toMatchInlineSnapshot(
      `"Anna Kowalska i Jan Nowak, <em>Nowa strategia energetyczna UE</em>, New European Strategies, 20 lipca 2026, https://neweustrategies.eu/analiza,"`,
    );
  });

  it("EN - HTML: kursywa tytułu, przecinki jako separatory", () => {
    expect(formatChicago(makeSource("en"))).toMatchInlineSnapshot(
      `"Anna Kowalska and Jan Nowak, <em>The new EU energy strategy</em>, New European Strategies, July 20, 2026, https://neweustrategies.eu/analiza,"`,
    );
  });

  it("PL - plain (schowek): bez HTML, identyczne przecinki i kolejność", () => {
    expect(formatChicagoPlain(makeSource("pl"))).toMatchInlineSnapshot(
      `"Anna Kowalska i Jan Nowak, Nowa strategia energetyczna UE, New European Strategies, 20 lipca 2026, https://neweustrategies.eu/analiza,"`,
    );
  });

  it("EN - plain (schowek): bez HTML, identyczne przecinki i kolejność", () => {
    expect(formatChicagoPlain(makeSource("en"))).toMatchInlineSnapshot(
      `"Anna Kowalska and Jan Nowak, The new EU energy strategy, New European Strategies, July 20, 2026, https://neweustrategies.eu/analiza,"`,
    );
  });

  it("hydratacja: powtórne wywołanie zwraca ten sam string (PL i EN)", () => {
    for (const lang of ["pl", "en"] as const) {
      const src = makeSource(lang);
      const html1 = formatChicago(src);
      const html2 = formatChicago(src);
      const plain1 = formatChicagoPlain(src);
      const plain2 = formatChicagoPlain(src);
      expect(html1).toBe(html2);
      expect(plain1).toBe(plain2);
      // Parytet HTML <-> plain: różnica wyłącznie w tagach <em>.
      expect(html1.replace(/<\/?em>/g, "")).toBe(plain1);
      // Brak kropek jako separatorów - dopuszczamy kropkę tylko w URL/tytule.
      expect(plain1).not.toMatch(/\. /);
    }
  });
});
