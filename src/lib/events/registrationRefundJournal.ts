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

/** Kto zamknął zgłoszenie (CHECK `event_refund_jobs_origin_values`). */
export const REFUND_JOB_ORIGINS = [
  "organizer_rejected",
  "organizer_cancelled",
  "participant_cancelled",
  "system",
] as const;
export type RefundJobOrigin = (typeof REFUND_JOB_ORIGINS)[number];

/** Decyzje organizatora o zleceniu (`admin_event_refund_job_decide`). */
export const REFUND_JOB_DECISIONS = ["refund", "mark_refunded", "dismiss"] as const;
export type RefundJobDecision = (typeof REFUND_JOB_DECISIONS)[number];

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
  next_attempt_at: string;
  created_at: string;
}

function invalid(): never {
  throw new Error("invalid_refund_journal");
}

function optionalText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") invalid();
  return value;
}

function optionalCents(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) invalid();
  return value;
}

function oneOf<T extends string>(values: readonly T[], value: unknown): T {
  if (typeof value !== "string" || !values.some((known) => known === value)) invalid();
  return value as T;
}

export async function fetchRegistrationRefundJournal(eventId: string): Promise<RefundJournalRow[]> {
  const { data, error } = await supabase.rpc("admin_event_refund_jobs", { p_event_id: eventId });
  if (error) throw error;
  if (!Array.isArray(data)) invalid();
  return data.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
    const row = value as Record<string, unknown>;
    const { id, person_name, attempts, next_attempt_at, created_at } = row;
    if (
      typeof id !== "string" ||
      typeof person_name !== "string" ||
      typeof attempts !== "number" ||
      !Number.isInteger(attempts) ||
      attempts < 0 ||
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
      last_error: optionalText(row.last_error),
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
