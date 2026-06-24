import { describe, it, expect } from "vitest";
import {
  StoryPageSchema,
  StoryPagesSchema,
  newStoryPage,
  safeParsePages,
  storyTitle,
  pageCaption,
  pageCtaLabel,
} from "../types";

describe("web-stories types", () => {
  it("newStoryPage produces a valid page", () => {
    const p = newStoryPage();
    expect(StoryPageSchema.parse(p)).toBeTruthy();
    expect(p.duration_seconds).toBeGreaterThanOrEqual(2);
  });

  it("safeParsePages returns [] on invalid input", () => {
    expect(safeParsePages(null)).toEqual([]);
    expect(safeParsePages("nope")).toEqual([]);
    expect(safeParsePages([{ id: "x" }])).toHaveLength(1);
  });

  it("safeParsePages accepts well-formed arrays", () => {
    const arr = [newStoryPage(), newStoryPage()];
    expect(StoryPagesSchema.parse(arr)).toHaveLength(2);
  });

  it("locale fallbacks return non-empty when one locale is filled", () => {
    expect(storyTitle({ title_pl: "PL", title_en: "" }, "en")).toBe("PL");
    expect(storyTitle({ title_pl: "", title_en: "EN" }, "pl")).toBe("EN");
  });

  it("page accessors fall back across locales", () => {
    const p = { ...newStoryPage(), caption_pl: "PL cap", cta_label_en: "Read" };
    expect(pageCaption(p, "en")).toBe("PL cap");
    expect(pageCtaLabel(p, "pl")).toBe("Read");
  });

  it("duration is clamped between 2 and 30", () => {
    expect(() => StoryPageSchema.parse({ ...newStoryPage(), duration_seconds: 1 })).toThrow();
    expect(() => StoryPageSchema.parse({ ...newStoryPage(), duration_seconds: 31 })).toThrow();
  });
});
