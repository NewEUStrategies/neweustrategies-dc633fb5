import { describe, expect, it } from "vitest";
import {
  estimateTextWidthPx,
  serpDescriptionMetric,
  serpTitleMetric,
  truncateToPx,
  SERP_TITLE_LIMIT_PX,
} from "@/lib/seo/serp";

describe("estimateTextWidthPx", () => {
  it("scales with font size and character class", () => {
    const narrow = estimateTextWidthPx("iiii", 20);
    const wide = estimateTextWidthPx("MMMM", 20);
    expect(wide).toBeGreaterThan(narrow * 2);
    // Linear in font size (within integer rounding).
    const ratio = estimateTextWidthPx("abc", 40) / estimateTextWidthPx("abc", 20);
    expect(ratio).toBeGreaterThan(1.9);
    expect(ratio).toBeLessThan(2.1);
    expect(estimateTextWidthPx("", 20)).toBe(0);
  });
});

describe("serp metrics", () => {
  it("grades empty, short, good and long", () => {
    expect(serpTitleMetric("").grade).toBe("empty");
    expect(serpTitleMetric("Krótko").grade).toBe("short");
    expect(serpTitleMetric("Strategiczne myślenie o bezpieczeństwie Europy dziś").grade).toBe(
      "good",
    );
    expect(serpTitleMetric("x".repeat(120)).grade).toBe("long");
  });
  it("description uses the wider budget", () => {
    const d = serpDescriptionMetric(
      "Solidny, konkretny opis artykułu o geopolityce i strategii bezpieczeństwa Europy Środkowej, pisany z myślą o wynikach wyszukiwania.",
    );
    expect(d.grade).toBe("good");
    expect(d.limitPx).toBe(960);
  });
});

describe("truncateToPx", () => {
  it("returns short strings unchanged and truncates long ones with ellipsis", () => {
    expect(truncateToPx("Krótki", 20, SERP_TITLE_LIMIT_PX)).toBe("Krótki");
    const long = "Bardzo ".repeat(30);
    const cut = truncateToPx(long, 20, SERP_TITLE_LIMIT_PX);
    expect(cut.endsWith("…")).toBe(true);
    expect(estimateTextWidthPx(cut, 20)).toBeLessThanOrEqual(SERP_TITLE_LIMIT_PX);
  });
});
