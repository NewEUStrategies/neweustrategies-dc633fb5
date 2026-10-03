import { describe, expect, it } from "vitest";
import { buildLlmsTxt, LLMS_TXT_USAGE_TERMS_HEADING, type LlmsTxtInput } from "@/lib/seo/llms";
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
    usage: { aiInputAllowed: true, trainingAllowed: true },
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
    usage: { aiInputAllowed: true, trainingAllowed: true },
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
    usage: { aiInputAllowed: true, trainingAllowed: true },
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
    expect(txt).toContain("## Warunki wykorzystania i cytowania / Usage and citation terms");
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
        usage: { aiInputAllowed: true, trainingAllowed: true },
        contactEmail,
      });
      expect(out).not.toContain("Kontakt / Contact:");
      expect(out).not.toContain("## Sekcje / Sections");
      expect(out.endsWith("\n")).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Blok warunków jako LUSTRO polityki AI redakcji (defekt audytu wydania 11).
// `LlmsTxtInput` nie miał pola polityki, więc builder deklarował zgodę
// („PERMITTED") bezwarunkowo - przy wyłączonych crawlerach AI llms.txt udzielał
// zgody, której robots.txt tego samego hosta odmawiał. Parytet na bajtach obu
// tras dowodzi `feedRoutesDegradation.test.ts`; tu - każdy wariant buildera.
// ---------------------------------------------------------------------------
describe("buildLlmsTxt - warunki wykorzystania wynikają z polityki AI", () => {
  const base: Omit<LlmsTxtInput, "usage"> = {
    siteName: "Redakcja Testowa",
    origin: "https://tenant.example/",
    descriptionPl: "Opis",
    descriptionEn: "Description",
    sections: [],
    latestPl: [],
    latestEn: [],
    resources: [],
  };

  /** Sam blok warunków - asercje nie mogą trafić w treść spoza niego. */
  function terms(usage: LlmsTxtInput["usage"]): string {
    const txt = buildLlmsTxt({ ...base, usage });
    const at = txt.indexOf(LLMS_TXT_USAGE_TERMS_HEADING);
    expect(at, "blok warunków jest zawsze obecny").toBeGreaterThan(-1);
    return txt.slice(at);
  }

  const MATRIX = [true, false].flatMap((aiInputAllowed) =>
    [true, false].map((trainingAllowed) => ({ aiInputAllowed, trainingAllowed })),
  );

  it.each(MATRIX)(
    "ai-input=$aiInputAllowed, ai-train=$trainingAllowed: zgody zgodne z przełącznikami",
    (usage) => {
      const block = terms(usage);
      expect(block.includes("PERMITTED on one condition")).toBe(usage.aiInputAllowed);
      expect(block.includes("DOZWOLONE pod jednym warunkiem")).toBe(usage.aiInputAllowed);
      expect(block.includes("PROHIBITED")).toBe(!usage.aiInputAllowed);
      expect(block.includes("ZABRONIONE")).toBe(!usage.aiInputAllowed);
      expect(block.includes("Cite the canonical article URLs")).toBe(usage.aiInputAllowed);
      expect(block.includes("ai-train=yes")).toBe(usage.trainingAllowed);
      expect(block.includes("ai-train=no")).toBe(!usage.trainingAllowed);
      expect(block.includes("requires a written licence")).toBe(!usage.trainingAllowed);
      // Zgoda na indeksowanie przy zakazie cytowania dotyczy TYLKO klasycznych
      // wyszukiwarek (grupa `*`) - crawlery wyszukiwawcze AI mają `Disallow: /`.
      expect(block.includes("AI search crawlers are disallowed in robots.txt")).toBe(
        !usage.aiInputAllowed,
      );
      expect(block).not.toContain("Search-engine indexing remains permitted");
    },
  );

  it.each(MATRIX)(
    "ai-input=$aiInputAllowed, ai-train=$trainingAllowed: warunek wskazania źródła nazywa siteName i tylko ją",
    (usage) => {
      const block = terms(usage);
      // robots.txt stawia warunek atrybucji niezależnie od przełączników -
      // llms.txt nie może go zdejmować w żadnym wariancie z polityką.
      expect(block).toMatch(/MUST name "Redakcja Testowa" as the source/);
      expect(block).toMatch(/MUSI wskazać "Redakcja Testowa" jako źródło/);
      const quoted = new Set(Array.from(block.matchAll(/"([^"]+)"/g), (m) => m[1]));
      expect([...quoted]).toEqual(["Redakcja Testowa"]);
    },
  );

  it("usage=null (warunki nieznane) nie udziela żadnej zgody i odsyła do robots.txt", () => {
    const block = terms(null);
    expect(block).not.toContain("PERMITTED");
    expect(block).not.toContain("DOZWOLONE");
    expect(block).not.toMatch(/permitted/i);
    expect(block).not.toContain("Redakcja Testowa");
    expect(block).toContain("This document grants no permission to reuse content");
    expect(block).toContain("Wiążąca polityka maszynowa: https://tenant.example/robots.txt");
  });

  it("usage=null daje bajtowo ten sam blok, który trasa wcześniej doklejała ręcznie", () => {
    // Odpowiednik usuniętego `withoutUsageGrant` z trasy: nagłówek, pusta
    // linia, dwa zdania, jeden znak końca pliku.
    const txt = buildLlmsTxt({ ...base, usage: null });
    expect(
      txt.endsWith(
        [
          "",
          LLMS_TXT_USAGE_TERMS_HEADING,
          "",
          "- Ten dokument nie udziela zgody na wykorzystanie treści - warunki serwisu są chwilowo niedostępne. Wiążąca polityka maszynowa: https://tenant.example/robots.txt (Content-Signal).",
          "- This document grants no permission to reuse content - the site's terms are temporarily unavailable. Binding machine-readable policy: https://tenant.example/robots.txt (Content-Signal).",
          "",
        ].join("\n"),
      ),
    ).toBe(true);
  });

  it("odsyłacz do robots.txt nie podwaja ukośnika przy originie zakończonym '/'", () => {
    for (const usage of [...MATRIX, null]) {
      const block = terms(usage);
      expect(block).toContain("https://tenant.example/robots.txt");
      expect(block).not.toContain("example//robots.txt");
    }
  });

  it("kontakt zostaje POD blokiem warunków we wszystkich wariantach", () => {
    for (const usage of [...MATRIX, null]) {
      const txt = buildLlmsTxt({ ...base, usage, contactEmail: "office@tenant.example" });
      expect(txt.indexOf("Kontakt / Contact:")).toBeGreaterThan(
        txt.indexOf(LLMS_TXT_USAGE_TERMS_HEADING),
      );
      expect(txt.endsWith("Kontakt / Contact: office@tenant.example\n")).toBe(true);
    }
  });
});
