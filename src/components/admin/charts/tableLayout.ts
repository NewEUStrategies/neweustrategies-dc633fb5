// Układ tabeli w podglądzie wklejki i importu - typy, położenia początkowe
// przełączników i rozmiar podglądu. Osobny moduł (bez Reacta): czytają go
// podgląd, siatka wykresu, kontrolka importu i siatka mapy.
import { analyseTable, type NumberLocaleChoice } from "@/lib/charts/importTable";

export type TablePreviewMode = "chart" | "map";
export type TablePreviewSource = "paste" | "file";

/** Układ tabeli wybrany w podglądzie - wejście `tableToChartData` / `tableToMapValues`. */
export interface TableLayout {
  header: boolean;
  transpose: boolean;
  locale: NumberLocaleChoice;
  /** Kolumna wartości mapy (0 to kolumna kraju). Wykres jej nie czyta. */
  valueColumn: number;
}

/** Ile wierszy wyniku pokazuje podgląd - reszta jest policzona w podsumowaniu. */
export const PREVIEW_ROWS = 8;
/** Ile serii (kolumn) wyniku pokazuje podgląd wykresu. */
export const PREVIEW_SERIES = 6;

/** Położenia początkowe przełączników - z rozpoznania układu tabeli. */
export function initialTableLayout(rows: readonly (readonly string[])[]): TableLayout {
  const a = analyseTable(rows);
  return { header: a.headerRow, transpose: a.seriesInRows, locale: "auto", valueColumn: 1 };
}
