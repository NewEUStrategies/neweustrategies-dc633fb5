// Walidacja i fallbacki dla niekompletnych danych wejściowych generatora
// cytowań. Niezmienniki: (1) autor bez lastName ale z firstName pojawia się
// w cytacie, (2) puste siteName/URL/title nie tworzą podwójnych przecinków
// ani wiszących separatorów, (3) autorzy z pustym display'em są pomijani
// bez wywracania listy, (4) łącznik "i"/"and" pozostaje poprawny gdy jedna
// pozycja wypada, (5) parytet HTML <-> plain (schowek) trzyma się w każdym
// przypadku.
import { describe, expect, it } from "vitest";
import {
  formatChicago,
  formatChicagoPlain,
  type CitationAuthor,
  type CitationSource,
} from "../format";

function src(
  authors: readonly CitationAuthor[],
  overrides: Partial<CitationSource> = {},
): CitationSource {
  return {
    authors,
    title: "Analiza",
    siteName: "New European Strategies",
    publishedAt: "2026-07-20T10:00:00Z",
    url: "https://neweustrategies.eu/x",
    lang: "pl",
    accessedOn: null,
    ...overrides,
  };
}

const stripEm = (s: string) => s.replace(/<\/?em>/g, "");
const noDoubleCommas = (s: string) => expect(s).not.toMatch(/,\s*,/);
const noTrailingCommaSpace = (s: string) => expect(s).not.toMatch(/,\s+$/);

describe("Chicago - walidacja i fallbacki", () => {
  it("autor tylko z firstName -> pojawia się jako family (nie znika)", () => {
    const out = formatChicago(
      src([{ firstName: "Anna", lastName: null, displayName: null }]),
    );
    expect(out).toContain("Anna,");
    noDoubleCommas(out);
  });

  it("autor tylko z displayName jednowyrazowym -> family", () => {
    const out = formatChicagoPlain(
      src([{ firstName: null, lastName: null, displayName: "OECD" }]),
    );
    expect(out.startsWith("OECD,")).toBe(true);
  });

  it("displayName z nadmiarowymi spacjami -> normalizacja", () => {
    const out = formatChicagoPlain(
      src([{ firstName: null, lastName: null, displayName: "  Anna   Maria   Kowalska  " }]),
    );
    expect(out.startsWith("Anna Maria Kowalska,")).toBe(true);
  });

  it("mieszani autorzy: pusty rekord pomijany, łącznik zostaje poprawny", () => {
    const out = formatChicago(
      src([
        { firstName: "Anna", lastName: "Kowalska", displayName: null },
        { firstName: null, lastName: null, displayName: "   " }, // odpada
        { firstName: "Jan", lastName: "Nowak", displayName: null },
      ]),
    );
    expect(out).toContain("Anna Kowalska i Jan Nowak,");
    noDoubleCommas(out);
  });

  it("wszyscy autorzy pomijalni -> segment autora nie jest emitowany", () => {
    const out = formatChicagoPlain(
      src([
        { firstName: "  ", lastName: "  ", displayName: "" },
        { firstName: null, lastName: null, displayName: null },
      ]),
    );
    expect(out.startsWith("Analiza,")).toBe(true);
    noDoubleCommas(out);
  });

  it("brak siteName -> nie generuje pustego segmentu przed datą", () => {
    const out = formatChicagoPlain(src([], { siteName: "   " }));
    // Oczekujemy: "Analiza, 20 lipca 2026, https://..."
    expect(out).toBe("Analiza, 20 lipca 2026, https://neweustrategies.eu/x,");
    noDoubleCommas(out);
  });

  it("brak URL -> nie wisi końcowy przecinek za samym separatorem", () => {
    const out = formatChicagoPlain(src([], { url: "" }));
    noDoubleCommas(out);
    // URL nie powinien pojawić się w wyniku.
    expect(out).not.toMatch(/https?:/);
  });

  it("pusty tytuł -> deterministyczny fallback językowy (PL/EN)", () => {
    const pl = formatChicago(src([], { title: "   " }));
    const en = formatChicago(src([], { title: "", lang: "en", publishedAt: null }));
    expect(pl).toContain("<em>[bez tytułu]</em>,");
    expect(en).toContain("<em>[untitled]</em>,");
  });

  it("brak publishedAt + accessedOn -> segment 'Udostępniono/Accessed'", () => {
    const pl = formatChicagoPlain(
      src([], { publishedAt: null, accessedOn: "2026-08-01" }),
    );
    const en = formatChicagoPlain(
      src([], { publishedAt: null, accessedOn: "2026-08-01", lang: "en" }),
    );
    expect(pl).toContain("Udostępniono 1 sierpnia 2026,");
    expect(en).toContain("Accessed August 1, 2026,");
    noDoubleCommas(pl);
    noDoubleCommas(en);
  });

  it("parytet HTML <-> plain trzyma się dla skrajnych danych", () => {
    const cases: CitationSource[] = [
      src([{ firstName: "Anna", lastName: null, displayName: null }]),
      src([], { siteName: "", url: "" }),
      src([], { publishedAt: null, accessedOn: "2026-08-01", lang: "en" }),
      src([], { title: "" }),
    ];
    for (const s of cases) {
      const html = formatChicago(s);
      const plain = formatChicagoPlain(s);
      expect(stripEm(html)).toBe(plain);
      noDoubleCommas(html);
      noDoubleCommas(plain);
      noTrailingCommaSpace(html);
      noTrailingCommaSpace(plain);
    }
  });
});
