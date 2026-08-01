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
  "active" | "trialing" | "past_due" | "paused" | "canceled" | string;

/** Status w `user_subscriptions` (enum `purchase_status`). */
export type EntitlementStatus = "pending" | "active" | "refunded" | "canceled";

export interface EntitlementSyncInput {
  userId: string;
  tenantId: string;
  planId: string;
  /** Identyfikator subskrypcji u operatora - klucz idempotencji (`external_ref`). */
  externalRef: string;
  status: ProviderSubscriptionStatus;
  /** Koniec opłaconego okresu wg operatora; `null` = brak wygaśnięcia. */
  periodEnd: string | null;
}

/**
 * Mapuje status operatora na status uprawnienia.
 *
 * - `active` / `trialing` / `past_due` -> dostęp działa (przy past_due operator
 *   ponawia obciążenie, nie odbieramy dostępu przedwcześnie),
 * - `canceled` -> dostęp do końca opłaconego okresu: zostawiamy `active`
 *   z `current_period_end`, bo `has_content_access()` sam wygasza rekord;
 *   gdy okres już minął (lub go nie ma) - `canceled`,
 * - `paused` -> `canceled` (brak dostępu od razu, wznowienie doda go ponownie).
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
 * Idempotentnie odwzorowuje stan subskrypcji operatora w `user_subscriptions`.
 * Klucz: `external_ref` = identyfikator subskrypcji u operatora.
 */
export async function syncEntitlementState(input: EntitlementSyncInput): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const status = mapProviderStatus(input.status, input.periodEnd);
  const canceledAt =
    input.status === "canceled" || input.status === "paused" ? new Date().toISOString() : null;

  const { data: existing, error: readErr } = await supabaseAdmin
    .from("user_subscriptions")
    .select("id, status")
    .eq("external_ref", input.externalRef)
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
        canceled_at: canceledAt,
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
    canceled_at: canceledAt,
  });
  if (error) {
    throw new Error(`entitlement sync: insert failed (${input.externalRef}): ${error.message}`);
  }
}
