// Czysty model widgetu "cover-overlay-card" (karta z okładką i nakładką).
//
// Poza komponentami, żeby renderer, molekuła UI i testy miały jedno źródło
// prawdy, a formatowanie daty dało się sprawdzić bez DOM.
//
// Wzorzec (wklejony HTML) miał datę zapisaną DWA razy: `datetime="2022-10-10"`
// dla maszyn i „10th Oct 2022" dla człowieka. Redakcja nie ma prawa wpisywać
// tego dwa razy i rozjeżdżać obu zapisów, więc panel przyjmuje JEDNĄ datę ISO,
// a napis dla człowieka powstaje tutaj - w języku widoku, nie treści.

/** Wartości domyślne prezentacji - te same liczby siedzą w `WIDGET_SCHEMAS`. */
export const COVER_OVERLAY_CARD_DEFAULTS = {
  /** `from-gray-900/50` ze wzorca (dół gradientu). */
  overlayAlphaBottom: 0.5,
  /** `to-gray-900/25` ze wzorca (góra gradientu). */
  overlayAlphaTop: 0.25,
  /** `pt-32 sm:pt-48 lg:pt-64` -> jedna, sterowalna wysokość kadru. */
  mediaMinHeight: 256,
  /** Platformowe 6 px zamiast `rounded-lg` - patrz komentarz molekuły. */
  radius: 6,
  /** 0 = pełna szerokość kolumny. */
  maxWidth: 0,
  /** `line-clamp-3` ze wzorca. */
  clampLines: 3,
} as const;

/** Kolor nakładki, gdy panel nie narzucił własnego (`gray-900` wzorca). */
export const COVER_OVERLAY_DEFAULT_COLOR = "#111827";

const LOCALE: Record<"pl" | "en", string> = { pl: "pl-PL", en: "en-GB" };

/**
 * Data ISO (`RRRR-MM-DD`) sprowadzona do atrybutu `datetime`.
 * Zwraca pusty napis dla wartości, której przeglądarka i tak by nie zrozumiała
 * - element `<time>` bez poprawnego `datetime` jest gorszy niż zwykły tekst.
 */
export function coverCardDateAttr(raw: string): string {
  const value = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  return Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? "" : value;
}

/**
 * Napis daty dla człowieka w języku WIDOKU: „10 października 2022" / „10 Oct
 * 2022". Strefa jest przypięta do UTC, bo data dzienna nie ma prawa przeskoczyć
 * o dobę w zależności od tego, gdzie stoi serwer renderujący SSR.
 */
export function formatCoverCardDate(raw: string, lang: "pl" | "en"): string {
  const value = coverCardDateAttr(raw);
  if (!value) return raw.trim();
  const date = new Date(`${value}T00:00:00Z`);
  return new Intl.DateTimeFormat(LOCALE[lang], {
    day: "numeric",
    month: lang === "pl" ? "long" : "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}
