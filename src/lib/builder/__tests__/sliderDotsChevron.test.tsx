import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(__dirname, "../sliderVariants.tsx"), "utf8");

describe("slider dots nav - czyste katy bez ogonkow", () => {
  it("uzywa AngleChevron po obu stronach kropek, bez strzalek z ogonkiem", () => {
    expect(src).toContain('<AngleChevron side="left"');
    expect(src).toContain('<AngleChevron side="right"');
    expect(src).not.toMatch(/<Arrow(Left|Right)\b/);
  });
});
