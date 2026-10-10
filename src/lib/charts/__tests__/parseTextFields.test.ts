// POLA TEKSTOWE KONFIGURACJI: OBIEKT NIE TRAFIA DO CZYTELNIKA (PR2).
//
// Parser wykresu i mapy czytał tytuł, opis, jednostkę, źródło, podpis, datę
// danych i trzy zdania przez `String(...)`, więc obiekt z uszkodzonej treści
// bloku wychodził na stronę jako „[object Object]". Zgłosił to edytor mapy
// (podgląd musiał to obchodzić), a dotyczy obu parserów.
import { describe, expect, it } from "vitest";
import { parseChartConfig, parseDataMapConfig } from "@/lib/charts/parse";
import type { Json } from "@/lib/blocks/types";

const POLA = [
  "title",
  "description",
  "unit",
  "source",
  "caption",
  "sourceDate",
  "notesShows",
  "notesSurprising",
  "notesHidden",
] as const;

describe("pola tekstowe parsera", () => {
  it.each(POLA)("%s: obiekt, tablica i `true` dają pusty napis, nie „[object Object]”", (pole) => {
    for (const smiec of [{ pl: "x" }, ["a"], true] as Json[]) {
      const chart = parseChartConfig({ [pole]: smiec }) as unknown as Record<string, unknown>;
      const map = parseDataMapConfig({ [pole]: smiec }) as unknown as Record<string, unknown>;
      expect(chart[pole]).toBe("");
      expect(map[pole]).toBe("");
    }
  });

  it("napis zostaje napisem, liczba - jej zapisem", () => {
    expect(parseChartConfig({ title: "Handel", unit: 2026 }).title).toBe("Handel");
    expect(parseChartConfig({ unit: 2026 }).unit).toBe("2026");
    expect(parseDataMapConfig({ caption: "Podpis" }).caption).toBe("Podpis");
    expect(parseDataMapConfig({ sourceDate: 2025 }).sourceDate).toBe("2025");
  });
});

describe("liczby z pól tekstowych panelu", () => {
  it("spacje grupujące tysiące (zwykła, twarda, wąska) i minus U+2212 są czytane", () => {
    expect(parseDataMapConfig({ midpoint: "1 234,5" }).midpoint).toBe(1234.5);
    expect(parseDataMapConfig({ midpoint: "1\u00a0234" }).midpoint).toBe(1234);
    expect(parseDataMapConfig({ midpoint: "2\u202f500" }).midpoint).toBe(2500);
    expect(parseDataMapConfig({ midpoint: "\u22123,5" }).midpoint).toBe(-3.5);
    expect(parseDataMapConfig({ midpoint: "abc" }).midpoint).toBeNull();
    expect(parseDataMapConfig({ midpoint: "" }).midpoint).toBeNull();
  });
});
