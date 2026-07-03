import { describe, it, expect } from "vitest";
import { splatToSegments, metaDescription } from "./publicSegments";

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

  it("caps the result at 160 characters", () => {
    const long = "x".repeat(500);
    const out = metaDescription(long, "fallback");
    expect(out).toHaveLength(160);
    expect(out).toBe("x".repeat(160));
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
