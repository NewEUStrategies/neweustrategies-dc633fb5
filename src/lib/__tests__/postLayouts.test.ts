import { describe, it, expect } from "vitest";
import { coverImageSizes, findLayout } from "@/lib/postLayouts";

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
