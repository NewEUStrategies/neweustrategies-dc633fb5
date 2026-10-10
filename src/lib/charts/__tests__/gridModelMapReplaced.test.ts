// SIATKA MAPY - kraj wklejony w nowe miejsce znika ze starego wiersza, a zdanie to mówi.
//
// Wklejenie kraju, który stał już w innym wierszu siatki, usuwa tamten wiersz
// - wklejenie mówi wprost, gdzie kraj ma stać. Zgłaszane było to jednak jako
// `duplicateCountries`, czyli zdaniem „zostało pierwsze wystąpienie", choć
// zostawało WKLEJONE, a usuwany bywał wiersz wyżej - czyli pierwszy.
import { describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import "@/lib/i18n-admin-blocks";
import { applyMapPasteAt } from "@/lib/charts/gridModel";
import { importProblemText } from "@/lib/charts/importProblems";

describe("applyMapPasteAt - kraj przeniesiony wklejeniem", () => {
  it("stary wiersz nad kotwicą znika, zgłoszenie mówi, że obowiązuje wklejona wartość", () => {
    const { rows, problems } = applyMapPasteAt(
      [
        { id: "PL", value: 5 },
        { id: "DE", value: 6 },
      ],
      [["PL", "7"]],
      { row: 2, col: 0 },
    );
    expect(rows).toEqual([
      { id: "DE", value: 6 },
      { id: "PL", value: 7 },
    ]);
    expect(problems).toContainEqual({ code: "countriesReplaced", labels: ["PL"] });
    expect(problems.map((p) => p.code)).not.toContain("duplicateCountries");
  });

  it("powtórzenie w tym samym bloku dalej jest `duplicateCountries` - wygrywa pierwsze", () => {
    const { rows, problems } = applyMapPasteAt(
      [],
      [
        ["PL", "1"],
        ["PL", "2"],
      ],
      { row: 0, col: 0 },
    );
    expect(rows).toEqual([{ id: "PL", value: 1 }]);
    expect(problems).toContainEqual({ code: "duplicateCountries", labels: ["PL"] });
    expect(problems.map((p) => p.code)).not.toContain("countriesReplaced");
  });

  it.each(["pl", "en"] as const)(
    "zdanie nie twierdzi, że zostało pierwsze wystąpienie (%s)",
    (lng) => {
      const t = i18n.getFixedT(lng);
      const tekst = importProblemText({ code: "countriesReplaced", labels: ["PL", "DE"] }, (k, o) =>
        String(t(k, o)),
      );
      expect(tekst).toContain("PL, DE");
      expect(tekst).not.toMatch(/pierwsze wystąpienie|first occurrence/);
    },
  );
});
