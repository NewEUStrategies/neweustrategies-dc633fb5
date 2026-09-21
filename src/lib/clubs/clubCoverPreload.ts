// Hint LCP dla okładki klubu - CZYSTA decyzja "czy i co wstępnie pobrać".
//
// PO CO OSOBNY MODUŁ. Preload obrazu, który NIE zostanie namalowany, jest
// czystą stratą pasma na ścieżce krytycznej, a hint musi powstać w LOADERZE
// UKŁADU `/club/$clubSlug` (tam jest karta klubu i dostęp do nagłówków
// odpowiedzi) - czyli w miejscu, które samo w sobie nie wie nic o tym, co
// rysuje powierzchnia. Reguła musi więc stać w JEDNYM miejscu, obok swojego
// uzasadnienia, bo jej druga kopia rozjedzie się z komponentem przy pierwszej
// zmianie układu.
//
// KIEDY OKŁADKA JEST ELEMENTEM LCP. Dokładnie na HUBIE klubu (`/club/<slug>`),
// gdy czytelnik NIE MA prawa czytać treści: `ClubHubRoute` oddaje wtedy
// `ClubAccessGate`, a ten zaczyna się od `ClubCover variant="banner"`
// (`priority`, więc bez lazy) - pierwszy i największy obraz nad zgięciem.
// Klub otwarty rysuje `ClubHub`, który obrazu nad zgięciem nie ma.
//
// DLACZEGO NIE NA POZOSTAŁYCH POWIERZCHNIACH MODUŁU. Baner rysuje też
// `ClubWorkspaceLayout` (karta klubu zamkniętego) i `ClubMinisite`, ale to są
// ślepe zaułki dla czytelnika bez dostępu: `noindex`, wejścia z linku, a
// minisite dla anonima (czyli dla KAŻDEGO dokumentu SSR - sesja mieszka
// w localStorage) w ogóle nie dochodzi do okładki, bo wcześniej oddaje kartę
// "tylko dla członków". Hint na tych ścieżkach byłby pobraniem pliku, którego
// dokument serwera albo nie maluje, albo nie warto pod niego kolejkować pasma.
//
// PARYTET Z KOMPONENTEM jest warunkiem poprawności, nie ozdobą: `ClubCover`
// renderuje `OptimizedImage responsive`, czyli `srcSet` z `buildImageSrcSet`
// i `sizes` wariantu `banner`. Preload z INNYM zestawem kandydatów każe
// przeglądarce pobrać plik, którego `<img>` i tak nie wybierze - czyli
// podwaja transfer zamiast go przyspieszać.
import { buildImageSrcSet } from "@/lib/cropSizes";
import { stripLangPrefix } from "@/lib/http/documentCache";
import type { ImagePreloadInput } from "@/lib/seo/meta";

/** `sizes` wariantu `banner` z `components/clubs/atoms/ClubCover.tsx`. */
export const CLUB_COVER_BANNER_SIZES = "(min-width: 1024px) 64rem, 100vw";

/** Minimum karty klubu, od którego zależy ta decyzja. */
export interface ClubCoverSource {
  can_read: boolean;
  cover_image_url: string | null;
}

/**
 * Czy to hub klubu (`/club/<slug>`), a nie powierzchnia pod nim. Liczona
 * z SEGMENTÓW, nie z porównania do sklejonego adresu: `clubSlug` z parametrów
 * trasy jest odkodowany, a ścieżka żądania nie musi być.
 */
export function isClubHubPath(pathname: string): boolean {
  const segments = stripLangPrefix(pathname).split("/").filter(Boolean);
  return segments.length === 2 && segments[0] === "club";
}

/**
 * Deskryptor preloadu okładki albo `null`, gdy okładki nikt nie namaluje
 * (inna powierzchnia niż hub, brak karty, brak pliku, albo klub, którego
 * treść czytelnik i tak widzi).
 */
export function clubCoverPreload(
  club: ClubCoverSource | null,
  pathname: string,
): ImagePreloadInput | null {
  if (!isClubHubPath(pathname)) return null;
  if (!club || club.can_read) return null;
  const href = club.cover_image_url?.trim() ?? "";
  if (href === "") return null;
  // `buildImageSrcSet` oddaje "" dla adresu spoza Supabase Storage - wtedy
  // `<img>` też nie dostaje `srcSet`, więc preload samego `href` JEST parytetem.
  const imageSrcSet = buildImageSrcSet(href);
  return imageSrcSet === "" ? { href } : { href, imageSrcSet, imageSizes: CLUB_COVER_BANNER_SIZES };
}
