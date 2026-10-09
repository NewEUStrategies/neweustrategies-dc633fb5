// STAN ARKUSZA DANYCH WYKRESU - dane, kolory serii i wskaźniki akcentu RAZEM.
//
// PO CO TEN MODUŁ. `gridModel.ts` zna kategorie i serie, ale nie wie nic
// o wskaźnikach akcentu, a te są INDEKSAMI: przesunięcie serii, której nie
// pilnuje nikt poza `moveSeries`, przenosiło akcent na sąsiadkę, a usunięcie
// kategorii nad wyróżnionym wycinkiem wyróżniało następny. Tu każda operacja
// arkusza bierze CAŁY stan (`ChartGridValue`) i oddaje cały stan - dane,
// kolory i oba wskaźniki przeliczone tym samym ruchem - więc edytor zapisuje
// go JEDNYM `onChange` (blok CMS) albo JEDNĄ łatką (widget buildera), czyli
// jednym krokiem cofania.
//
// DWA ADAPTERY ZAPISU, BO DWA KSZTAŁTY TREŚCI. Blok CMS trzyma serie jako
// Json (kolor w polu `colorSlot` serii), a widget buildera - jako tekst
// średnikowy (`csv.ts`) i POZYCYJNY napis slotów `seriesColors` ("3;4;8").
// Format średnikowy czyta czytelnik strony, więc tu go tylko PISZEMY
// (`csv.ts` zostaje nietknięty): liczby kropką dziesiętną, etykiety
// przepuszczone przez `safeTextCell`.
//
// Moduł jest czysty (bez Reacta i DOM) i ma własne testy.
import type { Json } from "@/lib/blocks/types";
import { MAX_COLOR_SLOT, MAX_SERIES, type ChartSeries } from "@/lib/charts/types";
import { slotForSeries } from "@/lib/charts/palette";
import { parseChartData } from "@/lib/charts/csv";
import {
  GRID_LIMITS,
  applyPasteAt,
  canTranspose,
  indexAfterInsert,
  indexAfterMove,
  indexAfterRemove,
  insertCategory,
  insertSeries,
  moveCategory,
  moveSeries,
  removeCategory,
  removeSeries,
  sortByColumn,
  transpose,
  type GridAnchor,
  type GridModel,
  type MoveDirection,
  type SortDirection,
} from "@/lib/charts/gridModel";
import {
  mergeSeriesColors,
  safeTextCell,
  type ImportProblem,
  type NumberLocaleChoice,
} from "@/lib/charts/importTable";

/** Cały stan arkusza: dane z kolorami serii i dwa wskaźniki akcentu. */
export interface ChartGridValue {
  model: GridModel;
  /** Indeks serii wyróżnionej (liczony od zera); 0 = pierwsza, czyli domyślnie. */
  accentSeries: number;
  /** Indeks wyróżnionej kategorii (wycinka); `null` = największy wycinek. */
  accentCategory: number | null;
}

export type EditorDocLang = "pl" | "en";

/**
 * Najmniej kategorii i serii, jakie arkusz zostawia. Pusta siatka nie ma
 * komórki, w którą dałoby się kliknąć, a wykres bez serii jest pusty - więc
 * ostatniej kategorii ani ostatniej serii usunąć się nie da.
 */
export const GRID_MIN = { categories: 1, series: 1 } as const;

const LITERY = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * Nazwa domyślna serii dokładanej przez arkusz - w JĘZYKU DOKUMENTU, nie
 * panelu: wpis polski edytowany w angielskim panelu dostaje „Seria C".
 */
export function defaultSeriesName(index: number, lang: EditorDocLang): string {
  const litera = LITERY[index] ?? String(index + 1);
  return lang === "en" ? `Series ${litera}` : `Seria ${litera}`;
}

/** Indeks serii albo kategorii z treści: liczba całkowita w zakresie, inaczej `null`. */
export function accentIndex(raw: unknown, length: number): number | null {
  const n = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n >= length) return null;
  return n;
}

/** Wskaźniki po zmianie wymiarów: akcent serii wraca do 0, kategoria do `null`. */
function wskazniki(model: GridModel, accentSeries: unknown, accentCategory: unknown) {
  return {
    accentSeries: accentIndex(accentSeries, model.series.length) ?? 0,
    accentCategory: accentIndex(accentCategory, model.categories.length),
  };
}

function z(v: ChartGridValue, model: GridModel, accents?: Partial<ChartGridValue>): ChartGridValue {
  if (model === v.model && accents === undefined) return v;
  return {
    model,
    ...wskazniki(
      model,
      accents?.accentSeries ?? v.accentSeries,
      accents && "accentCategory" in accents ? (accents.accentCategory ?? null) : v.accentCategory,
    ),
  };
}

// ---------------------------------------------------------------------------
// Komórki
// ---------------------------------------------------------------------------

export function gridSetValue(
  v: ChartGridValue,
  row: number,
  col: number,
  value: number | null,
): ChartGridValue {
  const s = v.model.series[col];
  if (s === undefined || row < 0 || row >= v.model.categories.length) return v;
  if ((s.values[row] ?? null) === value) return v;
  const series = v.model.series.map((x, i) =>
    i === col
      ? {
          ...x,
          values: v.model.categories.map((_, r) => (r === row ? value : (x.values[r] ?? null))),
        }
      : x,
  );
  return { ...v, model: { categories: v.model.categories, series } };
}

export function gridSetCategory(v: ChartGridValue, row: number, label: string): ChartGridValue {
  if (row < 0 || row >= v.model.categories.length || v.model.categories[row] === label) return v;
  const categories = v.model.categories.map((c, i) => (i === row ? label : c));
  return { ...v, model: { categories, series: v.model.series } };
}

export function gridSetSeriesName(v: ChartGridValue, col: number, name: string): ChartGridValue {
  const s = v.model.series[col];
  if (s === undefined || s.name === name) return v;
  const series = v.model.series.map((x, i) => (i === col ? { ...x, name } : x));
  return { ...v, model: { categories: v.model.categories, series } };
}

export function gridSetSeriesColor(v: ChartGridValue, col: number, slot: number): ChartGridValue {
  const s = v.model.series[col];
  if (s === undefined || s.colorSlot === slot) return v;
  const series = v.model.series.map((x, i) => (i === col ? { ...x, colorSlot: slot } : x));
  return { ...v, model: { categories: v.model.categories, series } };
}

export function gridSetAccentSeries(v: ChartGridValue, col: number): ChartGridValue {
  const next = accentIndex(col, v.model.series.length) ?? 0;
  return next === v.accentSeries ? v : { ...v, accentSeries: next };
}

export function gridSetAccentCategory(v: ChartGridValue, row: number | null): ChartGridValue {
  const next = accentIndex(row, v.model.categories.length);
  return next === v.accentCategory ? v : { ...v, accentCategory: next };
}

// ---------------------------------------------------------------------------
// Struktura - każda operacja przelicza oba wskaźniki tym samym ruchem
// ---------------------------------------------------------------------------

export function gridInsertCategory(v: ChartGridValue, at: number): ChartGridValue {
  const model = insertCategory(v.model, at);
  if (model === v.model) return v;
  const i = Math.min(Math.max(0, at), v.model.categories.length);
  return z(v, model, {
    accentCategory: v.accentCategory === null ? null : indexAfterInsert(v.accentCategory, i),
  });
}

export function gridRemoveCategory(v: ChartGridValue, row: number): ChartGridValue {
  if (v.model.categories.length <= GRID_MIN.categories) return v;
  const model = removeCategory(v.model, row);
  if (model === v.model) return v;
  return z(v, model, {
    accentCategory: v.accentCategory === null ? null : indexAfterRemove(v.accentCategory, row),
  });
}

export function gridMoveCategory(
  v: ChartGridValue,
  row: number,
  dir: MoveDirection,
): ChartGridValue {
  const model = moveCategory(v.model, row, dir);
  if (model === v.model) return v;
  return z(v, model, {
    accentCategory:
      v.accentCategory === null ? null : indexAfterMove(v.accentCategory, row, row + dir),
  });
}

export function gridInsertSeries(v: ChartGridValue, at: number, name: string): ChartGridValue {
  const model = insertSeries(v.model, at, { name });
  if (model === v.model) return v;
  const i = Math.min(Math.max(0, at), v.model.series.length);
  return z(v, model, { accentSeries: indexAfterInsert(v.accentSeries, i) });
}

/**
 * Usunięcie serii. Usunięta seria wyróżniona oddaje akcent PIERWSZEJ serii
 * (domyślnej), a nie tej, która wskoczyła na jej miejsce - sąsiadka nie
 * została wybrana przez nikogo.
 */
export function gridRemoveSeries(v: ChartGridValue, col: number): ChartGridValue {
  if (v.model.series.length <= GRID_MIN.series) return v;
  const model = removeSeries(v.model, col);
  if (model === v.model) return v;
  return z(v, model, { accentSeries: indexAfterRemove(v.accentSeries, col) ?? 0 });
}

export function gridMoveSeries(v: ChartGridValue, col: number, dir: MoveDirection): ChartGridValue {
  const moved = moveSeries(v.model, col, dir, v.accentSeries);
  if (moved.model === v.model) return v;
  return z(v, moved.model, { accentSeries: moved.accentSeries });
}

export function gridCanTranspose(v: ChartGridValue): boolean {
  return canTranspose(v.model);
}

/**
 * Obrót: kategorie stają się seriami i odwrotnie, więc wskaźniki zamieniają
 * się rolami - wyróżniona kategoria (wycinek) zostaje serią wyróżnioną,
 * a JAWNIE wybrana seria wyróżniona - wyróżnioną kategorią. Domyślny akcent
 * (pierwsza seria) nie jest wyborem, więc nie wyróżnia niczego po obrocie.
 */
export function gridTranspose(v: ChartGridValue): ChartGridValue {
  const model = transpose(v.model);
  if (model === v.model) return v;
  return z(v, model, {
    accentSeries: v.accentCategory ?? 0,
    accentCategory: v.accentSeries > 0 ? v.accentSeries : null,
  });
}

export function gridSort(v: ChartGridValue, col: number, dir: SortDirection): ChartGridValue {
  const { model, order } = sortByColumn(v.model, col, dir);
  if (model === v.model) return v;
  return z(v, model, {
    accentCategory: v.accentCategory === null ? null : order.indexOf(v.accentCategory),
  });
}

/**
 * Wklejenie zakresu od komórki kotwicy (`applyPasteAt`). Wklejenie niczego
 * nie usuwa ani nie przestawia - serie i kategorie najwyżej DOCHODZĄ na
 * końcu - więc wskaźniki zostają, jakie były.
 */
export function gridPaste(
  v: ChartGridValue,
  rows: readonly (readonly string[])[],
  anchor: GridAnchor,
  lang: EditorDocLang,
  locale: NumberLocaleChoice = "auto",
): { value: ChartGridValue; problems: ImportProblem[] } {
  const result = applyPasteAt(v.model, rows, anchor, GRID_LIMITS, {
    locale,
    seriesName: (i) => defaultSeriesName(i, lang),
  });
  if (result.range === null) return { value: v, problems: result.problems };
  return { value: z(v, result.model), problems: result.problems };
}

/**
 * Zastąpienie całej tabeli (plik, wklejka całej tabeli). Kolory idą za
 * nazwą serii (`mergeSeriesColors`), a akcent - za NAZWĄ wyróżnionej serii
 * i ETYKIETĄ wyróżnionej kategorii: poprawiony plik z tą samą serią w innej
 * kolumnie nie gubi wyboru autora. Seria, której w nowej tabeli nie ma,
 * oddaje akcent pierwszej.
 */
export function gridReplace(
  v: ChartGridValue,
  next: { categories: readonly string[]; series: readonly ChartSeries[] },
): ChartGridValue {
  const klucz = (s: string) => s.trim().toLowerCase();
  const series = mergeSeriesColors(next.series, v.model.series);
  const nazwaAkcentu = v.model.series[v.accentSeries]?.name;
  const etykietaAkcentu =
    v.accentCategory === null ? undefined : v.model.categories[v.accentCategory];
  const accentSeries =
    nazwaAkcentu === undefined || klucz(nazwaAkcentu) === ""
      ? 0
      : Math.max(
          0,
          series.findIndex((s) => klucz(s.name) === klucz(nazwaAkcentu)),
        );
  const kat =
    etykietaAkcentu === undefined
      ? -1
      : next.categories.findIndex((c) => klucz(c) === klucz(etykietaAkcentu));
  const model: GridModel = {
    categories: [...next.categories],
    series: series.map((s) => ({ ...s, values: [...s.values] })),
  };
  return z(v, model, { accentSeries, accentCategory: kat === -1 ? null : kat });
}

// ---------------------------------------------------------------------------
// Blok CMS: serie jako Json z polem `colorSlot`
// ---------------------------------------------------------------------------

function wartoscBloku(v: Json | undefined): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function slotZapisany(raw: Json | undefined, position: number): number {
  return typeof raw === "number" && raw >= 1 && raw <= MAX_COLOR_SLOT
    ? Math.round(raw)
    : slotForSeries(position);
}

/**
 * Stan arkusza z treści bloku. Wartość spoza liczb (stara wersja edytora,
 * ręczna edycja JSON-a) jest czytana tą samą koercją co parser wykresu,
 * a wskaźnik akcentu spoza zakresu - tak, jak go narysuje parser (seria 0,
 * największy wycinek).
 */
export function readBlockGrid(data: Readonly<Record<string, Json>>): ChartGridValue {
  const categories = (Array.isArray(data.categories) ? data.categories : []).map((c) =>
    typeof c === "string" ? c : typeof c === "number" ? String(c) : "",
  );
  const rawSeries = Array.isArray(data.series) ? data.series : [];
  const series: ChartSeries[] = rawSeries.slice(0, MAX_SERIES).map((item, si) => {
    const o =
      item !== null && typeof item === "object" && !Array.isArray(item)
        ? (item as Record<string, Json>)
        : {};
    const values = Array.isArray(o.values) ? o.values : [];
    return {
      name: typeof o.name === "string" ? o.name : typeof o.name === "number" ? String(o.name) : "",
      values: categories.map((_, i) => wartoscBloku(values[i])),
      colorSlot: slotZapisany(o.colorSlot, si),
    };
  });
  const model: GridModel = { categories, series };
  return { model, ...wskazniki(model, data.accentSeries, data.accentCategory) };
}

/**
 * Zmiany treści bloku dla `write` (`undefined` USUWA klucz): dane, kolory
 * w seriach i wskaźniki. Wskaźnik domyślny (pierwsza seria, największy
 * wycinek) znika z treści, zamiast udawać jawny wybór.
 */
export function blockGridChanges(v: ChartGridValue): Record<string, Json | undefined> {
  return {
    categories: [...v.model.categories],
    series: v.model.series.map((s) => ({
      name: s.name,
      values: s.values.map((x) => (x === null || x === undefined ? null : x)),
      colorSlot: s.colorSlot,
    })),
    accentSeries: v.accentSeries > 0 ? v.accentSeries : undefined,
    accentCategory: v.accentCategory === null ? undefined : v.accentCategory,
  };
}

// ---------------------------------------------------------------------------
// Widget buildera: tekst średnikowy + pozycyjny napis slotów
// ---------------------------------------------------------------------------

/** Kategoria startowa pustego arkusza widgetu - ta sama, co przed PR2. */
export const WIDGET_START_CATEGORY = "2024";

/** Pozycyjne sloty "3;4;8" -> slot serii albo `null` (domyślny po pozycji). */
export function parseSeriesColors(raw: unknown): (number | null)[] {
  if (typeof raw !== "string" || raw.trim() === "") return [];
  return raw.split(";").map((cell) => {
    const n = Number(cell.trim());
    return cell.trim() !== "" && Number.isInteger(n) && n >= 1 && n <= MAX_COLOR_SLOT ? n : null;
  });
}

/**
 * Stan arkusza z treści widgetu. Pusta treść dostaje JEDNĄ serię i JEDEN
 * wiersz - siatka bez komórki nie ma gdzie przyjąć pierwszej liczby.
 */
export function readWidgetGrid(
  csv: string,
  content: Readonly<Record<string, unknown>>,
  lang: EditorDocLang,
): ChartGridValue {
  const parsed = parseChartData(csv);
  const slots = parseSeriesColors(content.seriesColors);
  const series: ChartSeries[] =
    parsed.series.length > 0
      ? parsed.series.map((s, i) => ({ ...s, colorSlot: slots[i] ?? s.colorSlot }))
      : [{ name: defaultSeriesName(0, lang), values: [], colorSlot: slots[0] ?? slotForSeries(0) }];
  const categories = parsed.categories.length > 0 ? parsed.categories : [WIDGET_START_CATEGORY];
  const model: GridModel = {
    categories,
    series: series.map((s) => ({
      ...s,
      values: categories.map((_, i) => s.values[i] ?? null),
    })),
  };
  return { model, ...wskazniki(model, content.accentSeries, content.accentCategory) };
}

/** Liczba do tekstu średnikowego: kropka dziesiętna, bez grupowania. */
function liczbaCsv(v: number | null | undefined): string {
  return v === null || v === undefined || !Number.isFinite(v) ? "" : String(v);
}

/** Dane arkusza -> tekst textarei widgetu („; A; B" + „Kategoria; 1; 2"). */
export function widgetGridCsv(model: GridModel): string {
  const header = ["", ...model.series.map((s) => safeTextCell(s.name))].join("; ");
  const rows = model.categories.map((cat, ri) =>
    [safeTextCell(cat), ...model.series.map((s) => liczbaCsv(s.values[ri]))].join("; "),
  );
  return [header, ...rows].join("\n");
}

/**
 * Sloty serii -> napis POZYCYJNY. Slot równy domyślnemu dla pozycji zostaje
 * pusty, a puste miejsca z końca znikają - wykres bez zmienionych kolorów
 * zapisuje pusty napis, czyli dokładnie to, co zapisał przed PR2.
 */
export function widgetSeriesColors(series: readonly { colorSlot: number }[]): string {
  const cells = series.map((s, i) => (s.colorSlot === slotForSeries(i) ? "" : String(s.colorSlot)));
  while (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
  return cells.join(";");
}

/** Łatka treści widgetu - JEDEN zapis dla danych, kolorów i obu wskaźników. */
export function widgetGridPatch(
  v: ChartGridValue,
  dataKey: string,
): Record<string, string | number | undefined> {
  const colors = widgetSeriesColors(v.model.series);
  return {
    [dataKey]: widgetGridCsv(v.model),
    seriesColors: colors === "" ? undefined : colors,
    accentSeries: v.accentSeries > 0 ? v.accentSeries : undefined,
    accentCategory: v.accentCategory === null ? undefined : v.accentCategory,
  };
}

/**
 * Podpis stanu zapisanego w treści widgetu - do rozpoznania echa własnego
 * zapisu. Liczy się z WARTOŚCI SUROWYCH treści, a łatka `widgetGridPatch`
 * zapisuje dokładnie te wartości, więc echo daje identyczny podpis.
 */
export function widgetContentSignature(
  csv: string,
  content: Readonly<Record<string, unknown>>,
): string {
  const sc = typeof content.seriesColors === "string" ? content.seriesColors : "";
  const num = (raw: unknown) => (typeof raw === "number" && Number.isFinite(raw) ? raw : null);
  return JSON.stringify([csv, sc, num(content.accentSeries), num(content.accentCategory)]);
}

/** Podpis stanu, który łatka `widgetGridPatch` zapisze. */
export function widgetGridSignature(v: ChartGridValue): string {
  const patch = widgetGridPatch(v, "data");
  return JSON.stringify([
    patch.data,
    patch.seriesColors ?? "",
    patch.accentSeries ?? null,
    patch.accentCategory ?? null,
  ]);
}
