import { supabase } from "@/integrations/supabase/client";

export const REFUND_JOB_STATES = [
  "pending",
  "processing",
  "submitted",
  "completed",
  "failed",
  "cancelled",
  "needs_review",
] as const;
export type RefundJobState = (typeof REFUND_JOB_STATES)[number];

/**
 * Dlaczego zlecenie czeka na człowieka - każda wartość CHECK-a
 * `event_refund_jobs_review_reason_check` (20261012120000) ma etykietę
 * i wskazówkę w słowniku `adminEventRegistration.refundJournal.reasons`.
 */
export const REFUND_REVIEW_REASONS = [
  "active_registrations_share_payment",
  "attempts_exhausted",
  "provider_refund_failed",
  "refund_unconfirmed",
] as const;
export type RefundReviewReason = (typeof REFUND_REVIEW_REASONS)[number];

/**
 * Budżet prób zlecenia zwrotu - LUSTRO `public._event_refund_attempt_budget()`.
 * Porażka numer budżet przenosi zlecenie do `needs_review` z alarmem dla
 * administratorów. Panel podaje tę liczbę w podpowiedzi, więc rozjazd z bazą
 * byłby obietnicą prób, których nie będzie - pilnuje tego test parzystości.
 */
export const REFUND_ATTEMPT_BUDGET = 10;

/**
 * Po ilu dniach zlecenie przyjęte przez operatora, ale niepotwierdzone,
 * eskaluje jako `refund_unconfirmed` - LUSTRO
 * `public._event_refund_unconfirmed_days()` (ten sam test parzystości).
 */
export const REFUND_UNCONFIRMED_DAYS = 7;

export interface RefundJournalRow {
  id: string;
  payment_order_id: string;
  person_name: string;
  state: RefundJobState;
  attempts: number;
  last_error: string | null;
  /** Powód przeglądu; `null` poza `needs_review` (albo przed eskalacją). */
  review_reason: RefundReviewReason | null;
  /** Kiedy administratorzy dostali alarm o tym zleceniu; `null` = nigdy. */
  escalated_at: string | null;
  next_attempt_at: string;
  created_at: string;
}

/** Pole opcjonalne kontraktu: brak klucza (starsze RPC) czytamy jak `null`. */
function optionalText(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  return typeof value === "string" ? value : undefined;
}

export async function fetchRegistrationRefundJournal(eventId: string): Promise<RefundJournalRow[]> {
  const { data, error } = await supabase.rpc("admin_event_refund_jobs", { p_event_id: eventId });
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error("invalid_refund_journal");
  return data.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("invalid_refund_journal");
    const {
      id,
      payment_order_id,
      person_name,
      state,
      attempts,
      last_error,
      next_attempt_at,
      created_at,
    } = value;
    const reviewReason = optionalText(value.review_reason);
    const escalatedAt = optionalText(value.escalated_at);
    if (
      typeof id !== "string" ||
      typeof payment_order_id !== "string" ||
      typeof person_name !== "string" ||
      typeof state !== "string" ||
      !REFUND_JOB_STATES.some((known) => known === state) ||
      typeof attempts !== "number" ||
      !Number.isInteger(attempts) ||
      attempts < 0 ||
      (last_error !== null && typeof last_error !== "string") ||
      // Nieznany powód to ten sam błąd co nieznany stan: panel nie zgaduje
      // etykiety, tylko mówi, że odczyt się nie udał.
      reviewReason === undefined ||
      (reviewReason !== null && !REFUND_REVIEW_REASONS.some((known) => known === reviewReason)) ||
      escalatedAt === undefined ||
      typeof next_attempt_at !== "string" ||
      typeof created_at !== "string"
    )
      throw new Error("invalid_refund_journal");
    return {
      id,
      payment_order_id,
      person_name,
      state: state as RefundJobState,
      attempts,
      last_error,
      review_reason: reviewReason as RefundReviewReason | null,
      escalated_at: escalatedAt,
      next_attempt_at,
      created_at,
    };
  });
}
