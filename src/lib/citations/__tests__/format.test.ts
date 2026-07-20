import { describe, it, expect } from "vitest";
import {
  buildCitations,
  formatApa,
  formatBibtex,
  formatChicago,
  type CitationSource,
} from "../format";

const base: CitationSource = {
  authors: [{ firstName: "Anna", lastName: "Kowalska", displayName: null }],
  title: "Bezpieczeństwo energetyczne Europy Środkowej",
  siteName: "New European Strategies",
  publishedAt: "2026-07-20T08:30:00.000Z",
  url: "https://neweuropeanstrategies.com/analizy/bezpieczenstwo-energetyczne",
  lang: "pl",
};

describe("formatChicago", () => {
  it("formatuje pojedynczego autora po polsku (inwersja, polskie cudzysłowy)", () => {
    expect(formatChicago(base)).toBe(
      "Kowalska, Anna. „Bezpieczeństwo energetyczne Europy Środkowej”. " +
        "New European Strategies, 20 lipca 2026. " +
        "https://neweuropeanstrategies.com/analizy/bezpieczenstwo-energetyczne.",
    );
  });

  it("formatuje wielu autorów po angielsku (pierwszy w inwersji, Oxford comma)", () => {
    const source: CitationSource = {
      ...base,
      lang: "en",
      title: "Energy Security in Central Europe",
      authors: [
        { firstName: "Anna", lastName: "Kowalska", displayName: null },
        { firstName: "Jan", lastName: "Nowak", displayName: null },
        { firstName: "Eva", lastName: "Marsh", displayName: null },
      ],
    };
    expect(formatChicago(source)).toBe(
      "Kowalska, Anna, Jan Nowak, and Eva Marsh. “Energy Security in Central Europe.” " +
        "New European Strategies, July 20, 2026. " +
        "https://neweuropeanstrategies.com/analizy/bezpieczenstwo-energetyczne.",
    );
  });

  it("bez daty publikacji podaje datę dostępu", () => {
    const source: CitationSource = { ...base, publishedAt: null, accessedOn: "2026-07-21" };
    expect(formatChicago(source)).toContain("Udostępniono 21 lipca 2026.");
  });

  it("radzi sobie z autorem tylko z displayName", () => {
    const source: CitationSource = {
      ...base,
      authors: [{ firstName: null, lastName: null, displayName: "Zespół NES" }],
    };
    expect(formatChicago(source)).toMatch(/^NES, Zespół\./);
  });

  it("pomija segment autora, gdy brak autorów", () => {
    const source: CitationSource = { ...base, authors: [] };
    expect(formatChicago(source)).toMatch(/^„Bezpieczeństwo/);
  });
});

describe("formatApa", () => {
  it("formatuje inicjały i datę dzienną po polsku", () => {
    expect(formatApa(base)).toBe(
      "Kowalska, A. (2026, 20 lipca). Bezpieczeństwo energetyczne Europy Środkowej. " +
        "New European Strategies. " +
        "https://neweuropeanstrategies.com/analizy/bezpieczenstwo-energetyczne",
    );
  });

  it("łączy autorów ampersandem i skraca wieloczłonowe imiona", () => {
    const source: CitationSource = {
      ...base,
      lang: "en",
      authors: [
        { firstName: "Anna Maria", lastName: "Kowalska", displayName: null },
        { firstName: "Jan", lastName: "Nowak", displayName: null },
      ],
    };
    expect(formatApa(source)).toContain("Kowalska, A. M., & Nowak, J.");
    expect(formatApa(source)).toContain("(2026, July 20).");
  });

  it("bez daty publikacji: (b.d.) i 'Pobrano ... z' z datą dostępu", () => {
    const source: CitationSource = { ...base, publishedAt: null, accessedOn: "2026-07-21" };
    const apa = formatApa(source);
    expect(apa).toContain("(b.d.).");
    expect(apa).toContain("Pobrano 21 lipca 2026, z https://");
  });
});

describe("formatBibtex", () => {
  it("buduje wpis @online z kluczem ASCII z nazwiska i roku", () => {
    const bib = formatBibtex({ ...base, accessedOn: "2026-07-21" });
    expect(bib).toContain("@online{kowalska2026,");
    expect(bib).toContain("author       = {Kowalska, Anna},");
    expect(bib).toContain("title        = {Bezpieczeństwo energetyczne Europy Środkowej},");
    expect(bib).toContain("organization = {New European Strategies},");
    expect(bib).toContain("date         = {2026-07-20},");
    expect(bib).toContain("urldate      = {2026-07-21},");
    expect(bib).toContain("langid       = {polish},");
    expect(bib.endsWith("}")).toBe(true);
  });

  it("transliteruje polskie znaki w kluczu (Żółć -> zolc)", () => {
    const bib = formatBibtex({
      ...base,
      authors: [{ firstName: "Łukasz", lastName: "Żółć-Ćma", displayName: null }],
    });
    expect(bib).toContain("@online{zolccma2026,");
  });

  it("escapuje znaki specjalne LaTeX-a i usuwa klamry z tytułu", () => {
    const bib = formatBibtex({
      ...base,
      title: "Podatki & cła: 50% {wzrostu} #CEE_2026",
    });
    expect(bib).toContain("title        = {Podatki \\& cła: 50\\% wzrostu \\#CEE\\_2026},");
  });

  it("pomija urldate i date przy braku dat", () => {
    const bib = formatBibtex({ ...base, publishedAt: null });
    expect(bib).not.toContain("urldate");
    expect(bib).not.toContain("date         =");
    expect(bib).toContain("@online{kowalska,");
  });
});

describe("buildCitations", () => {
  it("zwraca komplet trzech spójnych formatów", () => {
    const all = buildCitations(base);
    expect(all.chicago).toContain("Kowalska");
    expect(all.apa).toContain("Kowalska");
    expect(all.bibtex).toContain("kowalska2026");
  });
});
