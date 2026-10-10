// UKŁAD TABELI MAPY - rozpoznanie kolumny krajów, obrót i odczyt wartości.
//
// `tableToMapValues` czyta kraj z PIERWSZEJ kolumny, a wartość z kolumny
// wskazanej. Tabele z arkuszy rzadko mają taki kształt:
//   * „Lp. | Kraj | Wartość" - kraj stoi w drugiej kolumnie, a pierwsza to
//     liczby porządkowe, które czytane jako kraj dawały same „nierozpoznane";
//   * „Rok | PL | DE | FR" - kraje leżą w NAGŁÓWKU, a wartości w wierszu pod
//     nim (tabela obrócona względem tej, której mapa potrzebuje).
// Tu stoi jedno rozpoznanie i jedna projekcja, z których korzysta podgląd
// wklejki i importu (`PastePreviewDialog` w trybie mapy) ORAZ każdy, kto po
// „Zastosuj" zapisuje dane (blok CMS, pole i arkusz mapy w builderze) - więc
// podgląd nie może pokazać czegoś innego niż zapis.
//
// Moduł czysty (bez Reacta): testy czytają go wprost.
import {
  analyseTable,
  readImportedNumber,
  rectangularTable,
  resolveCountryLabel,
  tableToMapValues,
  transposeTable,
  type CountryIndex,
  type ImportedMapData,
} from "@/lib/charts/importTable";
import { initialTableLayout, type TableLayout } from "./tableLayout";

/**
 * Układ tabeli w trybie mapy: `TableLayout` plus kolumna krajów. Pole jest
 * OPCJONALNE i dokłada je wyłącznie rozpoznanie mapy, więc układ wykresu
 * (i każdy zapisany wcześniej) jest poprawnym układem mapy z krajem
 * w pierwszej kolumnie. Podgląd oddaje go przez `onApply` jako `TableLayout`
 * - obiekt niesie pole dalej, a `DataImportControl` przekazuje go bez zmian.
 */
export type MapTableLayout = TableLayout & {
  /** Kolumna krajów w tabeli PO obrocie (tak, jak widzi ją autor w podglądzie). */
  countryColumn?: number;
};

/**
 * Ile wierszy rozpoznanie ogląda. Wynik zależy od większości, a tabela ze
 * schowka bywa długa - po dwustu wierszach przewaga jednej kolumny jest
 * rozstrzygnięta, a koszt (rozwiązanie nazwy kraju na każdą komórkę) rośnie.
 */
const PROBA_WIERSZY = 200;

/** Tabela w orientacji wybranej w podglądzie - prostokąt, wiersze równej długości. */
export function orientedMapTable(
  rows: readonly (readonly string[])[],
  transpose: boolean,
): string[][] {
  return transpose ? transposeTable(rectangularTable(rows)) : rectangularTable(rows);
}

/** Kolumna krajów układu; brak pola = pierwsza kolumna (układ sprzed rozpoznania). */
export function countryColumnOf(layout: MapTableLayout): number {
  const c = layout.countryColumn ?? 0;
  return Number.isInteger(c) && c > 0 ? c : 0;
}

function liczba(cell: string): boolean {
  return (
    readImportedNumber(cell, "pl").status === "number" ||
    readImportedNumber(cell, "en").status === "number"
  );
}

/** Ile komórek kolumny wskazuje kraj (kod, nazwa, alias). */
function trafienia(table: readonly (readonly string[])[], col: number, index?: CountryIndex) {
  let n = 0;
  for (const row of table.slice(0, PROBA_WIERSZY)) {
    const cell = (row[col] ?? "").trim();
    if (cell !== "" && !liczba(cell) && resolveCountryLabel(cell, index) !== null) n += 1;
  }
  return n;
}

/**
 * Pierwsza kolumna z liczbami ZA kolumną krajów, a gdy takiej nie ma - przed
 * nią. Za, bo „Lp. | Kraj | Wartość" ma liczby także w pierwszej kolumnie,
 * a to nie one są wartością mapy.
 */
export function firstValueColumn(
  table: readonly (readonly string[])[],
  countryColumn: number,
  header: boolean,
): number {
  const width = table[0]?.length ?? 0;
  const body = header ? table.slice(1) : table;
  const maLiczby = (c: number) => body.some((r) => liczba(r[c] ?? ""));
  for (let c = countryColumn + 1; c < width; c += 1) if (maLiczby(c)) return c;
  for (let c = 0; c < countryColumn; c += 1) if (maLiczby(c)) return c;
  return countryColumn === 0 ? 1 : 0;
}

/**
 * Tabela z kolumną krajów NA POCZĄTKU - kształt, który czyta
 * `tableToMapValues` - i numer kolumny wartości w tej tabeli. Kolumny
 * w układzie liczą się w tabeli PO obrocie (tak, jak widzi je autor
 * w podglądzie).
 */
export function projectMapTable(
  rows: readonly (readonly string[])[],
  layout: MapTableLayout,
): { rows: string[][]; valueColumn: number } {
  const table = orientedMapTable(rows, layout.transpose);
  const cc = countryColumnOf(layout);
  const v = Math.max(0, Math.floor(layout.valueColumn));
  if (cc === 0) return { rows: table, valueColumn: Math.max(1, v) };
  return {
    rows: table.map((r) => [r[cc] ?? "", ...r.filter((_, i) => i !== cc)]),
    valueColumn: v < cc ? v + 1 : Math.max(1, v),
  };
}

/** Kolumna z największą liczbą krajów w tabeli jednej orientacji (remis - bliżej lewej). */
function najlepszaKolumna(
  table: readonly (readonly string[])[],
  index?: CountryIndex,
): { col: number; hits: number } {
  const width = table[0]?.length ?? 0;
  let best = { col: 0, hits: 0 };
  for (let col = 0; col < width; col += 1) {
    const hits = trafienia(table, col, index);
    if (hits > best.hits) best = { col, hits };
  }
  return best;
}

/** Skorowidz pusty znaczy „nie mam skorowidza" - ta sama reguła co w `tableToMapValues`. */
function skorowidz(index?: CountryIndex): CountryIndex | undefined {
  return index !== undefined && index.ids.size > 0 ? index : undefined;
}

/**
 * Nagłówek, kolumna krajów i kolumna wartości dla tabeli JEDNEJ orientacji.
 * Nagłówek rozpoznaje `analyseTable` na tabeli JUŻ przestawionej (kolumna
 * krajów na początku) - „Lp. | Kraj | Wartość" ma wtedy tekst nad liczbami
 * i jest nagłówkiem, a „PL | 12" nie jest.
 */
function ukladOrientacji(
  rows: readonly (readonly string[])[],
  transpose: boolean,
  col: number,
): Pick<MapTableLayout, "header" | "transpose" | "countryColumn" | "valueColumn"> {
  const table = orientedMapTable(rows, transpose);
  const projected = table.map((r) => [r[col] ?? "", ...r.filter((_, i) => i !== col)]);
  const header = analyseTable(projected).headerRow;
  return {
    header,
    transpose,
    countryColumn: col,
    valueColumn: firstValueColumn(table, col, header),
  };
}

/**
 * Położenia początkowe przełączników podglądu w trybie mapy. Rozpoznanie
 * próbuje obu orientacji i każdej kolumny: wygrywa kolumna, w której
 * najwięcej komórek wskazuje kraj (remis - bez obrotu i kolumna bliżej
 * lewej); kolumną wartości jest pierwsza kolumna z liczbami za kolumną
 * krajów. Tabela bez żadnego kraju zostaje w układzie zastanym: kraj
 * w pierwszej kolumnie, wartość w drugiej.
 */
export function initialMapTableLayout(
  rows: readonly (readonly string[])[],
  index?: CountryIndex,
): MapTableLayout {
  const idx = skorowidz(index);
  const prosto = najlepszaKolumna(orientedMapTable(rows, false), idx);
  const obrot = najlepszaKolumna(orientedMapTable(rows, true), idx);
  if (prosto.hits === 0 && obrot.hits === 0) {
    return { ...initialTableLayout(rows), transpose: false, valueColumn: 1, countryColumn: 0 };
  }
  const transpose = obrot.hits > prosto.hits;
  return {
    locale: "auto",
    ...ukladOrientacji(rows, transpose, transpose ? obrot.col : prosto.col),
  };
}

/**
 * Układ po przełączeniu obrotu w podglądzie. Kolumny tabeli obróconej to
 * zupełnie inne kolumny, więc kolumna krajów, nagłówek i kolumna wartości
 * są rozpoznawane od nowa; format liczb zostaje wyborem autora.
 */
export function mapLayoutForTranspose(
  rows: readonly (readonly string[])[],
  layout: MapTableLayout,
  transpose: boolean,
  index?: CountryIndex,
): MapTableLayout {
  const best = najlepszaKolumna(orientedMapTable(rows, transpose), skorowidz(index));
  return { ...layout, ...ukladOrientacji(rows, transpose, best.col) };
}

/**
 * Wartości mapy z tabeli w układzie wybranym w podglądzie - ta sama funkcja
 * liczy podgląd i zapis. Bez układu (wołający bez podglądu) - zachowanie
 * `tableToMapValues` z rozpoznaniem konwencji liczb.
 */
export function mapTableValues(
  rows: readonly (readonly string[])[],
  index: CountryIndex | undefined,
  layout?: MapTableLayout,
): ImportedMapData {
  if (layout === undefined) return tableToMapValues(rows, index, {});
  const p = projectMapTable(rows, layout);
  return tableToMapValues(p.rows, index, {
    valueColumn: p.valueColumn,
    header: layout.header,
    locale: layout.locale,
  });
}
