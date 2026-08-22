import { describe, expect, it } from "vitest";
import {
  aiCrawlerGroups,
  AI_SEARCH_CRAWLERS,
  AI_TRAINING_CRAWLERS,
  DEFAULT_SEO_SETTINGS,
  effectiveNewsPublicationName,
  effectiveTitleSuffix,
  parseSeoSettings,
  siteDescriptionOverride,
  siteTitleOverride,
  type SeoSettings,
} from "@/lib/seo/settings";
import { buildRobotsTxt } from "@/lib/seo/robots";
import { SITE_NAME } from "@/lib/seo/meta";

describe("parseSeoSettings", () => {
  it("merges partial blobs over defaults", () => {
    const s = parseSeoSettings({ rss_item_count: 12, twitter_site: "@nes" });
    expect(s.rss_item_count).toBe(12);
    expect(s.twitter_site).toBe("@nes");
    expect(s.rss_enabled).toBe(true);
  });
  it("falls back to defaults on corrupted values", () => {
    expect(parseSeoSettings({ rss_item_count: "sto" })).toEqual(DEFAULT_SEO_SETTINGS);
    expect(parseSeoSettings(null)).toEqual(DEFAULT_SEO_SETTINGS);
    expect(parseSeoSettings("string")).toEqual(DEFAULT_SEO_SETTINGS);
  });
});

describe("effective values", () => {
  it("title suffix honours the toggle and custom text", () => {
    expect(effectiveTitleSuffix(DEFAULT_SEO_SETTINGS)).toBe(SITE_NAME);
    expect(effectiveTitleSuffix({ ...DEFAULT_SEO_SETTINGS, title_suffix: "NES" })).toBe("NES");
    expect(
      effectiveTitleSuffix({ ...DEFAULT_SEO_SETTINGS, title_suffix_enabled: false }),
    ).toBeNull();
  });
  it("news publication name falls back to the site name", () => {
    expect(effectiveNewsPublicationName(DEFAULT_SEO_SETTINGS)).toBe(SITE_NAME);
    expect(
      effectiveNewsPublicationName({ ...DEFAULT_SEO_SETTINGS, news_publication_name: "NES News" }),
    ).toBe("NES News");
  });
});

describe("aiCrawlerGroups", () => {
  it("emits nothing when everything is allowed (GEO default)", () => {
    expect(aiCrawlerGroups(DEFAULT_SEO_SETTINGS)).toEqual([]);
  });
  it("blocks training crawlers independently of search crawlers", () => {
    const groups = aiCrawlerGroups({
      ...DEFAULT_SEO_SETTINGS,
      ai_training_crawlers_allowed: false,
    });
    expect(groups).toEqual([{ agents: AI_TRAINING_CRAWLERS, disallow: ["/"] }]);
    expect(groups.flatMap((g) => g.agents)).not.toContain("PerplexityBot");
  });
  it("blocks search crawlers when disabled", () => {
    const groups = aiCrawlerGroups({
      ...DEFAULT_SEO_SETTINGS,
      ai_search_crawlers_allowed: false,
    });
    expect(groups).toEqual([{ agents: AI_SEARCH_CRAWLERS, disallow: ["/"] }]);
  });
  it("blocks both families when the editors opt out of AI entirely", () => {
    const groups = aiCrawlerGroups({
      ...DEFAULT_SEO_SETTINGS,
      ai_search_crawlers_allowed: false,
      ai_training_crawlers_allowed: false,
    });
    expect(groups).toHaveLength(2);
  });

  // REGRESJA (audyt 2026-08-06): te przełączniki NIE MIAŁY ŻADNEGO WOŁAJĄCEGO -
  // redakcja mogła zabronić crawlerom AI w panelu, a robots.txt nigdy o tym nie
  // wspominał. Test wiąże ustawienie z gotowym plikiem, nie tylko z funkcją.
  it("reaches the rendered robots.txt as a separate per-agent group", () => {
    const body = buildRobotsTxt({
      mode: "canonical",
      origin: "https://neweuropeanstrategies.com",
      sitemapPaths: ["/sitemap.xml"],
      groups: aiCrawlerGroups({
        ...DEFAULT_SEO_SETTINGS,
        ai_training_crawlers_allowed: false,
      }),
    });
    expect(body).toContain("User-agent: GPTBot");
    // Grupa `*` nadal zaprasza wyszukiwarki - blokada dotyczy tylko botów AI.
    expect(body).toContain("Allow: /");
    expect(body.indexOf("User-agent: GPTBot")).toBeGreaterThan(body.indexOf("Allow: /"));
    expect(body).not.toContain("PerplexityBot");
  });
});

// ---------------------------------------------------------------------------
// ETAP 4: nadpisania redakcyjne per język (settings.ts:104 i 109). Obie funkcje
// nie miały ANI JEDNEGO testu, a to one decydują, czy <title>/<meta description>
// niosą tekst redakcji, czy fallback marki - w obu językach osobno.
// ---------------------------------------------------------------------------
describe("siteTitleOverride / siteDescriptionOverride", () => {
  // "EN bez tłumaczenia": redakcja wypełniła tylko PL. Nadpisanie dla EN MUSI
  // zwrócić pusty łańcuch (= sygnał "użyj fallbacku marki"), a NIE tekst PL -
  // inaczej angielska strona dostałaby polski tytuł i opis w <head>.
  const tylkoPl: SeoSettings = {
    ...DEFAULT_SEO_SETTINGS,
    site_title_pl: "  Nowe Strategie Europejskie  ",
    site_title_en: "",
    site_description_pl: " Analizy polityki UE. ",
    site_description_en: "   ",
  };

  const oba: SeoSettings = {
    ...DEFAULT_SEO_SETTINGS,
    site_title_pl: "Tytuł PL",
    site_title_en: "Title EN",
    site_description_pl: "Opis PL",
    site_description_en: "Description EN",
  };

  it.each([
    {
      label: "PL wypełniony (przycięty)",
      settings: tylkoPl,
      lang: "pl" as const,
      expected: "Nowe Strategie Europejskie",
    },
    { label: "EN bez tłumaczenia", settings: tylkoPl, lang: "en" as const, expected: "" },
    {
      label: "domyślne ustawienia PL",
      settings: DEFAULT_SEO_SETTINGS,
      lang: "pl" as const,
      expected: "",
    },
    {
      label: "domyślne ustawienia EN",
      settings: DEFAULT_SEO_SETTINGS,
      lang: "en" as const,
      expected: "",
    },
    { label: "oba języki PL", settings: oba, lang: "pl" as const, expected: "Tytuł PL" },
    { label: "oba języki EN", settings: oba, lang: "en" as const, expected: "Title EN" },
  ])("siteTitleOverride: $label", ({ settings, lang, expected }) => {
    expect(siteTitleOverride(settings, lang)).toBe(expected);
  });

  it.each([
    {
      label: "PL wypełniony (przycięty)",
      settings: tylkoPl,
      lang: "pl" as const,
      expected: "Analizy polityki UE.",
    },
    { label: "EN z samych spacji", settings: tylkoPl, lang: "en" as const, expected: "" },
    {
      label: "domyślne ustawienia PL",
      settings: DEFAULT_SEO_SETTINGS,
      lang: "pl" as const,
      expected: "",
    },
    {
      label: "domyślne ustawienia EN",
      settings: DEFAULT_SEO_SETTINGS,
      lang: "en" as const,
      expected: "",
    },
    { label: "oba języki PL", settings: oba, lang: "pl" as const, expected: "Opis PL" },
    { label: "oba języki EN", settings: oba, lang: "en" as const, expected: "Description EN" },
  ])("siteDescriptionOverride: $label", ({ settings, lang, expected }) => {
    expect(siteDescriptionOverride(settings, lang)).toBe(expected);
  });

  it("nie przecieka tekstu PL do wersji angielskiej ani odwrotnie", () => {
    expect(siteTitleOverride(tylkoPl, "en")).not.toContain("Nowe");
    expect(siteDescriptionOverride(tylkoPl, "en")).not.toContain("Analizy");
    const tylkoEn: SeoSettings = {
      ...DEFAULT_SEO_SETTINGS,
      site_title_en: "EN only",
      site_description_en: "EN only description",
    };
    expect(siteTitleOverride(tylkoEn, "pl")).toBe("");
    expect(siteDescriptionOverride(tylkoEn, "pl")).toBe("");
  });
});

describe("parseSeoSettings - wejścia niepełne i spoza zbioru", () => {
  it.each([
    { label: "undefined", raw: undefined },
    { label: "null", raw: null },
    { label: "liczba", raw: 0 },
    { label: "pusty łańcuch", raw: "" },
    { label: "tablica", raw: [] as unknown[] },
    { label: "wartość spoza zbioru w polu logicznym", raw: { rss_enabled: "tak" } },
    { label: "liczba pozycji poza zakresem schematu", raw: { rss_item_count: 1000 } },
    { label: "sameAs z adresem, który nie jest URL", raw: { organization_same_as: ["nie-url"] } },
  ])("wraca do pełnych domyślnych ustawień dla $label", ({ raw }) => {
    expect(parseSeoSettings(raw)).toEqual(DEFAULT_SEO_SETTINGS);
  });

  it("pusty obiekt to poprawny blob (wszystkie pola z domyślnych)", () => {
    // `{}` NIE jest błędem kształtu - to świeży, nieedytowany wiersz ustawień.
    expect(parseSeoSettings({})).toEqual(DEFAULT_SEO_SETTINGS);
  });

  it("zachowuje pola nadpisane obok tych, których redakcja nie ruszyła", () => {
    const s = parseSeoSettings({ site_title_en: "NES EN", rss_item_count: 5 });
    expect(siteTitleOverride(s, "en")).toBe("NES EN");
    expect(siteTitleOverride(s, "pl")).toBe("");
    expect(s.rss_item_count).toBe(5);
    expect(s.news_sitemap_enabled).toBe(true);
  });
});
