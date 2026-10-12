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

/** Naruszenie unikalności (Postgres 23505) - przegrany wyścig o ten sam klucz. */
export function isUniqueViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === "23505";
}

/**
 * Idempotentnie odwzorowuje stan subskrypcji operatora w `user_subscriptions`.
 * Klucz: `external_ref` = identyfikator subskrypcji u operatora - UNIKALNY
 * w bazie (`user_subscriptions_external_ref_key`, 20261012100300).
 *
 * Unikalności pilnuje indeks, nie kod. Dwa równoległe zdarzenia tej samej
 * subskrypcji (`created` + `updated` bez wiersza) widziały dawniej oba „brak"
 * i wstawiały DWA uprawnienia; późniejsza rezygnacja trafiała tylko
 * w najstarsze, a drugie dawało dostęp bez płatności. Teraz przegrany wyścig
 * kończy się 23505 i zamienia w aktualizację TEGO SAMEGO klucza. Odczyt na
 * początku jest skrótem (zwrot -> nic nie piszemy), a nie bramką unikalności.
 *
 * Reguła „zwrot jest ostateczny" stoi w samym zapisie (`status <> 'refunded'`),
 * więc trzyma także wtedy, gdy zwrot wpadnie między odczyt a aktualizację.
 */
export async function syncEntitlementState(input: EntitlementSyncInput): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const status = mapProviderStatus(input.status, input.periodEnd);
  const canceledAt =
    input.status === "canceled" || input.status === "paused" ? new Date().toISOString() : null;

  // Aktualizacja po kluczu operatora, nigdy wiersza odebranego po zwrocie.
  const refresh = async (): Promise<void> => {
    const { error } = await supabaseAdmin
      .from("user_subscriptions")
      .update({
        plan_id: input.planId,
        status,
        current_period_end: input.periodEnd,
        canceled_at: canceledAt,
      })
      .eq("external_ref", input.externalRef)
      .neq("status", "refunded");
    if (error) {
      throw new Error(`entitlement sync: update failed (${input.externalRef}): ${error.message}`);
    }
  };

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
    await refresh();
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
  // Równoległe zdarzenie wstawiło wiersz między odczytem a zapisem - nasz stan
  // trafia w TEN wiersz zamiast w drugi.
  if (isUniqueViolation(error)) {
    await refresh();
    return;
  }
  if (error) {
    throw new Error(`entitlement sync: insert failed (${input.externalRef}): ${error.message}`);
  }
}
