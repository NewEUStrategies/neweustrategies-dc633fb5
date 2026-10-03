// Publiczne media są prezentowane pod domeną marki. Techniczny host magazynu
// pozostaje wyłącznie szczegółem transportowym i nie trafia do pól w panelu.
//
// DOMENA JEST KONFIGURACJĄ WDROŻENIA, NIE STAŁĄ (wydanie 12). Wcześniej
// origin był zaszyty w kodzie, a `brandedMediaUrl` stemplował go w każdym
// nowym `media.public_url` i adresie ikony - dla WSZYSTKICH najemców. Teraz:
//   * `VITE_PUBLIC_MEDIA_ORIGIN` - origin kanoniczny, którym stemplujemy nowe
//     adresy (domyślnie domena NES, więc wdrożenie bez zmiennej działa jak
//     dotąd),
//   * `VITE_PUBLIC_MEDIA_ORIGINS` - dodatkowe originy (lista po przecinku,
//     np. domeny najemców), pod którymi adres `/media/...` uznajemy za NASZ.
// Domena domyślna zostaje rozpoznawana zawsze: wiersze zapisane przed zmianą
// konfiguracji niosą właśnie ją, a bez rozpoznania straciłyby warianty
// rozmiarowe (`cropSizes`) i nie dałyby się przemarkować przy kolejnym zapisie
// (`brandedMediaUrl` przepisuje rozpoznany origin na kanoniczny).

/** Domena marki używana, gdy wdrożenie nie poda własnej. */
export const DEFAULT_PUBLIC_MEDIA_ORIGIN = "https://neweuropeanstrategies.com";

/**
 * Origin z konfiguracji albo `null`, gdy wartość nie jest czystym originem:
 * wymagany `https:` (wyjątek: `http:` dla localhost), bez ścieżki, zapytania,
 * fragmentu i danych logowania. Literówka w zmiennej środowiskowej nie może po
 * cichu wstemplować w bazę adresów pod obcym albo niepełnym hostem.
 */
export function parseMediaOrigin(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().replace(/\/+$/, "");
  if (!value) return null;
  try {
    const url = new URL(value);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return null;
    if (url.username || url.password || url.search || url.hash) return null;
    if (url.pathname !== "/" && url.pathname !== "") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Origin kanoniczny: poprawna wartość z konfiguracji albo domena domyślna. */
export function resolvePublicMediaOrigin(raw: unknown): string {
  return parseMediaOrigin(raw) ?? DEFAULT_PUBLIC_MEDIA_ORIGIN;
}

/**
 * Originy rozpoznawane jako markowe: kanoniczny, domyślny (dane historyczne)
 * i poprawne pozycje listy dodatkowej. Niepoprawne pozycje są pomijane.
 */
export function resolveRecognizedMediaOrigins(
  canonical: string,
  extraRaw: unknown,
): readonly string[] {
  const extra =
    typeof extraRaw === "string"
      ? extraRaw.split(",").flatMap((entry) => {
          const origin = parseMediaOrigin(entry);
          return origin ? [origin] : [];
        })
      : [];
  return Array.from(new Set([canonical, DEFAULT_PUBLIC_MEDIA_ORIGIN, ...extra]));
}

export const PUBLIC_MEDIA_ORIGIN = resolvePublicMediaOrigin(
  import.meta.env.VITE_PUBLIC_MEDIA_ORIGIN,
);

export const RECOGNIZED_MEDIA_ORIGINS = resolveRecognizedMediaOrigins(
  PUBLIC_MEDIA_ORIGIN,
  import.meta.env.VITE_PUBLIC_MEDIA_ORIGINS,
);

/** Czy adres `/media/...` pod tym originem obsługuje nasza trasa `/media/$`. */
export function isBrandedMediaOrigin(origin: string): boolean {
  return RECOGNIZED_MEDIA_ORIGINS.includes(origin);
}

const STORAGE_MARKER = "/storage/v1/object/public/media/";
const BRANDED_MARKER = "/media/";

function safeMediaPath(value: string): string | null {
  const path = value
    .split("/")
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join("/")
    .replace(/^\/+/, "");

  if (!path || path.length > 1024 || path.includes("\\") || path.split("/").includes("..")) {
    return null;
  }
  return path;
}

export function mediaStoragePath(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  // URL normalizuje segmenty `..` zanim odczytamy pathname, dlatego blokujemy
  // je na surowym wejściu, również po jednokrotnym dekodowaniu.
  const decodedInput = (() => {
    try {
      return decodeURIComponent(trimmed);
    } catch {
      return trimmed;
    }
  })();
  if (decodedInput.split(/[\\/]/).includes("..")) return null;

  try {
    const url = new URL(trimmed, PUBLIC_MEDIA_ORIGIN);
    const marker = url.pathname.includes(STORAGE_MARKER)
      ? STORAGE_MARKER
      : isBrandedMediaOrigin(url.origin) && url.pathname.startsWith(BRANDED_MARKER)
        ? BRANDED_MARKER
        : null;
    if (!marker) return null;
    return safeMediaPath(url.pathname.slice(url.pathname.indexOf(marker) + marker.length));
  } catch {
    return null;
  }
}

export function brandedMediaUrl(value: string): string {
  const path = mediaStoragePath(value);
  if (!path) return value;
  return `${PUBLIC_MEDIA_ORIGIN}/media/${path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
}

/**
 * Adres używany wyłącznie do renderowania pliku w aplikacji. Ścieżka
 * względna utrzymuje żądanie w bieżącym środowisku, więc świeżo dodane media
 * działają w podglądzie jeszcze przed publikacją nowej trasy `/media/*`.
 * W polach i schowku nadal prezentujemy pełny, markowy adres.
 */
export function mediaRenderUrl(value: string): string {
  const path = mediaStoragePath(value);
  if (!path) return value;
  return `/media/${path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
}
