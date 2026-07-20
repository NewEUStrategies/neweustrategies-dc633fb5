// Wspólna preferencja prędkości odtwarzania dla WSZYSTKICH odtwarzaczy audio
// (globalny player TTS artykułów + PodcastPlayer). Czytelnik ustawia tempo raz
// i obowiązuje wszędzie - jak w aplikacjach podcastowych. Trwałość:
// localStorage (per przeglądarka), z ochroną SSR/trybu prywatnego.
//
// UWAGA hydratacja: komponenty renderowane w SSR muszą inicjalizować stan na
// DEFAULT_PLAYBACK_RATE i dopiero w efekcie po montażu czytać wartość zapisaną
// (readStoredPlaybackRate zwraca default na serwerze, a rozjazd initializera
// między serwerem i klientem = niezgodność hydratacji np. na <select value>).

export const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;
export type PlaybackRate = (typeof PLAYBACK_RATES)[number];

export const DEFAULT_PLAYBACK_RATE: PlaybackRate = 1;

const STORAGE_KEY = "audio-rate";

/** Najbliższa dozwolona wartość - obce/legacy zapisy nie rozstroją playera. */
export function clampPlaybackRate(value: number): PlaybackRate {
  if (!Number.isFinite(value)) return DEFAULT_PLAYBACK_RATE;
  let best: PlaybackRate = DEFAULT_PLAYBACK_RATE;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const rate of PLAYBACK_RATES) {
    const dist = Math.abs(rate - value);
    if (dist < bestDist) {
      best = rate;
      bestDist = dist;
    }
  }
  return best;
}

export function readStoredPlaybackRate(): PlaybackRate {
  if (typeof window === "undefined") return DEFAULT_PLAYBACK_RATE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PLAYBACK_RATE;
    return clampPlaybackRate(Number(raw));
  } catch {
    return DEFAULT_PLAYBACK_RATE;
  }
}

export function writeStoredPlaybackRate(rate: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(clampPlaybackRate(rate)));
  } catch {
    /* private mode / quota - ignorujemy */
  }
}

/** Kolejna wartość w cyklu (2x zawija do 0.75x) - dla przycisku-cyklu. */
export function nextPlaybackRate(current: number): PlaybackRate {
  const idx = PLAYBACK_RATES.indexOf(clampPlaybackRate(current));
  return PLAYBACK_RATES[(idx + 1) % PLAYBACK_RATES.length];
}

/** "1×", "1.25×", "0.75×" - bez ogonków zer, ze znakiem mnożenia. */
export function formatPlaybackRate(rate: number): string {
  const r = clampPlaybackRate(rate);
  return `${String(r)}×`;
}
