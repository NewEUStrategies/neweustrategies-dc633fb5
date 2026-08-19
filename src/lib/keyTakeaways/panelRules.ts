// Reguły panelu sekcji „Z tego artykułu dowiesz się…".
//
// ZASADA JAK W `lib/toc/panelRules`: funkcja zwraca DESKRYPTOR albo KLUCZ i18n,
// nigdy gotowego tekstu. Poprzednia wersja panelu miała 31 rozgałęzień
// `isPL ? "…" : "…"` wprost w JSX - a bramka `check:i18n-hardcoded` ich nie
// widziała, bo jej wzorzec zna zmienną `isPl`, nie `isPL`. Tekst istniał więc
// tylko w kodzie i nikt nie wiedział, że istnieje.
import type { NumberBounds } from "@/lib/admin/panelDraft";
import {
  KEY_TAKEAWAYS_VARIANTS,
  type KeyTakeawaysSettings,
  type KeyTakeawaysVariant,
} from "@/lib/keyTakeaways/settings";

/** Granice suwaków panelu - te same, których pilnuje schemat ustawień. */
export const HIGHLIGHT_SIZE_BOUNDS: NumberBounds = { min: 0.5, max: 3 };
export const HIGHLIGHT_OFFSET_BOUNDS: NumberBounds = { min: -200, max: 200 };
export const BORDER_WIDTH_BOUNDS: NumberBounds = { min: 0, max: 8 };

/** Krok suwaków - rozmiar chodzi po setnych, przesunięcie i ramka po całych. */
export const HIGHLIGHT_SIZE_STEP = 0.05;

export interface VariantDescriptor {
  readonly value: KeyTakeawaysVariant;
  /** Krótkie oznaczenie wariantu („Wariant A"). */
  readonly badgeKey: string;
  /** Opis, po czym wariant poznać. */
  readonly descKey: string;
}

/** Trzy warianty wizualne sekcji, w kolejności wyświetlania. */
export function keyTakeawaysVariantDescriptors(): VariantDescriptor[] {
  return KEY_TAKEAWAYS_VARIANTS.map((value) => ({
    value,
    badgeKey: `adminPostPanes.keyTakeaways.variant.${value}.badge`,
    descKey: `adminPostPanes.keyTakeaways.variant.${value}.desc`,
  }));
}

/**
 * Ikony Lucide sugerowane dla sekcji. Nazwy nie idą do słownika: to
 * identyfikatory z lucide.dev, nie tekst dla użytkownika.
 */
export const KEY_TAKEAWAYS_ICON_CHOICES = [
  "search",
  "book-open",
  "lightbulb",
  "sparkles",
  "target",
  "list-checks",
  "check-circle-2",
  "info",
  "star",
  "flag",
  "graduation-cap",
  "trending-up",
] as const;

export type KeyTakeawaysIconName = (typeof KEY_TAKEAWAYS_ICON_CHOICES)[number];

/**
 * Czy zapisana nazwa ikony wskazuje na tę pozycję siatki.
 *
 * Porównanie jest ROZLUŹNIONE świadomie: schemat domyślnie zapisuje `Search`
 * (wielka litera), a siatka posługuje się kebab-case (`book-open`). Bez
 * dopuszczenia obu zapisów domyślna ikona nigdy nie byłaby zaznaczona.
 */
export function iconMatches(current: string, candidate: string): boolean {
  const normalized = current.toLowerCase();
  return normalized === candidate || normalized === candidate.replace(/-/g, "");
}

/** Który klucz listy indeksów obsługuje dany język etykiety. */
export function highlightIndicesKey(locale: "pl" | "en"): "indicesPl" | "indicesEn" {
  return locale === "pl" ? "indicesPl" : "indicesEn";
}

/**
 * Słowa etykiety, po których panel rysuje chipy podświetlenia.
 *
 * Rozdzielenie po dowolnym ciągu białych znaków i odsianie pustych członów -
 * inaczej podwójna spacja albo spacja na końcu etykiety produkowałaby chip bez
 * treści, czyli przycisk bez nazwy dostępnej.
 */
export function highlightWords(label: string): string[] {
  return (label || "").split(/\s+/).filter(Boolean);
}

/** Czy słowo o tym indeksie jest podświetlone w danym języku. */
export function isWordHighlighted(
  highlight: KeyTakeawaysSettings["highlight"] | undefined,
  locale: "pl" | "en",
  index: number,
): boolean {
  return (highlight?.[highlightIndicesKey(locale)] ?? []).includes(index);
}

export interface ColorFieldDescriptor {
  readonly key: keyof KeyTakeawaysSettings["colors"];
  readonly labelKey: string;
}

/**
 * Jedenaście pól koloru sekcji, w kolejności wyświetlania. `borderWidth` NIE
 * jest tu wymieniony - to liczba, nie barwa, i ma własny suwak.
 */
export function keyTakeawaysColorFields(): ColorFieldDescriptor[] {
  return (
    [
      "bg",
      "bgDark",
      "accent",
      "iconBg",
      "icon",
      "title",
      "titleDark",
      "text",
      "textDark",
      "border",
      "borderDark",
    ] as const
  ).map((key) => ({ key, labelKey: `adminPostPanes.keyTakeaways.colorField.${key}` }));
}

/**
 * Wartość pola koloru gotowa dla selektora barwy.
 *
 * Pola ramki mogą stać puste w starszych wierszach, a selektor bez wartości
 * pokazuje puste okienko zamiast „przezroczysty" - stąd jawny domyślny zapis.
 */
export function colorFieldValue(colors: KeyTakeawaysSettings["colors"], key: string): string {
  const raw = (colors as unknown as Record<string, unknown>)[key];
  return typeof raw === "string" && raw.length > 0 ? raw : "transparent";
}

/** Klucze przykładowych punktów podglądu (tekst mieszka w słowniku). */
export const KEY_TAKEAWAYS_SAMPLE_KEYS = [
  "adminPostPanes.keyTakeaways.sample.first",
  "adminPostPanes.keyTakeaways.sample.second",
  "adminPostPanes.keyTakeaways.sample.third",
] as const;

/** Mnożnik rozmiaru napisu ghost, z domyślną jedynką dla starszych wierszy. */
export function highlightSizeScale(
  highlight: KeyTakeawaysSettings["highlight"] | undefined,
): number {
  return highlight?.sizeScale ?? 1;
}

/** Przesunięcie etykiety ghost w pionie, z domyślnym zerem. */
export function highlightOffsetY(highlight: KeyTakeawaysSettings["highlight"] | undefined): number {
  return highlight?.offsetY ?? 0;
}

/** Grubość ramki sekcji, z domyślnym zerem (brak ramki). */
export function borderWidthValue(colors: KeyTakeawaysSettings["colors"]): number {
  return colors.borderWidth ?? 0;
}
