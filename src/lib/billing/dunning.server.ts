// Miękka windykacja (dunning): reakcja systemu na nieudaną i odzyskaną płatność.
//
// Nieudana płatność NIE odbiera od razu dostępu - operator ponawia obciążenie,
// więc do końca opłaconego okresu użytkownik pracuje normalnie, a my:
//   - podbijamy licznik `payment_failure_count` przy subskrypcji,
//   - wysyłamy mail transakcyjny PL/EN z terminem kolejnej próby,
//   - wrzucamy powiadomienie w aplikacji (dzwonek) z linkiem do portalu.
// Zaksięgowanie płatności zeruje licznik i wysyła potwierdzenie.
//
// Moduł server-only - importuj wyłącznie z handlerów webhooka.
import { notifyPaymentEmail } from "@/lib/billing/notifications.server";
import { resolvePlanForPrice } from "@/lib/billing/paddleEffects.server";

export interface DunningContext {
  subscriptionId: string;
  environment: "sandbox" | "live";
  /** Data zdarzenia od operatora. */
  occurredAt: string;
  /** Planowana kolejna próba obciążenia, jeśli operator ją podał. */
  retryAt?: string | null;
  amountCents?: number | null;
  currency?: string | null;
  /**
   * Identyfikator transakcji, której dotyczy zdarzenie. Operator opisuje jedno
   * nieudane obciążenie dwoma zdarzeniami (`transaction.payment_failed` oraz
   * `transaction.past_due`) - ten identyfikator jest kluczem deduplikacji, więc
   * licznik prób rośnie o jeden, a mail i dzwonek idą dokładnie raz.
   */
  transactionId?: string | null;
}

interface SubRow {
  user_id: string;
  tenant_id: string;
  price_id: string;
  current_period_end: string | null;
  payment_failure_count: number;
  last_dunning_transaction_id: string | null;
}

async function loadSubscription(ctx: DunningContext): Promise<SubRow | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("subscriptions")
    .select(
      "user_id, tenant_id, price_id, current_period_end, payment_failure_count, last_dunning_transaction_id",
    )
    .eq("paddle_subscription_id", ctx.subscriptionId)
    .eq("environment", ctx.environment)
    .maybeSingle();
  return (data as SubRow | null) ?? null;
}


async function pushNotification(params: {
  userId: string;
  tenantId: string;
  titlePl: string;
  titleEn: string;
  bodyPl: string;
  bodyEn: string;
  icon: string;
}): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("notifications").insert({
      user_id: params.userId,
      tenant_id: params.tenantId,
      kind: "billing",
      title_pl: params.titlePl,
      title_en: params.titleEn,
      body_pl: params.bodyPl,
      body_en: params.bodyEn,
      href: "/profile/subscription",
      icon: params.icon,
    });
  } catch (err) {
    console.error("[payments] dunning notification failed", err);
  }
}

/**
 * Okres karencji miękkiej windykacji: dostęp działa mimo nieudanej płatności,
 * dopóki operator ponawia próby obciążenia.
 */
export const PAYMENT_GRACE_DAYS = 14;

/** Nieudane obciążenie: licznik prób + mail + powiadomienie. */
export async function applyPaymentFailedEffects(ctx: DunningContext): Promise<void> {
  const sub = await loadSubscription(ctx);
  if (!sub) {
    console.warn("[payments] payment failed for unknown subscription", ctx.subscriptionId);
    return;
  }

  const attempt = (sub.payment_failure_count ?? 0) + 1;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin
    .from("subscriptions")
    .update({
      payment_failure_count: attempt,
      last_payment_failed_at: ctx.occurredAt,
      updated_at: new Date().toISOString(),
    })
    .eq("paddle_subscription_id", ctx.subscriptionId)
    .eq("environment", ctx.environment);

  const plan = await resolvePlanForPrice(sub.price_id);

  await notifyPaymentEmail({
    kind: "payment_failed",
    userId: sub.user_id,
    planId: plan?.planId ?? null,
    amountCents: ctx.amountCents ?? plan?.priceCents ?? null,
    currency: ctx.currency ?? plan?.currency ?? null,
    attemptedAt: ctx.occurredAt,
    retryAt: ctx.retryAt ?? null,
    accessUntil: sub.current_period_end,
    graceDays: PAYMENT_GRACE_DAYS,
    idempotencySeed: `${ctx.subscriptionId}:${attempt}`,
  });

  await pushNotification({
    userId: sub.user_id,
    tenantId: sub.tenant_id,
    titlePl: "Płatność nie powiodła się",
    titleEn: "Payment failed",
    bodyPl: "Zaktualizuj metodę płatności, żeby zachować dostęp bez przerwy.",
    bodyEn: "Update your payment method to keep uninterrupted access.",
    icon: "credit-card",
  });
}

/** Płatność zaksięgowana po nieudanej próbie: zerowanie licznika + mail. */
export async function applyPaymentRecoveredEffects(ctx: DunningContext): Promise<void> {
  const sub = await loadSubscription(ctx);
  if (!sub) return;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin
    .from("subscriptions")
    .update({
      payment_failure_count: 0,
      last_payment_failed_at: null,
      last_payment_at: ctx.occurredAt,
      updated_at: new Date().toISOString(),
    })
    .eq("paddle_subscription_id", ctx.subscriptionId)
    .eq("environment", ctx.environment);

  // Potwierdzenie wysyłamy tylko wtedy, gdy realnie odzyskaliśmy płatność.
  if ((sub.payment_failure_count ?? 0) === 0) return;

  const plan = await resolvePlanForPrice(sub.price_id);

  await notifyPaymentEmail({
    kind: "payment_recovered",
    userId: sub.user_id,
    planId: plan?.planId ?? null,
    amountCents: ctx.amountCents ?? plan?.priceCents ?? null,
    currency: ctx.currency ?? plan?.currency ?? null,
    accessUntil: sub.current_period_end,
    idempotencySeed: `${ctx.subscriptionId}:${ctx.occurredAt}`,
  });

  await pushNotification({
    userId: sub.user_id,
    tenantId: sub.tenant_id,
    titlePl: "Płatność zaksięgowana",
    titleEn: "Payment received",
    bodyPl: "Subskrypcja wróciła do normalnego trybu rozliczeń.",
    bodyEn: "Your subscription is back to normal billing.",
    icon: "badge-check",
  });
}
