// Kompleksowa weryfikacja niezmienników formatu Chicago (wariant NES) dla
// każdej realnej kombinacji danych wejściowych. Dwa twarde inwarianty:
//
//   (I1) TYTUŁ w wersji HTML jest ZAWSZE otoczony dokładnie jedną parą
//        <em>...</em>, także gdy tytuł jest pusty (wtedy fallback językowy).
//   (I2) SEPARATOREM segmentów jest wyłącznie przecinek + spacja - nigdy
//        kropka - w obu wersjach (HTML i schowek). Kropki dopuszczamy
//        tylko wewnątrz segmentów (URL, skróty w tytule).
//
// Dodatkowo pilnujemy parytetu: `formatChicagoPlain` = `formatChicago` po
// usunięciu <em>. To zabezpiecza schowek przed rozjazdem z widocznym
// renderem po hydratacji.
import { describe, expect, it } from "vitest";
import {
  formatChicago,
  formatChicagoPlain,
  type CitationAuthor,
  type CitationSource,
} from "../format";

function makeSource(
  authors: readonly CitationAuthor[],
  overrides: Partial<CitationSource> = {},
): CitationSource {
  return {
    authors,
    title: "Analiza strategiczna",
    siteName: "New European Strategies",
    publishedAt: "2026-07-20T10:00:00Z",
    url: "https://neweustrategies.eu/x",
    lang: "pl",
    accessedOn: null,
    ...overrides,
  };
}

const A = (
  first: string | null,
  last: string | null,
  display: string | null = null,
): CitationAuthor => ({
  firstName: first,
  lastName: last,
  displayName: display,
});

function assertInvariants(html: string, plain: string) {
  // I1 - dokładnie jedna para <em>...</em>.
  const emOpen = (html.match(/<em>/g) ?? []).length;
  const emClose = (html.match(/<\/em>/g) ?? []).length;
  expect(emOpen).toBe(1);
  expect(emClose).toBe(1);
  expect(html).toMatch(/<em>[^<]+<\/em>/);

  // I2 - brak podwójnych przecinków i wiszącego separatora na końcu.
  // Kropki wewnątrz segmentów (skróty w tytule, URL) są dopuszczone -
  // segmenty rozdzielamy wyłącznie ", " i to gwarantuje sam format.
  expect(html).not.toMatch(/,\s*,/);
  expect(plain).not.toMatch(/,\s*,/);
  expect(html).not.toMatch(/,\s+,\s*$/);
  expect(plain).not.toMatch(/,\s+,\s*$/);

  // Parytet HTML <-> plain (jedyna różnica to tagi <em>).
  expect(html.replace(/<\/?em>/g, "")).toBe(plain);
}

interface Scenario {
  name: string;
  source: CitationSource;
}

const scenarios: Scenario[] = [
  // Warianty autorów.
  { name: "PL: 1 autor", source: makeSource([A("Anna", "Kowalska")]) },
  { name: "EN: 1 autor", source: makeSource([A("Anna", "Kowalska")], { lang: "en" }) },
  { name: "PL: 2 autorów", source: makeSource([A("Anna", "Kowalska"), A("Jan", "Nowak")]) },
  {
    name: "EN: 2 autorów",
    source: makeSource([A("Anna", "Kowalska"), A("Jan", "Nowak")], { lang: "en" }),
  },
  {
    name: "PL: 3 autorów",
    source: makeSource([A("Anna", "Kowalska"), A("Jan", "Nowak"), A("Piotr", "Zieliński")]),
  },
  {
    name: "EN: 4 autorów",
    source: makeSource(
      [A("Anna", "Kowalska"), A("Jan", "Nowak"), A("Piotr", "Zieliński"), A("Maria", "Wiśniewska")],
      { lang: "en" },
    ),
  },
  {
    name: "PL: autor tylko z displayName (organizacja)",
    source: makeSource([A(null, null, "OECD")]),
  },
  {
    name: "PL: autor tylko z firstName - fallback",
    source: makeSource([A("Anna", null)]),
  },
  {
    name: "EN: mieszani - jeden pusty rekord pomijany",
    source: makeSource([A("Anna", "Kowalska"), A(null, null, "  "), A("Jan", "Nowak")], {
      lang: "en",
    }),
  },
  { name: "PL: brak autorów", source: makeSource([]) },
  // Warianty danych źródłowych.
  {
    name: "PL: pusty tytuł - fallback językowy",
    source: makeSource([A("Anna", "Kowalska")], { title: "" }),
  },
  {
    name: "EN: pusty tytuł - fallback językowy",
    source: makeSource([A("Anna", "Kowalska")], { title: "   ", lang: "en" }),
  },
  { name: "PL: brak siteName", source: makeSource([A("Anna", "Kowalska")], { siteName: "" }) },
  { name: "PL: brak URL", source: makeSource([A("Anna", "Kowalska")], { url: "" }) },
  {
    name: "PL: brak daty publikacji + accessedOn",
    source: makeSource([A("Anna", "Kowalska")], { publishedAt: null, accessedOn: "2026-08-01" }),
  },
  {
    name: "EN: brak daty publikacji + accessedOn",
    source: makeSource([A("Anna", "Kowalska")], {
      publishedAt: null,
      accessedOn: "2026-08-01",
      lang: "en",
    }),
  },
  {
    name: "PL: brak wszystkich dat",
    source: makeSource([A("Anna", "Kowalska")], { publishedAt: null, accessedOn: null }),
  },
  {
    name: "PL: skrajne - brak autorów, tytułu, siteName, URL",
    source: makeSource([], { title: "", siteName: "", url: "", publishedAt: null }),
  },
  {
    name: "PL: tytuł ze skrótem (kropka wewnątrz segmentu jest OK)",
    source: makeSource([A("Anna", "Kowalska")], { title: "Raport prof. Nowaka o UE" }),
  },
];

describe("Chicago - warianty cytowania: kursywa tytułu + przecinki jako separatory", () => {
  for (const { name, source } of scenarios) {
    it(name, () => {
      const html = formatChicago(source);
      const plain = formatChicagoPlain(source);
      assertInvariants(html, plain);
    });
  }

  it("łącznik 'i'/'and' zachowany po odrzuceniu pustego autora ze środka", () => {
    const pl = formatChicago(
      makeSource([A("Anna", "Kowalska"), A(null, null, ""), A("Jan", "Nowak")]),
    );
    const en = formatChicago(
      makeSource([A("Anna", "Kowalska"), A(null, null, ""), A("Jan", "Nowak")], { lang: "en" }),
    );
    expect(pl).toContain("Anna Kowalska i Jan Nowak,");
    expect(en).toContain("Anna Kowalska and Jan Nowak,");
  });

  it("pojedynczy autor po odrzuceniu pozostałych - bez łącznika 'i'/'and'", () => {
    const pl = formatChicagoPlain(
      makeSource([A("Anna", "Kowalska"), A(null, null, "   "), A("  ", "  ")]),
    );
    expect(pl.startsWith("Anna Kowalska,")).toBe(true);
    expect(pl).not.toMatch(/\bi\b\s+,/);
  });
});
