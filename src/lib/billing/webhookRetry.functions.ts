// Ponowne przetworzenie zdarzenia operatora płatności z panelu admina.
//
// Sytuacja docelowa: zdarzenie dotarło, ale obsługa poległa (chwilowy błąd
// bazy, niedostępna usługa e-mail, brak planu w katalogu w chwili zakupu).
// Zamiast czekać na ponowienie po stronie operatora - które po 3 dobach ustaje
// - admin uruchamia tę samą ścieżkę na ładunku zapisanym w dzienniku.
//
// Bezpieczeństwo:
//  - dostęp wyłącznie dla roli `admin` (weryfikacja po stronie serwera),
//  - podpis nie jest tu weryfikowany, bo ładunek pochodzi z naszej bazy, a nie
//    z sieci - dlatego funkcja nigdy nie przyjmuje ładunku od klienta, tylko
//    identyfikator wiersza,
//  - obsługa jest idempotentna, więc powtórka nie dubluje maili ani uprawnień.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { VerifiedWebhookEvent } from "@/lib/stripe.server";

const retrySchema = z.object({
  /** Identyfikator wiersza dziennika (`payment_webhook_events.id`). */
  id: z.string().uuid(),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Rozpoznaje SUROWE zdarzenie operatora zapisane w dzienniku przez trasę
 * `/api/public/payments/webhook` (`payload: verified`).
 *
 * Dziennik ma dwóch piszących i dwa kształty wiersza: trasa zapisuje ładunek
 * surowy (`{ id, type, created, data: { object } }`), a uzgadnianie
 * (`reconcile.server`) już znormalizowany (`{ eventType, data }`). Ponowienie
 * musi umieć oba - inaczej wiersz z trasy, czyli KAŻDY zwykły webhook, jedzie
 * do obsługi jako opakowanie Stripe'a zamiast modelu domenowego.
 */
function asVerifiedStripeEvent(payload: Record<string, unknown>): VerifiedWebhookEvent | null {
  const { id, type, created, data } = payload;
  if (typeof id !== "string" || typeof type !== "string" || typeof created !== "number") return null;
  if (!isRecord(data) || !isRecord(data.object)) return null;
  return { id, type, created, data: { object: data.object } };
}

export interface WebhookRetryResult {
  id: string;
  eventType: string;
  status: "processed" | "skipped" | "failed";
  durationMs: number;
  retryCount: number;
  error: string | null;
}

/**
 * Odtwarza obsługę zapisanego zdarzenia i aktualizuje jego wiersz w dzienniku
 * (status, czas obsługi, licznik prób, autor ponowienia).
 */
export const retryWebhookEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => retrySchema.parse(data))
  .handler(async ({ data, context }): Promise<WebhookRetryResult> => {
    const { assertAdmin } = await import("@/lib/billing/diagnostics.server");
    await assertAdmin(context.supabase, context.userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("payment_webhook_events")
      .select("id, event_id, event_type, environment, occurred_at, payload, retry_count")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(`nie udało się odczytać zdarzenia: ${error.message}`);
    if (!row) throw new Error("Zdarzenie nie istnieje.");

    // Dziennik trzyma TRZY kształty ładunku i ponowienie musi rozumieć każdy:
    //   * SUROWE zdarzenie operatora (trasa webhooka) - przepuszczamy je przez
    //     tę samą normalizację, co dostawa przychodząca; bez tego obsługa
    //     dostawała opakowanie `{ object: ... }` zamiast modelu domenowego,
    //     nie robiła nic i kończyła się fałszywym „przetworzono",
    //   * całe zdarzenie po normalizacji (`{ eventType, data }` z uzgadniania),
    //   * sam obiekt danych (wiersze historyczne).
    const payload = isRecord(row.payload) ? row.payload : null;
    const verified = payload ? asVerifiedStripeEvent(payload) : null;
    const normalized = verified
      ? (await import("@/lib/billing/stripeEvents.server")).normalizeStripeEvent(verified)
      : null;

    const eventType = normalized?.eventType ?? row.event_type;
    const eventData = normalized
      ? normalized.data
      : payload && "data" in payload
        ? payload.data
        : payload;
    // Pusty ładunek ma zatrzymać ponowienie NIEZALEŻNIE od tego, jak zapisano
    // pustkę: jsonowy `null` w kolumnie, `{ data: null }` albo pusty obiekt
    // znaczą to samo - nie ma czego odtwarzać, a wpis `processed` przy takim
    // wierszu zamykałby zgłoszenie klienta, który dalej nie ma uprawnienia.
    if (!isRecord(eventData) || Object.keys(eventData).length === 0) {
      throw new Error("Zapisany ładunek jest pusty - nie ma czego ponowić.");
    }

    const environment = row.environment === "live" ? "live" : "sandbox";
    const startedAt = Date.now();
    const retryCount = (row.retry_count ?? 0) + 1;

    let status: WebhookRetryResult["status"] = "processed";
    let message: string | null = null;
    try {
      const { dispatchWebhookEvent } = await import("@/lib/billing/webhookDispatch.server");
      const outcome = await dispatchWebhookEvent({
        eventType,
        data: eventData,
        environment,
        occurredAt: row.occurred_at ?? new Date().toISOString(),
      });
      status = outcome === "processed" ? "processed" : "skipped";
    } catch (err) {
      status = "failed";
      message = err instanceof Error ? err.message : String(err);
      console.error("[payments] webhook retry failed", row.event_id, err);
    }

    const durationMs = Date.now() - startedAt;
    await supabaseAdmin
      .from("payment_webhook_events")
      .update({
        status,
        error: message,
        processed_at: new Date().toISOString(),
        duration_ms: durationMs,
        retry_count: retryCount,
        last_retried_at: new Date().toISOString(),
        retried_by: context.userId,
      })
      .eq("id", row.id);

    return {
      id: row.id,
      eventType: row.event_type,
      status,
      durationMs,
      retryCount,
      error: message,
    };
  });

/** Ładunek pojedynczego zdarzenia - podgląd w panelu (tylko admin). */
export const readWebhookEventPayload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => retrySchema.parse(data))
  .handler(async ({ data, context }) => {
    const { assertAdmin } = await import("@/lib/billing/diagnostics.server");
    await assertAdmin(context.supabase, context.userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("payment_webhook_events")
      .select(
        "id, event_id, event_type, environment, status, error, occurred_at, processed_at, duration_ms, retry_count, last_retried_at, payload",
      )
      .eq("id", data.id)
      .maybeSingle();
    if (!row) throw new Error("Zdarzenie nie istnieje.");
    return row;
  });
