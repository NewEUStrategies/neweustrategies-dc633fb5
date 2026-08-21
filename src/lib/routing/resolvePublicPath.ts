// Gramatyka adresów publicznych: decyzja „co znaczy ten adres" jako czysta
// funkcja, bez routera, bez Reacta i bez bazy.
//
// PO CO OSOBNY MODUŁ. `src/routes/$.tsx` rozwiązuje KAŻDY publiczny adres,
// który nie trafił w trasę statyczną - `/<slug-strony>`,
// `/<rodzic>/<dziecko>/...` i `/<ścieżka-strony>/<slug-wpisu>`. Decyzje
// (404 / przekierowanie taksonomii / 301 kanoniczny / treść) były wplecione
// w loader trasy o 1374 liniach, razem z nagłówkami cache, budżetami SSR
// i prefetchami. Nie dało się ich sprawdzić bez postawienia routera, klienta
// zapytań i bazy - więc nie były sprawdzone wcale.
//
// KSZTAŁT: DWIE FAZY, BO MIĘDZY NIMI SIEDZI I/O. Loader musi odpytać bazę
// dokładnie raz, i dopiero wynik tego zapytania rozstrzyga resztę. Dlatego
// gramatyka jest rozcięta w tym samym miejscu, w którym rozcięty jest loader:
//
//   1. `planPublicPath(splat)` - co da się rozstrzygnąć BEZ bazy: pusty adres
//      i zwinięcie starych hierarchicznych adresów taksonomii;
//   2. `resolveMissingContent(...)` - co robić, gdy zapytanie nie znalazło
//      treści: przekierowanie na archiwum, 301 na adres kanoniczny wpisu,
//      albo 404.
//
// Funkcje zwracają DESKRYPTOR DECYZJI, nie gotowy `redirect()`/`notFound()`.
// Rzucanie jest sprawą routera; tu ma być wartość, którą da się porównać
// w tabeli przypadków.
//
// CZEGO TEN MODUŁ NIE ROZSTRZYGA. Kolizji „slug strony równy slugowi wpisu"
// nie rozstrzyga TypeScript, tylko funkcja SQL `resolve_path(_segments)` -
// to ona zwraca `page_id`/`post_id`. Ten moduł dostaje wynik tej decyzji
// z zewnątrz i nie próbuje jej odtwarzać.
import { splatToSegments } from "./publicSegments";

/** Dwa archiwa taksonomii z własnymi trasami statycznymi. */
export type PublicTaxonomy = "category" | "tag";

/** Prefiksy starych, hierarchicznych adresów taksonomii. */
const TAXONOMY_PREFIXES: readonly PublicTaxonomy[] = ["category", "tag"];

/** Trasa archiwum dla taksonomii - dokładnie te wzorce są w drzewie tras. */
export const TAXONOMY_ROUTE: Readonly<Record<PublicTaxonomy, string>> = {
  category: "/category/$slug",
  tag: "/tag/$slug",
};

/** Przekierowanie na archiwum taksonomii. */
export interface TaxonomyRedirect {
  readonly kind: "taxonomy-redirect";
  readonly taxonomy: PublicTaxonomy;
  readonly slug: string;
  /**
   * `replace: true` - stary adres hierarchiczny nie ma zostać w historii
   * przeglądarki, bo „wstecz" wróciłoby na adres, który zaraz znów przekieruje.
   */
  readonly replace: true;
  readonly reason: "legacy-hierarchical-taxonomy" | "bare-slug-is-taxonomy";
}

/** Adres nie do rozwiązania - 404. */
export interface NotFoundDecision {
  readonly kind: "not-found";
  readonly reason: "empty-path" | "unresolvable" | "self-redirect";
}

/** Faza 1 nie rozstrzyga - trzeba odpytać bazę o treść dla tych segmentów. */
export interface LookupContent {
  readonly kind: "lookup";
  readonly segments: readonly string[];
}

export type PublicPathPlan = NotFoundDecision | TaxonomyRedirect | LookupContent;

/**
 * FAZA 1: co wynika z samego adresu.
 *
 * Kolejność reguł jest częścią kontraktu: adres pusty odpada przed
 * taksonomiami, bo `segments[0]` na pustej tablicy jest `undefined`.
 */
export function planPublicPath(splat: string | null | undefined): PublicPathPlan {
  const segments = splatToSegments(splat ?? "");
  if (segments.length === 0) {
    // Sam ukośnik, ukośniki i pusty splat - trasa `/` jest statyczna, więc
    // dotarcie tu z pustą ścieżką znaczy adres bez treści.
    return { kind: "not-found", reason: "empty-path" };
  }
  // Stare adresy hierarchiczne: `/category/region/afryka`, `/tag/foo/bar`.
  // Slugi kategorii i tagów są globalnie unikalne, więc OSTATNI segment
  // zawsze wskazuje właściwe archiwum - zwijamy do formy płaskiej.
  const [first] = segments;
  if (segments.length >= 2 && isTaxonomyPrefix(first)) {
    return {
      kind: "taxonomy-redirect",
      taxonomy: first,
      slug: segments[segments.length - 1],
      replace: true,
      reason: "legacy-hierarchical-taxonomy",
    };
  }
  return { kind: "lookup", segments };
}

/** Strażnik zawężający segment do prefiksu taksonomii (bez rzutowania). */
function isTaxonomyPrefix(segment: string): segment is PublicTaxonomy {
  return (TAXONOMY_PREFIXES as readonly string[]).includes(segment);
}

/** 301 na adres kanoniczny wpisu (pełna ścieżka rodzica + slug). */
export interface CanonicalRedirect {
  readonly kind: "canonical-redirect";
  /** Wartość `_splat` docelowej trasy `/$`. */
  readonly splat: string;
  /** 301, nie 302 - stare adresy mają przekazać moc linków na nowy. */
  readonly statusCode: 301;
  readonly reason: "legacy-post-path";
}

export type MissingContentDecision = NotFoundDecision | TaxonomyRedirect | CanonicalRedirect;

/** Wyniki odpytań, które loader wykonuje, gdy treści nie ma. */
export interface MissingContentInput {
  readonly segments: readonly string[];
  /** Slug archiwum kategorii, jeśli goły slug w nie trafił. */
  readonly categorySlug?: string | null;
  /** Slug archiwum tagu, jeśli goły slug w nie trafił. */
  readonly tagSlug?: string | null;
  /** Kanoniczna ścieżka wpisu odnalezionego po OSTATNIM segmencie. */
  readonly legacyPostPath?: string | null;
}

/**
 * Czy warto w ogóle pytać o taksonomię. Zapytanie ma sens WYŁĄCZNIE dla adresu
 * jednosegmentowego: `/analizy/cos` nie jest gołym slugiem archiwum, a dwa
 * zapytania na każdy nietrafiony adres wielosegmentowy to koszt bez zysku.
 */
export function needsTaxonomyLookup(segments: readonly string[]): boolean {
  return segments.length === 1;
}

/**
 * Segment, po którym szukamy starego adresu wpisu. Slug wpisu jest globalnie
 * unikalny, więc OSTATNI segment wystarcza - również wtedy, gdy rodzic
 * w adresie jest nieaktualny (`/stara-sekcja/<slug>`).
 */
export function legacyLookupSlug(segments: readonly string[]): string {
  return segments.length === 0 ? "" : segments[segments.length - 1];
}

/** Ścieżka kanoniczna zapisana z segmentów - forma porównywalna z wynikiem bazy. */
export function segmentsToPath(segments: readonly string[]): string {
  return segments.join("/");
}

/**
 * FAZA 2a: goły slug wskazujący archiwum taksonomii.
 *
 * Wydzielone, bo loader MUSI móc rozstrzygnąć tę część PRZED zapłaceniem
 * round-tripu za stary adres wpisu - taksonomia ma pierwszeństwo, więc gdy
 * trafi, zapytanie o wpis jest kosztem bez zysku. Jedna implementacja: pełna
 * decyzja niżej woła tę samą funkcję.
 *
 * Kategoria przed tagiem: goły slug może istnieć w obu, a kolejność jest
 * kontraktem, nie przypadkiem.
 */
export function resolveTaxonomyFallback(
  input: Pick<MissingContentInput, "segments" | "categorySlug" | "tagSlug">,
): TaxonomyRedirect | null {
  if (!needsTaxonomyLookup(input.segments)) return null;
  if (input.categorySlug) {
    return {
      kind: "taxonomy-redirect",
      taxonomy: "category",
      slug: input.categorySlug,
      replace: true,
      reason: "bare-slug-is-taxonomy",
    };
  }
  if (input.tagSlug) {
    return {
      kind: "taxonomy-redirect",
      taxonomy: "tag",
      slug: input.tagSlug,
      replace: true,
      reason: "bare-slug-is-taxonomy",
    };
  }
  return null;
}

/**
 * FAZA 2: decyzja, gdy zapytanie o treść nic nie zwróciło.
 *
 * Kolejność reguł jest kontraktem i odtwarza kolejność z loadera:
 * archiwum taksonomii, potem 301 na adres kanoniczny wpisu, na końcu 404.
 */
export function resolveMissingContent(input: MissingContentInput): MissingContentDecision {
  const { segments } = input;
  const taxonomy = resolveTaxonomyFallback(input);
  if (taxonomy) return taxonomy;
  const canonical = input.legacyPostPath ?? null;
  if (canonical) {
    // PĘTLA ODRZUCONA: ścieżka kanoniczna równa żądanej znaczy, że wpis JUŻ
    // jest pod właściwym adresem, a treści nie ma z innego powodu (wersja
    // robocza, usunięcie, brak dostępu). Przekierowanie tu byłoby
    // przekierowaniem na siebie samego - nieskończona pętla w przeglądarce
    // i u crawlera. 404 jest jedyną poprawną odpowiedzią.
    if (canonical === segmentsToPath(segments)) {
      return { kind: "not-found", reason: "self-redirect" };
    }
    return {
      kind: "canonical-redirect",
      splat: canonical,
      statusCode: 301,
      reason: "legacy-post-path",
    };
  }
  return { kind: "not-found", reason: "unresolvable" };
}
