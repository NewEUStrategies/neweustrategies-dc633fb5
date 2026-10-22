// Etykieta powodu rezygnacji z `retention_feedback.reason_label` - JEDNA reguła
// dla huba (`ChurnReasonsCard`) i modułu Cennika (`RetentionFeedbackList`,
// `RetentionStatsCards`) - Z-S2-04, Z-S2-11, Z-S7-08.
//
// Trzy rodzaje zapisu w tej samej kolumnie:
//   * `not_given` - „Anuluj mimo to" przed wyborem powodu (Z-09). To NIE jest
//     powód: nie wchodzi do rankingu i ma własne słowo zamiast surowego klucza;
//   * `stripe:<kod>` - ankieta portalu klienta Stripe (Z-S2-11), pokazywana
//     jako „Portal Stripe: <kod>", żeby admin wiedział, skąd odpowiedź;
//   * reszta - treść powodu z dialogu serwisu (zamrożona przy zapisie).
//
// CZYSTY LIŚĆ bez importów: czyta go chunk Cennika i chunk huba.

/** Odpowiedź „Anuluj mimo to" przed wyborem powodu (lustro `RETENTION_REASON_NOT_GIVEN`). */
export const NOT_GIVEN_REASON = "not_given";
/** Prefiks odpowiedzi z ankiety portalu Stripe (`stripe:<kod>`). */
export const STRIPE_REASON_PREFIX = "stripe:";

export type ReasonLabel =
  | { kind: "not_given" }
  | { kind: "stripe"; code: string }
  | { kind: "text"; text: string };

export function retentionReasonLabel(reasonLabel: string): ReasonLabel {
  if (reasonLabel === NOT_GIVEN_REASON) return { kind: "not_given" };
  if (reasonLabel.startsWith(STRIPE_REASON_PREFIX)) {
    const code = reasonLabel.slice(STRIPE_REASON_PREFIX.length).trim();
    return { kind: "stripe", code: code === "" ? "-" : code };
  }
  return { kind: "text", text: reasonLabel };
}
