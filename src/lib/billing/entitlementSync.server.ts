// Most między stanem subskrypcji u operatora (`subscriptions`) a uprawnieniami
// czytanymi przez resztę platformy (`user_subscriptions`).
//
// `has_content_access()`, profil użytkownika, /admin/users, CRM, retencja oraz
// widgety z gatingiem czytają WYŁĄCZNIE `user_subscriptions`. Webhook operatora
// aktualizuje `subscriptions`, więc bez tej synchronizacji anulowanie, pauza,
// zwrot lub zmiana okresu rozliczeniowego nigdy nie docierały do uprawnień.
//
// Moduł server-only (klient service_role) - importuj wyłącznie z handlerów.

/** Statusy subskrypcji zwracane przez operatora płatności. */
export type ProviderSubscriptionStatus =
  "active" | "trialing" | "past_due" | "unpaid" | "paused" | "canceled" | string;

/** Status w `user_subscriptions` (enum `purchase_status`). */
export type EntitlementStatus = "pending" | "active" | "refunded" | "canceled";

export interface EntitlementSyncInput {
  userId: string;
  tenantId: string;
  planId: string;
  /** Identyfikator subskrypcji u operatora - klucz idempotencji (`external_ref`). */
  externalRef: string;
  status: ProviderSubscriptionStatus;
  /**
   * Do kiedy uprawnienie daje dostęp; `null` = brak wygaśnięcia. Dla
   * zaległości i anulowania za brak płatności to koniec KARENCJI, nie okresu
   * operatora - wylicza go `accessPeriodFromEvent` (`accessPeriod.ts`).
   */
  periodEnd: string | null;
  /**
   * Czy u operatora jest zaplanowana rezygnacja (`cancel_at_period_end` /
   * `cancel_at`). `true` utrzymuje `canceled_at`, `false` je czyści (klient
   * wznowił), a brak wartości (wołający nie zna stanu operatora) zostawia
   * zapisane `canceled_at` bez zmian.
   */
  cancelAtPeriodEnd?: boolean;
}

/**
 * Mapuje status operatora na status uprawnienia.
 *
 * - `active` / `trialing` -> dostęp działa do `periodEnd`,
 * - `past_due` / `unpaid` -> dostęp działa, ale `periodEnd` to KONIEC
 *   KARENCJI (wyliczony przez wołającego): operator ponawia obciążenie, więc
 *   nie odbieramy dostępu przedwcześnie - i nie dajemy go za nieopłacony
 *   okres; `has_content_access()` sam wygasza rekord po karencji, bez
 *   czekania na kolejne zdarzenie operatora,
 * - `canceled` -> dostęp do `periodEnd` (koniec opłaconego okresu albo, przy
 *   anulowaniu za brak płatności, koniec karencji): zostawiamy `active`
 *   z datą, bo `has_content_access()` sam wygasza rekord; gdy data już
 *   minęła (lub jej nie ma) - `canceled`,
 * - `paused` i reszta (`incomplete`, `incomplete_expired`) -> `canceled`
 *   (brak dostępu od razu; wznowienie albo płatność doda go ponownie).
 */
export function mapProviderStatus(
  status: ProviderSubscriptionStatus,
  periodEnd: string | null,
  now: Date = new Date(),
): EntitlementStatus {
  switch (status) {
    case "active":
    case "trialing":
    case "past_due":
    case "unpaid":
      return "active";
    case "canceled": {
      if (!periodEnd) return "canceled";
      return new Date(periodEnd).getTime() > now.getTime() ? "active" : "canceled";
    }
    case "paused":
      return "canceled";
    default:
      return "canceled";
  }
}

/**
 * Znacznik `canceled_at` uprawnienia: „rezygnacja zaplanowana albo dostęp
 * zakończony". Na nim stoją przycisk „Wznów" w panelu klienta i lokalne
 * `resumeSubscription`, więc:
 *   - stan końcowy (`canceled`, `paused`) albo zaplanowana rezygnacja -> data
 *     ZACHOWANA, jeśli już jest (np. ustawiło ją lokalne `cancelSubscription`),
 *     a tylko przy jej braku - „teraz". Wcześniej każde zdarzenie stemplowało
 *     „teraz" od nowa, a zdarzenie bez stanu końcowego ZERAWAŁO datę ustawioną
 *     przez lokalne anulowanie - panel gubił „anulowanie zaplanowane" przy
 *     pierwszym `subscription.updated` (audyt SUB-14),
 *   - jawny brak planowanej rezygnacji -> `null` (klient wznowił),
 *   - wołający nie zna stanu operatora -> bez zmian.
 */
function canceledAtFor(input: EntitlementSyncInput, stored: string | null): string | null {
  const ending =
    input.status === "canceled" || input.status === "paused" || input.cancelAtPeriodEnd === true;
  if (ending) return stored ?? new Date().toISOString();
  if (input.cancelAtPeriodEnd === false) return null;
  return stored;
}

/**
 * Idempotentnie odwzorowuje stan subskrypcji operatora w `user_subscriptions`.
 * Klucz: `external_ref` = identyfikator subskrypcji u operatora.
 */
export async function syncEntitlementState(input: EntitlementSyncInput): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const status = mapProviderStatus(input.status, input.periodEnd);

  // `order` + `limit(1)` - ten sam powód co w `grantEntitlement`: unikalności
  // `external_ref` pilnuje tylko kod, więc duplikat nie może wywrócić odczytu
  // (PGRST116) i zapętlić ponowień webhooka. Reguła „zwrot jest ostateczny"
  // nie cierpi na tym: `revokeSubscriptionEntitlement` stempluje `refunded`
  // na WSZYSTKICH wierszach z tym kluczem naraz.
  const { data: existing, error: readErr } = await supabaseAdmin
    .from("user_subscriptions")
    .select("id, status, canceled_at")
    .eq("external_ref", input.externalRef)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (readErr) {
    throw new Error(`entitlement sync: lookup failed (${input.externalRef}): ${readErr.message}`);
  }

  if (existing) {
    // Uprawnienie odebrane po zwrocie / obciążeniu zwrotnym jest ostateczne:
    // spóźnione zdarzenie od operatora (retry, `subscription.updated` tuż po
    // korekcie) nie może przywrócić płatnego dostępu. Ponowny zakup zakłada
    // nową subskrypcję, czyli inny `external_ref`, więc nic nie tracimy.
    if (existing.status === "refunded") return;
    const { error } = await supabaseAdmin
      .from("user_subscriptions")
      .update({
        plan_id: input.planId,
        status,
        current_period_end: input.periodEnd,
        canceled_at: canceledAtFor(input, existing.canceled_at ?? null),
      })
      .eq("id", existing.id);
    if (error) {
      throw new Error(`entitlement sync: update failed (${input.externalRef}): ${error.message}`);
    }
    return;
  }

  const { error } = await supabaseAdmin.from("user_subscriptions").insert({
    user_id: input.userId,
    tenant_id: input.tenantId,
    plan_id: input.planId,
    status,
    external_ref: input.externalRef,
    current_period_end: input.periodEnd,
    canceled_at: canceledAtFor(input, null),
  });
  if (error) {
    throw new Error(`entitlement sync: insert failed (${input.externalRef}): ${error.message}`);
  }
}
