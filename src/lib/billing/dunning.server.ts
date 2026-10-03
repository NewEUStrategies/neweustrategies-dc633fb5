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
import type { Database } from "@/integrations/supabase/types";
import { notifyPaymentEmail } from "@/lib/billing/notifications.server";
import { resolvePlanForPrice } from "@/lib/billing/purchaseEffects.server";
import { PROFILE_PLAN_PATH } from "@/lib/profile/routes";

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

type SubscriptionUpdate = Database["public"]["Tables"]["subscriptions"]["Update"];

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
  const { data, error } = await supabaseAdmin
    .from("subscriptions")
    .select(
      "user_id, tenant_id, price_id, current_period_end, payment_failure_count, last_dunning_transaction_id",
    )
    .eq("provider_subscription_id", ctx.subscriptionId)
    .eq("environment", ctx.environment)
    .maybeSingle();
  // PostgREST nie rzuca, tylko zwraca `{ data: null, error }`. Bez tego
  // rozróżnienia awaria odczytu wyglądała jak „nieznana subskrypcja”: webhook
  // kończył się jako `processed`, operator nie ponawiał, a klient tracił mail
  // i licznik. Wyjątek oznacza zdarzenie jako `failed` i wraca przy ponowieniu.
  if (error) {
    throw new Error(
      `dunning: subscription lookup failed (${ctx.subscriptionId}): ${error.message}`,
    );
  }
  return (data as SubRow | null) ?? null;
}

/**
 * Zapis stanu windykacji w wierszu subskrypcji. Błąd przerywa obsługę PRZED
 * mailem i dzwonkiem: niezapisany licznik i klucz deduplikacji psują kolejne
 * zdarzenie (drugi dzwonek dla bliźniaczego `past_due`), a ponowienie webhooka
 * jest bezpieczne właśnie dlatego, że do klienta nic jeszcze nie wyszło.
 */
async function updateSubscription(ctx: DunningContext, patch: SubscriptionUpdate): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin
    .from("subscriptions")
    .update(patch)
    .eq("provider_subscription_id", ctx.subscriptionId)
    .eq("environment", ctx.environment);
  if (error) {
    throw new Error(
      `dunning: subscription update failed (${ctx.subscriptionId}): ${error.message}`,
    );
  }
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
      href: PROFILE_PLAN_PATH,
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

  // Deduplikacja: drugie zdarzenie o tej samej nieudanej transakcji
  // (`past_due` po `payment_failed` lub odwrotnie, w dowolnej kolejności) nie
  // podbija licznika i nie generuje kolejnego maila ani dzwonka.
  if (ctx.transactionId && sub.last_dunning_transaction_id === ctx.transactionId) {
    return;
  }

  await updateSubscription(ctx, {
    payment_failure_count: sub.payment_failure_count + 1,
    last_payment_failed_at: ctx.occurredAt,
    last_dunning_transaction_id: ctx.transactionId ?? null,
    last_dunning_at: ctx.occurredAt,
    updated_at: new Date().toISOString(),
  });

  const plan = await resolvePlanForPrice(sub.price_id, {
    tenantId: sub.tenant_id,
    userId: sub.user_id,
  });

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
    // Klucz to TOŻSAMOŚĆ nieudanego obciążenia, nie numer próby. Licznik
    // zeruje się po odzyskaniu płatności, więc klucz z numeru próby wracał
    // w każdym kolejnym cyklu, a log wysyłek (bez okna czasowego) uznawał
    // pierwszą porażkę nowego cyklu za duplikat i mail nie wychodził.
    // Bliźniacze `payment_failed` i `past_due` niosą ten sam identyfikator
    // transakcji, więc nawet przetwarzane równolegle dają jeden mail.
    // `||`, nie `??`: mapowanie Stripe daje "" przy braku identyfikatora
    // (`idOf(invoice.id) ?? ""`), a stały klucz `<sub>:` połknąłby każdy
    // następny mail - tak jak deduplikacja wyżej, pusty znaczy „brak”.
    idempotencySeed: `${ctx.subscriptionId}:${ctx.transactionId || ctx.occurredAt}`,
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

  await updateSubscription(ctx, {
    payment_failure_count: 0,
    last_payment_failed_at: null,
    last_payment_at: ctx.occurredAt,
    // Zwolnienie klucza deduplikacji - kolejne nieudane obciążenie w nowym
    // cyklu ma znowu uruchomić pełną windykację.
    last_dunning_transaction_id: null,
    updated_at: new Date().toISOString(),
  });

  // Potwierdzenie wysyłamy tylko wtedy, gdy realnie odzyskaliśmy płatność.
  if (sub.payment_failure_count === 0) return;

  const plan = await resolvePlanForPrice(sub.price_id, {
    tenantId: sub.tenant_id,
    userId: sub.user_id,
  });

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
