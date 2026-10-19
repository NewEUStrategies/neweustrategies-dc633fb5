// Okno odpowiedzi ankiety anulowania - WSPÓLNE dla zakładki Retencja
// (`/admin/pricing?tab=retention`) i skrótu na pulpicie `/admin/monetization`.
//
// DLACZEGO JEDNA FUNKCJA. Oba ekrany pokazują te same liczby (odpowiedzi,
// przyjęte kontroferty, najczęstsze powody z okna `RETENTION_STATS_WINDOW_DAYS`).
// Gdy każdy składał parametry sam, różny limit albo inna granica okna dawały
// DWA wpisy cache i dwie różne odpowiedzi na to samo pytanie - dokładnie
// rozjazd, który S1 (def. 13) usuwa. Tu granica okna (zaokrąglona do doby,
// więc stała przez cały pobyt na ekranie) i limit są jedne, więc oba ekrany
// trafiają w TEN SAM wpis `retentionFeedbackQueryOptions` i odświeża je ta sama
// reguła szyny (`retention_flow.*` → prefiks `retentionKeys.admin.feedback()`).
import { retentionStatsSinceIso } from "@/lib/admin/retentionStats";
import { retentionFeedbackQueryOptions } from "@/lib/retention/queries";

/**
 * Ile odpowiedzi czytamy z okna. Rezygnacje z ankietą to dziesiątki
 * miesięcznie - limit chroni przed nieograniczonym odczytem, a jego
 * przekroczenie ekran zgłasza (`truncated`), zamiast udawać pełną statystykę.
 */
export const RETENTION_FEEDBACK_LIMIT = 2000;

/** Odpowiedzi z okna statystyk - jeden klucz dla panelu cennika i pulpitu. */
export function retentionFeedbackWindowQueryOptions(now: number = Date.now()) {
  return retentionFeedbackQueryOptions({
    sinceIso: retentionStatsSinceIso(now),
    limit: RETENTION_FEEDBACK_LIMIT,
  });
}
