// Link „Chcę dalej otrzymywać" (wygaszanie newslettera, I9d-Y1): adresy
// i stan strony z odpowiedzi endpointu.
//
// Osobny liść BEZ zależności: czyta go publiczna strona `/newsletter/keep`
// (chunk czytelnika - bez zod i stałych retencji) oraz serwer, który buduje
// link w mailu (`newsletterSunset.ts` re-eksportuje oba adresy).

/** Publiczny endpoint linku (GET: walidacja/303, POST: potwierdzenie). */
export const NEWSLETTER_KEEP_API_PATH = "/api/public/newsletter/keep";
/** Strona z przyciskiem, na którą GET z przeglądarki robi 303. */
export const NEWSLETTER_KEEP_PAGE_PATH = "/newsletter/keep";

/** Stan strony `/newsletter/keep`. */
export type KeepPageState =
  | "loading"
  | "confirm"
  | "ok"
  | "already"
  | "inactive"
  | "gone"
  | "expired"
  | "invalid"
  | "rateLimited"
  | "error";

/** Ciało odpowiedzi endpointu (bez danych osoby - patrz trasa API). */
export interface KeepResponseBody {
  ok?: boolean;
  already?: boolean;
  error?: string;
}

/**
 * Odpowiedź endpointu -> stan strony. Kody błędów są kontraktem trasy API
 * (`api.public.newsletter.keep.ts`); nieznany kod = ogólny błąd z ponowieniem.
 */
export function keepStateOf(status: number, body: KeepResponseBody): KeepPageState {
  if (body.ok) return body.already ? "already" : "ok";
  switch (body.error) {
    case "expired":
      return "expired";
    case "invalid_token":
      return "invalid";
    case "inactive":
      return "inactive";
    case "not_found":
      return "gone";
    case "rate_limited":
      return "rateLimited";
    default:
      return status === 429 ? "rateLimited" : "error";
  }
}
