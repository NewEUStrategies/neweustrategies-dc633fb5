import { describe, expect, it } from "vitest";
import { archiveFirstCardPreload } from "@/lib/seo/archivePreload";
import { CARD_IMAGE_SIZES, FEATURED_CARD_IMAGE_SIZES } from "@/lib/cardImageSizes";

const COVER = "https://p.supabase.co/storage/v1/object/public/covers/a.jpg";

describe("archiveFirstCardPreload", () => {
  it("null dla pustej listy i wpisu bez okładki", () => {
    expect(archiveFirstCardPreload([], false)).toBeNull();
    expect(archiveFirstCardPreload(undefined, false)).toBeNull();
    expect(archiveFirstCardPreload([{ cover_image_url: null }], false)).toBeNull();
  });

  it("karta wyróżniona: sizes szerokiej karty; zwykła siatka: sizes karty", () => {
    const featured = archiveFirstCardPreload([{ cover_image_url: COVER }], true);
    const grid = archiveFirstCardPreload([{ cover_image_url: COVER }], false);
    expect(featured?.imageSizes).toBe(FEATURED_CARD_IMAGE_SIZES);
    expect(grid?.imageSizes).toBe(CARD_IMAGE_SIZES);
    expect(featured?.href).toBe(COVER);
  });

  it("srcSet pochodzi z transformacji Supabase (render endpoint) - parytet z <img>", () => {
    const preload = archiveFirstCardPreload([{ cover_image_url: COVER }], false);
    expect(preload?.imageSrcSet).toContain("/storage/v1/render/image/public/");
    expect(preload?.imageSrcSet).toContain("320w");
  });

  it("URL spoza Supabase: preload samego href (pusty srcSet)", () => {
    const preload = archiveFirstCardPreload(
      [{ cover_image_url: "https://cdn.example/x.jpg" }],
      false,
    );
    expect(preload?.href).toBe("https://cdn.example/x.jpg");
    expect(preload?.imageSrcSet).toBe("");
  });
});
