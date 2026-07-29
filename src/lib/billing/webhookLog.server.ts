// Rejestr zdarzeń od operatora płatności.
//
// Dwa zadania:
//  1. idempotencja - `claimWebhookEvent` wstawia wiersz z unikalnym
//     (event_id, environment); duplikat oznacza, że zdarzenie już
//     przetworzyliśmy i handler może je bezpiecznie pominąć,
//  2. audyt - panel `/admin/billing` czyta tę tabelę (RLS: tylko admin).
//
// Moduł server-only (klient service_role) - importuj wyłącznie z handlerów.
import type { Json } from "@/integrations/supabase/types";

export type WebhookEventStatus = "received" | "processed" | "skipped" | "failed";

export interface WebhookEventRef {
  eventId: string;
  eventType: string;
  environment: "sandbox" | "live";
  occurredAt?: string | null;
  subscriptionId?: string | null;
  customerId?: string | null;
  userId?: string | null;
  payload?: unknown;
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/**
 * Rezerwuje zdarzenie do przetworzenia.
 * @returns `true` gdy to pierwsze wystąpienie, `false` gdy duplikat.
 */
export async function claimWebhookEvent(ref: WebhookEventRef): Promise<boolean> {
  const supabase = await admin();
  const { error } = await supabase.from("payment_webhook_events").insert({
    event_id: ref.eventId,
    event_type: ref.eventType,
    environment: ref.environment,
    occurred_at: ref.occurredAt ?? null,
    subscription_id: ref.subscriptionId ?? null,
    customer_id: ref.customerId ?? null,
    user_id: ref.userId ?? null,
    payload: (ref.payload ?? {}) as Json,
    status: "received",
  });
  if (!error) return true;
  // 23505 = unique_violation -> zdarzenie już zarejestrowane
  if (error.code === "23505") return false;
  throw new Error(`webhook log insert failed: ${error.message}`);
}

/** Domyka wiersz zdarzenia statusem końcowym. Nigdy nie rzuca. */
export async function finishWebhookEvent(
  ref: Pick<WebhookEventRef, "eventId" | "environment">,
  status: WebhookEventStatus,
  patch?: {
    error?: string | null;
    subscriptionId?: string | null;
    userId?: string | null;
    /** Czas obsługi zdarzenia w ms - panel diagnostyczny pokazuje go wprost. */
    durationMs?: number | null;
  },
): Promise<void> {
  try {
    const supabase = await admin();
    await supabase
      .from("payment_webhook_events")
      .update({
        status,
        error: patch?.error ?? null,
        processed_at: new Date().toISOString(),
        ...(typeof patch?.durationMs === "number"
          ? { duration_ms: Math.max(0, Math.round(patch.durationMs)) }
          : {}),
        ...(patch?.subscriptionId ? { subscription_id: patch.subscriptionId } : {}),
        ...(patch?.userId ? { user_id: patch.userId } : {}),
      })
      .eq("event_id", ref.eventId)
      .eq("environment", ref.environment);
  } catch (err) {
    console.error("[payments] webhook log update failed", err);
  }
}
