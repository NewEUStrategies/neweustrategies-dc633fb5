// Unit tests for the tab registry + type guard.
import { describe, it, expect } from "vitest";
import { PREVIEW_SECTIONS, TAB_ITEMS, isPreviewSection } from "../tabs";

describe("tabs registry", () => {
  it("exposes 12 sections", () => {
    expect(PREVIEW_SECTIONS).toHaveLength(12);
  });

  it("keeps TAB_ITEMS in sync with PREVIEW_SECTIONS", () => {
    expect(TAB_ITEMS.map((item) => item.value)).toEqual([...PREVIEW_SECTIONS]);
  });

  it("gives every tab an i18n label key", () => {
    for (const item of TAB_ITEMS) {
      expect(item.labelKey.startsWith("adminThemeDesign.tabs.")).toBe(true);
    }
  });
});

describe("isPreviewSection", () => {
  it("accepts known section ids", () => {
    expect(isPreviewSection("carousel")).toBe(true);
    expect(isPreviewSection("overlay")).toBe(true);
  });

  it("rejects unknown values", () => {
    expect(isPreviewSection("nope")).toBe(false);
    expect(isPreviewSection("")).toBe(false);
  });
});
