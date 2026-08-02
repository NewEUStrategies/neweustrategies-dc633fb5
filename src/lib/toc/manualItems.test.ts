// Kontrakt parsera ręcznych pozycji spisu treści (widget buildera).
// Kluczowa regresja: kotwice muszą wychodzić z kanonicznego slugifyAnchor,
// nie z dawnej NFKD-only kopii widgetu, która gubiła litery atomowe (`ł`).
import { describe, expect, it } from "vitest";
import { MANUAL_TOC_ITEMS_KEY, parseManualTocItems, readManualTocLines } from "./manualItems";

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

  it("splits a multi-line entry into separate items", () => {
    // Wklejony blok tekstu (albo starszy zapis jednopolowy) to nadal lista.
    expect(parseManualTocItems(["Alfa\n-- Beta\n\nGamma"]).map((i) => i.text)).toEqual([
      "Alfa",
      "Beta",
      "Gamma",
    ]);
  });
});

// Regresja key-mismatch: schemat zapisywał `items` (stringArray), a widget
// czytał wyłącznie `items_pl` / `items_${lang}`, więc ręcznie wpisany spis
// treści nigdy się nie renderował. Odczyt mieszka teraz w jednym miejscu i
// obsługuje OBA zapisy - nowy dwujęzyczny i stary bezjęzykowy.
describe("readManualTocLines", () => {
  it("uses the requested language when present", () => {
    expect(readManualTocLines({ items_pl: ["Sekcja PL"], items_en: ["Section EN"] }, "en")).toEqual(
      ["Section EN"],
    );
  });

  it("falls back to Polish when the requested language is empty", () => {
    expect(readManualTocLines({ items_pl: ["Sekcja PL"], items_en: [] }, "en")).toEqual([
      "Sekcja PL",
    ]);
  });

  it("falls back to English when only the English list exists", () => {
    expect(readManualTocLines({ items_en: ["Section EN"] }, "pl")).toEqual(["Section EN"]);
  });

  it("reads content saved by the broken language-less control", () => {
    expect(readManualTocLines({ items: ["Legacy"] }, "pl")).toEqual(["Legacy"]);
    expect(readManualTocLines({ items: ["Legacy"] }, "en")).toEqual(["Legacy"]);
  });

  it("returns an empty list for missing or malformed content", () => {
    expect(readManualTocLines({}, "pl")).toEqual([]);
    expect(readManualTocLines({ items: "nie tablica" }, "pl")).toEqual([]);
  });

  it("exposes the storage key the schema field must declare", () => {
    expect(MANUAL_TOC_ITEMS_KEY).toBe("items");
  });
});
