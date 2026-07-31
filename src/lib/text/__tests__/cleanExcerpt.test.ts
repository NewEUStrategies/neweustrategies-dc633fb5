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
