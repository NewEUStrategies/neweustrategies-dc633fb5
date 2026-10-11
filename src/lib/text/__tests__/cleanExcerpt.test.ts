import { describe, expect, it } from "vitest";
import { cleanExcerpt, decodeHtmlEntities } from "@/lib/text/cleanExcerpt";

describe("cleanExcerpt", () => {
  it("dekoduje encje HTML", () => {
    expect(decodeHtmlEntities("Kowalski &amp; Sp&oacute;lka")).toContain("&");
    expect(decodeHtmlEntities("tekst &#8230;")).toBe("tekst \u2026");
  });

  it("usuwa końcowy znacznik [&hellip;]", () => {
    expect(cleanExcerpt("zastanawiał się nad przyszłością Polski [&hellip;]")).toBe(
      "zastanawiał się nad przyszłością Polski",
    );
  });

  it("usuwa [...] i (...)", () => {
    expect(cleanExcerpt("Tekst [...]")).toBe("Tekst");
    expect(cleanExcerpt("Tekst (...)")).toBe("Tekst");
    expect(cleanExcerpt("Tekst […] […]")).toBe("Tekst");
  });

  it("zwraca undefined dla pustych wartości", () => {
    expect(cleanExcerpt(null)).toBeUndefined();
    expect(cleanExcerpt("  [&hellip;] ")).toBeUndefined();
  });
});

describe("decodeHtmlEntities - kody spoza zakresu nie wywracają strony wpisu", () => {
  it("kod spoza Unicode, NUL i surogat dają U+FFFD zamiast RangeError", () => {
    expect(() => cleanExcerpt("Wstęp &#9999999; dalej")).not.toThrow();
    expect(cleanExcerpt("a &#9999999; b")).toBe("a \ufffd b");
    expect(decodeHtmlEntities("&#x110000;&#0;&#xD800;")).toBe("\ufffd\ufffd\ufffd");
    expect(decodeHtmlEntities("&#8222;cytat&#8221;")).toBe("\u201ecytat\u201d");
  });
});
