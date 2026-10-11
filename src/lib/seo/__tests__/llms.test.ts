import { describe, expect, it } from "vitest";
import {
  buildLlmsTxt,
  LLMS_TXT_USAGE_TERMS_LABEL,
  llmsTxtTaxonomy,
  resolvePrimarySectionHref,
  type LlmsTxtCategory,
  type LlmsTxtInput,
} from "@/lib/seo/llms";
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

describe("llms.txt - sekcje główne", () => {
  const base = {
    siteName: "NES",
    origin: "https://nes.example",
    descriptionPl: "Opis",
    descriptionEn: "Description",
    sections: [{ name: "Geopolityka", url: "https://nes.example/category/geo" }],
    latestPl: [],
    latestEn: [],
    resources: [],
    usage: { aiInputAllowed: true, trainingAllowed: true },
  } satisfies LlmsTxtInput;

  it("publikuje sekcje główne w podanej kolejności, PRZED kategoriami", () => {
    const txt = buildLlmsTxt({
      ...base,
      primarySections: [
        { name: "Analizy / Analyses", url: "https://nes.example/analizy" },
        { name: "Wywiady / Interviews", url: "https://nes.example/category/wywiady" },
        { name: "Wydarzenia / Events", url: "https://nes.example/wydarzenia" },
      ],
    });
    const key = txt.indexOf("## Najważniejsze sekcje / Key sections");
    expect(key).toBeGreaterThan(-1);
    expect(key).toBeLessThan(txt.indexOf("## Sekcje / Sections"));
    const analizy = txt.indexOf("- [Analizy / Analyses](https://nes.example/analizy)");
    const wywiady = txt.indexOf("- [Wywiady / Interviews](https://nes.example/category/wywiady)");
    const wydarzenia = txt.indexOf("- [Wydarzenia / Events](https://nes.example/wydarzenia)");
    expect(analizy).toBeGreaterThan(key);
    expect(wywiady).toBeGreaterThan(analizy);
    expect(wydarzenia).toBeGreaterThan(wywiady);
  });

  it("bez sekcji głównych nie emituje pustego nagłówka", () => {
    expect(buildLlmsTxt(base)).not.toContain("## Najważniejsze sekcje");
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
    expect(txt).toContain(LLMS_TXT_USAGE_TERMS_LABEL);
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
    const at = txt.indexOf(LLMS_TXT_USAGE_TERMS_LABEL);
    expect(at, "blok warunków jest zawsze obecny").toBeGreaterThan(-1);
    // Blok kończy się na pierwszej sekcji `##` - od 2026-10 stoi w treści
    // swobodnej nad listami, a nie na końcu pliku.
    const end = txt.indexOf("\n## ", at);
    return txt.slice(at, end === -1 ? undefined : end);
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
    // Odpowiednik usuniętego `withoutUsageGrant` z trasy: tytuł bloku, pusta
    // linia, dwa zdania. Od 2026-10 blok stoi w treści swobodnej PRZED
    // pierwszym `##` (llmstxt.org: pod `##` wolno tylko listy odnośników).
    const txt = buildLlmsTxt({ ...base, usage: null });
    const block = [
      "",
      LLMS_TXT_USAGE_TERMS_LABEL,
      "",
      "- Ten dokument nie udziela zgody na wykorzystanie treści - warunki serwisu są chwilowo niedostępne. Wiążąca polityka maszynowa: https://tenant.example/robots.txt (Content-Signal).",
      "- This document grants no permission to reuse content - the site's terms are temporarily unavailable. Binding machine-readable policy: https://tenant.example/robots.txt (Content-Signal).",
      "",
    ].join("\n");
    expect(txt).toContain(block);
    expect(txt.indexOf(block)).toBeLessThan(txt.indexOf("\n## "));
  });

  it("odsyłacz do robots.txt nie podwaja ukośnika przy originie zakończonym '/'", () => {
    for (const usage of [...MATRIX, null]) {
      const block = terms(usage);
      expect(block).toContain("https://tenant.example/robots.txt");
      expect(block).not.toContain("example//robots.txt");
    }
  });

  it("kontakt zostaje POD blokiem warunków, ale NAD listami we wszystkich wariantach", () => {
    // Kontakt na końcu pliku wpadał pod ostatnią sekcję `##` jako linia bez
    // odnośnika - parser referencyjny odrzucał przez to cały dokument.
    for (const usage of [...MATRIX, null]) {
      const txt = buildLlmsTxt({ ...base, usage, contactEmail: "office@tenant.example" });
      const contact = txt.indexOf("Kontakt / Contact: office@tenant.example\n");
      expect(contact).toBeGreaterThan(txt.indexOf(LLMS_TXT_USAGE_TERMS_LABEL));
      expect(contact).toBeLessThan(txt.indexOf("\n## "));
    }
  });
});

// ---------------------------------------------------------------------------
// GRAMATYKA llmstxt.org (2026-10 audyt: parser referencyjny `llms-txt` 0.0.7
// odrzucał produkcyjny plik). Pod KAŻDYM `##` wolno wyłącznie listę plików
// `- [tytuł](url)` z opcjonalnym `: notatka` - a dokument miał tam
// `- Etykieta: https://...` (zasoby), zdania warunków pod własnym `##`,
// artykuły bez zajawki kończone „ (data)" bez dwukropka i kontakt pod ostatnią
// sekcją. Wyrażenie niżej to gramatyka specyfikacji, przykładana do każdej
// niepustej linii każdej sekcji `##`.
// ---------------------------------------------------------------------------
describe("buildLlmsTxt - gramatyka llmstxt.org", () => {
  const LINK_LINE = /^-\s*\[[^\]]+\]\([^)]+\)(:\s*.*)?$/;

  /** Sekcje `##` z liniami - podział jak w parserze referencyjnym. */
  function h2Sections(txt: string): Array<{ heading: string; lines: string[] }> {
    const parts = txt.split(/^##\s*(.*?)$/m);
    const out: Array<{ heading: string; lines: string[] }> = [];
    for (let i = 1; i < parts.length; i += 2) {
      out.push({
        heading: parts[i] ?? "",
        lines: (parts[i + 1] ?? "").split("\n").filter((line) => line.trim() !== ""),
      });
    }
    return out;
  }

  /** Wejście z każdą pułapką naraz: nawiasy, złamania wierszy, encje, brak zajawki. */
  function trudneWejscie(usage: LlmsTxtInput["usage"]): LlmsTxtInput {
    return {
      siteName: "New European\nStrategies",
      origin: "https://nes.example",
      descriptionPl: "Think-tank o bezpieczeństwie\nEuropy.",
      descriptionEn: "A think-tank on European\nsecurity.",
      primarySections: [
        { name: "Analizy / Analyses", url: "https://nes.example/analizy" },
        { name: "Wywiady [archiwum]", url: "https://nes.example/category/wywiady" },
      ],
      sections: [
        // Duplikat sekcji głównej - ma wypaść, nie zostać drugą linią.
        { name: "Wywiady / Interviews", url: "https://nes.example/category/wywiady" },
        { name: "Raport [PDF] (2026)", url: "https://nes.example/category/raport-(pdf)" },
        { name: "Opis wielowierszowy", url: "https://nes.example/b", description: "a\n\nb" },
      ],
      organizations: [{ name: "NATO", url: "https://nes.example/organization/nato" }],
      latestPl: [
        {
          title: "Wpis [1] z przypisem",
          url: "https://nes.example/blog/a",
          description: "<p>Zajawka &#8222;cytat&#8221; [&hellip;]</p>",
          publishedAt: "2026-07-01T10:00:00Z",
        },
        // Bez zajawki, z datą - wcześniej „- [..](..) (2026-07-02)" bez dwukropka.
        { title: "Bez zajawki", url: "https://nes.example/blog/b", publishedAt: "2026-07-02" },
        { title: "   ", url: "https://nes.example/blog/c" },
      ],
      latestEn: [{ title: "EN post", url: "https://nes.example/en/blog/post" }],
      resources: llmsTxtResourceLines("https://nes.example", localizedPath),
      usage,
      contactEmail: "office@nes.example",
    };
  }

  const USAGES: ReadonlyArray<LlmsTxtInput["usage"]> = [
    { aiInputAllowed: true, trainingAllowed: true },
    { aiInputAllowed: false, trainingAllowed: false },
    null,
  ];

  it.each(USAGES)("każda niepusta linia pod każdym `##` to odnośnik (usage=%o)", (usage) => {
    const txt = buildLlmsTxt(trudneWejscie(usage));
    const sections = h2Sections(txt);
    expect(sections.map((s) => s.heading)).toEqual([
      "Najważniejsze sekcje / Key sections",
      "Sekcje / Sections",
      "Organizacje / Organizations",
      "Najnowsze artykuły (PL)",
      "Latest articles (EN)",
      "Zasoby maszynowe / Machine-readable resources",
    ]);
    for (const { heading, lines } of sections) {
      for (const line of lines) expect(line, `sekcja „${heading}"`).toMatch(LINK_LINE);
    }
  });

  it("blok swobodny: H1, JEDNA linia cytatu, streszczenie EN akapitem, warunki i kontakt przed `##`", () => {
    const txt = buildLlmsTxt(trudneWejscie({ aiInputAllowed: true, trainingAllowed: true }));
    // Wyrażenie początku dokumentu z parsera referencyjnego.
    const head = txt.split(/^##/m)[0] ?? "";
    const match = /^#\s*(?<title>.+?$)\n+(?:^>\s*(?<summary>.+?$)$)?\n+(?<info>.*)/ms.exec(
      head.trim(),
    );
    expect(match?.groups?.title).toBe("New European Strategies");
    expect(match?.groups?.summary).toBe("Think-tank o bezpieczeństwie Europy.");
    const info = match?.groups?.info ?? "";
    expect(info.startsWith("A think-tank on European security.\n")).toBe(true);
    expect(info, "druga linia cytatu nie wpada do treści swobodnej").not.toMatch(/^>/m);
    expect(info).toContain(LLMS_TXT_USAGE_TERMS_LABEL);
    expect(info).toContain('MUST name "New European Strategies" as the source');
    expect(info).toContain("Kontakt / Contact: office@nes.example");
    expect(txt.match(/^> /gm)).toHaveLength(1);
  });

  it("streszczenie EN identyczne z PL (albo puste) nie jest powtarzane", () => {
    for (const descriptionEn of ["Opis", "", "  "]) {
      const txt = buildLlmsTxt({
        ...trudneWejscie(null),
        descriptionPl: "Opis",
        descriptionEn,
      });
      expect(txt.match(/^Opis$/gm)).toBeNull();
      expect(txt).toContain("> Opis\n\nJęzyki / Languages:");
    }
  });

  it("nawiasy kwadratowe w tytule stają się okrągłymi, `)` w adresie jest kodowany", () => {
    // `\]` nie ratuje linii: klasa `[^\]]` parsera kończy tytuł na PIERWSZYM `]`
    // bez względu na ukośnik - dlatego zamiana, a nie ucieczka.
    const txt = buildLlmsTxt(trudneWejscie(null));
    expect(txt).toContain(
      "- [Raport (PDF) (2026)](https://nes.example/category/raport-%28pdf%29)\n",
    );
    expect(txt).toContain("- [Wpis (1) z przypisem](https://nes.example/blog/a): ");
    expect(txt).not.toContain("\\]");
  });

  it("tytuł z samych spacji zastępuje adres - klasa tytułu wymaga choć jednego znaku", () => {
    const txt = buildLlmsTxt(trudneWejscie(null));
    expect(txt).toContain("- [https://nes.example/blog/c](https://nes.example/blog/c)\n");
  });

  it("artykuł bez zajawki dostaje notatkę z samą datą", () => {
    const txt = buildLlmsTxt(trudneWejscie(null));
    expect(txt).toContain("- [Bez zajawki](https://nes.example/blog/b): (2026-07-02)\n");
  });

  it("zasoby maszynowe są odnośnikami z etykietą jako tytułem", () => {
    const txt = buildLlmsTxt(trudneWejscie(null));
    expect(txt).toContain(
      "- [Sitemap (indeks) / Sitemap (index)](https://nes.example/sitemap.xml)\n",
    );
    expect(txt).toContain(
      "- [RSS - wszystkie analizy / all analyses (EN)](https://nes.example/en/rss.xml)\n",
    );
    const resources = txt.slice(txt.indexOf("## Zasoby maszynowe"));
    expect(resources).not.toMatch(/^- [^[].*: https:\/\//m);
  });

  it("jeden adres = jedna pozycja: sekcja główna wygrywa z duplikatem z kategorii", () => {
    const txt = buildLlmsTxt(trudneWejscie(null));
    expect(txt.match(/\(https:\/\/nes\.example\/category\/wywiady\)/g)).toHaveLength(1);
    expect(txt).toContain("- [Wywiady (archiwum)](https://nes.example/category/wywiady)\n");
    expect(txt).not.toContain("[Wywiady / Interviews]");
  });

  it("dokument kończy się jednym znakiem nowej linii, bez pustych linii na końcu", () => {
    const txt = buildLlmsTxt(trudneWejscie(null));
    expect(txt.endsWith("\n")).toBe(true);
    expect(txt.endsWith("\n\n")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Zajawki przez TEN SAM sanitarny tekst co RSS (2026-10 audyt: llms.txt podawał
// modelom „[&hellip;]" i „&#8222;" z importu WordPressa dosłownie).
// ---------------------------------------------------------------------------
describe("buildLlmsTxt - zajawki artykułów jako tekst jawny", () => {
  function line(description: string): string {
    const txt = buildLlmsTxt({
      siteName: "NES",
      origin: "https://nes.example",
      descriptionPl: "Opis",
      descriptionEn: "Description",
      sections: [],
      latestPl: [{ title: "Wpis", url: "https://nes.example/a", description }],
      latestEn: [],
      resources: [],
      usage: null,
    });
    return txt.split("\n").find((l) => l.startsWith("- [Wpis]")) ?? "";
  }

  it("zdejmuje końcowy znacznik WordPressa [&hellip;]", () => {
    expect(line("Polska w XXI wieku [&hellip;]")).toBe(
      "- [Wpis](https://nes.example/a): Polska w XXI wieku",
    );
    expect(line("Polska [...]")).toBe("- [Wpis](https://nes.example/a): Polska");
  });

  it("dekoduje encje liczbowe i nazwane", () => {
    expect(line("z książki &#8222;Geopolityka Rosji&#8221; &ndash; tom 1")).toBe(
      "- [Wpis](https://nes.example/a): z książki „Geopolityka Rosji” – tom 1",
    );
  });

  it("zdejmuje znaczniki HTML i nie dekoduje podwójnie", () => {
    expect(line("<p>R&amp;D &amp;amp; więcej</p>")).toBe(
      "- [Wpis](https://nes.example/a): R&D &amp; więcej",
    );
  });

  it("zajawka z samego znacznika skrócenia nie zostawia wiszącego dwukropka", () => {
    expect(line(" [&hellip;] ")).toBe("- [Wpis](https://nes.example/a)");
  });
});

// ---------------------------------------------------------------------------
// Kategorie -> sekcje (2026-10 audyt: 44 puste archiwa jako „Sekcje",
// organizacje pod niekanonicznym `/category/<slug>`). Lustro sekcji
// `taxonomy` mapy strony.
// ---------------------------------------------------------------------------
describe("llmsTxtTaxonomy i resolvePrimarySectionHref", () => {
  function kategoria(nadpisania: Partial<LlmsTxtCategory> & { slug: string }): LlmsTxtCategory {
    return {
      kind: "category",
      name_pl: nadpisania.slug,
      name_en: nadpisania.slug,
      description_pl: null,
      description_en: null,
      published_post_count: 0,
      ...nadpisania,
    };
  }

  const KATEGORIE: readonly LlmsTxtCategory[] = [
    kategoria({
      slug: "geopolityka",
      name_pl: "Geopolityka",
      name_en: "Geopolitics",
      published_post_count: 3,
    }),
    kategoria({ slug: "wywiady", published_post_count: 0 }),
    kategoria({ slug: "nato", name_pl: "NATO", name_en: "NATO", kind: "organization" }),
    kategoria({ slug: "policy-papers", published_post_count: 1, description_en: "Papers" }),
  ];

  it("archiwum trafia do sekcji tylko z co najmniej jednym wpisem", () => {
    const { sections } = llmsTxtTaxonomy("https://nes.example", KATEGORIE);
    expect(sections).toEqual([
      {
        name: "Geopolityka / Geopolitics",
        url: "https://nes.example/category/geopolityka",
        description: null,
      },
      {
        name: "policy-papers",
        url: "https://nes.example/category/policy-papers",
        description: "Papers",
      },
    ]);
  });

  it("organizacja idzie pod /organization/<slug> - także bez wpisów", () => {
    const { organizations, sections } = llmsTxtTaxonomy("https://nes.example", KATEGORIE);
    expect(organizations).toEqual([
      { name: "NATO", url: "https://nes.example/organization/nato", description: null },
    ]);
    expect(sections.some((s) => s.url.includes("/category/nato"))).toBe(false);
  });

  it("wiersz bez licznika (stary kształt) nie jest archiwum z treścią", () => {
    const { sections } = llmsTxtTaxonomy("https://nes.example", [
      { slug: "x", name_pl: "X", name_en: "X", description_pl: null, description_en: null },
    ]);
    expect(sections).toEqual([]);
  });

  it.each([
    { href: "/analizy", expected: "/analizy", label: "strona spoza kategorii zostaje" },
    {
      href: "/category/geopolityka",
      expected: "/category/geopolityka",
      label: "archiwum z wpisem zostaje",
    },
    { href: "/category/wywiady", expected: null, label: "puste archiwum wypada" },
    { href: "/category/nie-ma", expected: null, label: "nieistniejący term wypada" },
    {
      href: "/category/nato",
      expected: "/organization/nato",
      label: "organizacja dostaje adres kanoniczny",
    },
  ])("sekcja główna: $label", ({ href, expected }) => {
    expect(resolvePrimarySectionHref(href, KATEGORIE)).toBe(expected);
  });

  it("pusta lista kategorii (stan nieznany po awarii czytnika) zostawia sekcję redakcji", () => {
    expect(resolvePrimarySectionHref("/category/wywiady", [])).toBe("/category/wywiady");
  });

  it("adres spoza kategorii zgłoszony przez trasę jako pusty wypada (np. /podcasts bez odcinka)", () => {
    const puste = new Set(["/podcasts"]);
    expect(resolvePrimarySectionHref("/podcasts", KATEGORIE, puste)).toBeNull();
    // Także przy nieznanym stanie kategorii - to osobna wiedza trasy.
    expect(resolvePrimarySectionHref("/podcasts", [], puste)).toBeNull();
    expect(resolvePrimarySectionHref("/analizy", KATEGORIE, puste)).toBe("/analizy");
    expect(resolvePrimarySectionHref("/podcasts", KATEGORIE)).toBe("/podcasts");
  });
});
