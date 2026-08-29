// JEDNO ZACHOWANIE IKON W CAŁEJ PLATFORMIE.
//
// Ikony social w nagłówku strony (widget `social-bar`) zachowują się tak:
// w spoczynku są przezroczystym kwadratem 6px z ikoną w tonie tekstu, a po
// najechaniu (i przy focusie z klawiatury) kafelek wypełnia się kolorem marki,
// ikona robi się jasna. Ten sam język wizualny obowiązuje na stronie
// wydarzenia, na stronie uczestnika wydarzenia i w globalnym profilu -
// dotyczy to również kontaktu: e-maila, telefonu i lokalizacji.
//
// Trzymamy to w JEDNYM module, żeby zmiana palety w nagłówku przechodziła
// przez wszystkie profile bez dublowania klas.
import type { CSSProperties } from "react";

import { SOCIAL_OFFICIAL_COLORS } from "@/components/builder/organisms/widget-view/socialHover";

/** Klucze kafelków obsługiwane przez wspólny hover (social + kontakt). */
export type BrandTileKey =
  | "facebook"
  | "x"
  | "youtube"
  | "instagram"
  | "linkedin"
  | "spotify"
  | "website"
  | "mail"
  | "email"
  | "phone"
  | "location"
  | string;

/** Ton firmowy - używany przez kontakt i „stronę www" (to NASZA marka). */
const HOUSE = "hsl(var(--brand, 25 95% 63%))";

/** Kolor marki dla kafelka; nieznany klucz dostaje ton firmowy. */
export function brandTileColor(key: BrandTileKey): string {
  return SOCIAL_OFFICIAL_COLORS[key] ?? HOUSE;
}

/** Zmienna CSS z kolorem marki - wstrzykiwana w `style` kafelka. */
export function brandTileStyle(key: BrandTileKey, extra?: CSSProperties): CSSProperties {
  return { ...extra, ["--tile-brand" as string]: brandTileColor(key) } as CSSProperties;
}

/**
 * Klasy kafelka ikony - jak w nagłówku: przezroczyste tło, brak obwódki,
 * po najechaniu pełny kolor marki i jasna ikona.
 */
export const BRAND_TILE_CLASS =
  "inline-flex shrink-0 items-center justify-center rounded-[6px] border border-transparent bg-transparent text-foreground transition-colors duration-150 hover:border-[var(--tile-brand)] hover:bg-[var(--tile-brand)] hover:text-white focus-visible:border-[var(--tile-brand)] focus-visible:bg-[var(--tile-brand)] focus-visible:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/**
 * Klasy pigułki kontaktowej (e-mail, telefon, miejsce) - w spoczynku spokojna
 * pigułka, po najechaniu ta sama reakcja marki co kafelek w nagłówku.
 */
export const BRAND_PILL_CLASS =
  "transition-colors duration-150 hover:border-[var(--tile-brand)] hover:bg-[var(--tile-brand)] hover:text-white focus-visible:border-[var(--tile-brand)] focus-visible:bg-[var(--tile-brand)] focus-visible:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background [&_svg]:transition-colors hover:[&_svg]:text-white focus-visible:[&_svg]:text-white";
