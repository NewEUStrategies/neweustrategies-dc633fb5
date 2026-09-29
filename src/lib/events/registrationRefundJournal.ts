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
export interface RefundJournalRow {
  id: string;
  payment_order_id: string;
  person_name: string;
  state: RefundJobState;
  attempts: number;
  last_error: string | null;
  next_attempt_at: string;
  created_at: string;
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
      next_attempt_at,
      created_at,
    };
  });
}
