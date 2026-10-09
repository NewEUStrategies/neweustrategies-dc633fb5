// Siatka danych wykresu i mapy: operacje edytora jako CZYSTE funkcje.
//
// JEDEN MODEL DLA OBU POWIERZCHNI. Edytor bloku (Gutenberg) i arkusz danych
// widgetu (Elementor) edytują to samo - kategorie i serie - a do 2026-10
// każdy robił to po swojemu: inna obsługa wstawiania, inny los koloru
// przesuniętej serii, wklejenie zakresu w jedno pole. Tu jest jedna
// implementacja, testowana bez montowania komponentu.
//
// NIEZMIENNOŚĆ. Każda operacja zwraca NOWY model, a wejście zostaje nietknięte
// - historia cofania w edytorze trzyma poprzednie wersje i nie może ich
// zobaczyć zmienionych. Operacja, której nie da się wykonać (indeks poza
// zakresem, limit osiągnięty), oddaje TEN SAM obiekt - wołający porównaniem
// referencji wie, że nic się nie stało.
//
// WSKAŹNIKI IDĄ ZA DANYMI. Seria akcentu (`accentSeries`) i wyróżniona
// kategoria (`accentCategory`) to indeksy; po przesunięciu albo usunięciu
// muszą dalej wskazywać TO SAMO, a nie to samo miejsce. `moveSeries` zwraca
// nowy indeks akcentu, a `indexAfter*` przeliczają dowolny inny wskaźnik.
//
// WKLEJENIE (`applyPasteAt`) działa jak w arkuszu: blok trafia od komórki
// kotwicy w prawo i w dół, nadpisuje to, co leży pod nim, i dokłada wiersze
// i serie do limitów. Wiersz -1 to wiersz nazw serii, kolumna -1 to kolumna
// kategorii. To, co nie zmieściło się w limitach, i komórki, które liczbą nie
// są, wracają w `problems` - te same kody co import pliku.
import { MAX_SERIES, type ChartSeries, type MapDatum } from "./types";
import { MAX_CATEGORIES } from "./parse";
import { SLOT_SEQUENCE, slotForSeries } from "./palette";
import {
  columnLetter,
  detectNumberLocale,
  isPeriodLabel,
  numberStyle,
  readImportedNumber,
  resolveCountryLabel,
  type CountryIndex,
  type ImportProblem,
  type NumberLocale,
  type NumberLocaleChoice,
} from "./importTable";

/** Dane siatki wykresu: etykiety kategorii i serie z wartościami. */
export interface GridModel {
  categories: string[];
  series: ChartSeries[];
}

export interface GridLimits {
  maxCategories: number;
  maxSeries: number;
}

/** Limity siatki = limity konfiguracji wykresu (`parse.ts`, `types.ts`). */
export const GRID_LIMITS: GridLimits = { maxCategories: MAX_CATEGORIES, maxSeries: MAX_SERIES };

/** Komórka kotwicy wklejenia. Wiersz -1 = nazwy serii, kolumna -1 = kategorie. */
export interface GridAnchor {
  row: number;
  col: number;
}

/** Zakres, który wklejenie faktycznie zapisało (po obcięciu do limitów). */
export interface GridRange {
  fromRow: number;
  toRow: number;
  fromCol: number;
  toCol: number;
}

export type MoveDirection = -1 | 1;
export type SortDirection = "asc" | "desc";

function wstaw<T>(items: readonly T[], at: number, item: T): T[] {
  return [...items.slice(0, at), item, ...items.slice(at)];
}

function usun<T>(items: readonly T[], at: number): T[] {
  return [...items.slice(0, at), ...items.slice(at + 1)];
}

function zamien<T>(items: readonly T[], a: number, b: number): T[] {
  const out = [...items];
  [out[a], out[b]] = [out[b], out[a]];
  return out;
}

function ogranicz(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/** Pierwszy slot sekwencji, którego nie używa żadna seria; gdy wszystkie zajęte - slot pozycji. */
function wolnySlot(series: readonly ChartSeries[], position: number): number {
  const uzyte = new Set(series.map((s) => s.colorSlot));
  return SLOT_SEQUENCE.find((slot) => !uzyte.has(slot)) ?? slotForSeries(position);
}

// ---------------------------------------------------------------------------
// Wskaźniki (akcent serii, wyróżniona kategoria)
// ---------------------------------------------------------------------------

/** Indeks po wstawieniu elementu na pozycję `at`. */
export function indexAfterInsert(index: number, at: number): number {
  return index >= at ? index + 1 : index;
}

/** Indeks po usunięciu elementu `removed`; `null`, gdy usunięto właśnie wskazany. */
export function indexAfterRemove(index: number, removed: number): number | null {
  if (index === removed) return null;
  return index > removed ? index - 1 : index;
}

/** Indeks po przeniesieniu elementu z `from` na `to` (reszta się przesuwa). */
export function indexAfterMove(index: number, from: number, to: number): number {
  if (index === from) return to;
  if (from < to && index > from && index <= to) return index - 1;
  if (from > to && index >= to && index < from) return index + 1;
  return index;
}

// ---------------------------------------------------------------------------
// Kategorie
// ---------------------------------------------------------------------------

/** Wstawia pustą kategorię (wartości: luki) na pozycję `at`, do limitu. */
export function insertCategory(
  model: GridModel,
  at: number,
  label = "",
  limits: GridLimits = GRID_LIMITS,
): GridModel {
  if (model.categories.length >= limits.maxCategories) return model;
  const i = ogranicz(at, 0, model.categories.length);
  return {
    categories: wstaw(model.categories, i, label),
    series: model.series.map((s) => ({ ...s, values: wstaw(s.values, i, null) })),
  };
}

export function removeCategory(model: GridModel, index: number): GridModel {
  if (index < 0 || index >= model.categories.length) return model;
  return {
    categories: usun(model.categories, index),
    series: model.series.map((s) => ({ ...s, values: usun(s.values, index) })),
  };
}

/** Przesuwa kategorię o jedno miejsce w górę (-1) albo w dół (1). */
export function moveCategory(model: GridModel, index: number, dir: MoveDirection): GridModel {
  const to = index + dir;
  if (index < 0 || index >= model.categories.length || to < 0 || to >= model.categories.length) {
    return model;
  }
  return {
    categories: zamien(model.categories, index, to),
    series: model.series.map((s) => ({ ...s, values: zamien(s.values, index, to) })),
  };
}

// ---------------------------------------------------------------------------
// Serie
// ---------------------------------------------------------------------------

/**
 * Wstawia serię z lukami na pozycję `at`, do limitu. Kolor: podany albo
 * pierwszy WOLNY slot sekwencji - nowa seria nie może przyjść w kolorze
 * serii, która już jest na wykresie.
 */
export function insertSeries(
  model: GridModel,
  at: number,
  init: { name?: string; colorSlot?: number } = {},
  limits: GridLimits = GRID_LIMITS,
): GridModel {
  if (model.series.length >= limits.maxSeries) return model;
  const i = ogranicz(at, 0, model.series.length);
  const nowa: ChartSeries = {
    name: init.name ?? "",
    values: model.categories.map(() => null),
    colorSlot: init.colorSlot ?? wolnySlot(model.series, i),
  };
  return { categories: model.categories, series: wstaw(model.series, i, nowa) };
}

export function removeSeries(model: GridModel, index: number): GridModel {
  if (index < 0 || index >= model.series.length) return model;
  return { categories: model.categories, series: usun(model.series, index) };
}

/**
 * Przesuwa serię o jedno miejsce. Seria zabiera ze sobą kolor (`colorSlot`
 * jest jej polem) i AKCENT: zwracany `accentSeries` wskazuje tę samą serię co
 * przed przesunięciem - akcent nie przeskakuje na sąsiadkę.
 */
export function moveSeries(
  model: GridModel,
  index: number,
  dir: MoveDirection,
  accentSeries = 0,
): { model: GridModel; accentSeries: number } {
  const to = index + dir;
  if (index < 0 || index >= model.series.length || to < 0 || to >= model.series.length) {
    return { model, accentSeries };
  }
  return {
    model: { categories: model.categories, series: zamien(model.series, index, to) },
    accentSeries: indexAfterMove(accentSeries, index, to),
  };
}

// ---------------------------------------------------------------------------
// Obrót i sortowanie
// ---------------------------------------------------------------------------

/** Czy obrót mieści się w limitach (kategorie stają się seriami i odwrotnie). */
export function canTranspose(model: GridModel, limits: GridLimits = GRID_LIMITS): boolean {
  return model.categories.length <= limits.maxSeries && model.series.length <= limits.maxCategories;
}

/**
 * Zamienia kategorie z seriami: nazwy serii stają się kategoriami, kategorie -
 * seriami. Obrót, który nie mieści się w limitach, NIE ucina danych - oddaje
 * model bez zmian (`canTranspose` pozwala wyłączyć przycisk zawczasu).
 * Nowe serie dostają kolory z sekwencji po pozycji: to inne byty niż serie
 * przed obrotem, więc ich kolory nie mają czego dziedziczyć.
 */
export function transpose(model: GridModel, limits: GridLimits = GRID_LIMITS): GridModel {
  if (!canTranspose(model, limits)) return model;
  return {
    categories: model.series.map((s) => s.name),
    series: model.categories.map((label, ci) => ({
      name: label,
      values: model.series.map((s) => s.values[ci] ?? null),
      colorSlot: slotForSeries(ci),
    })),
  };
}

const ETYKIETY = new Intl.Collator("pl", { numeric: true, sensitivity: "base" });

/**
 * Sortuje kategorie po kolumnie: -1 to etykiety kategorii (porządek naturalny,
 * „2" przed „10"), 0..n-1 to wartości serii. Luki i puste etykiety idą zawsze
 * NA KONIEC, w obu kierunkach - brak danych nie jest ani najmniejszy, ani
 * największy. Sortowanie jest stabilne. `order[nowa] = stara` pozwala
 * przeliczyć wskaźniki (wyróżniona kategoria).
 */
export function sortByColumn(
  model: GridModel,
  col: number,
  dir: SortDirection,
): { model: GridModel; order: number[] } {
  const n = model.categories.length;
  const identity = Array.from({ length: n }, (_, i) => i);
  if (col < -1 || col >= model.series.length) return { model, order: identity };
  const sign = dir === "asc" ? 1 : -1;
  const order = [...identity].sort((a, b) => {
    if (col === -1) {
      const la = model.categories[a].trim();
      const lb = model.categories[b].trim();
      if (la === "" || lb === "") return la === lb ? a - b : la === "" ? 1 : -1;
      return sign * ETYKIETY.compare(la, lb) || a - b;
    }
    const va = model.series[col].values[a] ?? null;
    const vb = model.series[col].values[b] ?? null;
    if (va === null || vb === null) return va === vb ? a - b : va === null ? 1 : -1;
    return sign * (va - vb) || a - b;
  });
  return {
    model: {
      categories: order.map((i) => model.categories[i]),
      series: model.series.map((s) => ({ ...s, values: order.map((i) => s.values[i] ?? null) })),
    },
    order,
  };
}

// ---------------------------------------------------------------------------
// Wklejenie
// ---------------------------------------------------------------------------

export interface GridPasteOptions {
  /** Konwencja liczb; domyślnie rozpoznana z wklejanych wartości. */
  locale?: NumberLocaleChoice;
  /** Nazwa serii dołożonej przez wklejenie (bez wiersza nazw). Domyślnie numer. */
  seriesName?: (index: number) => string;
  /** Etykieta kategorii dołożonej przez wklejenie (bez kolumny kategorii). Domyślnie numer. */
  categoryLabel?: (index: number) => string;
}

export interface GridPasteResult {
  model: GridModel;
  problems: ImportProblem[];
  /** `null`, gdy nic nie zostało zapisane (pusty blok). */
  range: GridRange | null;
}

/** Konwencja dla wklejenia: wybór albo rozpoznanie z komórek wartości. */
function konwencjaWklejenia(
  choice: NumberLocaleChoice,
  wartosci: () => Iterable<string>,
): { locale: NumberLocale | undefined; liczNiejasne: boolean } {
  if (choice !== "auto") return { locale: choice, liczNiejasne: false };
  const wykryta = detectNumberLocale(wartosci());
  return wykryta === "ambiguous"
    ? { locale: undefined, liczNiejasne: true }
    : { locale: wykryta, liczNiejasne: false };
}

/** Licznik komórek wartości: nieliczbowe, z flagą, niejasne. */
class Liczniki {
  nonNumeric = 0;
  flags = 0;
  niejasne = 0;

  problems(): ImportProblem[] {
    const out: ImportProblem[] = [];
    if (this.nonNumeric > 0) out.push({ code: "nonNumericCells", count: this.nonNumeric });
    if (this.flags > 0) out.push({ code: "dataFlags", count: this.flags });
    if (this.niejasne > 0) out.push({ code: "localeAmbiguous", count: this.niejasne });
    return out;
  }
}

/**
 * Wkleja blok `rows` od komórki `anchor`.
 *
 * - Wiersz -1 to nazwy serii, kolumna -1 to etykiety kategorii, róg (-1, -1)
 *   jest pomijany. Cała tabela z nagłówkiem wklejona w róg zastępuje więc
 *   nazwy, etykiety i wartości naraz.
 * - Pusta komórka WARTOŚCI czyści wartość (luka) - tak jak w arkuszu. Pusta
 *   komórka NAZWY albo ETYKIETY nie kasuje istniejącej: seria bez nazwy to
 *   pusta pozycja legendy, a nie świadoma decyzja.
 * - Blok wychodzący poza siatkę dokłada kategorie i serie do limitów; reszta
 *   jest zgłaszana (`categoriesTruncated`, `seriesTruncated`) z dokładną
 *   liczbą wierszy i kolumn bloku, które nie weszły.
 * - Liczby czyta `readImportedNumber` - ta sama reguła co import pliku.
 */
export function applyPasteAt(
  model: GridModel,
  rows: readonly (readonly string[])[],
  anchor: GridAnchor,
  limits: GridLimits = GRID_LIMITS,
  opts: GridPasteOptions = {},
): GridPasteResult {
  const height = rows.length;
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  if (height === 0 || width === 0) return { model, problems: [], range: null };

  const r0 = ogranicz(anchor.row, -1, model.categories.length);
  const c0 = ogranicz(anchor.col, -1, model.series.length);
  const lastRow = r0 + height - 1;
  const lastCol = c0 + width - 1;
  const capRows = Math.max(model.categories.length, limits.maxCategories);
  const capCols = Math.max(model.series.length, limits.maxSeries);
  const nCat = Math.max(model.categories.length, Math.min(lastRow + 1, capRows));
  const nSer = Math.max(model.series.length, Math.min(lastCol + 1, capCols));

  const categories = Array.from(
    { length: nCat },
    (_, i) => model.categories[i] ?? opts.categoryLabel?.(i) ?? String(i + 1),
  );
  const series: ChartSeries[] = model.series.map((s) => ({
    ...s,
    values: Array.from({ length: nCat }, (_, i) => s.values[i] ?? null),
  }));
  while (series.length < nSer) {
    const i = series.length;
    series.push({
      name: opts.seriesName?.(i) ?? String(i + 1),
      values: Array.from({ length: nCat }, () => null),
      colorSlot: wolnySlot(series, i),
    });
  }

  const { locale, liczNiejasne } = konwencjaWklejenia(opts.locale ?? "auto", function* () {
    for (let pr = 0; pr < height; pr += 1) {
      for (let pc = 0; pc < rows[pr].length; pc += 1) {
        if (r0 + pr >= 0 && c0 + pc >= 0) yield rows[pr][pc];
      }
    }
  });
  const liczniki = new Liczniki();

  for (let pr = 0; pr < height; pr += 1) {
    const r = r0 + pr;
    if (r >= nCat) break;
    for (let pc = 0; pc < width; pc += 1) {
      const c = c0 + pc;
      if (c >= nSer) break;
      const cell = rows[pr][pc] ?? "";
      if (r === -1 && c === -1) continue;
      if (r === -1) {
        if (cell.trim() !== "") series[c] = { ...series[c], name: cell.trim() };
        continue;
      }
      if (c === -1) {
        if (cell.trim() !== "") categories[r] = cell.trim();
        continue;
      }
      const reading = readImportedNumber(cell, locale);
      if (reading.status === "invalid") liczniki.nonNumeric += 1;
      if (reading.flagged) liczniki.flags += 1;
      if (liczNiejasne && reading.status === "number" && numberStyle(cell) === "ambiguous") {
        liczniki.niejasne += 1;
      }
      series[c].values[r] = reading.value;
    }
  }

  const problems: ImportProblem[] = [];
  const droppedRows = Math.max(0, lastRow + 1 - capRows);
  const droppedCols = Math.max(0, lastCol + 1 - capCols);
  if (droppedCols > 0) problems.push({ code: "seriesTruncated", dropped: droppedCols });
  if (droppedRows > 0) problems.push({ code: "categoriesTruncated", dropped: droppedRows });
  problems.push(...liczniki.problems());
  return {
    model: { categories, series },
    problems,
    range: {
      fromRow: r0,
      toRow: Math.min(lastRow, nCat - 1),
      fromCol: c0,
      toCol: Math.min(lastCol, nSer - 1),
    },
  };
}

// ---------------------------------------------------------------------------
// Siatka mapy
// ---------------------------------------------------------------------------

/**
 * Wiersz siatki mapy. Siatka może trzymać wiersz NIEDOKOŃCZONY - kraj bez
 * wartości albo wartość bez kraju (`id: ""`) - bo tak wygląda edycja w toku;
 * do treści bloku trafia dopiero `mapRowsToValues`. `MapDatum` jest szczególnym
 * przypadkiem tego typu, więc zapisane dane wchodzą do siatki bez konwersji.
 */
export interface MapGridRow {
  id: string;
  value: number | null;
}

/** Górny limit wierszy siatki mapy - więcej, niż krajów ma zasób świata. */
export const MAP_GRID_MAX_ROWS = 300;

export interface MapPasteOptions {
  locale?: NumberLocaleChoice;
  maxRows?: number;
}

export interface MapPasteResult {
  rows: MapGridRow[];
  problems: ImportProblem[];
  /** Wiersze siatki zapisane przez wklejenie; `null`, gdy żaden. */
  range: { fromRow: number; toRow: number } | null;
}

/**
 * Wkleja blok w siatkę mapy: kolumna 0 to kraj, kolumna 1 to wartość
 * (kotwica -1 jest traktowana jak 0 - siatka mapy nie ma wiersza nazw ani
 * kolumny etykiet).
 *
 * - Kraj rozwiązuje `resolveCountryLabel` - te same reguły co import pliku:
 *   ISO-2, nazwa z zasobu, ISO-3, kod Eurostatu, nazwa zastępcza. Alias jest
 *   zgłaszany, kraj nieznany też - a jego wiersz NIE jest zapisywany, żeby
 *   nie podpiąć cudzej wartości pod kraj, który akurat stał w tym wierszu.
 * - Pierwszy wiersz bloku, który wygląda na nagłówek („Kraj | Wartość",
 *   „Kraj | 2019 | 2020"), jest pomijany.
 * - Kolumny za kolumną wartości są zgłaszane (`columnsIgnored`).
 * - Kraj wklejony drugi raz w tym samym bloku: wygrywa pierwsze wystąpienie.
 *   Kraj, który był już w INNYM wierszu siatki, zostaje tam usunięty -
 *   wklejenie mówi wprost, gdzie ma stać - i jest to zgłaszane
 *   (`duplicateCountries`).
 */
export function applyMapPasteAt(
  current: readonly MapGridRow[],
  pasted: readonly (readonly string[])[],
  anchor: GridAnchor,
  index?: CountryIndex,
  opts: MapPasteOptions = {},
): MapPasteResult {
  const maxRows = opts.maxRows ?? MAP_GRID_MAX_ROWS;
  const c0 = ogranicz(anchor.col, 0, 1);
  const r0 = ogranicz(anchor.row, 0, current.length);
  const width = pasted.reduce((w, r) => Math.max(w, r.length), 0);
  if (pasted.length === 0 || width === 0) return { rows: [...current], problems: [], range: null };

  const countryCol = c0 === 0 ? 0 : -1;
  const valueCol = c0 === 0 ? 1 : 0;
  const valueOf = (row: readonly string[]) => (valueCol < row.length ? (row[valueCol] ?? "") : "");

  const first = pasted[0];
  const naglowek =
    pasted.length > 1 &&
    (countryCol === 0
      ? resolveCountryLabel(first[0] ?? "", index) === null &&
        (first[0] ?? "").trim() !== "" &&
        (readImportedNumber(valueOf(first), "pl").value === null ||
          first.slice(1).every((c) => c.trim() === "" || isPeriodLabel(c)))
      : readImportedNumber(valueOf(first), "pl").status === "invalid");
  const body = naglowek ? pasted.slice(1) : pasted;

  const problems: ImportProblem[] = [];
  const ignored: string[] = [];
  for (let c = valueCol + 1; c < width; c += 1) {
    if (!body.some((r) => readImportedNumber(r[c] ?? "", "en").status === "number")) continue;
    const nazwa = naglowek ? (first[c] ?? "").trim() : "";
    ignored.push(nazwa !== "" ? nazwa : columnLetter(c));
  }

  const { locale, liczNiejasne } = konwencjaWklejenia(opts.locale ?? "auto", () =>
    body.map(valueOf),
  );
  const liczniki = new Liczniki();
  const rows: MapGridRow[] = current.map((r) => ({ ...r }));
  const unknown: string[] = [];
  const duplicate: string[] = [];
  const aliased: string[] = [];
  const wklejone = new Map<string, number>();
  const zapisane = new Set<MapGridRow>();
  let dropped = 0;

  body.forEach((row, i) => {
    const r = r0 + i;
    if (r >= Math.max(maxRows, current.length)) {
      dropped += 1;
      return;
    }
    let id: string | null = null;
    if (countryCol === 0) {
      const label = (row[0] ?? "").trim();
      if (label !== "") {
        const hit = resolveCountryLabel(label, index);
        if (hit === null) {
          unknown.push(label);
          return;
        }
        if (wklejone.has(hit.id)) {
          duplicate.push(label);
          return;
        }
        if (hit.alias) aliased.push(`${label} (${hit.id})`);
        id = hit.id;
      }
    }
    const hasValue = valueCol < row.length;
    let value: number | null | undefined;
    if (hasValue) {
      const cell = valueOf(row);
      const reading = readImportedNumber(cell, locale);
      if (reading.status === "invalid") liczniki.nonNumeric += 1;
      if (reading.flagged) liczniki.flags += 1;
      if (liczNiejasne && reading.status === "number" && numberStyle(cell) === "ambiguous") {
        liczniki.niejasne += 1;
      }
      value = reading.value;
    }
    while (rows.length <= r) rows.push({ id: "", value: null });
    rows[r] = { id: id ?? rows[r].id, value: value === undefined ? rows[r].value : value };
    zapisane.add(rows[r]);
    if (id !== null) wklejone.set(id, r);
  });

  // Kraj wklejony tutaj znika z innych wierszy siatki - od końca, żeby
  // usuwanie nie przesuwało indeksów, które jeszcze sprawdzamy.
  for (let r = rows.length - 1; r >= 0; r -= 1) {
    const owner = wklejone.get(rows[r].id);
    if (owner === undefined || owner === r) continue;
    duplicate.push(rows[r].id);
    rows.splice(r, 1);
  }
  const indeksy = rows.flatMap((row, i) => (zapisane.has(row) ? [i] : []));

  if (unknown.length > 0) problems.push({ code: "unknownCountries", labels: unknown });
  if (duplicate.length > 0) problems.push({ code: "duplicateCountries", labels: duplicate });
  if (dropped > 0) problems.push({ code: "categoriesTruncated", dropped });
  if (aliased.length > 0) problems.push({ code: "aliasesApplied", labels: aliased });
  if (ignored.length > 0) problems.push({ code: "columnsIgnored", labels: ignored });
  problems.push(...liczniki.problems());
  return {
    rows,
    problems,
    range: indeksy.length > 0 ? { fromRow: indeksy[0], toRow: indeksy[indeksy.length - 1] } : null,
  };
}

/**
 * Siatka mapy -> dane bloku: tylko wiersze z krajem ISO-2 i wartością,
 * pierwsze wystąpienie kraju wygrywa (tak jak `parseMapValues`).
 */
export function mapRowsToValues(rows: readonly MapGridRow[]): MapDatum[] {
  const seen = new Set<string>();
  const out: MapDatum[] = [];
  for (const row of rows) {
    const id = row.id.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(id) || row.value === null || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, value: row.value });
  }
  return out;
}
