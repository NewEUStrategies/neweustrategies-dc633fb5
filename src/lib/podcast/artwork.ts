// Okładka podcastu w kanałach RSS - ZAWSZE kwadrat w widełkach Apple.
//
// Apple Podcasts (i za nim Spotify, Pocket Casts, YouTube Music) przyjmuje
// wyłącznie kwadrat 1400..3000 px w JPEG/PNG. Do 2026-10-11 kanał bez
// ustawionej okładki dostawał `og-default.jpg` (baner 1024x640), a okładka
// programu szła do `<itunes:image>` bez żadnej kontroli proporcji - stąd
// "niekwadratowa okładka podcastu" w audycie.
//
// Plik z biblioteki mediów (magazyn albo markowe `/media/...`) przepuszczamy
// przez transformację obrazu: kadr `cover` 1400x1400 ze środka, w formacie
// oryginału (`format=origin` - bez negocjacji WebP, którego Apple nie czyta).
// Adres zewnętrzny zostaje bez zmian - tam proporcje pilnuje panel (pomiar
// wymiarów w `PodcastArtworkField` + reguła `applePodcastGaps`).
import { buildTransformedImageUrl, isSupabaseStorageUrl } from "@/lib/cropSizes";
import { APPLE_IMAGE_MIN_PX } from "@/lib/podcast/artworkRules";

/**
 * Bok kwadratu w feedzie. Minimum Apple - i wyraźnie poniżej limitu boku
 * transformacji magazynu (2500 px), więc wariant zawsze się wyrenderuje.
 */
export const PODCAST_FEED_ARTWORK_SIDE = APPLE_IMAGE_MIN_PX;

const RENDER_MARKER = "/storage/v1/render/image/public/";

/**
 * Czy feed poda ten adres przez kwadratową transformację (obraz z biblioteki
 * mediów). SVG nie jest dopuszczalną okładką i nie przechodzi transformacji;
 * adres już przetworzony ma własne parametry, których nie nadpisujemy po omacku.
 */
export function isFeedArtworkSquared(raw: string | null | undefined): boolean {
  const src = raw?.trim();
  if (!src) return false;
  if (/\.svg(?:[?#]|$)/i.test(src) || src.includes(RENDER_MARKER)) return false;
  return isSupabaseStorageUrl(src);
}

/**
 * Wymiary okładki, którą feed NAPRAWDĘ poda - to je ocenia karta gotowości.
 * Obraz z biblioteki idzie przez kadr `cover` 1400x1400, więc niekwadratowy
 * oryginał o krótszym boku >= 1400 px daje poprawną okładkę. Transformacja nie
 * powiększa obrazu: krótszy bok poniżej 1400 px zostaje za mały i tak go
 * zgłaszamy. Adres spoza biblioteki idzie do feedu bez zmian - liczy się
 * oryginał.
 */
export function servedFeedArtworkSize(
  raw: string | null | undefined,
  measured: { width: number; height: number } | null,
): { width: number; height: number } | null {
  if (!measured) return null;
  if (!isFeedArtworkSquared(raw)) return measured;
  const side = Math.min(measured.width, measured.height, PODCAST_FEED_ARTWORK_SIDE);
  return { width: side, height: side };
}

/** Absolutny adres kwadratowej okładki do `<itunes:image>` albo `null`. */
export function podcastFeedArtworkUrl(raw: string | null | undefined): string | null {
  const src = raw?.trim();
  if (!src) return null;
  if (!isFeedArtworkSquared(src)) return src;
  const transformed = buildTransformedImageUrl(src, {
    width: PODCAST_FEED_ARTWORK_SIDE,
    height: PODCAST_FEED_ARTWORK_SIDE,
    resize: "cover",
  });
  try {
    const url = new URL(transformed);
    url.searchParams.set("format", "origin");
    return url.toString();
  } catch {
    // Adres względny (`/media/...`) - feed i tak wymaga absolutnego, a
    // dopisywanie originu to rola trasy; zostawiamy wariant bez zmian.
    return transformed;
  }
}
