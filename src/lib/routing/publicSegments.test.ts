import { describe, it, expect } from "vitest";
import { splatToSegments, metaDescription } from "./publicSegments";
import { SERP_DESCRIPTION_LIMIT_PX, estimateTextWidthPx } from "@/lib/seo/serp";

describe("splatToSegments", () => {
  it("splits a multi-segment path", () => {
    expect(splatToSegments("a/b/c")).toEqual(["a", "b", "c"]);
  });

  it("returns a single segment for a top-level slug", () => {
    expect(splatToSegments("about")).toEqual(["about"]);
  });

  it("returns an empty array for an empty splat (→ 404 in the resolver)", () => {
    expect(splatToSegments("")).toEqual([]);
  });

  it("drops leading, trailing and duplicate slashes", () => {
    expect(splatToSegments("/a//b/")).toEqual(["a", "b"]);
    expect(splatToSegments("///")).toEqual([]);
  });

  it("preserves segment order and casing", () => {
    expect(splatToSegments("Parent/Child-Slug/post_1")).toEqual(["Parent", "Child-Slug", "post_1"]);
  });
});

describe("metaDescription", () => {
  it("strips HTML tags and collapses whitespace", () => {
    expect(metaDescription("<p>Hello   <b>world</b></p>", "fallback")).toBe("Hello world");
  });

  it("trims surrounding whitespace left by tag stripping", () => {
    expect(metaDescription("  <div> spaced </div>  ", "fallback")).toBe("spaced");
  });

  it("fits Google's pixel budget, cutting at a word boundary with an ellipsis", () => {
    const words = "Analiza bezpieczeństwa wschodniej flanki NATO ".repeat(10).trim();
    const out = metaDescription(words, "fallback");
    expect(out.endsWith("…")).toBe(true);
    expect(estimateTextWidthPx(out, 14)).toBeLessThanOrEqual(SERP_DESCRIPTION_LIMIT_PX);
    // Ucięte na granicy słowa - przed wielokropkiem stoi całe słowo z tekstu.
    expect(words.split(" ")).toContain(out.slice(0, -1).split(" ").at(-1));
  });

  it("leaves a description that already fits untouched", () => {
    expect(metaDescription("Krótka zajawka.", "fallback")).toBe("Krótka zajawka.");
  });

  it("hard-cuts a single word longer than the budget", () => {
    const out = metaDescription("x".repeat(500), "fallback");
    expect(out.endsWith("…")).toBe(true);
    expect(estimateTextWidthPx(out, 14)).toBeLessThanOrEqual(SERP_DESCRIPTION_LIMIT_PX);
  });

  it("falls back when the raw value is null or undefined", () => {
    expect(metaDescription(null, "fallback")).toBe("fallback");
    expect(metaDescription(undefined, "fallback")).toBe("fallback");
  });

  it("falls back when the raw value is empty or whitespace/markup only", () => {
    expect(metaDescription("", "fallback")).toBe("fallback");
    expect(metaDescription("   ", "fallback")).toBe("fallback");
    expect(metaDescription("<br/><span></span>", "fallback")).toBe("fallback");
  });
});
