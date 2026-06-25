import { describe, it, expect } from "vitest";
import {
  isSupabaseStorageUrl,
  buildScaledImageUrl,
  buildImageSrcSet,
  buildTransformedImageUrl,
} from "@/lib/cropSizes";

const OBJ = "https://proj.supabase.co/storage/v1/object/public/media/cover.jpg";
const EXT = "https://cdn.example.com/cover.jpg";

describe("isSupabaseStorageUrl", () => {
  it("detects object + render storage urls", () => {
    expect(isSupabaseStorageUrl(OBJ)).toBe(true);
    expect(isSupabaseStorageUrl(OBJ.replace("/object/", "/render/image/"))).toBe(true);
  });
  it("is false for external / empty", () => {
    expect(isSupabaseStorageUrl(EXT)).toBe(false);
    expect(isSupabaseStorageUrl("")).toBe(false);
    expect(isSupabaseStorageUrl("not a url")).toBe(false);
  });
});

describe("buildScaledImageUrl", () => {
  it("rewrites storage object urls to width-only render transforms", () => {
    const out = new URL(buildScaledImageUrl(OBJ, 640, 70));
    expect(out.pathname).toContain("/storage/v1/render/image/public/");
    expect(out.searchParams.get("width")).toBe("640");
    expect(out.searchParams.get("quality")).toBe("70");
    expect(out.searchParams.get("height")).toBeNull(); // width-only preserves ratio
  });
  it("appends a w hint for external urls", () => {
    expect(new URL(buildScaledImageUrl(EXT, 640)).searchParams.get("w")).toBe("640");
  });
});

describe("buildImageSrcSet", () => {
  it("emits one width-descriptor candidate per width for storage urls", () => {
    const set = buildImageSrcSet(OBJ, [320, 640]);
    const parts = set.split(", ");
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatch(/width=320.* 320w$/);
    expect(parts[1]).toMatch(/width=640.* 640w$/);
  });
  it("returns empty for non-transformable urls so callers omit srcSet", () => {
    expect(buildImageSrcSet(EXT)).toBe("");
    expect(buildImageSrcSet("")).toBe("");
  });
});

describe("buildTransformedImageUrl (crop) still works", () => {
  it("sets width+height+resize for crops", () => {
    const out = new URL(buildTransformedImageUrl(OBJ, { width: 400, height: 300 }));
    expect(out.searchParams.get("width")).toBe("400");
    expect(out.searchParams.get("height")).toBe("300");
    expect(out.searchParams.get("resize")).toBe("cover");
  });
});
