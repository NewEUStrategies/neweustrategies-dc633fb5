// Pamięć pozycji odtwarzania audio artykułu (localStorage).
//
// DLACZEGO OSOBNY MODUŁ: te funkcje były prywatne w 752-linijkowym
// `global-player.tsx`, razem z providerem, elementem `<audio>`, magistralą
// zdarzeń i fetcherem TTS - sprawdzenie ich wymagało zamontowania całego
// odtwarzacza. Reguła „od którego miejsca wznowić" jest jednak czysta i to ona
// decyduje, czy czytelnik wróci tam, gdzie skończył, czy na początek.
//
// Klucz jest per TOŻSAMOŚĆ AUDIO (wpis + język), spójny z kluczem cache blobów.
// To nie kosmetyka: jeden wpis ma dwie różne narracje (PL i EN) o różnej
// długości, więc wspólny klucz przenosiłby pozycję z jednej na drugą.

const POSITION_KEY_PREFIX = "audio-pos:";

/** Poniżej tego progu (s) nie zapisujemy i nie przywracamy - offset jest trywialny. */
export const POSITION_MIN_SECONDS = 5;

/** Odstęp od końca (s), przy którym uznajemy materiał za „prawie skończony". */
export const POSITION_END_MARGIN = 5;

/** Throttle zapisu pozycji (ms). */
export const POSITION_SAVE_INTERVAL = 5000;

export function positionKey(postId: string, lang: "pl" | "en"): string {
  return `${POSITION_KEY_PREFIX}${postId}:${lang}`;
}

/**
 * Odczyt zapisanej pozycji. Zwraca 0 dla wszystkiego, co nie jest dodatnią
 * liczbą skończoną - uszkodzony wpis nie może przestawić odtwarzania na `NaN`
 * (element `<audio>` przyjmuje wtedy `currentTime = NaN` i rzuca).
 */
export function readStoredPosition(key: string): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(key);
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** Zapis pozycji (w pełnych sekundach). Nigdy nie rzuca - tryb prywatny/limit. */
export function writeStoredPosition(key: string, seconds: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, String(Math.floor(seconds)));
  } catch {
    /* private mode / quota - ignorujemy */
  }
}

export function clearStoredPosition(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* noop */
  }
}

/**
 * Czy pozycja `t` w materiale o długości `dur` warta jest zapisania/przywrócenia.
 *
 * Dwa odrzucenia, oba widoczne dla czytelnika:
 *   - offset trywialny (<= 5 s) - wznawianie od 3. sekundy to szum;
 *   - materiał prawie skończony (<= 5 s od końca) - inaczej ponowne odtworzenie
 *     startowałoby od napisów końcowych zamiast od początku.
 * Nieznana długość (`NaN`/0, metadane jeszcze nie wczytane) NIE blokuje zapisu.
 */
export function isRestorablePosition(t: number, dur: number): boolean {
  if (t <= POSITION_MIN_SECONDS) return false;
  if (Number.isFinite(dur) && dur > 0 && t >= dur - POSITION_END_MARGIN) return false;
  return true;
}
