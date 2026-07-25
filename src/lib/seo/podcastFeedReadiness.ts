// Gotowość kanału podcastowego do zgłoszenia w Apple Podcasts Connect.
//
// Osobny modu od `podcastRss.ts` celowo: liczy to samo, co emituje builder, ale
// jest wołany z PANELU (klient), a builder XML jest potrzebny wyłącznie na
// serwerze. Bez tego rozdziału `/admin/podcasts` wciągał do bundla cały
// generator RSS razem z taksonomią kategorii.
//
// Braki, które Apple traktuje jako blokujące, wychodziły dotąd dopiero w ich
// walidatorze - po zgłoszeniu i bez wskazania, czego brakuje.

/**
 * Podsumowanie odcinków potrzebne do oceny gotowości kanału - panel liczy je z
 * lekkiego zapytania, feed z pełnych elementów.
 */
export interface PodcastEpisodesSummary {
  total: number;
  /** Odcinki bez znanego rozmiaru pliku (enclosure length="0"). */
  withoutByteLength: number;
  /** Odcinki bez czasu trwania. */
  withoutDuration: number;
}

export function summarizeEpisodes(
  items: readonly { audioBytes?: number | null; durationSeconds: number }[],
): PodcastEpisodesSummary {
  return {
    total: items.length,
    withoutByteLength: items.filter((i) => !(i.audioBytes != null && i.audioBytes > 0)).length,
    withoutDuration: items.filter((i) => i.durationSeconds <= 0).length,
  };
}

export interface PodcastFeedReadinessInput {
  title: string;
  description: string;
  language: string;
  imageUrl?: string | null;
  author?: string | null;
  ownerName?: string | null;
  ownerEmail?: string | null;
  copyright?: string | null;
  episodes: PodcastEpisodesSummary;
}

/**
 * Braki, które blokują lub osłabiają zgłoszenie kanału. Zwracamy kody (nie
 * teksty), żeby panel przetłumaczył je PL/EN.
 *
 * `blocking` = Apple odrzuci kanał albo nie da się potwierdzić własności.
 * `warnings` = kanał przejdzie, ale wpis w katalogu będzie ubogi.
 */
export interface PodcastFeedReadiness {
  ready: boolean;
  blocking: readonly string[];
  warnings: readonly string[];
}

/**
 * Kategoria i `explicit` NIE są tu sprawdzane: builder ma dla nich wartości
 * domyślne, więc feed nigdy nie wychodzi bez tych tagów.
 */
export function podcastFeedReadiness(input: PodcastFeedReadinessInput): PodcastFeedReadiness {
  const blocking: string[] = [];
  const warnings: string[] = [];

  if (!input.title.trim()) blocking.push("title");
  if (!input.description.trim()) blocking.push("description");
  if (!input.language.trim()) blocking.push("language");
  // Okładka: Apple wymaga kwadratu 1400..3000 px JPEG/PNG. Rozmiaru nie
  // sprawdzimy po URL-u, ale brak adresu jest sprawdzalny i blokujący.
  if (!input.imageUrl?.trim()) blocking.push("image");
  // Bez e-maila właściciela Apple nie ma gdzie wysłać kodu weryfikacyjnego.
  if (!input.ownerEmail?.trim()) blocking.push("ownerEmail");
  if (input.episodes.total === 0) blocking.push("episodes");

  if (!input.author?.trim()) warnings.push("author");
  if (!input.ownerName?.trim()) warnings.push("ownerName");
  if (!input.copyright?.trim()) warnings.push("copyright");
  // length="0" przechodzi u większości agregatorów, ale walidator Apple
  // oznacza to jako problem - a my znamy rozmiar dla plików z biblioteki.
  if (input.episodes.withoutByteLength > 0) warnings.push("enclosureLength");
  if (input.episodes.withoutDuration > 0) warnings.push("duration");

  return { ready: blocking.length === 0, blocking, warnings };
}
