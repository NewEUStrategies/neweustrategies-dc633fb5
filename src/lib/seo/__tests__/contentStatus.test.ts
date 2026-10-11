import { describe, expect, it } from "vitest";
import {
  findDuplicateDescriptions,
  seoContentStatus,
  seoGrade,
  summarizeSeoStatuses,
  type SeoStatusInput,
} from "@/lib/seo/contentStatus";

const base: SeoStatusInput = {
  title_pl: "Tytuł",
  title_en: "Title",
  excerpt_pl: null,
  excerpt_en: null,
  cover_image_url: null,
  seo_title_pl: null,
  seo_title_en: null,
  seo_description_pl: null,
  seo_description_en: null,
  seo_canonical_url: null,
  seo_noindex: false,
  seo_og_image_url: null,
  og_image_generated_url: null,
};

describe("seoContentStatus", () => {
  it("grades a bare row as poor (indexable + short titles that fit Google)", () => {
    const s = seoContentStatus(base);
    expect(s.titleFits).toBe(true);
    expect(s.score).toBe(15 + 15);
    expect(s.grade).toBe("poor");
    expect(s.description).toEqual({ pl: "missing", en: "missing" });
    expect(s.socialImage).toBe("default");
  });

  it("tracks description sources per language (override beats excerpt)", () => {
    const s = seoContentStatus({
      ...base,
      excerpt_pl: "Zajawka",
      seo_description_en: "Override EN",
      excerpt_en: "Excerpt EN",
    });
    expect(s.description).toEqual({ pl: "excerpt", en: "override" });
    expect(s.score).toBe(15 + 15 + 25 + 25);
  });

  it("resolves the social image chain and scores it", () => {
    expect(seoContentStatus({ ...base, cover_image_url: "https://x/c.jpg" }).socialImage).toBe(
      "cover",
    );
    expect(
      seoContentStatus({ ...base, og_image_generated_url: "https://x/k.png" }).socialImage,
    ).toBe("card");
    expect(
      seoContentStatus({
        ...base,
        seo_og_image_url: "https://x/o.png",
        cover_image_url: "https://x/c.jpg",
      }).socialImage,
    ).toBe("override");
  });

  it("reaches good grade on a fully tended row and penalizes noindex", () => {
    const full = seoContentStatus({
      ...base,
      excerpt_pl: "Zajawka",
      excerpt_en: "Excerpt",
      cover_image_url: "https://x/c.jpg",
      seo_title_pl: "SEO tytuł",
    });
    expect(full.score).toBe(100);
    expect(full.grade).toBe("good");
    const hidden = seoContentStatus({ ...base, seo_noindex: true });
    expect(hidden.noindex).toBe(true);
    expect(hidden.score).toBe(15);
  });

  it("scores titles Google shows in full - not the mere presence of an override", () => {
    // Dawne „+15 za dowolny tytuł SEO" nagradzało nadpisanie, które po cichu
    // zdejmuje sufiks marki; punkty są teraz za tytuł mieszczący się w ~600 px.
    const tooLong =
      "Bardzo długi tytuł artykułu, który z pewnością nie zmieści się w wyniku Google";
    const derivedLong = seoContentStatus({ ...base, title_pl: tooLong });
    expect(derivedLong.titleFits).toBe(false);
    expect(derivedLong.score).toBe(15);
    const fixedByOverride = seoContentStatus({
      ...base,
      title_pl: tooLong,
      seo_title_pl: "Krótki tytuł SEO",
    });
    expect(fixedByOverride.titleFits).toBe(true);
    // Sufiks marki doklejany do tytułu WYPROWADZONEGO (jak head()) wlicza się
    // do pomiaru; nadpisanie idzie bez sufiksu.
    const nearlyFull = "Bezpieczeństwo flanki wschodniej NATO"; // ~400 px, z sufiksem ~680 px
    expect(seoContentStatus({ ...base, title_pl: nearlyFull, title_en: "Short" }).titleFits).toBe(
      true,
    );
    expect(
      seoContentStatus(
        { ...base, title_pl: nearlyFull, title_en: "Short" },
        { titleSuffix: "New European Strategies" },
      ).titleFits,
    ).toBe(false);
    expect(
      seoContentStatus(
        { ...base, title_pl: nearlyFull, seo_title_pl: nearlyFull, title_en: "Short" },
        { titleSuffix: "New European Strategies" },
      ).titleFits,
    ).toBe(true);
    // EN bez tłumaczenia mierzy tytuł PL - tak jak head().
    expect(seoContentStatus({ ...base, title_en: "", title_pl: tooLong }).titleFits).toBe(false);
  });
});

describe("summarizeSeoStatuses", () => {
  it("aggregates the tile counters", () => {
    const statuses = [
      seoContentStatus(base),
      seoContentStatus({
        ...base,
        excerpt_pl: "x",
        excerpt_en: "y",
        cover_image_url: "https://x/c.jpg",
      }),
      seoContentStatus({ ...base, seo_noindex: true, seo_title_pl: "t" }),
    ];
    const summary = summarizeSeoStatuses(statuses);
    expect(summary).toEqual({
      total: 3,
      missingDescription: 2,
      defaultImage: 2,
      noindexed: 1,
      withOverrides: 1,
    });
  });
});

describe("seoGrade - jedno miejsce, w którym żyją pasma oceny", () => {
  // Kokpit SEO rysuje plakietkę wyniku MARKI tą samą skalą, co tabela treści
  // wynik POJEDYNCZEJ treści. Dopóki obie strony miały własną kopię tego
  // wyrażenia, ta sama liczba mogła zapalić dwa różne kolory w dwóch miejscach
  // panelu - i nic by tego nie złapało.
  it.each([
    [100, "good"],
    [80, "good"],
    [79, "warn"],
    [50, "warn"],
    [49, "poor"],
    [0, "poor"],
  ])("wynik %i to ocena %s", (score, expected) => {
    expect(seoGrade(score as number)).toBe(expected);
  });

  it("ocena wiersza treści idzie przez TĘ SAMĄ funkcję", () => {
    // Gdyby `seoContentStatus` liczyło pasma po swojemu, ten test przeszedłby
    // przypadkiem; dlatego porównujemy z `seoGrade` wprost, a nie z literałem.
    const status = seoContentStatus({ ...base, seo_noindex: true });
    expect(status.grade).toBe(seoGrade(status.score));
  });
});

describe("findDuplicateDescriptions", () => {
  const row = (
    key: string,
    over: Partial<Parameters<typeof findDuplicateDescriptions>[0][number]> = {},
  ) => ({
    key,
    excerpt_pl: null,
    excerpt_en: null,
    seo_description_pl: null,
    seo_description_en: null,
    ...over,
  });
  const copied =
    "Analiza wpływu sankcji na eksport technologii podwójnego zastosowania w regionie.";

  it("flags excerpts copied between articles, in both directions", () => {
    const out = findDuplicateDescriptions([
      row("post-a", { excerpt_pl: copied }),
      row("post-b", { excerpt_pl: `<p>${copied.toUpperCase()}</p>` }),
      row("post-c", {
        excerpt_pl: "Zupełnie inna zajawka o polityce energetycznej Unii Europejskiej.",
      }),
    ]);
    expect(out.get("post-a")).toEqual(["post-b"]);
    expect(out.get("post-b")).toEqual(["post-a"]);
    expect(out.has("post-c")).toBe(false);
  });

  it("an SEO override replaces the excerpt it would duplicate", () => {
    const out = findDuplicateDescriptions([
      row("post-a", { excerpt_pl: copied }),
      row("post-b", {
        excerpt_pl: copied,
        seo_description_pl: "Własny opis meta tej analizy, zupełnie inny.",
      }),
    ]);
    expect(out.size).toBe(0);
  });

  it("compares within a language and ignores short boilerplate", () => {
    const out = findDuplicateDescriptions([
      row("a", { excerpt_pl: copied }),
      row("b", { excerpt_en: copied }),
      row("c", { excerpt_pl: "Czytaj więcej" }),
      row("d", { excerpt_pl: "Czytaj więcej" }),
    ]);
    expect(out.size).toBe(0);
  });
});
