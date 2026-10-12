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
//  - ponowienie PRZEJMUJE wiersz tym samym porównaj-i-zamień co dostawa od
//    operatora i zamiatarka (`reclaimWebhookEventRow`): kliknięcie w trakcie
//    żywej dostawy tego samego zdarzenia dostaje odmowę „w toku", zamiast
//    wykonać obsługę drugi raz równolegle,
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

const retrySchema = z.object({
  /** Identyfikator wiersza dziennika (`payment_webhook_events.id`). */
  id: z.string().uuid(),
});

/**
 * Bramka obu funkcji: rola `super_admin` w obszarze wołającego, a potem najemca
 * z jego profilu (skonfrontowany z hostem żądania). Implementacja jest wspólna
 * z uzgadnianiem (`assertSuperAdmin` w `diagnostics.server`), bo oba narzędzia
 * czytają ten sam dziennik i odtwarzają zdarzenia tą samą ścieżką.
 */
async function assertSuperAdminTenant(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<string> {
  const { assertSuperAdmin } = await import("@/lib/billing/diagnostics.server");
  return (await assertSuperAdmin(supabase, userId)).tenantId;
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
      .select(
        "id, event_id, event_type, environment, occurred_at, payload, status, created_at, last_retried_at, retry_count",
      )
      .eq("id", data.id)
      // Wiersze bez rozstrzygniętego płatnika też MAJĄ najemcę: nadaje go
      // trigger `payment_webhook_events_bind_tenant` przez
      // `email_default_tenant_id()` (migracja 20260831060000), więc nie ma
      // kategorii „zdarzeń bez obszaru", którą ten filtr mógłby odciąć.
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) throw new Error(`nie udało się odczytać zdarzenia: ${error.message}`);
    if (!row) throw new Error("Zdarzenie nie istnieje.");

    // Kształt ładunku (surowe zdarzenie z trasy, `{ eventType, data }`
    // z uzgadniania, sam obiekt danych) rozpoznaje wspólny rdzeń - ten sam,
    // którym odtwarza zdarzenia zamiatarka. Pusty ładunek zatrzymuje
    // ponowienie PRZED przejęciem wiersza: nie ma czego odtwarzać, a wpis
    // `processed` zamykałby zgłoszenie klienta, który dalej nie ma uprawnienia.
    const { EMPTY_PAYLOAD_ERROR, loggedWebhookEvent, processClaimedWebhookEvent } =
      await import("@/lib/billing/webhookReplay.server");
    const replay = await loggedWebhookEvent(row);
    if (!replay) throw new Error(EMPTY_PAYLOAD_ERROR);

    // Przejęcie wiersza: licznik prób, `last_retried_at` i autor ponowienia
    // lądują w TYM SAMYM warunkowym zapisie, który rezerwuje zdarzenie.
    // Admin może świadomie otworzyć wiersz domknięty (`processed`/`skipped`),
    // ale nie ten, który właśnie obsługuje żywa dostawa albo zamiatarka.
    const { reclaimWebhookEventRow } = await import("@/lib/billing/webhookLog.server");
    const claim = await reclaimWebhookEventRow(row, {
      retriedBy: context.userId,
      tenantId,
      reopenClosed: true,
    });
    if (claim !== "claimed") {
      throw new Error(
        "Zdarzenie jest właśnie przetwarzane - odczekaj kilka minut i odśwież dziennik.",
      );
    }

    const environment = row.environment === "live" ? "live" : "sandbox";
    const outcome = await processClaimedWebhookEvent({
      eventId: row.event_id,
      environment,
      occurredAt: row.occurred_at ?? new Date().toISOString(),
      normalized: replay.normalized,
      // Filtr najemcy na ZAPISIE jest osobnym wymogiem, nie powtórzeniem
      // odczytu: gdyby kiedyś rozdzielono te zapytania, sam filtr na odczycie
      // przestałby chronić cudzy wiersz przed domknięciem.
      tenantId,
    });
    return {
      id: row.id,
      eventType: row.event_type,
      status: outcome.status,
      durationMs: outcome.durationMs,
      retryCount: (row.retry_count ?? 0) + 1,
      error: outcome.error,
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
