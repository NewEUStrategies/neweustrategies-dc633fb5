// Dziennik zwrotów zgłoszeń wydarzenia (REG-03, decyzja D9).
//
// KAŻDE ZAMKNIĘCIE OPŁACONEGO ZGŁOSZENIA ZOSTAWIA TU WIERSZ: odrzucenie,
// anulowanie przez organizatora, rezygnacja uczestnika i zamknięcie bez
// decyzji (siatka bezpieczeństwa w bazie). `pending` idzie do operatora
// płatności sam, `needs_review` czeka na decyzję organizatora z powodem
// (`review_reason`).
//
// WPŁATA RĘCZNA NIE MA ZAMÓWIENIA. Przelew przyjęty przez organizatora (akcja
// „opłacone") zostawia wiersz z `payment_order_id = null` - parser go przyjmuje,
// a dziennik oferuje dla niego tylko „oznacz jako zwrócone" i „nie zwracaj".
//
// PARSER JEST ŚCISŁY: wiersz, którego nie umiemy przeczytać, to błąd wczytania,
// a nie pusty dziennik - pusty dziennik obiecywałby, że nic nie czeka na zwrot.
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { REFUND_REVIEW_REASONS, type RefundReviewReason } from "@/lib/events/cancellationPreview";

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
  registration_id: string | null;
  /** `null` = wpłata poza operatorem płatności (przelew przyjęty ręcznie). */
  payment_order_id: string | null;
  person_name: string;
  state: RefundJobState;
  origin: RefundJobOrigin;
  review_reason: RefundReviewReason | null;
  amount_cents: number | null;
  currency: string | null;
  refund_deadline_at: string | null;
  /** Notatka organizatora przy decyzji - wewnętrzna, nigdy dla uczestnika. */
  review_note: string | null;
  decided_at: string | null;
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
  if (!Array.isArray(data)) invalid();
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
      typeof person_name !== "string" ||
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
      invalid();
    const reason = optionalText(row.review_reason);
    return {
      id,
      registration_id: optionalText(row.registration_id),
      payment_order_id: optionalText(row.payment_order_id),
      person_name,
      state: oneOf(REFUND_JOB_STATES, row.state),
      // Baza sprzed REG-03 nie zna pochodzenia - wtedy każdy wiersz był
      // odrzuceniem (jedyna droga do dziennika).
      origin:
        row.origin === undefined ? "organizer_rejected" : oneOf(REFUND_JOB_ORIGINS, row.origin),
      review_reason: reason === null ? null : oneOf(REFUND_REVIEW_REASONS, reason),
      amount_cents: optionalCents(row.amount_cents),
      currency: optionalText(row.currency),
      refund_deadline_at: optionalText(row.refund_deadline_at),
      review_note: optionalText(row.review_note),
      decided_at: optionalText(row.decided_at),
      attempts,
      last_error,
      review_reason: reviewReason as RefundReviewReason | null,
      escalated_at: escalatedAt,
      next_attempt_at,
      created_at,
    };
  });
}

/**
 * Decyzje, które dziennik oferuje dla wiersza. Zwrot przez operatora tylko
 * dla zamówienia Stripe; wpłata poza operatorem (bez zamówienia albo inny
 * operator - `manual_payment`) dostaje „oznacz jako zwrócone": zwrot
 * zamówienia Stripe idzie przez operatora, żeby księga i operator się nie
 * rozjechały. Baza i tak odmawia niepasującej decyzji.
 */
export function refundJobDecisions(row: RefundJournalRow): readonly RefundJobDecision[] {
  if (row.state !== "needs_review" && row.state !== "failed") return [];
  return row.payment_order_id === null || row.review_reason === "manual_payment"
    ? ["mark_refunded", "dismiss"]
    : ["refund", "dismiss"];
}

/** Najkrótsza notatka, którą baza przyjmuje przy „nie zwracaj" (`reason_required`). */
export const REFUND_DISMISS_NOTE_MIN_LENGTH = 3;
/** Sufit notatki decyzji - CHECK `event_refund_jobs_review_note_len` / `note_too_long`. */
export const REFUND_NOTE_MAX_LENGTH = 2000;

export async function decideRefundJob(input: {
  jobId: string;
  action: RefundJobDecision;
  note?: string | null;
}): Promise<Json> {
  const payload: Record<string, Json> = { job_id: input.jobId, action: input.action };
  const note = input.note?.trim() ?? "";
  if (note !== "") payload.note = note;
  const { data, error } = await supabase.rpc("admin_event_refund_job_decide", {
    p_payload: payload,
  });
  if (error) throw error;
  return (data ?? {}) as Json;
}
