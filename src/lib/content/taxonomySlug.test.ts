import { describe, expect, it } from "vitest";
import { slugifyTaxonomy } from "./taxonomySlug";

describe("slugifyTaxonomy", () => {
  it("lowercases and dashes word separators", () => {
    expect(slugifyTaxonomy("Hello World")).toBe("hello-world");
  });

  it("strips decomposable Polish diacritics (NFD combining marks)", () => {
    // Ś→s, ą→a etc. decompose to base letter + combining mark, which is removed.
    expect(slugifyTaxonomy("Śląsk")).toBe("slask");
    expect(slugifyTaxonomy("Gęślą jaźń")).toBe("gesla-jazn");
  });

  it("treats the atomic 'ł' (no NFD decomposition) as a separator, matching prior behavior", () => {
    // U+0142 has no canonical decomposition, so it is not a base+mark pair and
    // falls through to the non-alphanumeric -> dash rule. This documents the
    // exact behavior the inline helper had before extraction.
    expect(slugifyTaxonomy("Łódź")).toBe("odz");
  });

  it("collapses any run of non-alphanumerics into a single dash", () => {
    expect(slugifyTaxonomy("a  --  b__c!!d")).toBe("a-b-c-d");
  });

  it("trims leading and trailing dashes", () => {
    expect(slugifyTaxonomy("  -Hello-  ")).toBe("hello");
  });

  it("returns an empty string when nothing survives", () => {
    expect(slugifyTaxonomy("!!!")).toBe("");
    expect(slugifyTaxonomy("")).toBe("");
  });

  it("caps the slug at 80 characters", () => {
    expect(slugifyTaxonomy("a".repeat(200))).toHaveLength(80);
  });
});
