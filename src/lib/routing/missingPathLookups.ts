// Odczyty zapasowe gałęzi „treści nie ma" trasy `/$` - wykonawcza (I/O) połowa
// decyzji `resolveMissingContent` z `resolvePublicPath.ts`.
//
// PO CO OSOBNY MODUŁ. Gdy `resolve_path` nie znalazł treści, adres może jeszcze
// znaczyć archiwum taksonomii (goły slug kategorii albo tagu) albo stary adres
// wpisu (płaski poWordPressowy, z nieaktualnym rodzicem). Te trzy odczyty żyły
// w loaderze trasy jako DWIE SZEREGOWE fale: najpierw kategoria i tag,
// a dopiero po ich rozstrzygnięciu wpis. Każdy nietrafiony adres - a to
// głównie boty i stare linki - płacił więc trzy fale round-tripów przed
// pierwszym bajtem strony 404 (pomiar produkcji 2026-11-14: 15-17 zapytań,
// TTFB 2,3-3,5 s).
//
// JEDNA FALA. Wszystkie odczyty zapasowe startują RAZEM. Pierwszeństwo
// taksonomii nad starym adresem wpisu zostaje - rozstrzyga je czysta funkcja
// `resolveMissingContent`, a nie kolejność zapytań. Cena: trafione archiwum
// (goły slug kategorii albo tagu - rzadki przypadek) płaci jedno RÓWNOLEGŁE
// zapytanie o wpis, którego wynik zostaje odrzucony; zysk: każde 404 i każde
// 301 ze starego adresu wpisu ma o jedną szeregową falę mniej.
import { supabase } from "@/integrations/supabase/client";

import { resolveLegacyPostPath } from "./legacyPostPath";
import {
  legacyLookupSlug,
  needsTaxonomyLookup,
  type MissingContentInput,
} from "./resolvePublicPath";

/** Wyniki odczytów zapasowych - dokładnie pola, które czyta `resolveMissingContent`. */
export type MissingPathLookups = Required<
  Pick<MissingContentInput, "categorySlug" | "tagSlug" | "legacyPostPath">
>;

type TaxonomySlugs = Pick<MissingPathLookups, "categorySlug" | "tagSlug">;

const NO_TAXONOMY: TaxonomySlugs = Object.freeze({ categorySlug: null, tagSlug: null });

/** Goły slug jako archiwum kategorii albo tagu - dwa zapytania równolegle. */
async function lookupTaxonomySlugs(slug: string): Promise<TaxonomySlugs> {
  const [{ data: category }, { data: tag }] = await Promise.all([
    supabase.from("categories").select("slug").eq("slug", slug).maybeSingle(),
    supabase.from("tags").select("slug").eq("slug", slug).maybeSingle(),
  ]);
  return { categorySlug: category?.slug ?? null, tagSlug: tag?.slug ?? null };
}

/**
 * Wszystkie odczyty zapasowe adresu bez treści - JEDNĄ falą. Nigdy nie rzuca
 * (jak dotąd: błąd pojedynczego odczytu czyta się jak „nie znaleziono").
 */
export async function lookupMissingPath(segments: readonly string[]): Promise<MissingPathLookups> {
  const [taxonomy, legacyPostPath] = await Promise.all([
    needsTaxonomyLookup(segments) ? lookupTaxonomySlugs(segments[0]) : NO_TAXONOMY,
    resolveLegacyPostPath(legacyLookupSlug(segments)),
  ]);
  return { ...taxonomy, legacyPostPath };
}
