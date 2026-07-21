import { describe, it, expect } from "vitest";
import {
  normalizePath,
  parentOf,
  folderName,
  folderDepth,
  buildBreadcrumbs,
  isWithin,
  directChildFolders,
} from "../mediaPaths";

describe("normalizePath", () => {
  it("wraps a bare segment in leading/trailing slashes", () => {
    expect(normalizePath("press")).toBe("/press/");
  });

  it("collapses duplicate slashes and trims", () => {
    expect(normalizePath("  //press//2026// ")).toBe("/press/2026/");
  });

  it("is idempotent on an already-normalised path", () => {
    expect(normalizePath("/press/2026/")).toBe("/press/2026/");
  });

  it("keeps the root as a single slash", () => {
    expect(normalizePath("/")).toBe("/");
    expect(normalizePath("")).toBe("/");
  });
});

describe("parentOf", () => {
  it("returns the parent folder", () => {
    expect(parentOf("/press/2026/")).toBe("/press/");
    expect(parentOf("/press/")).toBe("/");
  });

  it("returns root for the root", () => {
    expect(parentOf("/")).toBe("/");
  });
});

describe("folderName", () => {
  it("returns the last segment", () => {
    expect(folderName("/press/2026/")).toBe("2026");
    expect(folderName("/press/")).toBe("press");
  });

  it("returns slash for the root", () => {
    expect(folderName("/")).toBe("/");
  });
});

describe("folderDepth", () => {
  it("counts nesting depth", () => {
    expect(folderDepth("/")).toBe(0);
    expect(folderDepth("/press/")).toBe(1);
    expect(folderDepth("/press/2026/")).toBe(2);
  });
});

describe("buildBreadcrumbs", () => {
  it("always starts at the root", () => {
    expect(buildBreadcrumbs("/")).toEqual([{ label: "/", path: "/" }]);
  });

  it("accumulates each segment as its own crumb", () => {
    expect(buildBreadcrumbs("/press/2026/")).toEqual([
      { label: "/", path: "/" },
      { label: "press", path: "/press/" },
      { label: "2026", path: "/press/2026/" },
    ]);
  });
});

describe("isWithin", () => {
  it("treats a folder as within itself", () => {
    expect(isWithin("/press/", "/press/")).toBe(true);
  });

  it("detects nested descendants", () => {
    expect(isWithin("/press/2026/", "/press/")).toBe(true);
  });

  it("rejects unrelated or ancestor paths", () => {
    expect(isWithin("/press/", "/press/2026/")).toBe(false);
    expect(isWithin("/news/", "/press/")).toBe(false);
  });
});

describe("directChildFolders", () => {
  it("returns immediate children from explicit folder rows", () => {
    const folders = ["/press/", "/press/2026/", "/press/2027/", "/news/"];
    expect(directChildFolders("/press/", folders, [])).toEqual(["/press/2026/", "/press/2027/"]);
  });

  it("includes folders implied by media locations", () => {
    expect(directChildFolders("/", [], ["/press/", "/news/"])).toEqual(["/news/", "/press/"]);
  });

  it("de-duplicates a folder present in both sources", () => {
    expect(directChildFolders("/", ["/press/"], ["/press/"])).toEqual(["/press/"]);
  });

  it("never returns the current folder itself", () => {
    expect(directChildFolders("/press/", ["/press/"], [])).toEqual([]);
  });
});
