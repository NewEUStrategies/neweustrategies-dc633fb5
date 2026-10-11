// Reguły wymiarów okładki podcastu (Apple Podcasts Connect) - moduł bez
// zależności, bo czyta go zarówno lekka checklista panelu
// (`podcastFeedReadiness`), jak i pełna reguła Apple (`applePodcast.ts`).

/** Apple wymaga kwadratu od 1400x1400 do 3000x3000 px. */
export const APPLE_IMAGE_MIN_PX = 1400;
export const APPLE_IMAGE_MAX_PX = 3000;

export type PodcastArtworkCheck =
  | { state: "ok"; width: number; height: number }
  | { state: "notSquare"; width: number; height: number }
  | { state: "tooSmall"; width: number; height: number }
  | { state: "tooLarge"; width: number; height: number };

/**
 * Ocena zmierzonych wymiarów okładki (`naturalWidth`/`naturalHeight`).
 * Kwadrat sprawdzamy ściśle: Apple odrzuca nawet 3000x2999.
 */
export function checkPodcastArtworkDimensions(width: number, height: number): PodcastArtworkCheck {
  if (width !== height) return { state: "notSquare", width, height };
  if (width < APPLE_IMAGE_MIN_PX) return { state: "tooSmall", width, height };
  if (width > APPLE_IMAGE_MAX_PX) return { state: "tooLarge", width, height };
  return { state: "ok", width, height };
}
