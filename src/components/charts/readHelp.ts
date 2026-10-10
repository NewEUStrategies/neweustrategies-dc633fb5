// „JAK CZYTAĆ" - klucze zdań okna pomocy ramy wykresu per rodzina rysunku.
// Osobny moduł, bo rama (`ChartFrame`) eksportuje komponenty, a bramki
// słownika i testy czytają te same mapy.
import type { ChartFamily } from "./ChartFrame";

/** Klucze zdań „Jak czytać" jednej rodziny rysunku. */
export interface ReadHelpKeys {
  elements: string;
  colorsFocus: string;
  colorsCategorical: string;
  interactions: string;
}

/**
 * „JAK CZYTAĆ" PER RODZINA - klucze wypisane JAWNIE (bramka
 * `chartDictionaryKeys`: klucz sklejony z nazwy rodziny byłby niewidoczny dla
 * kontroli parytetu PL/EN). Zdanie o osiach, legendzie przełączanej i oknie
 * punktu mówiło nieprawdę o tarczy, mapie ciepła, panelach i mapie, więc
 * każda rodzina ma własne trzy zdania. Rodziny, w których kolor KODUJE
 * wartość albo znak (wrażliwość, mapa), mają jedno zdanie o kolorach dla obu
 * palet - wybór palety ich nie dotyczy.
 */
export const READ_HELP_KEYS: Record<ChartFamily, ReadHelpKeys> = {
  cartesian: {
    elements: "read.family.cartesian.elements",
    colorsFocus: "read.family.cartesian.colorsFocus",
    colorsCategorical: "read.family.cartesian.colorsCategorical",
    interactions: "read.family.cartesian.interactions",
  },
  distribution: {
    elements: "read.family.distribution.elements",
    colorsFocus: "read.family.distribution.colorsFocus",
    colorsCategorical: "read.family.distribution.colorsCategorical",
    interactions: "read.family.distribution.interactions",
  },
  part: {
    elements: "read.family.part.elements",
    colorsFocus: "read.family.part.colorsFocus",
    colorsCategorical: "read.family.part.colorsCategorical",
    interactions: "read.family.part.interactions",
  },
  relation: {
    elements: "read.family.relation.elements",
    colorsFocus: "read.family.relation.colorsFocus",
    colorsCategorical: "read.family.relation.colorsCategorical",
    interactions: "read.family.relation.interactions",
  },
  sensitivity: {
    elements: "read.family.sensitivity.elements",
    colorsFocus: "read.family.sensitivity.colors",
    colorsCategorical: "read.family.sensitivity.colors",
    interactions: "read.family.sensitivity.interactions",
  },
  panels: {
    elements: "read.family.panels.elements",
    colorsFocus: "read.family.panels.colorsFocus",
    colorsCategorical: "read.family.panels.colorsCategorical",
    interactions: "read.family.panels.interactions",
  },
  map: {
    elements: "read.family.map.elements",
    colorsFocus: "read.family.map.colors",
    colorsCategorical: "read.family.map.colors",
    interactions: "read.family.map.interactions",
  },
};

/** Zdania ogólne - rama bez rodziny (osadzenie spoza silnika rodzajów). */
export const READ_GENERIC_KEYS: ReadHelpKeys = {
  elements: "read.elementsText",
  colorsFocus: "read.colorsFocus",
  colorsCategorical: "read.colorsCategorical",
  interactions: "read.interactionsText",
};
