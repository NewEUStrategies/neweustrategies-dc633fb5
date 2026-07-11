// Maleńka, bezzależnościowa szyna zdarzeń na poziomie modułu, która arbitruje
// pojedyncze odtwarzanie audio na całej stronie. Współdzielą ją wszystkie
// odtwarzacze: wiele instancji `PodcastPlayer` (np. w siatce) oraz globalny
// player TTS. Gdy dowolny player rusza, rozgłasza swój unikalny identyfikator,
// a każdy inny subskrybent pauzuje - dzięki temu w danym momencie gra tylko
// jeden element <audio>.

/** Nasłuchiwacz powiadomień "ktoś zaczął grać". Dostaje id aktywnego playera. */
type PlaybackListener = (activeId: string) => void;

const listeners = new Set<PlaybackListener>();

/**
 * Subskrybuje powiadomienia o starcie odtwarzania w innym playerze.
 * Zwraca funkcję odsubskrybowania (wołaj przy unmount).
 */
export function subscribePlayback(listener: PlaybackListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Ogłasza, że player o danym `id` właśnie ruszył - wszyscy inni subskrybenci
 * powinni się zatrzymać. Player o tym samym `id` ignoruje własne ogłoszenie.
 */
export function announcePlayback(id: string): void {
  for (const listener of listeners) listener(id);
}
