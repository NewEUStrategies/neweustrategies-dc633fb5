// Panel mediów nie może pobierać oryginałów do kafelków: każda powierzchnia
// prosi o wariant dopasowany do tego, co rysuje (1x/2x), a oryginał zostaje
// dla pobierania, nowej karty i awaryjnego powrotu.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MEDIA_VARIANT_WIDTH,
  mediaVariant,
  prefetchMediaPreview,
  resetMediaPrefetchCache,
} from "../mediaVariants";

const BRANDED = "https://neweuropeanstrategies.com/media/t1/wp-import/2026/abc.png";

describe("mediaVariant", () => {
  it("kafel siatki prosi o 200 px (1x) i 400 px (2x), nie o oryginał", () => {
    const v = mediaVariant(BRANDED, "tile");
    expect(v.src).toBe("/media/t1/wp-import/2026/abc.png?width=200&resize=contain&quality=76");
    expect(v.srcSet).toBe(
      "/media/t1/wp-import/2026/abc.png?width=200&resize=contain&quality=76 1x, " +
        "/media/t1/wp-import/2026/abc.png?width=400&resize=contain&quality=76 2x",
    );
    expect(v.original).toBe("/media/t1/wp-import/2026/abc.png");
  });

  it("podgląd pełnoekranowy ma 1280 px, a 2x jest przycięte do 2500 px", () => {
    expect(MEDIA_VARIANT_WIDTH.preview).toBe(1280);
    const v = mediaVariant(BRANDED, "preview");
    expect(v.src).toContain("width=1280");
    expect(v.srcSet).toContain("width=2500");
  });

  it("ikona w widoku listy to 24 px i 48 px", () => {
    const v = mediaVariant(BRANDED, "row");
    expect(v.src).toContain("width=24&");
    expect(v.srcSet).toContain("width=48&");
  });

  it.each(["logo.svg", "anim.gif", "fav.ico"])("%s zostaje oryginałem bez srcSet", (name) => {
    const v = mediaVariant(`https://neweuropeanstrategies.com/media/t1/${name}`, "tile");
    expect(v.src).toBe(`/media/t1/${name}`);
    expect(v.srcSet).toBeUndefined();
  });

  it("obcy host nie dostaje parametrów skalowania", () => {
    const v = mediaVariant("https://cdn.example/a.png", "tile");
    expect(v.src).toBe("https://cdn.example/a.png");
    expect(v.srcSet).toBeUndefined();
  });
});

describe("prefetchMediaPreview", () => {
  afterEach(() => {
    resetMediaPrefetchCache();
    vi.unstubAllGlobals();
  });

  it("pobiera wariant podglądu tylko raz na plik", () => {
    const created: { src: string; srcset: string }[] = [];
    class FakeImage {
      src = "";
      srcset = "";
      decoding = "";
      constructor() {
        created.push(this);
      }
    }
    vi.stubGlobal("Image", FakeImage);
    prefetchMediaPreview(BRANDED);
    prefetchMediaPreview(BRANDED);
    expect(created).toHaveLength(1);
    expect(created[0]?.src).toContain("width=1280");
  });
});
