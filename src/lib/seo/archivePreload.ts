// Preload LCP dla tras archiwów (kategoria / tag / blog / strona główna w
// trybie "najnowsze wpisy"): pierwszą malowaną okładką jest karta wyróżniona
// (gdy włączona) albo pierwsza karta siatki - obie renderuje PostListCard,
// więc para srcSet/sizes pochodzi z tych samych modułów co render
// (lib/cardImageSizes + buildImageSrcSet) i preload nigdy nie pobiera innego
// wariantu niż malowany. Czysty moduł - testowalny bez frameworka.
import type { ImagePreloadInput } from "@/lib/seo/meta";
import { buildImageSrcSet } from "@/lib/cropSizes";
import { CARD_IMAGE_SIZES, FEATURED_CARD_IMAGE_SIZES } from "@/lib/cardImageSizes";

interface ArchiveFirstPost {
  cover_image_url: string | null;
}

/**
 * Deskryptor preloadu pierwszej okładki archiwum albo null (brak wpisów /
 * brak okładki). `featuredTop` = archiwum renderuje kartę wyróżnioną na górze
 * (settings.show_featured_top) - wtedy obowiązują `sizes` szerokiej karty.
 */
export function archiveFirstCardPreload(
  posts: readonly ArchiveFirstPost[] | null | undefined,
  featuredTop: boolean,
): ImagePreloadInput | null {
  const cover = posts?.[0]?.cover_image_url;
  if (!cover) return null;
  return {
    href: cover,
    imageSrcSet: buildImageSrcSet(cover),
    imageSizes: featuredTop ? FEATURED_CARD_IMAGE_SIZES : CARD_IMAGE_SIZES,
  };
}
