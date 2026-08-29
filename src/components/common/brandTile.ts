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

import {
  SOCIAL_BRAND_GRADIENTS,
  SOCIAL_HOUSE_GRADIENTS,
  SOCIAL_OFFICIAL_COLORS,
} from "@/components/builder/organisms/widget-view/socialHover";

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

/**
 * Gradient marki dla kafelka - ten sam język co w nagłówku: pogłębiona rampa
 * 135° z palety oficjalnej, a dla kontaktu / „www" firmowa tonacja „amber".
 * Dzięki temu LinkedIn nie jest płaską plamą `#0A66C2`, tylko gradientem jak
 * w headerze, a każdy kafelek zachowuje się identycznie.
 */
export function brandTileGradient(key: BrandTileKey): string {
  return SOCIAL_BRAND_GRADIENTS[key] ?? SOCIAL_HOUSE_GRADIENTS.amber;
}

/** Zmienne CSS kafelka - wstrzykiwane w `style`: płaski ton + gradient. */
export function brandTileStyle(key: BrandTileKey, extra?: CSSProperties): CSSProperties {
  return {
    ...extra,
    ["--tile-brand" as string]: brandTileColor(key),
    ["--tile-grad" as string]: brandTileGradient(key),
  } as CSSProperties;
}

/**
 * Klasy kafelka ikony - dokładnie jak w nagłówku: przezroczyste tło w
 * spoczynku, a po najechaniu (i przy focusie z klawiatury) pogłębiony gradient
 * marki z blaskiem i delikatnym uniesieniem oraz jasna ikona. Kolor ikony jest
 * wymuszany także bezpośrednio na SVG, żeby ikony z własnym `color` (jak
 * LinkedIn) nie zostawały ciemne.
 */
export const BRAND_TILE_CLASS =
  "group/tile inline-flex shrink-0 items-center justify-center rounded-[6px] border border-transparent bg-transparent text-foreground transition-[background-image,box-shadow,border-color,color] duration-200 ease-out hover:border-transparent hover:[background-image:linear-gradient(180deg,rgba(255,255,255,0.16)_0%,rgba(255,255,255,0.05)_38%,rgba(255,255,255,0)_62%),var(--tile-grad)] hover:text-white hover:shadow-[0_10px_24px_-16px_rgba(0,0,0,0.55)] focus-visible:border-transparent focus-visible:[background-image:linear-gradient(180deg,rgba(255,255,255,0.16)_0%,rgba(255,255,255,0.05)_38%,rgba(255,255,255,0)_62%),var(--tile-grad)] focus-visible:text-white focus-visible:shadow-[0_10px_24px_-16px_rgba(0,0,0,0.55)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background [&_svg]:transition-colors [&_svg]:duration-200 hover:[&_svg]:!text-white focus-visible:[&_svg]:!text-white";

/**
 * Klasy pigułki kontaktowej (e-mail, telefon, miejsce) - w spoczynku spokojna
 * pigułka, po najechaniu ta sama reakcja marki co kafelek w nagłówku.
 */
export const BRAND_PILL_CLASS =
  "transition-[background-image,box-shadow,border-color,color] duration-200 ease-out hover:border-transparent hover:[background-image:linear-gradient(180deg,rgba(255,255,255,0.16)_0%,rgba(255,255,255,0.05)_38%,rgba(255,255,255,0)_62%),var(--tile-grad)] hover:text-white hover:shadow-[0_10px_24px_-16px_rgba(0,0,0,0.55)] focus-visible:border-transparent focus-visible:[background-image:linear-gradient(180deg,rgba(255,255,255,0.16)_0%,rgba(255,255,255,0.05)_38%,rgba(255,255,255,0)_62%),var(--tile-grad)] focus-visible:text-white focus-visible:shadow-[0_10px_24px_-16px_rgba(0,0,0,0.55)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background [&_svg]:transition-colors [&_svg]:duration-200 hover:[&_svg]:!text-white focus-visible:[&_svg]:!text-white";
