// WKLEJENIE ARKUSZA DO POLA TEKSTOWEGO DANYCH WIDGETU (wykres, mapa).
//
// Pole danych widgetu czyta format średnikowy (`csv.ts`) - i czyta go
// czytelnik strony, więc jego gramatyka NIE MOŻE się zmienić. Zakres
// wklejony z Excela przychodzi jednak tabulatorami, a parser średnikowy
// widział w nim jedną kolumnę: „12<TAB>8" w komórce stawało się liczbą 128,
// a nagłówek z tabulatorami nie dawał żadnej serii, czyli pusty wykres.
//
// Tu schowek z TABELĄ (HTML z arkusza albo tekst z tabulatorami) jest
// przekładany na format pola: średniki, kropka dziesiętna, etykiety bez
// średnika. Wklejenie zastępuje treść pola w całości - tabela to cały zestaw
// danych, a doklejona w środek tekstu rozbiłaby nagłówek. Zwykły tekst (także
// skopiowany gotowy format średnikowy) wkleja się po staremu.
import { readClipboardTable, type ClipboardPayload } from "@/lib/charts/clipboardTable";
import {
  mapValuesToText,
  tableToChartData,
  tableToMapValues,
  type CountryIndex,
  type ImportProblem,
} from "@/lib/charts/importTable";
import { widgetGridCsv } from "./chartGridState";

export interface TextareaPasteResult {
  text: string;
  problems: ImportProblem[];
}

/** Tabela ze schowka - wyłącznie prawdziwy arkusz (HTML albo tabulatory), nie zwykły tekst. */
function tabela(payload: ClipboardPayload) {
  const table = readClipboardTable(payload);
  if (table === null || table.source === "text") return null;
  return table;
}

/** Schowek -> tekst pola danych WYKRESU albo `null` (zwykłe wklejenie). */
export function clipboardToChartText(payload: ClipboardPayload): TextareaPasteResult | null {
  const table = tabela(payload);
  if (table === null) return null;
  const dane = tableToChartData(table.rows, {});
  if (dane.series.length === 0) return null;
  return {
    text: widgetGridCsv({ categories: dane.categories, series: dane.series }),
    problems: [...(table.truncated ? [{ code: "pasteTruncated" as const }] : []), ...dane.problems],
  };
}

/**
 * Schowek -> tekst pola danych MAPY („ISO2; wartość" na wiersz) albo `null`.
 * Skorowidz krajów regionu rozwiązuje nazwy („Polska", „POL") - bez niego
 * przechodzą wyłącznie kody ISO-2.
 */
export function clipboardToMapText(
  payload: ClipboardPayload,
  index?: CountryIndex,
): TextareaPasteResult | null {
  const table = tabela(payload);
  if (table === null) return null;
  const dane = tableToMapValues(table.rows, index, {});
  return {
    text: mapValuesToText(dane.values),
    problems: [...(table.truncated ? [{ code: "pasteTruncated" as const }] : []), ...dane.problems],
  };
}
