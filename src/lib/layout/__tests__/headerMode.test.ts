import { describe, expect, it } from "vitest";
import { isReadingSurface, resolveHeaderMode } from "@/lib/layout/headerMode";

describe("resolveHeaderMode", () => {
  it("wpis (kind z loaderData) oddaje górną krawędź paskowi czytania", () => {
    // Kanoniczny adres wpisu to <ścieżka-rodzica>/<slug> - po samej ścieżce
    // wpisu rozpoznać nie można, dlatego decyduje `kind` z loadera.
    expect(
      resolveHeaderMode({ pathname: "/analizy/pentagon-bliskiego-wschodu", contentKind: "post" }),
    ).toBe("reading");
    expect(resolveHeaderMode({ pathname: "/en/analyses/some-article", contentKind: "post" })).toBe(
      "reading",
    );
  });

  it("strony, archiwa i home zostają na sticky + shrink", () => {
    expect(resolveHeaderMode({ pathname: "/", contentKind: null })).toBe("sticky-shrink");
    expect(resolveHeaderMode({ pathname: "/blog", contentKind: null })).toBe("sticky-shrink");
    expect(resolveHeaderMode({ pathname: "/o-nas", contentKind: "page" })).toBe("sticky-shrink");
    expect(resolveHeaderMode({ pathname: "/profile/bookmarks" })).toBe("sticky-shrink");
  });

  it("legacy /post/<slug> (też z prefiksem języka) liczy się jak wpis", () => {
    // Trasa tylko przekierowuje 301, ale zanim to zrobi renderuje chrome -
    // bez tej gałęzi pierwsza klatka miałaby dwa przyklejone paski.
    expect(isReadingSurface({ pathname: "/post/afganistan-wielka-gra" })).toBe(true);
    expect(isReadingSurface({ pathname: "/en/post/afghanistan-great-game" })).toBe(true);
    expect(isReadingSurface({ pathname: "/post" })).toBe(true);
  });

  it("nie myli ścieżek, które tylko zaczynają się jak /post", () => {
    expect(isReadingSurface({ pathname: "/postawy-europy" })).toBe(false);
    expect(isReadingSurface({ pathname: "/podcast/odcinek-1" })).toBe(false);
  });
});
