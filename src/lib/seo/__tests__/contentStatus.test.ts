import { describe, expect, it } from "vitest";
import {
  seoContentStatus,
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
  it("grades a bare row as poor (only the indexable points)", () => {
    const s = seoContentStatus(base);
    expect(s.score).toBe(15);
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
    expect(s.score).toBe(15 + 25 + 25);
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
    expect(hidden.score).toBe(0);
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
