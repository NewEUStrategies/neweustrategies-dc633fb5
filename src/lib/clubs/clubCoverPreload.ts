// Hint LCP dla okładki klubu - CZYSTA decyzja "czy i co wstępnie pobrać".
//
// PO CO OSOBNY MODUŁ. Preload obrazu, który NIE zostanie namalowany, jest
// czystą stratą pasma na ścieżce krytycznej - a okładka klubu maluje się
// dokładnie w jednym przypadku: gdy czytelnik NIE MA prawa czytać treści
// i dostaje wizytówkę klubu (`ClubAccessGate`, oraz karta zamknięta
// w `ClubWorkspaceLayout`). Hub klubu otwartego nie ma obrazu nad zgięciem.
// Ta reguła musi stać W JEDNYM miejscu, bo jej druga kopia rozjedzie się
// z komponentem przy pierwszej zmianie układu.
//
// PARYTET Z KOMPONENTEM jest warunkiem poprawności, nie ozdobą: `ClubCover`
// renderuje `OptimizedImage responsive`, czyli `srcSet` z `buildImageSrcSet`
// i `sizes` wariantu `banner`. Preload z INNYM zestawem kandydatów każe
// przeglądarce pobrać plik, którego `<img>` i tak nie wybierze - czyli
// podwaja transfer zamiast go przyspieszać.
import { buildImageSrcSet } from "@/lib/cropSizes";
import type { ImagePreloadInput } from "@/lib/seo/meta";

/** `sizes` wariantu `banner` z `components/clubs/atoms/ClubCover.tsx`. */
export const CLUB_COVER_BANNER_SIZES = "(min-width: 1024px) 64rem, 100vw";

/** Minimum karty klubu, od którego zależy ta decyzja. */
export interface ClubCoverSource {
  can_read: boolean;
  cover_image_url: string | null;
}

/**
 * Deskryptor preloadu okładki albo `null`, gdy okładki nikt nie namaluje
 * (brak karty, brak pliku, albo klub, którego treść czytelnik i tak widzi).
 */
export function clubCoverPreload(club: ClubCoverSource | null): ImagePreloadInput | null {
  if (!club || club.can_read) return null;
  const href = club.cover_image_url?.trim() ?? "";
  if (href === "") return null;
  // `buildImageSrcSet` oddaje "" dla adresu spoza Supabase Storage - wtedy
  // `<img>` też nie dostaje `srcSet`, więc preload samego `href` JEST parytetem.
  const imageSrcSet = buildImageSrcSet(href);
  return imageSrcSet === ""
    ? { href }
    : { href, imageSrcSet, imageSizes: CLUB_COVER_BANNER_SIZES };
}
