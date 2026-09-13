// Ponowne przetworzenie zdarzenia operatora płatności z panelu admina.
//
// Sytuacja docelowa: zdarzenie dotarło, ale obsługa poległa (chwilowy błąd
// bazy, niedostępna usługa e-mail, brak planu w katalogu w chwili zakupu).
// Zamiast czekać na ponowienie po stronie operatora - które po 3 dobach ustaje
// - admin uruchamia tę samą ścieżkę na ładunku zapisanym w dzienniku.
//
// Bezpieczeństwo:
//  - dostęp wyłącznie dla roli `super_admin` (weryfikacja po stronie serwera).
//    Poprzeczka odtwarza politykę RLS tej tabeli - „payment_webhook_events
//    admin read" to `USING (tenant_id = current_tenant_id() AND
//    is_super_admin())`. Ścieżka serwerowa biegnie spod `service_role`, czyli
//    z pominięciem RLS, więc to ONA musi odtworzyć oba człony polityki; rola
//    `admin` była o szczebel niżej niż wymaga baza,
//  - podpis nie jest tu weryfikowany, bo ładunek pochodzi z naszej bazy, a nie
//    z sieci - dlatego funkcja nigdy nie przyjmuje ładunku od klienta, tylko
//    identyfikator wiersza,
//  - obsługa jest idempotentna, więc powtórka nie dubluje maili ani uprawnień,
//  - zakres NAJEMCY (drugi człon polityki): `assertCallerTenantMatchesHost`
//    oddaje najemcę Z PROFILU wołającego - tego samego, w którym `has_role()`
//    autoryzowało rolę - a oba zapytania (odczyt i zapis) filtrują po
//    `tenant_id`. Jedynym zakresem jest ten filtr. Bez niego admin jednego
//    obszaru roboczego czytał surowy ładunek Stripe'a (e-mail, adres, kwoty)
//    i ODTWARZAŁ zdarzenie rozliczeniowe cudzego obszaru.
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import type { VerifiedWebhookEvent } from "@/lib/stripe.server";

const retrySchema = z.object({
  /** Identyfikator wiersza dziennika (`payment_webhook_events.id`). */
  id: z.string().uuid(),
});

/**
 * Bramka obu funkcji: rola `super_admin` w obszarze wołającego, a potem najemca
 * z jego profilu (skonfrontowany z hostem żądania).
 *
 * Kolejność jest wiążąca - rola PRZED dotknięciem czegokolwiek - i nie ma tu
 * gałęzi wyjątku: `is_super_admin()` w bazie samo jest zawężone do
 * `current_tenant_id()`, więc „super admin widzi wszystko" byłoby cofnięciem
 * całej poprawki, a nie udogodnieniem.
 */
async function assertSuperAdminTenant(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<string> {
  const { data, error } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "super_admin",
  });
  // Fail-closed: `null` z RPC (brak wiersza roli, brak grantu na funkcję) ani
  // żadna wartość prawdziwa-ale-nie-`true` nie może przejść jako zgoda.
  if (error || data !== true) throw new Error("forbidden");

  const { assertCallerTenantMatchesHost } = await import("@/lib/server/callerTenant.server");
  return assertCallerTenantMatchesHost(supabase, userId);
}

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
    const tenantId = await assertSuperAdminTenant(context.supabase, context.userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("payment_webhook_events")
      .select("id, event_id, event_type, environment, occurred_at, payload, retry_count")
      .eq("id", data.id)
      // Wiersze bez rozstrzygniętego płatnika też MAJĄ najemcę: nadaje go
      // trigger `payment_webhook_events_bind_tenant` przez
      // `email_default_tenant_id()` (migracja 20260831060000), więc nie ma
      // kategorii „zdarzeń bez obszaru", którą ten filtr mógłby odciąć.
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
      // Filtr najemcy na ZAPISIE jest osobnym wymogiem, nie powtórzeniem
      // odczytu: gdyby kiedyś rozdzielono te dwa zapytania, sam filtr na
      // odczycie przestałby chronić stempel `retried_by` w cudzym wierszu.
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

/** Ładunek pojedynczego zdarzenia - podgląd w panelu (tylko `super_admin`). */
export const readWebhookEventPayload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => retrySchema.parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await assertSuperAdminTenant(context.supabase, context.userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("payment_webhook_events")
      .select(
        "id, event_id, event_type, environment, status, error, occurred_at, processed_at, duration_ms, retry_count, last_retried_at, payload",
      )
      .eq("id", data.id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    // Wiersz cudzego najemcy ma być NIEODRÓŻNIALNY od nieistniejącego: osobny
    // komunikat potwierdzałby istnienie zdarzenia o podanym identyfikatorze.
    if (!row) throw new Error("Zdarzenie nie istnieje.");
    return row;
  });
