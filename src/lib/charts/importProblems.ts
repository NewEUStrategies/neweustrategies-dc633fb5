// TEKSTY PROBLEMÓW IMPORTU I WKLEJENIA - jedna tabela kod -> klucz słownika.
//
// PO CO OSOBNY MODUŁ. Problem importu (`ImportProblem`) powstaje w trzech
// miejscach: przy odczycie pliku (kodowanie, arkusze ponad limit, obcięty
// arkusz), przy przekładaniu tabeli na dane (`tableToChartData`,
// `tableToMapValues`) i przy wklejeniu w siatkę edytora (`applyPasteAt`).
// Do PR2 tekst znała wyłącznie kontrolka importu pliku - `switch` prywatny
// w `DataImportControl.tsx` - więc siatka, która wkleja zakres z Excela,
// musiałaby mieć drugą kopię tej samej listy. Kopia rozjechałaby się przy
// pierwszym nowym kodzie i wklejenie mówiłoby o problemie surowym kodem.
//
// `Record` PO UNII KODÓW jest wyczerpujący: kod dopisany w `importTable.ts`
// bez tekstu tutaj NIE SKOMPILUJE SIĘ. Klucze są PEŁNYMI ścieżkami słownika
// (`blocks.editors.dataImport.*`, nakładka `i18n-admin-blocks.ts`), wypisanymi
// jawnie - bramka kluczy sklejanych nie ma tu czego szukać.
//
// MODUŁ JEST CZYSTY (bez i18n, bez Reacta): wołający podaje swoją funkcję
// tłumaczącą, więc ta sama tabela służy panelowi bloku i panelowi buildera,
// a test sprawdza ją bez montowania komponentu.
import type { ImportProblem, ImportProblemCode } from "./importTable";

/** Funkcja tłumacząca pełny klucz słownika - `t` z `react-i18next` albo jej odpowiednik. */
export type ImportProblemTranslate = (key: string, opts?: Record<string, unknown>) => string;

/**
 * Klucz słownika dla każdego kodu. `cellsTruncated` ma tu wariant OGÓLNY
 * (wiersze i kolumny naraz); warianty „tylko wiersze" i „tylko kolumny"
 * wybiera `importProblemText` z `CELLS_TRUNCATED_KEYS`.
 */
export const IMPORT_PROBLEM_KEYS: Readonly<Record<ImportProblemCode, string>> = {
  seriesTruncated: "blocks.editors.dataImport.pSeriesTruncated",
  categoriesTruncated: "blocks.editors.dataImport.pCategoriesTruncated",
  nonNumericCells: "blocks.editors.dataImport.pNonNumeric",
  rowsSkipped: "blocks.editors.dataImport.pRowsSkipped",
  unknownCountries: "blocks.editors.dataImport.pUnknownCountries",
  duplicateCountries: "blocks.editors.dataImport.pDuplicateCountries",
  labelsAdjusted: "blocks.editors.dataImport.pLabelsAdjusted",
  headerAssumed: "blocks.editors.dataImport.pHeaderAssumed",
  columnsIgnored: "blocks.editors.dataImport.pColumnsIgnored",
  aliasesApplied: "blocks.editors.dataImport.pAliasesApplied",
  dataFlags: "blocks.editors.dataImport.pDataFlags",
  encodingFallback: "blocks.editors.dataImport.pEncodingFallback",
  localeAmbiguous: "blocks.editors.dataImport.pLocaleAmbiguous",
  cellsTruncated: "blocks.editors.dataImport.pCellsTruncatedBoth",
  sheetsTruncated: "blocks.editors.dataImport.pSheetsTruncated",
  pasteTruncated: "blocks.editors.dataImport.pPasteTruncated",
};

/** Obcięty arkusz: zdanie zależy od tego, CO obcięto - wiersze, kolumny czy oba. */
export const CELLS_TRUNCATED_KEYS = {
  both: IMPORT_PROBLEM_KEYS.cellsTruncated,
  rows: "blocks.editors.dataImport.pCellsTruncatedRows",
  columns: "blocks.editors.dataImport.pCellsTruncatedColumns",
} as const;

/**
 * Zdanie dla redaktora. Liczby i listy idą do wstawek dokładnie takie, jakie
 * policzył import - „pominięto 3 serie" ma znaczyć dokładnie trzy.
 */
export function importProblemText(p: ImportProblem, t: ImportProblemTranslate): string {
  const key = IMPORT_PROBLEM_KEYS[p.code];
  switch (p.code) {
    case "seriesTruncated":
    case "categoriesTruncated":
    case "sheetsTruncated":
      return t(key, { count: p.dropped });
    case "nonNumericCells":
    case "rowsSkipped":
    case "labelsAdjusted":
    case "dataFlags":
    case "localeAmbiguous":
      return t(key, { count: p.count });
    case "unknownCountries":
    case "duplicateCountries":
    case "columnsIgnored":
    case "aliasesApplied":
      return t(key, { labels: p.labels.join(", ") });
    case "cellsTruncated":
      if (p.rows > 0 && p.columns > 0) {
        return t(CELLS_TRUNCATED_KEYS.both, { rows: p.rows, columns: p.columns });
      }
      return p.rows > 0
        ? t(CELLS_TRUNCATED_KEYS.rows, { count: p.rows })
        : t(CELLS_TRUNCATED_KEYS.columns, { count: p.columns });
    case "headerAssumed":
    case "encodingFallback":
    case "pasteTruncated":
      return t(key);
  }
}
