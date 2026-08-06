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

/**
 * Ustawienia checkoutu dla tenantu zamówienia. Nigdy nie rzuca: awaria odczytu
 * konfiguracji nie może wywrócić płatności, więc spadamy na bezpieczne
 * domyślne (`DEFAULT_CHECKOUT_SETTINGS`) i zostawiamy ślad w logu.
 */
export async function loadCheckoutSettings(
  supabase: SupabaseClient,
  tenantId?: string | null,
): Promise<CheckoutSettings> {
  try {
    const base = supabase.from("checkout_settings").select(CHECKOUT_SETTINGS_COLUMNS);
    const scoped = tenantId ? base.eq("tenant_id", tenantId) : base;
    const { data, error } = await scoped.maybeSingle();
    if (error) throw error;
    return normalizeCheckoutSettings(data);
  } catch (e) {
    console.error("[checkout] checkout_settings read failed, falling back to defaults", e);
    return DEFAULT_CHECKOUT_SETTINGS;
  }
}
