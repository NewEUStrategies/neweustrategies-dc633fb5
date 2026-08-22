import { describe, expect, it } from "vitest";
import { buildLlmsTxt } from "@/lib/seo/llms";
import { llmsTxtResourceLines } from "@/lib/seo/machineSurfaces";
import { localizedPath } from "@/lib/i18n/localePath";

describe("buildLlmsTxt", () => {
  const txt = buildLlmsTxt({
    siteName: "New European Strategies",
    origin: "https://nes.example",
    descriptionPl: "Think-tank o bezpieczeństwie.",
    descriptionEn: "A security think-tank.",
    sections: [
      {
        name: "Geopolityka / Geopolitics",
        url: "https://nes.example/category/geo",
        description: "Analizy",
      },
    ],
    latestPl: [
      {
        title: "Wpis PL",
        url: "https://nes.example/blog/wpis",
        description: "Zajawka",
        publishedAt: "2026-07-01T10:00:00Z",
      },
    ],
    latestEn: [{ title: "EN post", url: "https://nes.example/en/blog/post" }],
    // Zasoby maszynowe przychodzą teraz z rejestru (seo/machineSurfaces), a nie
    // z twardej listy w builderze - patrz machineSurfaces.contract.test.ts.
    resources: llmsTxtResourceLines("https://nes.example", localizedPath),
    contactEmail: "office@nes.example",
  });

  it("follows the llms.txt structure (H1 + blockquote + sections)", () => {
    expect(txt.startsWith("# New European Strategies\n")).toBe(true);
    expect(txt).toContain("> Think-tank o bezpieczeństwie.");
    expect(txt).toContain("## Sekcje / Sections");
    expect(txt).toContain(
      "- [Geopolityka / Geopolitics](https://nes.example/category/geo): Analizy",
    );
  });
  it("lists articles per language with dates", () => {
    expect(txt).toContain("- [Wpis PL](https://nes.example/blog/wpis): Zajawka (2026-07-01)");
    expect(txt).toContain("## Latest articles (EN)");
    expect(txt).toContain("- [EN post](https://nes.example/en/blog/post)");
  });
  it("advertises the machine-readable surfaces and contact", () => {
    expect(txt).toContain("https://nes.example/sitemap.xml");
    expect(txt).toContain("https://nes.example/news-sitemap.xml");
    expect(txt).toContain("https://nes.example/en/rss.xml");
    expect(txt).toContain("Kontakt / Contact: office@nes.example");
  });
});

describe("llms.txt - zasoby maszynowe trackera", () => {
  const txt = buildLlmsTxt({
    siteName: "NES",
    origin: "https://nes.example",
    descriptionPl: "Opis",
    descriptionEn: "Description",
    sections: [],
    latestPl: [],
    latestEn: [],
    resources: llmsTxtResourceLines("https://nes.example", localizedPath),
  });

  it("wystawia kanał trackera w obu językach", () => {
    expect(txt).toContain("https://nes.example/tracker/rss.xml");
    expect(txt).toContain("https://nes.example/en/tracker/rss.xml");
  });
});

// ---------------------------------------------------------------------------
// ETAP 4: gałąź opisu sekcji (llms.ts:65) - `section.description?.trim()`.
// Sekcje przychodzą z drzewa treści redakcji, więc opis bywa nieustawiony,
// wyzerowany albo złożony z samych spacji. Puste `": "` w llms.txt to śmieć,
// który model przepisuje do odpowiedzi razem z nazwą sekcji.
// (Trasa /llms.txt jako CAŁOŚĆ jest dowiedziona bajtami w `e2e/seo.spec.ts`,
// test "llms.txt is text/plain and lists sections" - tutaj tylko builder.)
// ---------------------------------------------------------------------------
describe("buildLlmsTxt - sekcje z niepełnym opisem", () => {
  const txt = buildLlmsTxt({
    siteName: "NES",
    origin: "https://nes.example",
    descriptionPl: "Opis",
    descriptionEn: "Description",
    sections: [
      { name: "Brak pola opisu", url: "https://nes.example/a" },
      { name: "Opis null", url: "https://nes.example/b", description: null },
      { name: "Opis pusty", url: "https://nes.example/c", description: "" },
      { name: "Opis z samych spacji", url: "https://nes.example/d", description: "   \n  " },
      { name: "Opis w spacjach", url: "https://nes.example/e", description: "  Analizy  " },
    ],
    latestPl: [],
    latestEn: [],
    resources: [],
  });

  it.each([
    { label: "brakiem pola", expected: "- [Brak pola opisu](https://nes.example/a)" },
    { label: "opisem null", expected: "- [Opis null](https://nes.example/b)" },
    { label: "opisem pustym", expected: "- [Opis pusty](https://nes.example/c)" },
    {
      label: "opisem z samych spacji",
      expected: "- [Opis z samych spacji](https://nes.example/d)",
    },
  ])("emituje sam link (bez wiszącego dwukropka) dla sekcji z $label", ({ expected }) => {
    expect(txt).toContain(`${expected}\n`);
  });

  it("przycina opis, gdy jest realny", () => {
    expect(txt).toContain("- [Opis w spacjach](https://nes.example/e): Analizy\n");
  });

  it("nie zostawia w pliku ani jednego pustego dwukropka po nawiasie", () => {
    expect(txt).not.toMatch(/\): *$/m);
    expect(txt).not.toContain("): \n");
  });

  it("pomija nagłówki list, których nie ma czym wypełnić", () => {
    // Puste `latestPl`/`latestEn`/`resources` nie mogą zostawić nagłówka bez
    // treści - model przepisałby "Najnowsze artykuły" jako fakt o serwisie.
    expect(txt).not.toContain("## Najnowsze artykuły (PL)");
    expect(txt).not.toContain("## Latest articles (EN)");
    // Sekcja zasobów maszynowych jest ogłaszana ZAWSZE (kontrakt llmstxt.org),
    // nawet gdy rejestr nic nie zwrócił - patrz machineSurfaces.contract.test.ts.
    expect(txt).toContain("## Zasoby maszynowe / Machine-readable resources");
    expect(txt).toContain("## Zasady cytowania / Citation policy");
  });

  it("pomija linię kontaktu, gdy adres jest pusty albo z samych spacji", () => {
    for (const contactEmail of [undefined, null, "", "   "]) {
      const out = buildLlmsTxt({
        siteName: "NES",
        origin: "https://nes.example",
        descriptionPl: "Opis",
        descriptionEn: "Description",
        sections: [],
        latestPl: [],
        latestEn: [],
        resources: [],
        contactEmail,
      });
      expect(out).not.toContain("Kontakt / Contact:");
      expect(out).not.toContain("## Sekcje / Sections");
      expect(out.endsWith("\n")).toBe(true);
    }
  });
});
