import { describe, expect, it } from "vitest";
import { layoutOgTitle, ogCardStoragePath, wrapText, type MeasureFn } from "@/lib/seo/ogCard";

// Deterministic measurer: every character is 0.5em wide.
const measure: MeasureFn = (text, fontSize) => text.length * fontSize * 0.5;

describe("wrapText", () => {
  it("wraps greedily on the pixel budget", () => {
    // 20px font -> 10px/char; 100px budget -> 10 chars per line.
    expect(wrapText("aaa bbb ccc", 100, 20, measure)).toEqual(["aaa bbb", "ccc"]);
  });
  it("hard-clips single words longer than the budget", () => {
    const lines = wrapText("Superduperlongword", 100, 20, measure);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.endsWith("…")).toBe(true);
    expect(measure(lines[0] ?? "", 20)).toBeLessThanOrEqual(100);
  });
});

describe("layoutOgTitle", () => {
  it("keeps short titles at the largest size", () => {
    const layout = layoutOgTitle("Krótki tytuł", measure);
    expect(layout.fontSize).toBe(72);
    expect(layout.lines).toEqual(["Krótki tytuł"]);
  });
  it("steps the font down for long titles and clamps to 4 lines", () => {
    const layout = layoutOgTitle("słowo ".repeat(60), measure);
    expect(layout.fontSize).toBe(42);
    expect(layout.lines.length).toBeLessThanOrEqual(4);
    expect(layout.lines[layout.lines.length - 1]?.endsWith("…")).toBe(true);
  });
});

describe("ogCardStoragePath", () => {
  it("keys one object per entity", () => {
    expect(ogCardStoragePath("post", "abc")).toBe("og-cards/post-abc.png");
    expect(ogCardStoragePath("page", "def")).toBe("og-cards/page-def.png");
  });
});
