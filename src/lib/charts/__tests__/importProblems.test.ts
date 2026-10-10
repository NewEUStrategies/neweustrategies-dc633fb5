// TEKSTY PROBLEMÓW IMPORTU - tabela kod -> klucz słownika.
//
// Pilnuje trzech rzeczy: każdy kod `ImportProblem` ma klucz, klucz ma treść
// w OBU językach, a zdanie niesie liczby i listy z problemu (żadnej surowej
// wstawki `{{...}}` ani surowego klucza na ekranie).
import { describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import "@/lib/i18n-admin-blocks";
import {
  CELLS_TRUNCATED_KEYS,
  IMPORT_PROBLEM_KEYS,
  importProblemText,
} from "@/lib/charts/importProblems";
import type { ImportProblem } from "@/lib/charts/importTable";

/** Po jednej próbce każdego kodu - kompletność wymusza `Record` niżej. */
const PROBKI: Record<ImportProblem["code"], ImportProblem> = {
  seriesTruncated: { code: "seriesTruncated", dropped: 3 },
  categoriesTruncated: { code: "categoriesTruncated", dropped: 7 },
  nonNumericCells: { code: "nonNumericCells", count: 4 },
  rowsSkipped: { code: "rowsSkipped", count: 2 },
  unknownCountries: { code: "unknownCountries", labels: ["Atlantyda", "Wakanda"] },
  duplicateCountries: { code: "duplicateCountries", labels: ["PL"] },
  countriesReplaced: { code: "countriesReplaced", labels: ["DE"] },
  labelsAdjusted: { code: "labelsAdjusted", count: 5 },
  headerAssumed: { code: "headerAssumed" },
  columnsIgnored: { code: "columnsIgnored", labels: ["2019", "2020"] },
  aliasesApplied: { code: "aliasesApplied", labels: ["POL (PL)"] },
  dataFlags: { code: "dataFlags", count: 6 },
  encodingFallback: { code: "encodingFallback", encoding: "windows-1250" },
  localeAmbiguous: { code: "localeAmbiguous", count: 8 },
  cellsTruncated: { code: "cellsTruncated", rows: 11, columns: 12 },
  sheetsTruncated: { code: "sheetsTruncated", dropped: 9 },
  pasteTruncated: { code: "pasteTruncated" },
};

const JEZYKI = ["pl", "en"] as const;

describe("importProblemText - tabela kluczy", () => {
  it("każdy klucz (z wariantami obciętego arkusza) ma treść w obu językach", () => {
    const klucze = [...Object.values(IMPORT_PROBLEM_KEYS), ...Object.values(CELLS_TRUNCATED_KEYS)];
    for (const jezyk of JEZYKI) {
      for (const klucz of klucze) {
        expect(i18n.exists(klucz, { lng: jezyk }), `${klucz} (${jezyk})`).toBe(true);
      }
    }
  });

  it.each(JEZYKI)("każdy kod daje zdanie bez surowego klucza i wstawki (%s)", (jezyk) => {
    const t = i18n.getFixedT(jezyk);
    for (const p of Object.values(PROBKI)) {
      const tekst = importProblemText(p, (k, o) => String(t(k, o)));
      expect(tekst, p.code).not.toContain("blocks.editors");
      expect(tekst, p.code).not.toMatch(/\{\{/);
      expect(tekst.trim(), p.code).not.toBe("");
    }
  });

  it("liczby i listy z problemu trafiają do zdania", () => {
    const t = i18n.getFixedT("pl");
    const tr = (k: string, o?: Record<string, unknown>) => String(t(k, o));
    expect(importProblemText(PROBKI.seriesTruncated, tr)).toContain("3");
    expect(importProblemText(PROBKI.unknownCountries, tr)).toContain("Atlantyda, Wakanda");
    expect(importProblemText(PROBKI.cellsTruncated, tr)).toMatch(/11.*12/);
  });

  it("obcięty arkusz wybiera zdanie według tego, co obcięto", () => {
    const uzyte: string[] = [];
    const tr = (k: string) => {
      uzyte.push(k);
      return k;
    };
    importProblemText({ code: "cellsTruncated", rows: 3, columns: 0 }, tr);
    importProblemText({ code: "cellsTruncated", rows: 0, columns: 4 }, tr);
    importProblemText({ code: "cellsTruncated", rows: 3, columns: 4 }, tr);
    expect(uzyte).toEqual([
      CELLS_TRUNCATED_KEYS.rows,
      CELLS_TRUNCATED_KEYS.columns,
      CELLS_TRUNCATED_KEYS.both,
    ]);
  });
});
