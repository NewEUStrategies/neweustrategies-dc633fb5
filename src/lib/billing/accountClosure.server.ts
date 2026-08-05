// Zamknięcie konta od strony rozliczeń.
//
// Usunięcie konta musi zatrzymać pieniądze PRZED skasowaniem danych: po
// `deleteUser` nie ma już z czym powiązać subskrypcji, a operator dalej
// obciążałby kartę w kolejnych okresach. Dlatego anulujemy natychmiast
// (nie na koniec okresu) i dopiero wtedy wolno usuwać użytkownika.
//
// Moduł server-only (klucze bramki + service role).
import type { StripeEnv } from "@/lib/stripe.server";

export interface AccountClosureResult {
  /** Ile aktywnych subskrypcji anulowano u operatora. */
  canceled: number;
  /** Identyfikatory, których operator nie pozwolił anulować. */
  failed: string[];
}

const OPEN_STATUSES = ["active", "trialing", "past_due", "paused"];

/**
 * Anuluje wszystkie otwarte subskrypcje użytkownika ze skutkiem natychmiastowym
 * i potwierdza to mailem. Rzuca, gdy operator odmówi - kasowanie konta nie może
 * zostawić za sobą płatnego abonamentu bez właściciela.
 */
export async function closeBillingForUser(
  userId: string,
  email: string | null,
): Promise<AccountClosureResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { subscriptionEnvironment, cancelSubscriptionImmediately, isProviderSubscriptionRef } =
    await import("@/lib/billing/subscriptionProvider.server");

  const env: StripeEnv = subscriptionEnvironment();
  const { data: rows, error } = await supabaseAdmin
    .from("subscriptions")
    .select("provider_subscription_id, status, price_id")
    .eq("user_id", userId)
    .eq("environment", env)
    .in("status", OPEN_STATUSES);
  if (error) throw new Error(`account closure: subscription lookup failed: ${error.message}`);

  const result: AccountClosureResult = { canceled: 0, failed: [] };
  const nowIso = new Date().toISOString();

  for (const row of rows ?? []) {
    const ref = row.provider_subscription_id;
    if (!isProviderSubscriptionRef(ref)) continue;

    const op = await cancelSubscriptionImmediately(env, ref);
    if (!op.ok) {
      // Sprzeczność stanu: operator zna subskrypcję, my jej już nie znajdziemy.
      // Zgłaszamy zamiast po cichu kasować konto.
      console.error("[account] subscription cancel failed", ref, op.error);
      result.failed.push(ref);
      continue;
    }

    const { error: updErr } = await supabaseAdmin
      .from("subscriptions")
      .update({
        status: "canceled",
        cancel_at_period_end: false,
        trial_ends_at: null,
        updated_at: nowIso,
      })
      .eq("provider_subscription_id", ref)
      .eq("environment", env);
    if (updErr) throw new Error(`account closure: subscription update failed: ${updErr.message}`);

    const { revokeSubscriptionEntitlement } = await import("@/lib/billing/grant.server");
    await revokeSubscriptionEntitlement(ref, nowIso);

    result.canceled += 1;

    // Potwierdzenie anulowania - jedyny mail, jaki ma jeszcze sens wysłać na
    // adres zamykanego konta.
    if (email) {
      try {
        const { resolvePlanForPrice } = await import("@/lib/billing/purchaseEffects.server");
        const plan = row.price_id ? await resolvePlanForPrice(row.price_id) : null;
        const { notifySubscriptionEmail } = await import("@/lib/billing/notifications.server");
        await notifySubscriptionEmail({
          kind: "subscription_canceled",
          userId,
          planId: plan?.planId ?? null,
          periodEnd: nowIso,
          idempotencySeed: `account-closure:${ref}`,
        });
      } catch (err) {
        console.error("[account] closure email failed", ref, err);
      }
    }
  }

  if (result.failed.length > 0) {
    throw new Error(
      "Nie udało się anulować aktywnej subskrypcji u operatora płatności. Spróbuj ponownie za chwilę lub napisz do nas - konto nie zostało usunięte.",
    );
  }

  return result;
}
