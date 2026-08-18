// Cache blob URL-i narracji na sesję: ten sam artykuł => ten sam blob, bez
// ponownej (PŁATNEJ) syntezy TTS i bez drugiego pobrania MP3.
//
// DLACZEGO OSOBNY MODUŁ: eksmisja i zwalnianie URL-i były prywatne w
// `global-player.tsx`. Błąd tutaj nie daje widocznej awarii od razu - daje
// WYCIEK PAMIĘCI w długiej sesji czytania (każdy niezwolniony blob trzyma
// całe MP3) albo, w drugą stronę, zwolnienie blobu, który jest właśnie
// odtwarzany, czyli urwane audio w połowie artykułu.

/** Górny limit trzymanych blobów - zapora przed nieograniczonym wzrostem pamięci. */
export const MAX_CACHED_BLOBS = 12;

export function cacheKey(postId: string, lang: "pl" | "en"): string {
  return `${postId}:${lang}`;
}

/**
 * Cache blob URL na sesję. `Map` zachowuje kolejność wstawiania, więc
 * „najstarszy wpis" to po prostu pierwszy klucz iteracji.
 */
const audioBlobCache = new Map<string, string>();

export function getCachedBlob(key: string): string | undefined {
  return audioBlobCache.get(key);
}

export function cachedBlobCount(): number {
  return audioBlobCache.size;
}

/**
 * Zwalnianie URL-a. Wstrzykiwalne, żeby test mógł policzyć KTÓRE blob URL-e
 * zostały zwolnione - `URL.revokeObjectURL` nie zostawia po sobie żadnego
 * obserwowalnego śladu, a to właśnie ono decyduje o wycieku pamięci.
 */
let revoke: (url: string) => void = (url) => {
  if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
    URL.revokeObjectURL(url);
  }
};

/** Test hook: podmienia funkcję zwalniania i zwraca poprzednią. */
export function setBlobRevoker(next: (url: string) => void): (url: string) => void {
  const previous = revoke;
  revoke = next;
  return previous;
}

/** Test hook: czyści cache BEZ zwalniania (stan między przypadkami testowymi). */
export function resetBlobCache(): void {
  audioBlobCache.clear();
}

/**
 * Zapisuje blob URL do cache, zwalniając stary URL gdy dany klucz jest
 * nadpisywany oraz gdy najstarsze wpisy są eksmitowane po przekroczeniu
 * `MAX_CACHED_BLOBS`.
 *
 * `keepUrl` chroni AKTUALNIE ODTWARZANY blob przed zwolnieniem, gdyby akurat
 * miał zostać eksmitowany - bez tego długa sesja czytania urywałaby audio
 * w połowie artykułu, do którego czytelnik właśnie wrócił.
 */
export function setCachedBlob(key: string, url: string, keepUrl?: string | null): void {
  const previous = audioBlobCache.get(key);
  if (previous && previous !== url) {
    revoke(previous);
  }
  audioBlobCache.set(key, url);
  while (audioBlobCache.size > MAX_CACHED_BLOBS) {
    const oldestKey = audioBlobCache.keys().next().value;
    if (oldestKey === undefined || oldestKey === key) break;
    const oldestUrl = audioBlobCache.get(oldestKey);
    audioBlobCache.delete(oldestKey);
    if (oldestUrl && oldestUrl !== url && oldestUrl !== keepUrl) {
      revoke(oldestUrl);
    }
  }
}

/**
 * Nazwa pliku dla pobranego MP3. Transliteruje diakrytyki, wycina wszystko poza
 * bezpiecznym alfabetem i przycina do 80 znaków; puste wejście degraduje do
 * `artykul`, żeby pobranie nigdy nie dało pliku o nazwie `.mp3`.
 */
export function sanitizeFilename(input: string): string {
  return (
    input
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9-_ ]/gi, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 80) || "artykul"
  );
}
