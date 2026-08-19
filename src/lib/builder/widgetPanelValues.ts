// CZYSTA warstwa dostępu do wartości pól panelu właściwości widgetu.
//
// PO CO OSOBNY MODUŁ. Audyt pokrycia z 2026-08-18 nazwał
// `components/admin/builder/**` (112 plików, 2 077 funkcji) „jedyną dużą
// powierzchnią MODUŁU 3 bez żadnego progu per-ścieżka - i dlatego jedyną, która
// osunęła się do 13,6%". Diagnoza była trafna także co do przyczyny: reguły
// odczytu i zapisu wartości (klasyfikacja trybu szerokości, klampy rozmiarów,
// rozpakowanie zapisu responsywnego, „auto" jako brak wartości) siedziały jako
// domknięcia WEWNĄTRZ komponentu `WidgetProperties.tsx` (1 800 linii), więc
// jedynym sposobem ich przetestowania było wyrenderowanie całego panelu.
//
// Ten plik zbiera je jako zwykłe funkcje. Kontrakt jest ten sam CO DO BAJTU -
// to przeniesienie, nie zmiana zachowania (`bun run check:widget-fidelity`
// i pełna suita zielone przed i po).
//
// ZASADA: zero Reacta, zero DOM-u, wyłącznie importy typów. To ten sam zabieg,
// który dał `lib/builder/schema.ts` 100% funkcji, i ta sama reguła, którą
// `lib/sanitizePure.ts` opisuje dla swojej warstwy.
import type { AdvancedSettings, Device } from "./types";

// ---------------------------------------------------------------------------
// Wysokość widgetu (suwak „Wysokość" w zakładce Zaawansowane)
// ---------------------------------------------------------------------------

/**
 * Zapis wysokości trzymany per breakpoint, żeby edycja desktopu NIE zdeptała
 * istniejącego nadpisania na tablecie/mobile. `"auto"` to jawny tryb
 * hug-content; `undefined` czyści nadpisanie i widget wraca do wysokości
 * własnej treści.
 */
export type HeightResponsive = {
  desktop?: number | "auto";
  tablet?: number | "auto";
  mobile?: number | "auto";
};
export type HeightValue = number | HeightResponsive | undefined;
export type DesktopHeight = number | "auto" | undefined;

/** Wyciąga warstwę desktopową z zapisu płaskiego LUB responsywnego. */
export function readDesktopHeight(value: HeightValue): DesktopHeight {
  if (value === undefined) return undefined;
  if (typeof value === "number") return value;
  return value.desktop;
}

/**
 * Zapisuje warstwę desktopową, zachowując tablet/mobile. Pusty obiekt zwija się
 * do `undefined`, żeby w dokumencie nie zostawał martwy `height: {}`.
 *
 * UWAGA na asymetrię: płaska wartość historyczna (`number`) jest przy pierwszym
 * zapisie ZAMIENIANA na `{ desktop: n }`. To celowe - od tego momentu ustawienie
 * jest per breakpoint.
 */
export function writeDesktopHeight(
  prev: HeightValue,
  next: DesktopHeight,
): HeightResponsive | undefined {
  const base: HeightResponsive = prev && typeof prev === "object" ? { ...prev } : {};

  if (next === undefined) {
    delete base.desktop;
  } else {
    base.desktop = next;
  }
  const hasAny =
    base.desktop !== undefined || base.tablet !== undefined || base.mobile !== undefined;
  return hasAny ? base : undefined;
}

/** Granice wysokości stałej. Poza nimi widget przestaje być użyteczny w kanwie. */
export const WIDGET_HEIGHT_MIN_PX = 40;
export const WIDGET_HEIGHT_MAX_PX = 2400;

/** Przycina wysokość stałą do zakresu obsługiwanego przez kanwę. */
export function clampWidgetHeight(next: number): number {
  return Math.max(WIDGET_HEIGHT_MIN_PX, Math.min(WIDGET_HEIGHT_MAX_PX, next));
}

// ---------------------------------------------------------------------------
// Szerokość widgetu (segmentowany przełącznik pełna / % / px / do treści)
// ---------------------------------------------------------------------------

/** Tryb szerokości pokazywany w panelu - pochodna KSZTAŁTU zapisanej wartości. */
export type WidgetWidthMode = "full" | "percent" | "px" | "wrapped";

type StoredWidth = AdvancedSettings["width"];
type ActiveWidth = number | "auto" | `${number}%` | undefined;

/**
 * Rozpakowuje zapis szerokości do wartości obowiązującej na danym urządzeniu.
 * Zapis responsywny spada na `desktop`; zapis płaski (historyczny) obowiązuje
 * wszędzie.
 */
export function readActiveWidgetWidth(stored: StoredWidth, device: Device): ActiveWidth {
  if (stored && typeof stored === "object") {
    return (stored[device] ?? stored.desktop) as ActiveWidth;
  }
  return stored as ActiveWidth;
}

/**
 * Klasyfikuje wartość na tryb przełącznika. `"100%"` to NIE „procent" a „pełna
 * szerokość" - inaczej przełącznik pokazywałby suwak 100% zamiast zaznaczonego
 * trybu pełnego. Brak wartości i wartość nierozpoznana dają `"full"`, bo taka
 * jest domyślna szerokość widgetu w kolumnie.
 */
export function widgetWidthMode(active: ActiveWidth): WidgetWidthMode {
  if (active === "auto") return "wrapped";
  if (typeof active === "string" && active.endsWith("%")) {
    return active === "100%" ? "full" : "percent";
  }
  if (typeof active === "number") return "px";
  return "full";
}

/**
 * Liczba pokazywana w polu obok przełącznika. Wartości domyślne (50%, 320 px)
 * są tym, co redaktor zobaczy po przełączeniu trybu na pustym zapisie -
 * `parseFloat`/`Number` na śmieciu dają `NaN`, więc `||` sprowadza je do nich.
 * Tryb „do treści" nie ma liczby, stąd 0.
 */
export function widgetWidthValue(active: ActiveWidth, mode: WidgetWidthMode): number {
  if (mode === "percent") return Number.parseFloat(String(active)) || 50;
  if (mode === "px") return Number(active) || 320;
  if (mode === "full") return 100;
  return 0;
}

/** Wartość, którą przełączenie trybu wpisuje do dokumentu. */
export function seedWidthForMode(mode: WidgetWidthMode): number | "auto" | `${number}%` {
  if (mode === "full") return "100%";
  if (mode === "percent") return "50%";
  if (mode === "px") return 320;
  return "auto";
}

/**
 * Zapisuje szerokość dla JEDNEGO urządzenia. `undefined` usuwa nadpisanie tego
 * urządzenia; opróżniony obiekt zwija się do `undefined`, żeby nie zostawiać
 * w dokumencie martwego `width: {}`.
 */
export function writeWidgetWidth(
  prev: StoredWidth,
  device: Device,
  value: number | "auto" | `${number}%` | undefined,
): StoredWidth {
  const responsive: Record<string, unknown> = prev && typeof prev === "object" ? { ...prev } : {};
  if (value === undefined) delete responsive[device];
  else responsive[device] = value;
  return (Object.keys(responsive).length > 0 ? responsive : undefined) as StoredWidth;
}

// ---------------------------------------------------------------------------
// Rozmiary elementów formularza (pola px z krokiem +/-)
// ---------------------------------------------------------------------------

/** Przycina i zaokrągla rozmiar do zakresu deklarowanego przez pole. */
export function clampFormElementSize(next: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(next)));
}

/**
 * Interpretuje to, co redaktor WPISAŁ w pole rozmiaru.
 *
 * Trzy wyniki, bo trzy różne intencje:
 *  - `{ kind: "clear" }`  - pole wyczyszczone: ustawienie wraca do „auto",
 *    czyli klucz ma zostać USUNIĘTY z treści (nie zapisany jako 0);
 *  - `{ kind: "ignore" }` - wpis nie jest liczbą: zostawiamy poprzednią wartość,
 *    zamiast zapisywać `NaN` (to trafiłoby do CSS jako `NaNpx`);
 *  - `{ kind: "set" }`    - liczba, przycięta do zakresu pola.
 */
export type SizeCommit = { kind: "clear" } | { kind: "ignore" } | { kind: "set"; value: number };

export function commitSizeInput(raw: string, min: number, max: number): SizeCommit {
  if (raw.trim() === "") return { kind: "clear" };
  const next = Number(raw);
  if (Number.isNaN(next)) return { kind: "ignore" };
  return { kind: "set", value: clampFormElementSize(next, min, max) };
}

/**
 * Krok przyciskiem +/-. Krok z „auto" startuje od AKTUALNIE wyrenderowanego
 * rozmiaru, nie od `min` - inaczej pierwsze kliknięcie widocznie zeskakiwało
 * drobne rozmiary tekstu na wartość minimalną pola.
 */
export function bumpSize(
  current: number | null,
  effectivePx: number,
  delta: number,
  min: number,
  max: number,
): number {
  return clampFormElementSize((current ?? effectivePx) + delta, min, max);
}
