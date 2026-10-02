// Kontrakt beaconu czasu czytania: przeglądarka -> `/api/public/post-dwell`.
//
// JEDEN PLIK NA OBA KOŃCE (wzorem `events/eventFunnelWire.ts`). Pomiar
// (`postDwell.ts`) wysyła ładunek w granicach z tego pliku, a endpoint waliduje
// go TĄ SAMĄ funkcją - kształt nie rozjedzie się bez czerwonego testu. Baza
// sprawdza wszystko jeszcze raz (`record_post_dwell`, migracja 20261002200000),
// bo endpoint jest publiczny i bez podpisu: tu odrzucamy śmieci tanio.
//
// Plik jest CELOWO bez importów: siedzi w grafie trasy serwerowej, więc nie może
// ciągnąć za sobą modułów przeglądarki (zgoda, transport beaconu).

export const POST_DWELL_ENDPOINT = "/api/public/post-dwell";

/** Krótszego czytania nie zgłaszamy - `record_post_dwell` i tak je odrzuca. */
export const DWELL_MIN_MS = 1_000;

/** Sufit jednego zgłoszenia - ten sam, który trzyma CHECK `post_views_dwell_ms_range`. */
export const DWELL_MAX_MS = 30 * 60_000;

/** Prawdziwy ładunek ma ~110 bajtów; wszystko powyżej to nie nasz beacon. */
export const POST_DWELL_MAX_BODY = 512;

export interface PostDwellPayload {
  postId: string;
  viewerHash: string;
  dwellMs: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Ta sama granica długości co `recordPostView` (16-64) i `record_post_dwell`;
// znaki drukowalne ASCII - token z `viewerHash.ts` jest szesnastkowy albo base36.
const VIEWER_HASH_RE = /^[\x21-\x7e]{16,64}$/;

/** Ładunek beaconu -> zgłoszenie albo `null`, gdy nie ma czego zapisywać. */
export function parsePostDwellBeacon(value: unknown): PostDwellPayload | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const { postId, viewerHash, dwellMs } = value as Record<string, unknown>;
  if (typeof postId !== "string" || !UUID_RE.test(postId)) return null;
  if (typeof viewerHash !== "string" || !VIEWER_HASH_RE.test(viewerHash)) return null;
  if (typeof dwellMs !== "number" || !Number.isInteger(dwellMs)) return null;
  if (dwellMs < DWELL_MIN_MS || dwellMs > DWELL_MAX_MS) return null;
  return { postId: postId.toLowerCase(), viewerHash, dwellMs };
}
