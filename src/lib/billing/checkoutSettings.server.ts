// Serwerowy odczyt ustawień checkoutu - jedyne wejście dla ścieżek tworzących
// sesję Stripe (plan z katalogu, odblokowanie treści, bilet, darowizna).
//
// Tenant: ustawienia są per tenant (`checkout_settings.tenant_id` = PK), więc
// czytamy je ZAWSZE zawężone do tenantu, który stempluje zamówienie
// (`payment_orders.tenant_id`). Zapytanie idzie klientem użytkownika, czyli pod
// RLS (`tenant_id = public_tenant_id()`) - jawny filtr jest drugim zamkiem:
// gdyby tenant zamówienia rozjechał się z tenantem żądania, dostaniemy zero
// wierszy i konserwatywne domyślne zamiast cudzej konfiguracji podatkowej.
//
// Odczyt nie jest cache'owany świadomie: to jeden SELECT z tabeli o jednym
// wierszu na tenant, pomijalny obok 2-4 wywołań API Stripe w tej samej ścieżce,
// a admin zmieniający flagi widzi skutek natychmiast (bez okna staleness).
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CHECKOUT_SETTINGS_COLUMNS,
  DEFAULT_CHECKOUT_SETTINGS,
  normalizeCheckoutSettings,
  type CheckoutSettings,
} from "@/lib/billing/checkoutSettings";
import { isCheckoutAbandonMinutes } from "@/lib/revenue/limits";

// Okno porzucenia kasy (S3, P22) czyta ścieżka tworzenia sesji - dokładamy
// kolumnę tutaj, a nie do `CHECKOUT_SETTINGS_COLUMNS`, które wybiera też
// migawka dokumentów (tam pole nie ma odbiorcy). Karta kasy w panelu czyta je
// własnym zestawem kolumn z tokenem (`useCheckoutSettings`, I9a).
const SESSION_SETTINGS_COLUMNS = `${CHECKOUT_SETTINGS_COLUMNS}, abandon_after_minutes` as const;

/**
 * Minuty okna porzucenia albo `null` (= domyślne okno operatora). Wartość
 * spoza CHECK-u bazy (30-1440) albo niecałkowita nie zgaduje okna - wraca
 * domyślne, tak jak brak wiersza. Predykat jest wspólny z formularzem panelu
 * (`isCheckoutAbandonMinutes`, I9a) - klient i serwer nie mogą się różnić
 * co do tego, która wartość jest poprawna.
 */
export function abandonAfterMinutes(raw: unknown): number | null {
  return isCheckoutAbandonMinutes(raw) ? raw : null;
}

/**
 * Ustawienia checkoutu dla tenantu zamówienia. Nigdy nie rzuca: awaria odczytu
 * konfiguracji nie może wywrócić płatności, więc spadamy na bezpieczne
 * domyślne (`DEFAULT_CHECKOUT_SETTINGS`) i zostawiamy ślad w logu.
 *
 * „Bezpieczne" znaczy tu fail-closed dla rabatów: domyślne NIE pokazują pola
 * kodu Stripe, więc błąd odczytu nie otwiera ścieżki rabatu poza bazą.
 */
export async function loadCheckoutSettings(
  supabase: SupabaseClient,
  tenantId?: string | null,
): Promise<CheckoutSettings> {
  try {
    const base = supabase.from("checkout_settings").select(SESSION_SETTINGS_COLUMNS);
    const scoped = tenantId ? base.eq("tenant_id", tenantId) : base;
    const { data, error } = await scoped.maybeSingle();
    if (error) throw error;
    const settings = normalizeCheckoutSettings(data);
    const abandon = abandonAfterMinutes(
      (data as { abandon_after_minutes?: unknown } | null)?.abandon_after_minutes,
    );
    return abandon === null ? settings : { ...settings, abandon_after_minutes: abandon };
  } catch (e) {
    console.error("[checkout] checkout_settings read failed, falling back to defaults", e);
    return DEFAULT_CHECKOUT_SETTINGS;
  }
}
