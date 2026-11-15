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
//
// PAMIĘĆ IZOLATU. Wynik fali - także NEGATYWNY („ani archiwum, ani wpis") -
// leży w `edgeTtlCache` przez `MISSING_PATH_TTL_MS`. Dotąd zapamiętany był
// tylko stary adres wpisu (`resolveLegacyPostPath`), a dwa zapytania
// o taksonomię szły do bazy przy KAŻDYM powtórzonym 404 tego samego adresu.
// Trzy zasady tego wpisu:
//   * JEDEN wpis na adres, nie trzy: magazyn `edgeTtlCache` ma sufit 500
//     wpisów na izolat i wypiera najstarsze, więc każdy dodatkowy klucz na
//     nietrafiony adres przyspiesza wypieranie ustawień i menu przez przelot
//     skanera. Rezolucja treści (`public:resolved:`) plus ten wpis to tyle
//     samo kluczy na adres, co przed zmianą;
//   * BŁĄD NIE JEST WYNIKIEM NEGATYWNYM: gdy którykolwiek odczyt padnie, fala
//     rzuca i do pamięci nie trafia nic; bieżące żądanie dostaje te wyniki,
//     które przyszły (jak dotąd - błąd pojedynczego odczytu czyta się jak
//     „nie znaleziono"), a następne pyta ponownie;
//   * BEZ SERVE-STALE: po TTL wpis nie jest oddawany „od ręki". Odpowiedź
//     negatywna to dokładnie ta, która zmienia się w chwili publikacji, więc
//     decyzja 404 nigdy nie stoi na odczycie starszym niż TTL.
// Zakres najemcy: `edgeTtlCache` kluczuje wpis zwalidowanym hostem żądania
// „z konstrukcji" - slug z adresu nie może trafić w pamięć innego tenanta.
import { supabase } from "@/integrations/supabase/client";
import { edgeTtlCache } from "@/lib/ssrCache";

import { fetchLegacyPostPath } from "./legacyPostPath";
import {
  legacyLookupSlug,
  needsTaxonomyLookup,
  type MissingContentInput,
} from "./resolvePublicPath";

/** Wyniki odczytów zapasowych - dokładnie pola, które czyta `resolveMissingContent`. */
export type MissingPathLookups = Required<
  Pick<MissingContentInput, "categorySlug" | "tagSlug" | "legacyPostPath">
>;

/**
 * Świeżość zapamiętanego wyniku fali. Ta sama minuta, co rezolucja treści
 * (`public:resolved:` w `lib/queries/public.ts`): adres zaczyna działać
 * najpóźniej po tym czasie od publikacji także w izolacie, który tuż przed nią
 * odpowiedział 404.
 */
export const MISSING_PATH_TTL_MS = 60_000;

/**
 * Fala, w której co najmniej jeden odczyt padł. Niesie wyniki pozostałych,
 * żeby bieżące żądanie nie straciło trafionego przekierowania przez błąd
 * sąsiedniego zapytania - ale jako WYJĄTEK, więc `edgeTtlCache` jej nie zapisze.
 */
class DegradedMissingPathLookups extends Error {
  constructor(readonly partial: MissingPathLookups) {
    super("missing-path lookups degraded");
    this.name = "DegradedMissingPathLookups";
  }
}

/** Slug archiwum kategorii o danym slugu albo `null`. Rzuca przy błędzie bazy. */
async function fetchCategorySlug(slug: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("categories")
    .select("slug")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  return data?.slug ?? null;
}

/** Slug archiwum tagu o danym slugu albo `null`. Rzuca przy błędzie bazy. */
async function fetchTagSlug(slug: string): Promise<string | null> {
  const { data, error } = await supabase.from("tags").select("slug").eq("slug", slug).maybeSingle();
  if (error) throw error;
  return data?.slug ?? null;
}

function settledValue(result: PromiseSettledResult<string | null>): string | null {
  return result.status === "fulfilled" ? result.value : null;
}

/** Jedna fala odczytów. Rzuca `DegradedMissingPathLookups`, gdy którykolwiek padł. */
async function readMissingPath(slug: string, withTaxonomy: boolean): Promise<MissingPathLookups> {
  const results = await Promise.allSettled([
    withTaxonomy ? fetchCategorySlug(slug) : null,
    withTaxonomy ? fetchTagSlug(slug) : null,
    fetchLegacyPostPath(slug),
  ]);
  const [category, tag, legacy] = results;
  const lookups: MissingPathLookups = {
    categorySlug: settledValue(category),
    tagSlug: settledValue(tag),
    legacyPostPath: settledValue(legacy),
  };
  if (results.some((result) => result.status === "rejected")) {
    throw new DegradedMissingPathLookups(lookups);
  }
  return lookups;
}

const NOTHING_FOUND: MissingPathLookups = Object.freeze({
  categorySlug: null,
  tagSlug: null,
  legacyPostPath: null,
});

/**
 * Wszystkie odczyty zapasowe adresu bez treści - JEDNĄ falą, z wynikiem
 * zapamiętanym w izolacie. Nigdy nie rzuca.
 *
 * Klucz pamięci to slug i RODZAJ fali, nie pełna ścieżka: adres wielosegmentowy
 * pyta wyłącznie o wpis po ostatnim segmencie, więc `/a/<slug>` i `/b/<slug>`
 * dzielą jeden wpis, a goły `/<slug>` (z taksonomią) ma osobny.
 */
export async function lookupMissingPath(segments: readonly string[]): Promise<MissingPathLookups> {
  const slug = legacyLookupSlug(segments);
  if (!slug) return NOTHING_FOUND;
  const withTaxonomy = needsTaxonomyLookup(segments);
  try {
    return await edgeTtlCache(
      `public:missing-path:${withTaxonomy ? "slug" : "post"}:${slug}`,
      MISSING_PATH_TTL_MS,
      () => readMissingPath(slug, withTaxonomy),
      { serveStale: false },
    );
  } catch (error) {
    return error instanceof DegradedMissingPathLookups ? error.partial : NOTHING_FOUND;
  }
}
