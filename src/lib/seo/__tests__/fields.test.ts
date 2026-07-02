import { describe, expect, it } from "vitest";
import {
  applyTitleSuffix,
  resolveRobotsMeta,
  resolveSeoText,
  resolveSocialImage,
  seoCanonicalOverride,
  socialImageIsGeneratedCard,
  type SeoFieldsRow,
} from "@/lib/seo/fields";

const empty: SeoFieldsRow = {};

describe("resolveSeoText", () => {
  it("falls back to derived values when overrides are empty", () => {
    const r = resolveSeoText({ seo_title_pl: "  " }, "pl", "Tytuł", "Opis");
    expect(r).toEqual({ title: "Tytuł", description: "Opis", titleIsOverride: false });
  });
  it("uses the same-language override only", () => {
    const row: SeoFieldsRow = { seo_title_pl: "PL SEO", seo_description_en: "EN desc" };
    expect(resolveSeoText(row, "pl", "T", "D").title).toBe("PL SEO");
    expect(resolveSeoText(row, "en", "T", "D").title).toBe("T");
    expect(resolveSeoText(row, "en", "T", "D").description).toBe("EN desc");
    expect(resolveSeoText(row, "pl", "T", "D").description).toBe("D");
  });
});

describe("applyTitleSuffix", () => {
  it("appends the suffix to derived titles", () => {
    expect(applyTitleSuffix("Nagłówek", "Marka", false)).toBe("Nagłówek - Marka");
  });
  it("keeps override titles verbatim", () => {
    expect(applyTitleSuffix("Ręczny tytuł", "Marka", true)).toBe("Ręczny tytuł");
  });
  it("does not double-append or overflow", () => {
    expect(applyTitleSuffix("Nagłówek - Marka", "Marka", false)).toBe("Nagłówek - Marka");
    expect(applyTitleSuffix("x".repeat(118), "Marka", false)).toBe("x".repeat(118));
    expect(applyTitleSuffix("Nagłówek", null, false)).toBe("Nagłówek");
  });
});

describe("resolveSocialImage", () => {
  it("prefers override, then cover, then generated card", () => {
    const row: SeoFieldsRow = {
      seo_og_image_url: "https://x/override.png",
      og_image_generated_url: "https://x/card.png",
    };
    expect(resolveSocialImage(row, "https://x/cover.jpg")).toBe("https://x/override.png");
    expect(
      resolveSocialImage({ og_image_generated_url: "https://x/card.png" }, "https://x/cover.jpg"),
    ).toBe("https://x/cover.jpg");
    expect(resolveSocialImage({ og_image_generated_url: "https://x/card.png" }, null)).toBe(
      "https://x/card.png",
    );
    expect(resolveSocialImage(empty, null)).toBeNull();
  });
  it("flags the generated card so og:image dimensions can be emitted", () => {
    const row: SeoFieldsRow = { og_image_generated_url: "https://x/card.png" };
    expect(socialImageIsGeneratedCard(row, "https://x/card.png")).toBe(true);
    expect(socialImageIsGeneratedCard(row, "https://x/cover.jpg")).toBe(false);
    expect(socialImageIsGeneratedCard(empty, null)).toBe(false);
  });
});

describe("robots + canonical", () => {
  it("emits zero-click friendly robots by default", () => {
    expect(resolveRobotsMeta(empty)).toBe(
      "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1",
    );
  });
  it("emits noindex when flagged", () => {
    expect(resolveRobotsMeta({ seo_noindex: true })).toBe("noindex, nofollow");
  });
  it("accepts only absolute canonical overrides", () => {
    expect(seoCanonicalOverride({ seo_canonical_url: "https://zrodlo.example/a" })).toBe(
      "https://zrodlo.example/a",
    );
    expect(seoCanonicalOverride({ seo_canonical_url: "/wzgledny" })).toBeNull();
    expect(seoCanonicalOverride(empty)).toBeNull();
  });
});
