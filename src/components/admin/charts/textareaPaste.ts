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
// średnika. W polu WYKRESU wklejenie zastępuje treść w całości - tabela to
// cały zestaw danych, a doklejona w środek tekstu rozbiłaby nagłówek. Pole
// MAPY dostaje także same wartości (`values`) i dokłada kraje do swoich
// wierszy (`MapDataField`) - wiersz mapy to jeden kraj, więc jeden wiersz
// skopiowany z arkusza nie może skasować reszty. Zwykły tekst (także
// skopiowany gotowy format średnikowy) wkleja się po staremu.
import { readClipboardTable, type ClipboardPayload } from "@/lib/charts/clipboardTable";
import {
  mapValuesToText,
  tableToChartData,
  type CountryIndex,
  type ImportProblem,
} from "@/lib/charts/importTable";
import type { MapDatum } from "@/lib/charts/types";
import { widgetGridCsv } from "./chartGridState";
import { initialMapTableLayout, mapTableValues } from "./mapTableLayout";

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

/** Wynik wklejenia do pola MAPY: tekst plus same wartości (pole dokłada je do swoich wierszy). */
export interface MapTextareaPasteResult extends TextareaPasteResult {
  values: MapDatum[];
}

/**
 * Schowek -> tekst pola danych MAPY („ISO2; wartość" na wiersz) albo `null`.
 * Skorowidz krajów regionu rozwiązuje nazwy („Polska", „POL") - bez niego
 * przechodzą wyłącznie kody ISO-2.
 *
 * UKŁAD TABELI rozpoznaje `initialMapTableLayout` - to samo, co ustawia
 * podgląd siatki i importu: kolumna krajów nie musi być pierwsza („Lp. |
 * Kraj | Wartość"), tabela bywa obrócona („Rok | PL | DE"), a wiersz
 * z krajem nigdy nie jest nagłówkiem. Wartości liczy `mapTableValues`, więc
 * textarea i siatka czytają tę samą tabelę tak samo. `values` puste =
 * nic nie rozpoznano; wtedy o polu decyduje wołający (nie musi go czyścić).
 */
export function clipboardToMapText(
  payload: ClipboardPayload,
  index?: CountryIndex,
): MapTextareaPasteResult | null {
  const table = tabela(payload);
  if (table === null) return null;
  const dane = mapTableValues(table.rows, index, initialMapTableLayout(table.rows, index));
  return {
    text: mapValuesToText(dane.values),
    values: dane.values,
    problems: [...(table.truncated ? [{ code: "pasteTruncated" as const }] : []), ...dane.problems],
  };
}
