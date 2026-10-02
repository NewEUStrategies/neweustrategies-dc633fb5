import { describe, it, expect } from "vitest";
import {
  coverAspectRatio,
  coverImageSizes,
  findLayout,
  inheritsThemeTitleSizes,
} from "@/lib/postLayouts";

const sizesFor = (id: string) => coverImageSizes(findLayout("standard", id));

describe("coverImageSizes", () => {
  it("uses 100vw for wide / ratio / above-cover covers", () => {
    expect(sizesFor("layout-1")).toBe("100vw"); // above-cover, wide
    expect(sizesFor("layout-6")).toBe("100vw"); // above-cover, ratio
    expect(sizesFor("layout-8")).toBe("100vw"); // below-cover, wide
  });

  it("uses the boxed 672px sizes for the boxed cover (layout-2)", () => {
    expect(sizesFor("layout-2")).toBe("(max-width: 768px) 100vw, 672px");
  });

  it("uses full-bleed 100vw for overlay headers (layout-4 / layout-5)", () => {
    expect(sizesFor("layout-4")).toBe("100vw"); // overlay, full-bleed
    expect(sizesFor("layout-5")).toBe("100vw"); // overlay, wide
  });

  it("uses the 50vw split sizes for the side-by-side header (layout-7)", () => {
    expect(sizesFor("layout-7")).toBe("(max-width: 1024px) 100vw, 50vw");
  });
});

// Kadr okładki: ta sama proporcja trafia do ramki w rendererze i do podglądu
// CMS, a opis „Grafika: 1600×900px · 16:9" w panelu obiecuje dokładnie ten kadr.
describe("coverAspectRatio", () => {
  const preset = (id: string) => findLayout("standard", id);

  it("układ z konfigurowalnym kadrem bierze proporcję z panelu", () => {
    expect(coverAspectRatio(preset("layout-6"), 150)).toBe("100 / 150");
    expect(coverAspectRatio(preset("layout-10"), 45)).toBe("100 / 45");
  });

  it("brak albo zero w ustawieniu panelu spada na rekomendowany rozmiar grafiki", () => {
    expect(coverAspectRatio(preset("layout-6"), 0)).toBe("1600 / 2400");
    expect(coverAspectRatio(preset("layout-11"), null)).toBe("1200 / 540");
  });

  it("hero overlay to filmowy pas 16:8, nawet gdy grafika jest rekomendowana 16:9", () => {
    expect(coverAspectRatio(preset("layout-4"))).toBe("16 / 8");
    expect(preset("layout-4").recommendedImage?.ratio).toBe("16:9");
  });

  it("proporcja panelu NIE działa na układach bez konfigurowalnego kadru", () => {
    expect(coverAspectRatio(preset("layout-1"), 45)).toBe("1600 / 900");
    expect(coverAspectRatio(preset("layout-7"), 45)).toBe("900 / 900");
  });

  it("preset bez rekomendowanego rozmiaru dostaje bezpieczne 16:9", () => {
    // Layout 9 nie maluje okładki, ale podgląd CMS pyta o kadr dla każdego presetu.
    expect(preset("layout-9").recommendedImage).toBeUndefined();
    expect(coverAspectRatio(preset("layout-9"))).toBe("16 / 9");
  });
});

describe("inheritsThemeTitleSizes", () => {
  it("brak ustawień (pierwsze wczytanie, SSR bez wiersza) dziedziczy rozmiary motywu", () => {
    expect(inheritsThemeTitleSizes(null)).toBe(true);
    expect(inheritsThemeTitleSizes(undefined)).toBe(true);
  });

  it("jawne źródło „layout” wyłącza dziedziczenie, „theme” je zostawia", () => {
    expect(inheritsThemeTitleSizes({ title_size_source: "layout" })).toBe(false);
    expect(inheritsThemeTitleSizes({ title_size_source: "theme" })).toBe(true);
  });
});
