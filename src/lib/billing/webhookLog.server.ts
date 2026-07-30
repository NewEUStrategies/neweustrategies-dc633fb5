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

/** Po tylu ms zdarzenie w stanie `received` uznajemy za porzucone (padł worker). */
const STUCK_AFTER_MS = 5 * 60 * 1000;

/**
 * Rezerwuje zdarzenie do przetworzenia.
 *
 * Duplikat blokuje ponowne wykonanie TYLKO wtedy, gdy poprzednie podejście
 * zakończyło się statusem końcowym (`processed`/`skipped`). Zdarzenie, które
 * padło (`failed`) albo utknęło w `received` (worker zginął w trakcie), musi
 * dać się przejąć ponownie - inaczej ponowna wysyłka od operatora zostałaby
 * zignorowana i klient zostałby bez uprawnień mimo obciążenia.
 *
 * @returns `true` gdy zdarzenie jest nasze do przetworzenia, `false` gdy
 *          zostało już domknięte.
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
  if (error.code !== "23505") throw new Error(`webhook log insert failed: ${error.message}`);

  const { data: existing, error: readErr } = await supabase
    .from("payment_webhook_events")
    .select("id, status, created_at")
    .eq("event_id", ref.eventId)
    .eq("environment", ref.environment)
    .maybeSingle();
  if (readErr) throw new Error(`webhook log lookup failed: ${readErr.message}`);
  if (!existing) return false;

  const status = existing.status as WebhookEventStatus | null;
  if (status === "processed" || status === "skipped") return false;

  if (status === "received") {
    const startedAt = existing.created_at ? Date.parse(existing.created_at) : Number.NaN;
    const stuck = Number.isFinite(startedAt) && Date.now() - startedAt > STUCK_AFTER_MS;
    // Zdarzenie może być obsługiwane właśnie teraz przez równoległą dostawę -
    // przejmujemy je dopiero po upływie okna bezpieczeństwa.
    if (!stuck) return false;
  }

  // `failed` albo porzucone `received`: przejmujemy do ponownej próby.
  const { error: retryErr } = await supabase
    .from("payment_webhook_events")
    .update({
      status: "received",
      error: null,
      processed_at: null,
      retry_count: (existing as { retry_count?: number | null }).retry_count
        ? Number((existing as { retry_count?: number | null }).retry_count) + 1
        : 1,
      payload: (ref.payload ?? {}) as Json,
    })
    .eq("id", existing.id);
  if (retryErr) throw new Error(`webhook log reclaim failed: ${retryErr.message}`);
  return true;
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
