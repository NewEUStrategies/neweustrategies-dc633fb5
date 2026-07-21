// Unit tests for the bilingual live-preview copy + tab titles.
import { describe, it, expect } from "vitest";
import { getPreviewCopy, getTabTitle } from "../previewCopy";
import { PREVIEW_SECTIONS } from "../tabs";

describe("getPreviewCopy", () => {
  it("returns Polish copy for pl", () => {
    const copy = getPreviewCopy("pl");
    expect(copy.readMore).toBe("Czytaj więcej");
    expect(copy.items).toHaveLength(3);
  });

  it("returns English copy for en", () => {
    const copy = getPreviewCopy("en");
    expect(copy.readMore).toBe("Read more");
    expect(copy.modeItems).toHaveLength(3);
  });

  it("never contains an em dash (house style uses a hyphen)", () => {
    for (const lang of ["pl", "en"] as const) {
      const copy = getPreviewCopy(lang);
      const joined = [copy.excerpt, copy.title, copy.eyebrow, ...copy.items].join(" ");
      expect(joined).not.toContain("—");
    }
  });
});

describe("getTabTitle", () => {
  it("maps each section to a non-empty label in both languages", () => {
    for (const section of PREVIEW_SECTIONS) {
      expect(getTabTitle(section, "pl").length).toBeGreaterThan(0);
      expect(getTabTitle(section, "en").length).toBeGreaterThan(0);
    }
  });

  it("distinguishes languages where copy differs", () => {
    expect(getTabTitle("block-heading", "pl")).toBe("Nagłówki bloków");
    expect(getTabTitle("block-heading", "en")).toBe("Block headings");
  });
});
