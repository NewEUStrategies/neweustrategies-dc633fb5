// Ponowne przetworzenie zdarzenia operatora płatności z panelu admina.
//
// Sytuacja docelowa: zdarzenie dotarło, ale obsługa poległa (chwilowy błąd
// bazy, niedostępna usługa e-mail, brak planu w katalogu w chwili zakupu).
// Zamiast czekać na ponowienie po stronie operatora - które po 3 dobach ustaje
// - admin uruchamia tę samą ścieżkę na ładunku zapisanym w dzienniku.
//
// Bezpieczeństwo:
//  - dostęp wyłącznie dla roli `admin` (weryfikacja po stronie serwera),
//  - ZAKRES NAJEMCY: bramka roli potwierdza rolę w tenancie DOMOWYM wywołującego
//    (`has_role` -> `current_tenant_id()` -> `profiles.tenant_id`), a dziennik
//    czytamy kluczem serwisowym, czyli Z POMINIĘCIEM RLS - polityka
//    `payment_webhook_events admin read` na tej ścieżce NIE BIEGNIE, więc jawny
//    filtr `tenant_id` w zapytaniu JEST tu jedyną granicą obszaru roboczego.
//    Bez niego sam identyfikator wiersza wystarczał, żeby admin jednego obszaru
//    odczytał ładunek płatności drugiego (dane rozliczeniowe kupującego)
//    i odtworzył jego skutki. Cudze identyfikatory nie są przy tym tajemnicą:
//    RPC `admin_payment_webhook_health` oddaje je w `recent_failures` każdemu
//    adminowi, bez filtra najemcy. Filtrujemy po najemcy Z PROFILU, nie po
//    hoście żądania - autoryzacja i zakres danych muszą biec po tej samej
//    płaszczyźnie; admin obszaru A oglądający domenę obszaru B dostanie tu
//    „Zdarzenie nie istnieje." i jest to odpowiedź poprawna, bo rola została
//    udowodniona wyłącznie w A (nie „naprawiać" tego przejściem na host),
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
  if (typeof id !== "string" || typeof type !== "string" || typeof created !== "number")
    return null;
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
    // Najemca z PROFILU wywołującego - nie z ładunku i nie z hosta. Rolę
    // potwierdziliśmy w tenancie domowym (`has_role` -> `current_tenant_id()`),
    // więc granica danych musi biec dokładnie po tej samej płaszczyźnie;
    // rozjazd „autoryzuj po domowym, filtruj po hoście" to ta sama klasa
    // defektu, którą opisuje `scripts/check-sql-tenant-scope.ts`. Profil bez
    // najemcy kończy ścieżkę wyjątkiem - odczyt bez granicy byłby gorszy od
    // odmowy.
    const { resolveUserTenantId } = await import("@/lib/server/userTenant.server");
    const tenantId = await resolveUserTenantId(supabaseAdmin, context.userId);

    const { data: row, error } = await supabaseAdmin
      .from("payment_webhook_events")
      .select("id, event_id, event_type, environment, occurred_at, payload, retry_count")
      .eq("id", data.id)
      .eq("tenant_id", tenantId)
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
      // Zapis też z filtrem najemcy, mimo że wiersz przeszedł już przez odczyt:
      // odczyt i zapis to dwa osobne zapytania, a to drugie stempluje cudzy
      // ślad audytowy (`retried_by`, `retry_count`). Filtr tylko przy odczycie
      // zostawiałby zapis bez granicy dla następnej zmiany w tym łańcuchu.
      .eq("id", row.id)
      .eq("tenant_id", tenantId);

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
    // Ta sama granica co w ponowieniu, a stawka wyższa: `payload` to najbardziej
    // wrażliwa kolumna dziennika (adres, e-mail, kwoty kupującego), a ten eksport
    // nie ma żadnego konsumenta w UI - jedyne, co dzieli go od wywołania
    // „na surowo", to ten filtr.
    const { resolveUserTenantId } = await import("@/lib/server/userTenant.server");
    const tenantId = await resolveUserTenantId(supabaseAdmin, context.userId);

    const { data: row } = await supabaseAdmin
      .from("payment_webhook_events")
      .select(
        "id, event_id, event_type, environment, status, error, occurred_at, processed_at, duration_ms, retry_count, last_retried_at, payload",
      )
      .eq("id", data.id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!row) throw new Error("Zdarzenie nie istnieje.");
    return row;
  });
