import { describe, expect, it } from "vitest";
import { validateSeoPanel, hasBlockingSeoIssues, type SeoIssue } from "@/lib/seo/validation";
import type { SeoPanelValue } from "@/components/admin/seo/SeoPanel";

const emptyValue: SeoPanelValue = {
  seo_title_pl: null,
  seo_title_en: null,
  seo_description_pl: null,
  seo_description_en: null,
  seo_canonical_url: null,
  seo_noindex: false,
  seo_og_image_url: null,
  og_image_generated_url: null,
};

describe("validateSeoPanel", () => {
  it("returns no issues for well-sized derived fallbacks", () => {
    const issues = validateSeoPanel({
      value: emptyValue,
      fallbackTitle: {
        pl: "Strategiczne myślenie o bezpieczeństwie Europy dziś",
        en: "Strategic thinking about Europe's security today",
      },
      fallbackDescription: {
        pl: "Solidny, konkretny opis artykułu o geopolityce i strategii bezpieczeństwa Europy Środkowej pisany z myślą o wynikach wyszukiwania.",
        en: "A solid, specific description of an article on geopolitics and Central European security strategy, written with search results in mind.",
      },
      slug: "test",
      titleCharLimit: 160,
      descriptionCharLimit: 320,
    });
    expect(issues).toEqual([]);
  });

  it("flags a title that exceeds Google's pixel budget as a warning", () => {
    const long = "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW";
    const issues = validateSeoPanel({
      value: { ...emptyValue, seo_title_pl: long },
      fallbackTitle: { pl: "x", en: "x" },
      fallbackDescription: { pl: "opis", en: "desc" },
      slug: "test",
      titleCharLimit: 160,
      descriptionCharLimit: 320,
    });
    const titleIssue = issues.find((i) => i.kind === "title" && i.lang === "pl");
    expect(titleIssue?.severity).toBe("warning");
    expect(titleIssue?.px).toBeGreaterThan(titleIssue!.pxLimit);
    expect(hasBlockingSeoIssues(issues)).toBe(false);
  });

  it("flags a character-cap overflow as a blocking error", () => {
    const issues = validateSeoPanel({
      value: { ...emptyValue, seo_title_pl: "x".repeat(200) },
      fallbackTitle: { pl: "x", en: "x" },
      fallbackDescription: { pl: "opis", en: "desc" },
      slug: "test",
      titleCharLimit: 160,
      descriptionCharLimit: 320,
    });
    const err = issues.find((i) => i.severity === "error");
    expect(err?.chars).toBe(200);
    expect(err?.charLimit).toBe(160);
    expect(hasBlockingSeoIssues(issues)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ETAP 4: gałęzie `resolveTitle` (linie 52-55), `resolveDescription`
// (linie 64-67) i drugi `push` w pętli po językach (linia 109).
//
// Wszystkie tabele używają WĄSKICH znaków ("i" ma współczynnik 0.28 szerokości
// fontu, patrz serp.ts), żeby jeden przypadek mierzył WYŁĄCZNIE limit znaków.
// Gdyby tekst był szeroki, ostrzeżenie pikselowe pojawiłoby się razem z błędem
// limitu i nie dałoby się odróżnić, którą gałąź zamknął test.
// ---------------------------------------------------------------------------
type ValidateInput = Parameters<typeof validateSeoPanel>[0];

/** n wąskich znaków: 5.6 px/znak w tytule (20 px), 3.92 px/znak w opisie (14 px). */
const narrow = (n: number): string => "i".repeat(n);

const baseInput: ValidateInput = {
  value: emptyValue,
  fallbackTitle: { pl: "Tytuł PL", en: "Title EN" },
  fallbackDescription: { pl: "Opis PL", en: "Desc EN" },
  slug: "slug",
  // Wartości produkcyjne z SeoPanel.tsx (TITLE_MAX / DESCRIPTION_MAX).
  titleCharLimit: 160,
  descriptionCharLimit: 320,
};

const run = (over: Partial<ValidateInput>): SeoIssue[] =>
  validateSeoPanel({ ...baseInput, ...over });

const issueFor = (
  issues: SeoIssue[],
  lang: "pl" | "en",
  kind: "title" | "description",
): SeoIssue | undefined => issues.find((i) => i.lang === lang && i.kind === kind);

interface ResolveCase {
  name: string;
  lang: "pl" | "en";
  over: Partial<ValidateInput>;
  chars: number;
}

describe("validateSeoPanel - który TYTUŁ jest faktycznie sprawdzany", () => {
  // Limit 10 znaków ustawiony w teście: każdy rozwiązany tytuł z tabeli go
  // przebija, więc `chars` w zgłoszeniu jednoznacznie identyfikuje źródło.
  const cases: ResolveCase[] = [
    {
      name: "nadpisanie EN wygrywa z fallbackiem",
      lang: "en",
      over: { value: { ...emptyValue, seo_title_en: narrow(31) } },
      chars: 31,
    },
    {
      name: "nadpisanie z samych spacji jest traktowane jak brak (trim)",
      lang: "en",
      over: {
        value: { ...emptyValue, seo_title_en: "   " },
        fallbackTitle: { pl: "Tytuł PL", en: narrow(32) },
      },
      chars: 32,
    },
    {
      name: "EN bez tłumaczenia spada na tytuł PL",
      lang: "en",
      over: { fallbackTitle: { pl: narrow(33), en: "" } },
      chars: 33,
    },
    {
      name: "PL bez tytułu spada na tytuł EN",
      lang: "pl",
      over: { fallbackTitle: { pl: "", en: narrow(34) } },
      chars: 34,
    },
    {
      name: "brak jakiegokolwiek tytułu spada na slug (ostatni fallback)",
      lang: "pl",
      over: { fallbackTitle: { pl: "", en: "" }, slug: narrow(35) },
      chars: 35,
    },
    {
      name: "nadpisanie PL wygrywa nawet przy pustych fallbackach i pustym slugu",
      lang: "pl",
      over: {
        value: { ...emptyValue, seo_title_pl: narrow(36) },
        fallbackTitle: { pl: "", en: "" },
        slug: "",
      },
      chars: 36,
    },
  ];

  it.each(cases)("$name", ({ lang, over, chars }) => {
    const issues = run({ ...over, titleCharLimit: 10 });
    expect(issueFor(issues, lang, "title")).toMatchObject({
      chars,
      charLimit: 10,
      severity: "error",
    });
  });
});

describe("validateSeoPanel - który OPIS jest faktycznie sprawdzany", () => {
  const cases: ResolveCase[] = [
    {
      name: "nadpisanie EN wygrywa z fallbackiem",
      lang: "en",
      over: { value: { ...emptyValue, seo_description_en: narrow(41) } },
      chars: 41,
    },
    {
      name: "nadpisanie z samych spacji jest traktowane jak brak (trim)",
      lang: "en",
      over: {
        value: { ...emptyValue, seo_description_en: "  " },
        fallbackDescription: { pl: "Opis PL", en: narrow(42) },
      },
      chars: 42,
    },
    {
      name: "null w opisie EN spada na opis PL",
      lang: "en",
      over: { fallbackDescription: { pl: narrow(43), en: null } },
      chars: 43,
    },
    {
      name: "pusty łańcuch w opisie EN też spada na opis PL",
      lang: "en",
      over: { fallbackDescription: { pl: narrow(44), en: "" } },
      chars: 44,
    },
    {
      name: "PL bez opisu spada na opis EN",
      lang: "pl",
      over: { fallbackDescription: { pl: null, en: narrow(45) } },
      chars: 45,
    },
    {
      name: "brak obu opisów spada na TYTUŁ strony (metaDescription)",
      lang: "pl",
      over: {
        fallbackDescription: { pl: null, en: null },
        fallbackTitle: { pl: narrow(46), en: "Title EN" },
      },
      chars: 46,
    },
  ];

  it.each(cases)("$name", ({ lang, over, chars }) => {
    const issues = run({ ...over, descriptionCharLimit: 12 });
    expect(issueFor(issues, lang, "description")).toMatchObject({
      chars,
      charLimit: 12,
      severity: "error",
    });
  });

  it("opis Z FALLBACKU nigdy nie przebije limitu panelu, bo metaDescription ucina go do 160", () => {
    // FAKT PRZYPIĘTY: metaDescription() (publicSegments.ts:25) obcina wyliczony
    // opis do 160 znaków, a panel dopuszcza 320. Wniosek dla redakcji: BŁĄD
    // limitu opisu może wywołać tylko ręczne nadpisanie, nigdy opis wzięty
    // z treści wpisu - i dlatego banner "za długi opis" zawsze wskazuje pole
    // edytowalne.
    const fromFallback = run({ fallbackDescription: { pl: narrow(400), en: narrow(400) } });
    expect(fromFallback.filter((i) => i.kind === "description")).toEqual([]);

    const fromOverride = run({ value: { ...emptyValue, seo_description_pl: narrow(400) } });
    expect(issueFor(fromOverride, "pl", "description")).toMatchObject({
      chars: 400,
      charLimit: 320,
      severity: "error",
    });
  });
});

describe("validateSeoPanel - granica limitu znaków", () => {
  it.each([
    { chars: 60, expected: 0 },
    { chars: 61, expected: 1 },
  ])("tytuł o $chars znakach przy limicie 60 daje $expected zgłoszeń", ({ chars, expected }) => {
    const issues = run({
      value: { ...emptyValue, seo_title_pl: narrow(chars) },
      titleCharLimit: 60,
    });
    const pl = issues.filter((i) => i.lang === "pl" && i.kind === "title");
    expect(pl).toHaveLength(expected);
    // 60 wąskich znaków to 336 px - poniżej budżetu 600 px, więc DOKŁADNIE na
    // limicie nie ma ani błędu, ani ostrzeżenia pikselowego.
    if (expected === 1) expect(pl[0]).toMatchObject({ chars: 61, severity: "error" });
  });
});

describe("validateSeoPanel - opis: piksele vs znaki", () => {
  it("opis pod limitem znaków, ale ponad budżetem pikselowym Google, to OSTRZEŻENIE", () => {
    // 80 znaków "W" (0.92 szerokości fontu) = 1030 px przy budżecie 960 px,
    // a jednocześnie 80 z 320 znaków. Google skróci snippet, ale zapis wolno
    // wykonać - to jest sedno rozdziału severity error/warning.
    const issues = run({ value: { ...emptyValue, seo_description_pl: "W".repeat(80) } });
    const d = issueFor(issues, "pl", "description");
    expect(d).toMatchObject({ severity: "warning", chars: 80, charLimit: 320, pxLimit: 960 });
    expect(d?.px).toBeGreaterThan(960);
    expect(hasBlockingSeoIssues(issues)).toBe(false);
  });

  it("zgłasza oba języki w kolejności pl->en, parami tytuł+opis", () => {
    const issues = run({
      value: {
        ...emptyValue,
        seo_title_pl: narrow(200),
        seo_title_en: narrow(201),
        seo_description_pl: narrow(400),
        seo_description_en: narrow(401),
      },
    });
    expect(issues.map((i) => [i.lang, i.kind, i.chars])).toEqual([
      ["pl", "title", 200],
      ["pl", "description", 400],
      ["en", "title", 201],
      ["en", "description", 401],
    ]);
    expect(hasBlockingSeoIssues(issues)).toBe(true);
  });
});
