// KLAWIATURA SIATKI DANYCH - jak w arkuszu, na zwykłych polach `<input>`.
//
// Komórki siatki są NATYWNYMI polami tekstowymi: globalne skróty kanwy bloków
// i buildera omijają pola edytowalne, wklejanie trafia do pola, a czytnik
// ekranu czyta je jak formularz. Nawigacja jest więc dołożona NAD polami:
// każda komórka niesie współrzędne (`data-grid-row`, `data-grid-col`), a ten
// moduł szuka sąsiada w obrębie najbliższego `[data-chart-grid]`.
//
//   * Enter / Shift+Enter - komórka niżej / wyżej (jak w Excelu),
//   * Tab / Shift+Tab - następna / poprzednia komórka w porządku czytania;
//     z ostatniej komórki Tab wychodzi z siatki zwykłą drogą przeglądarki,
//   * strzałki góra i dół - zawsze; lewo i prawo - dopiero na krawędzi tekstu,
//     żeby strzałka wewnątrz wpisu nadal przesuwała kursor.
//
// Przyciski wierszy i kolumn mają `tabIndex={-1}` - Tab chodzi po komórkach,
// a nie po koszach - a ich menu otwiera klawisz menu kontekstowego albo
// Shift+F10 w komórce.
//
// Ten sam moduł obsłuży siatkę mapy (kraj, wartość): nie wie nic o seriach.

/** Atrybut korzenia siatki - granica nawigacji i cel zdarzenia opróżnienia. */
export const CHART_GRID_ATTR = "data-chart-grid";

/**
 * Zdarzenie wysyłane NA korzeń siatki tuż przed cofnięciem albo ponowieniem
 * (skróty buildera): siatka z odłożonym zapisem wysyła go od razu, żeby
 * Ctrl+Z cofał ostatnią edycję, a nie tę sprzed niej.
 */
export const GRID_FLUSH_EVENT = "chart-grid:flush";

/** Atrybuty współrzędnych komórki. Wiersz -1 to nagłówek, kolumna -1 - etykiety. */
export function gridCellAttrs(row: number, col: number): Record<string, number> {
  return { "data-grid-row": row, "data-grid-col": col };
}

/** Szczegół zdarzenia opróżnienia: siatka zaznacza, że odłożony zapis naprawdę poszedł. */
export interface GridFlushDetail {
  flushed: boolean;
}

/**
 * Opróżnia odłożony zapis siatki, w której leży `target` (o ile w jakiejś
 * leży). Zwraca `true`, gdy siatka coś WYSŁAŁA - wołający wie wtedy, że
 * historia dostała nowy krok, którego jego domknięcie z tego renderu jeszcze
 * nie widzi (skróty buildera: `canUndo`, etykieta cofnięcia).
 */
export function flushChartGridAt(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const root = target.closest(`[${CHART_GRID_ATTR}]`);
  if (root === null) return false;
  const detail: GridFlushDetail = { flushed: false };
  root.dispatchEvent(new CustomEvent<GridFlushDetail>(GRID_FLUSH_EVENT, { detail }));
  return detail.flushed;
}

/**
 * Zatwierdza szkic komórki, w której stoi fokus - o ile stoi w siatce.
 * Komórka liczby zatwierdza szkic przy utracie fokusu, a okno zamknięte
 * Escape'em zdejmuje pole z dokumentu BEZ utraty fokusu: wpisana i jeszcze
 * niezatwierdzona liczba ginęła bez śladu. Zamykający woła to przed
 * opróżnieniem odłożonego zapisu.
 */
export function commitFocusedGridCell(doc: Document = document): void {
  const el = doc.activeElement;
  if (el instanceof HTMLElement && el.closest(`[${CHART_GRID_ATTR}]`) !== null) el.blur();
}

function komorka(root: Element, row: number, col: number): HTMLInputElement | null {
  return root.querySelector<HTMLInputElement>(
    `input[data-grid-row="${row}"][data-grid-col="${col}"]`,
  );
}

function wszystkie(root: Element): HTMLInputElement[] {
  return Array.from(root.querySelectorAll<HTMLInputElement>("input[data-grid-row]"));
}

function naPoczatku(input: HTMLInputElement): boolean {
  return input.selectionStart === 0 && input.selectionEnd === 0;
}

function naKoncu(input: HTMLInputElement): boolean {
  const n = input.value.length;
  return input.selectionStart === n && input.selectionEnd === n;
}

/** Fokus na komórce z zaznaczeniem całego wpisu - nadpisanie bez kasowania. */
export function focusGridCell(input: HTMLInputElement): void {
  input.focus();
  input.select();
}

/**
 * Fokus na komórce (row, col), a gdy jej już nie ma (usunięty wiersz albo
 * kolumna) - na NAJBLIŻSZEJ, która została: najpierw ten sam wiersz, potem
 * sąsiedni. Menu wiersza i kolumny oddaje tędy fokus siatce; bez tego po
 * „Usuń kategorię" fokus spadał na `body` i autor z klawiatury tracił
 * miejsce w arkuszu.
 */
export function focusNearestGridCell(root: Element, row: number, col: number): boolean {
  const exact = komorka(root, row, col);
  if (exact !== null) {
    focusGridCell(exact);
    return true;
  }
  let best: HTMLInputElement | null = null;
  let dist = Number.POSITIVE_INFINITY;
  for (const input of wszystkie(root)) {
    const r = Number(input.dataset.gridRow);
    const c = Number(input.dataset.gridCol);
    if (!Number.isFinite(r) || !Number.isFinite(c)) continue;
    // Odległość w wierszach waży więcej niż w kolumnach.
    const d = Math.abs(r - row) * 1000 + Math.abs(c - col);
    if (d < dist) {
      dist = d;
      best = input;
    }
  }
  if (best === null) return false;
  focusGridCell(best);
  return true;
}

/** Czy klawisz otwiera menu wiersza albo kolumny (klawisz menu, Shift+F10). */
export function isMenuKey(e: { key: string; shiftKey: boolean }): boolean {
  return e.key === "ContextMenu" || (e.shiftKey && e.key === "F10");
}

/**
 * Obsługa klawisza nawigacji w komórce. Zwraca `true`, gdy klawisz został
 * obsłużony (wtedy z `preventDefault`). `beforeMove` woła komórka, która ma
 * szkic do zatwierdzenia - zapis idzie PRZED przeniesieniem fokusu.
 */
export function handleGridKey(
  e: {
    key: string;
    shiftKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
    currentTarget: HTMLInputElement;
    preventDefault: () => void;
  },
  beforeMove?: () => void,
): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  const input = e.currentTarget;
  const root = input.closest(`[${CHART_GRID_ATTR}]`);
  if (root === null) return false;
  const row = Number(input.dataset.gridRow);
  const col = Number(input.dataset.gridCol);
  if (!Number.isFinite(row) || !Number.isFinite(col)) return false;

  let target: HTMLInputElement | null = null;
  switch (e.key) {
    case "Enter":
      // Enter zawsze ZATWIERDZA - także w ostatnim wierszu, gdzie nie ma
      // dokąd zejść; formularz wokół siatki nie może go dostać jako „wyślij".
      e.preventDefault();
      beforeMove?.();
      target = komorka(root, row + (e.shiftKey ? -1 : 1), col);
      if (target !== null) focusGridCell(target);
      return true;
    case "ArrowDown":
      if (e.shiftKey) return false;
      target = komorka(root, row + 1, col);
      break;
    case "ArrowUp":
      if (e.shiftKey) return false;
      target = komorka(root, row - 1, col);
      break;
    case "ArrowLeft":
      if (e.shiftKey || !naPoczatku(input)) return false;
      target = komorka(root, row, col - 1);
      break;
    case "ArrowRight":
      if (e.shiftKey || !naKoncu(input)) return false;
      target = komorka(root, row, col + 1);
      break;
    case "Tab": {
      const lista = wszystkie(root);
      const i = lista.indexOf(input);
      target = i === -1 ? null : (lista[i + (e.shiftKey ? -1 : 1)] ?? null);
      break;
    }
    default:
      return false;
  }
  if (target === null) return false;
  e.preventDefault();
  beforeMove?.();
  focusGridCell(target);
  return true;
}
