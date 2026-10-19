// Ocena 5-stopniowa względem benchmarku: ranga, kolory graficzne i kolory
// napisu - oraz GRANICA GRAFU: moduł ocen jest tylko adminowy, a wykresy
// publiczne nie mogą go wciągnąć (budżet `public` zamrożony).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Tier } from "@/lib/analytics/semantic/benchmarks/types";
import { tierColor, tierOrder, tierRank, tierTextColor } from "@/lib/charts/benchmarkTier";

const WSZYSTKIE: readonly Tier[] = ["critical", "weak", "normal", "good", "optimal"];

/** Pliki produkcyjne katalogu (bez testów), rekurencyjnie. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return entry === "__tests__" ? [] : sources(full);
    return /\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}

describe("ocena 5-stopniowa względem benchmarku", () => {
  it("kolejność ocen rośnie razem z rangą 1-5", () => {
    expect(tierOrder()).toEqual(WSZYSTKIE);
    expect(tierOrder().map(tierRank)).toEqual([1, 2, 3, 4, 5]);
  });

  it("tierOrder zwraca świeżą tablicę - mutacja u konsumenta nie psuje kolejnego wywołania", () => {
    const a = tierOrder() as Tier[];
    a.reverse();
    expect(tierOrder()[0]).toBe("critical");
  });

  it("kolory graficzne: skrajne pełne, środkowe jako domieszka tokenu z przezroczystością", () => {
    expect(tierColor("critical")).toBe("var(--chart-negative)");
    expect(tierColor("weak")).toBe("color-mix(in srgb, var(--chart-negative) 45%, transparent)");
    expect(tierColor("normal")).toBe("color-mix(in srgb, var(--chart-s-main) 35%, transparent)");
    expect(tierColor("good")).toBe("color-mix(in srgb, var(--chart-positive) 45%, transparent)");
    expect(tierColor("optimal")).toBe("var(--chart-positive)");
  });

  it("każda ocena ma INNY kolor graficzny - pięć poziomów, pięć odcieni", () => {
    expect(new Set(WSZYSTKIE.map(tierColor)).size).toBe(5);
  });

  it("kolory napisu to pełne tokeny tekstowe (kontrast), bez domieszek", () => {
    expect(tierTextColor("critical")).toBe("var(--chart-negative-text)");
    expect(tierTextColor("weak")).toBe("var(--chart-negative-text)");
    expect(tierTextColor("normal")).toBe("var(--chart-ink2)");
    expect(tierTextColor("good")).toBe("var(--chart-positive-text)");
    expect(tierTextColor("optimal")).toBe("var(--chart-positive-text)");
    for (const t of WSZYSTKIE) expect(tierTextColor(t)).not.toMatch(/color-mix/);
  });

  it("żaden kolor nie jest literałem hex - geometria i odcień idą z tokenów motywu", () => {
    for (const t of WSZYSTKIE) {
      expect(tierColor(t)).not.toMatch(/#[0-9a-f]{3,8}/i);
      expect(tierTextColor(t)).not.toMatch(/#[0-9a-f]{3,8}/i);
    }
  });
});

describe("granica grafu: oceny tylko w panelu", () => {
  it("żaden moduł wykresów publicznych (`components/charts`, `lib/charts`) nie importuje ocen", () => {
    const publiczne = [...sources("src/components/charts"), ...sources("src/lib/charts")].filter(
      (file) => !file.endsWith("benchmarkTier.ts"),
    );
    // Skaner widzi pliki - inaczej pusta lista niżej niczego by nie dowodziła.
    expect(publiczne.length).toBeGreaterThan(20);
    const zOcenami = publiczne.filter((file) =>
      /from\s+["'](?:@\/lib\/charts|\.{1,2})\/benchmarkTier["']/.test(readFileSync(file, "utf8")),
    );
    expect(zOcenami).toEqual([]);
  });

  it("`status.ts` (chunk wspólny z wykresami publicznymi) nie zna typów rejestru benchmarków", () => {
    expect(readFileSync("src/lib/charts/status.ts", "utf8")).not.toMatch(/semantic\/benchmarks/);
  });
});
