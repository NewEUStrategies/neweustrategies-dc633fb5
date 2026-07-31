// Kontrakt parsera ręcznych pozycji spisu treści (widget buildera).
// Kluczowa regresja: kotwice muszą wychodzić z kanonicznego slugifyAnchor,
// nie z dawnej NFKD-only kopii widgetu, która gubiła litery atomowe (`ł`).
import { describe, expect, it } from "vitest";
import { parseManualTocItems } from "./manualItems";

describe("parseManualTocItems", () => {
  it("parses a plain line as an H2 with the canonical anchor", () => {
    expect(parseManualTocItems(["Wprowadzenie"])).toEqual([
      { id: "wprowadzenie", text: "Wprowadzenie", level: 2 },
    ]);
  });

  it("parses '-- Tekst' as an indented H3", () => {
    expect(parseManualTocItems(["-- Szczegóły"])).toEqual([
      { id: "szczegoly", text: "Szczegóły", level: 3 },
    ]);
  });

  it("transliterates atomic letters instead of dropping them (the 'ł' regression)", () => {
    // Dawna kopia slugify w TocWidget produkowała tu "wyzwania-ma-ych-firm".
    expect(parseManualTocItems(["Wyzwania małych firm"])).toEqual([
      { id: "wyzwania-malych-firm", text: "Wyzwania małych firm", level: 2 },
    ]);
    expect(parseManualTocItems(["-- Łódź i region"])[0].id).toBe("lodz-i-region");
  });

  it("honors an explicit '#id | Tekst' anchor, with '#' optional", () => {
    expect(parseManualTocItems(["#custom-anchor | Wnioski"])).toEqual([
      { id: "custom-anchor", text: "Wnioski", level: 2 },
    ]);
    expect(parseManualTocItems(["inny-id | Wnioski"])[0].id).toBe("inny-id");
  });

  it("keeps everything after the FIRST pipe in the label", () => {
    // Dawny parser dzielił po KAŻDYM "|" i gubił trzeci segment.
    expect(parseManualTocItems(["#roadmap | Plan | Q3"])).toEqual([
      { id: "roadmap", text: "Plan | Q3", level: 2 },
    ]);
  });

  it("falls back to the canonical slug when the explicit part is blank", () => {
    expect(parseManualTocItems(["# | Wnioski"])[0].id).toBe("wnioski");
  });

  it("skips blank lines and lines without a label", () => {
    expect(parseManualTocItems(["", "   ", "#osierocony-id |", "Temat"])).toEqual([
      { id: "temat", text: "Temat", level: 2 },
    ]);
  });

  it("deduplicates repeated titles from the base (stable, unique React keys)", () => {
    expect(parseManualTocItems(["Wnioski", "Wnioski", "Wnioski"]).map((i) => i.id)).toEqual([
      "wnioski",
      "wnioski-2",
      "wnioski-3",
    ]);
  });

  it("deduplicates a repeated explicit anchor too", () => {
    expect(parseManualTocItems(["#dup | A", "#dup | B"]).map((i) => i.id)).toEqual([
      "dup",
      "dup-2",
    ]);
  });
});
