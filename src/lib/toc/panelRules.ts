// Reguły panelu ustawień spisu treści - deskryptory i klasy podglądu.
//
// ZASADA: funkcja reguły zwraca DESKRYPTOR (dane) albo KLUCZ i18n, nigdy
// gotowego tekstu. Dzięki temu test reguły nie zależy od brzmienia etykiety,
// a EN nie zostaje z tyłu, kiedy ktoś poprawi PL. Poprzednia wersja panelu
// trzymała trzy nazwy układów, trzy nazwy kolumn i siedem nazw kolorów
// PO POLSKU wprost w JSX - dla czytelnika EN panel był w połowie polski.
import type { CSSProperties } from "react";
import {
  TOC_COLUMNS,
  TOC_LAYOUTS,
  type TocColumns,
  type TocDefaults,
  type TocLayout,
} from "@/lib/toc/settings";
import type { NumberBounds } from "@/lib/admin/panelDraft";

/** Granice pól liczbowych panelu - te same, których pilnuje `TocDefaultsSchema`. */
export const TOC_POSITION_BOUNDS: NumberBounds = { min: -1, max: 20 };
export const TOC_MIN_HEADINGS_BOUNDS: NumberBounds = { min: 1, max: 20 };

/** Dozwolone poziomy nagłówka - H1..H6, zgodnie ze schematem ustawień. */
export const TOC_HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const;
export type TocHeadingLevel = (typeof TOC_HEADING_LEVELS)[number];

/** Klucz i18n nazwy układu. */
export function tocLayoutLabelKey(layout: TocLayout): string {
  return `admin.toc.layoutOption.${layout}`;
}

export interface TocColumnDescriptor {
  readonly value: TocColumns;
  readonly labelKey: string;
  readonly hintKey: string;
  /** Ile pasków rysuje miniatura - `col-2` pokazuje podział na dwie kolumny. */
  readonly bars: 1 | 2;
  /** Wąska miniatura dla wariantu „połowa szerokości". */
  readonly narrowThumb: boolean;
}

/** Deskryptory kart wyboru układu kolumn (wartość + klucze + kształt miniatury). */
export function tocColumnDescriptors(): TocColumnDescriptor[] {
  return TOC_COLUMNS.map((value) => ({
    value,
    labelKey: `admin.toc.columnsOption.${value}.label`,
    hintKey: `admin.toc.columnsOption.${value}.hint`,
    bars: value === "col-2" ? 2 : 1,
    narrowThumb: value === "half",
  }));
}

/** Deskryptory opcji wyboru układu (wartość + klucz nazwy). */
export function tocLayoutOptions(): { value: TocLayout; labelKey: string }[] {
  return TOC_LAYOUTS.map((value) => ({ value, labelKey: tocLayoutLabelKey(value) }));
}

/**
 * Opcje poziomu nagłówka z informacją, które są niedostępne.
 *
 * REGUŁA: dolna granica nie może przeskoczyć górnej. Panel liczył to dwa razy
 * (`n > draft.maxLevel` w jednym select, `n < draft.minLevel` w drugim), więc
 * jedna reguła w dwóch kopiach - stąd jedna funkcja z jawnym `bound`.
 */
export function tocLevelOptions(
  bound: "min" | "max",
  current: { minLevel: number; maxLevel: number },
): { level: TocHeadingLevel; disabled: boolean }[] {
  return TOC_HEADING_LEVELS.map((level) => ({
    level,
    disabled: bound === "min" ? level > current.maxLevel : level < current.minLevel,
  }));
}

export interface TocColorFieldDescriptor {
  readonly key: keyof TocDefaults["colors"];
  readonly labelKey: string;
}

/** Siedem pól koloru panelu, w kolejności wyświetlania. */
export function tocColorFields(): TocColorFieldDescriptor[] {
  return (["bg", "bgDark", "border", "borderDark", "text", "textDark", "accent"] as const).map(
    (key) => ({ key, labelKey: `admin.toc.colorField.${key}` }),
  );
}

export interface TocSampleHeading {
  readonly level: 1 | 2 | 3;
  readonly textKey: string;
  readonly anchor: string;
}

/**
 * Przykładowe nagłówki podglądu. Tekst siedzi w słowniku (klucz), więc podgląd
 * mówi w języku wybranym w zakładce, a nie w tym, w którym akurat napisano
 * tablicę w kodzie.
 */
const SAMPLE_HEADINGS: readonly TocSampleHeading[] = [
  { level: 1, textKey: "admin.toc.sample.main", anchor: "main-topic" },
  { level: 2, textKey: "admin.toc.sample.intro", anchor: "introduction" },
  { level: 2, textKey: "admin.toc.sample.factors", anchor: "key-factors" },
  { level: 3, textKey: "admin.toc.sample.context", anchor: "context" },
  { level: 3, textKey: "admin.toc.sample.outlook", anchor: "outlook" },
  { level: 2, textKey: "admin.toc.sample.conclusions", anchor: "conclusions" },
];

/** Nagłówki podglądu przefiltrowane zakresem poziomów z ustawień. */
export function tocPreviewHeadings(settings: {
  minLevel: number;
  maxLevel: number;
}): TocSampleHeading[] {
  return SAMPLE_HEADINGS.filter(
    (h) => h.level >= settings.minLevel && h.level <= settings.maxLevel,
  );
}

/** Wcięcie pozycji podglądu w pikselach - poziom względem dolnej granicy. */
export function tocPreviewIndent(level: number, minLevel: number): number {
  return Math.max(0, (level - minLevel) * 12);
}

/** Zmienne CSS i kolory podglądu - dokładnie te, które czyta publiczny ToC. */
export function tocPreviewStyle(settings: TocDefaults): CSSProperties {
  return {
    "--toc-bg": settings.colors.bg,
    "--toc-bg-dark": settings.colors.bgDark,
    "--toc-border": settings.colors.border,
    "--toc-border-dark": settings.colors.borderDark,
    "--toc-text": settings.colors.text,
    "--toc-text-dark": settings.colors.textDark,
    "--toc-accent": settings.colors.accent,
    background: settings.colors.bg,
    color: settings.colors.text,
    border: settings.layout === "inline" ? "none" : `1px solid ${settings.colors.border}`,
  } as CSSProperties;
}

/** Klasy opakowania podglądu (ramka, sticky, połowa szerokości). */
export function tocPreviewWrapperClass(settings: TocDefaults): string {
  return [
    "not-prose p-4",
    settings.layout === "inline" ? "" : "rounded-lg",
    settings.sticky ? "lg:sticky lg:top-24" : "",
    settings.columns === "half" ? "md:max-w-[50%]" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Klasy listy podglądu (numeracja, podział na kolumny). */
export function tocPreviewListClass(settings: TocDefaults): string {
  return [
    "pl-5 text-sm",
    settings.ordered ? "list-decimal" : "list-disc",
    settings.columns === "col-2"
      ? "sm:columns-2 sm:gap-8 [&>li]:break-inside-avoid space-y-1.5"
      : "space-y-1.5",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Znacznik listy podglądu - numerowana czy punktowana. */
export function tocPreviewListTag(settings: TocDefaults): "ol" | "ul" {
  return settings.ordered ? "ol" : "ul";
}

/** Tytuł podglądu w wybranym języku zakładki (nie języku interfejsu). */
export function tocPreviewTitle(settings: TocDefaults, lang: "pl" | "en"): string {
  return lang === "en" ? settings.titleEn : settings.titlePl;
}
