import { describe, expect, it } from "vitest";
import { validateSeoPanel, hasBlockingSeoIssues } from "@/lib/seo/validation";
import type { SeoPanelValue } from "@/components/admin/seo/SeoPanel";

const emptyValue: SeoPanelValue = {
  seo_title_pl: null,
  seo_title_en: null,
  seo_description_pl: null,
  seo_description_en: null,
  seo_canonical_url: null,
  seo_noindex: false,
  seo_og_image_url: null,
  og_image_generated_url: null,
};

describe("validateSeoPanel", () => {
  it("returns no issues for well-sized derived fallbacks", () => {
    const issues = validateSeoPanel({
      value: emptyValue,
      fallbackTitle: {
        pl: "Strategiczne myślenie o bezpieczeństwie Europy dziś",
        en: "Strategic thinking about Europe's security today",
      },
      fallbackDescription: {
        pl: "Solidny, konkretny opis artykułu o geopolityce i strategii bezpieczeństwa Europy Środkowej pisany z myślą o wynikach wyszukiwania.",
        en: "A solid, specific description of an article on geopolitics and Central European security strategy, written with search results in mind.",
      },
      slug: "test",
      titleCharLimit: 160,
      descriptionCharLimit: 320,
    });
    expect(issues).toEqual([]);
  });

  it("flags a title that exceeds Google's pixel budget as a warning", () => {
    const long = "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW";
    const issues = validateSeoPanel({
      value: { ...emptyValue, seo_title_pl: long },
      fallbackTitle: { pl: "x", en: "x" },
      fallbackDescription: { pl: "opis", en: "desc" },
      slug: "test",
      titleCharLimit: 160,
      descriptionCharLimit: 320,
    });
    const titleIssue = issues.find((i) => i.kind === "title" && i.lang === "pl");
    expect(titleIssue?.severity).toBe("warning");
    expect(titleIssue?.px).toBeGreaterThan(titleIssue!.pxLimit);
    expect(hasBlockingSeoIssues(issues)).toBe(false);
  });

  it("flags a character-cap overflow as a blocking error", () => {
    const issues = validateSeoPanel({
      value: { ...emptyValue, seo_title_pl: "x".repeat(200) },
      fallbackTitle: { pl: "x", en: "x" },
      fallbackDescription: { pl: "opis", en: "desc" },
      slug: "test",
      titleCharLimit: 160,
      descriptionCharLimit: 320,
    });
    const err = issues.find((i) => i.severity === "error");
    expect(err?.chars).toBe(200);
    expect(err?.charLimit).toBe(160);
    expect(hasBlockingSeoIssues(issues)).toBe(true);
  });
});
