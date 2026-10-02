// Brzegi formatów, których główne pliki nie dotykają: autor z samym
// nazwiskiem, data nieparsowalna, cytat EN bez daty, nazwisko spoza alfabetu
// łacińskiego w kluczu BibTeX - oraz data dostępu w strefie czytelnika.
import { afterEach, describe, expect, it } from "vitest";
import {
  formatApa,
  formatBibtex,
  formatChicago,
  localAccessDate,
  type CitationSource,
} from "../format";

const base: CitationSource = {
  authors: [{ firstName: "Anna", lastName: "Kowalska", displayName: null }],
  title: "Bezpieczeństwo energetyczne",
  siteName: "New European Strategies",
  publishedAt: "2026-07-20T08:30:00.000Z",
  url: "https://neweuropeanstrategies.com/analizy/a",
  lang: "pl",
};

describe("localAccessDate - dzień czytelnika, nie dzień UTC", () => {
  const ORIGINAL_TZ = process.env.TZ;

  afterEach(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });

  it("w Warszawie tuż po północy to już NOWY dzień (UTC jest jeszcze wczoraj)", () => {
    process.env.TZ = "Europe/Warsaw";
    const justAfterMidnight = new Date("2026-07-20T22:30:00.000Z"); // 00:30 CEST

    expect(localAccessDate(justAfterMidnight)).toBe("2026-07-21");
    expect(justAfterMidnight.toISOString().slice(0, 10)).toBe("2026-07-20");
  });

  it("w Nowym Jorku wieczorem to WCIĄŻ dzisiaj (UTC jest już jutro)", () => {
    process.env.TZ = "America/New_York";
    const evening = new Date("2026-01-05T03:15:00.000Z"); // 22:15 EST, 4 stycznia

    expect(localAccessDate(evening)).toBe("2026-01-04");
    expect(evening.toISOString().slice(0, 10)).toBe("2026-01-05");
  });
});

describe("autor z samym nazwiskiem", () => {
  const source: CitationSource = {
    ...base,
    authors: [{ firstName: null, lastName: "  Nowak ", displayName: "Ignorowany Podpis" }],
  };

  it("nazwisko wygrywa z displayName we wszystkich trzech formatach", () => {
    expect(formatChicago(source).startsWith("Nowak, <em>")).toBe(true);
    expect(formatApa(source).startsWith("Nowak. (2026, 20 lipca).")).toBe(true);
    expect(formatBibtex(source)).toContain("author       = {Nowak},");
    expect(formatChicago(source)).not.toContain("Podpis");
  });
});

describe("data publikacji nieparsowalna", () => {
  const source: CitationSource = { ...base, publishedAt: "nie-data", accessedOn: "2026-07-22" };

  it("traktuje źródło jak niedatowane - z datą dostępu zamiast daty-widma", () => {
    expect(formatChicago(source)).toContain("New European Strategies, Udostępniono 22 lipca 2026,");
    expect(formatApa(source)).toContain("(b.d.).");
    expect(formatChicago(source)).not.toContain("NaN");
    expect(formatApa(source)).not.toContain("NaN");
  });

  it("BibTeX nie dostaje pola date ani roku w kluczu", () => {
    const bib = formatBibtex(source);

    expect(bib).toContain("@online{kowalska,");
    expect(bib).not.toContain("date         =");
    expect(bib).toContain("urldate      = {2026-07-22},");
  });
});

describe("APA po angielsku bez daty publikacji", () => {
  it("używa (n.d.) i formuły 'Retrieved …, from'", () => {
    const apa = formatApa({ ...base, lang: "en", publishedAt: null, accessedOn: "2026-07-21" });

    expect(apa).toContain("Kowalska, A. (n.d.).");
    expect(apa).toContain("Retrieved July 21, 2026, from https://neweuropeanstrategies.com/");
  });

  it("bez daty dostępu kończy samym adresem", () => {
    const apa = formatApa({ ...base, lang: "en", publishedAt: null });

    expect(apa).toContain("(n.d.).");
    expect(apa.endsWith(" https://neweuropeanstrategies.com/analizy/a")).toBe(true);
    expect(apa).not.toContain("Retrieved");
  });
});

describe("klucz BibTeX dla nazwiska spoza alfabetu łacińskiego", () => {
  it("cyrylica składa się do pustego ASCII - klucz wraca do prefiksu serwisu", () => {
    const bib = formatBibtex({
      ...base,
      authors: [{ firstName: "Иван", lastName: "Иванов", displayName: null }],
    });

    expect(bib).toContain("@online{nes2026,");
    // Pole autora zachowuje oryginalny zapis - zmienia się tylko klucz.
    expect(bib).toContain("author       = {Иванов, Иван},");
  });
});
