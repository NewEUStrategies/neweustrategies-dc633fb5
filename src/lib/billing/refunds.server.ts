// Zwroty i obciążenia zwrotne (Paddle: zdarzenia `adjustment.*`).
//
// Decyzja produktowa: zwrot ODBIERA DOSTĘP NATYCHMIAST - nie czekamy do końca
// opłaconego okresu. Klient dostał pieniądze z powrotem, więc uprawnienie musi
// zniknąć z `user_subscriptions` / `user_purchases`, bo to jedyne, co czyta
// `has_content_access()`.
//
// Zakres skutków jednego zwrotu:
//   1. odbicie statusu na źródle płatności (`payment_orders` / `donations`),
//   2. odebranie uprawnienia (subskrypcja lub zakup jednorazowy),
//   3. cofnięcie potwierdzenia udziału w wydarzeniu (bilet),
//   4. znacznik w CRM + powiadomienie w aplikacji + mail transakcyjny.
//
// Kontrakt błędów jak w pozostałych handlerach: rzucamy przy awarii zapisu,
// żeby operator ponowił dostarczenie zdarzenia. Efekty miękkie (mail, CRM,
// dzwonek) nigdy nie wywracają przetwarzania.
//
// Moduł server-only (klient service_role) - importuj wyłącznie z handlerów.
import { PROFILE_PLAN_PATH } from "@/lib/profile/routes";

/** Kwalifikacja zdarzenia korygującego przysłanego przez operatora. */
export type AdjustmentAction = "refund" | "chargeback" | "chargeback_warning" | "credit" | "other";

export interface RefundEvent {
  /** Identyfikator korekty u operatora - klucz idempotencji maili. */
  adjustmentId: string;
  transactionId: string | null;
  subscriptionId: string | null;
  action: AdjustmentAction;
  /** `approved` / `pending_approval` / `rejected` / `reversed`. */
  status: string | null;
  amountCents: number | null;
  currency: string | null;
  environment: "sandbox" | "live";
}

export type RefundOutcome =
  | "skipped"
  | "subscription_refunded"
  | "order_refunded"
  | "donation_refunded"
  | "subscription_restored"
  | "order_restored";

/**
 * Korekty, które odbierają dostęp.
 *
 * Spór (`chargeback_warning`) liczy się od chwili otwarcia: bank już wycofuje
 * środki, a rozstrzygnięcie trwa tygodniami. Trzymanie dostępu przez ten czas
 * oznaczałoby darmową treść na koszt serwisu - dlatego odbieramy od razu i
 * przywracamy, gdy spór zostanie wygrany (`reversed`).
 */
export function isRevokingAdjustment(event: RefundEvent): boolean {
  if (event.action === "credit" || event.action === "other") return false;
  if (event.action === "chargeback_warning") {
    return event.status !== "reversed" && event.status !== "rejected";
  }
  // `pending_approval` to dopiero wniosek - dostęp odbieramy po zatwierdzeniu.
  // `reversed` / `rejected` oznaczają, że zwrot nie doszedł do skutku.
  return event.status === null || event.status === "approved";
}

/** Spór rozstrzygnięty na naszą korzyść - dostęp wraca. */
export function isDisputeReversed(event: RefundEvent): boolean {
  if (event.action !== "chargeback" && event.action !== "chargeback_warning") return false;
  return event.status === "reversed";
}

/** Mapuje akcję operatora na czytelny powód w dzienniku i CRM. */
function reasonLabel(action: AdjustmentAction): string {
  return action === "chargeback" ? "chargeback" : "refund";
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Odbiera uprawnienie subskrypcyjne powiązane z subskrypcją operatora. */
async function revokeSubscription(event: RefundEvent): Promise<RefundOutcome> {
  const supabase = await admin();
  const subscriptionId = event.subscriptionId;
  if (!subscriptionId) return "skipped";

  const nowIso = new Date().toISOString();

  const { data: sub, error: subErr } = await supabase
    .from("subscriptions")
    .select("user_id, price_id")
    .eq("provider_subscription_id", subscriptionId)
    .eq("environment", event.environment)
    .maybeSingle();
  if (subErr) throw new Error(`refund: subscription lookup failed: ${subErr.message}`);

  const { revokeSubscriptionEntitlement } = await import("@/lib/billing/grant.server");
  const revoked = await revokeSubscriptionEntitlement(subscriptionId, nowIso);

  if (!sub?.user_id) return revoked ? "subscription_refunded" : "skipped";

  const { resolvePlanForPrice, syncCrmSubscriptionState } =
    await import("@/lib/billing/purchaseEffects.server");
  const plan = sub.price_id ? await resolvePlanForPrice(sub.price_id) : null;

  // CRM: zwrot to utrata klienta, nie pauza.
  const { catalogEntryByPriceId } = await import("@/lib/billing/catalog");
  const tierKey = sub.price_id ? (catalogEntryByPriceId(sub.price_id)?.tierKey ?? null) : null;
  if (tierKey) await syncCrmSubscriptionState(sub.user_id, tierKey, "churned");

  const { notifyRefundEmail } = await import("@/lib/billing/notifications.server");
  await notifyRefundEmail({
    userId: sub.user_id,
    planId: plan?.planId ?? null,
    amountCents: event.amountCents,
    currency: event.currency,
    transactionId: event.transactionId,
    accessUntil: nowIso,
    idempotencySeed: event.adjustmentId,
  });

  await pushRefundNotification(sub.user_id, plan?.tenantId ?? null, reasonLabel(event.action));

  return "subscription_refunded";
}

/** Odbiera uprawnienie zakupu jednorazowego (odblokowanie treści, bilet). */
async function revokeOrder(event: RefundEvent): Promise<RefundOutcome> {
  const supabase = await admin();
  const txnId = event.transactionId;
  if (!txnId) return "skipped";

  const nowIso = new Date().toISOString();

  // Zwrot przychodzi z identyfikatorem intencji płatności, a zamówienie mogło
  // zapisać sesję checkout albo (historycznie) sesję w polu intencji. Szukamy
  // po wszystkich trzech, inaczej zwrot cicho nie odbierałby dostępu.
  const { data: matches, error } = await supabase
    .from("payment_orders")
    .select("id, user_id, tenant_id, plan_id, kind, entity_type, entity_id, metadata")
    .or(
      `provider_payment_intent_id.eq.${txnId},provider_intent_id.eq.${txnId},provider_session_id.eq.${txnId}`,
    )
    .limit(1);
  const order = matches?.[0] ?? null;
  if (error) throw new Error(`refund: order lookup failed: ${error.message}`);
  if (!order) return await revokeDonation(event, txnId);

  const { error: updateErr } = await supabase
    .from("payment_orders")
    .update({ status: "refunded", updated_at: nowIso })
    .eq("id", order.id)
    .neq("status", "refunded");
  if (updateErr) throw new Error(`refund: order status flip failed: ${updateErr.message}`);

  const { revokeOrderEntitlement } = await import("@/lib/billing/grant.server");
  await revokeOrderEntitlement(order, nowIso);

  // Bilet na wydarzenie: zwrot cofa potwierdzony udział.
  const metadata = (order.metadata ?? {}) as Record<string, unknown>;
  const eventId = typeof metadata.event_id === "string" ? metadata.event_id : null;
  if (eventId && order.user_id) {
    const { error: rsvpErr } = await supabase
      .from("event_rsvps")
      .update({ status: "canceled", updated_at: nowIso })
      .eq("event_id", eventId)
      .eq("user_id", order.user_id);
    if (rsvpErr) throw new Error(`refund: rsvp cancel failed: ${rsvpErr.message}`);

    // Zwolnione miejsce wraca do puli, a pierwsza osoba z listy rezerwowej
    // wchodzi na jej miejsce - w tej samej operacji co anulowanie zgłoszenia.
    const { applyTicketOutcome } = await import("@/lib/billing/oneTimeFulfilment.server");
    await applyTicketOutcome(order.id, "refunded");
  }

  if (order.user_id) {
    const { notifyRefundEmail } = await import("@/lib/billing/notifications.server");
    await notifyRefundEmail({
      userId: order.user_id,
      planId: order.plan_id,
      amountCents: event.amountCents,
      currency: event.currency,
      transactionId: txnId,
      accessUntil: nowIso,
      idempotencySeed: event.adjustmentId,
    });
    await pushRefundNotification(order.user_id, order.tenant_id, reasonLabel(event.action));
  }

  return "order_refunded";
}

/** Zwrot darowizny - bez uprawnień, ale status musi się zgadzać z księgami. */
async function revokeDonation(_event: RefundEvent, txnId: string): Promise<RefundOutcome> {
  const supabase = await admin();
  const { data, error } = await supabase
    .from("donations")
    .update({ status: "refunded" })
    .eq("provider_intent_id", txnId)
    .neq("status", "refunded")
    .select("id");
  if (error) throw new Error(`refund: donation status flip failed: ${error.message}`);
  return data && data.length > 0 ? "donation_refunded" : "skipped";
}

/** Dzwonek w aplikacji. Nigdy nie rzuca. */
async function pushRefundNotification(
  userId: string,
  tenantId: string | null,
  reason: string,
): Promise<void> {
  if (!tenantId) return;
  try {
    const supabase = await admin();
    await supabase.from("notifications").insert({
      user_id: userId,
      tenant_id: tenantId,
      kind: "billing",
      title_pl: reason === "chargeback" ? "Obciążenie zwrotne" : "Zwrot płatności",
      title_en: reason === "chargeback" ? "Chargeback" : "Payment refunded",
      body_pl: "Dostęp powiązany ze zwróconą płatnością został zakończony.",
      body_en: "Access linked to the refunded payment has ended.",
      href: PROFILE_PLAN_PATH,
      icon: "receipt",
    });
  } catch (err) {
    console.error("[payments] refund notification failed", err);
  }
}

/**
 * Alert dla zespołu przy sporze. Spór wymaga ludzkiej reakcji (dowody dla
 * banku w terminie), więc zawsze musi zostawić ślad w panelu. Nigdy nie rzuca.
 */
async function alertAdminsAboutDispute(event: RefundEvent, phase: "opened" | "won"): Promise<void> {
  try {
    const supabase = await admin();
    const { data: admins } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");
    if (!admins || admins.length === 0) return;

    const ids = admins.map((r) => r.user_id);
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, tenant_id")
      .in("id", ids);
    if (!profiles || profiles.length === 0) return;

    const ref = event.transactionId ?? event.subscriptionId ?? event.adjustmentId;
    const rows = profiles
      .filter((p) => Boolean(p.tenant_id))
      .map((p) => ({
        user_id: p.id,
        tenant_id: p.tenant_id as string,
        kind: "billing",
        title_pl: phase === "opened" ? "Otwarto spór płatniczy" : "Spór płatniczy rozstrzygnięty",
        title_en: phase === "opened" ? "Payment dispute opened" : "Payment dispute resolved",
        body_pl:
          phase === "opened"
            ? `Bank otworzył spór dla ${ref}. Dostęp klienta został wstrzymany - przygotuj dowody.`
            : `Spór dla ${ref} rozstrzygnięto na naszą korzyść. Dostęp klienta przywrócono.`,
        body_en:
          phase === "opened"
            ? `A dispute was opened for ${ref}. Customer access is suspended - prepare evidence.`
            : `The dispute for ${ref} was won. Customer access has been restored.`,
        href: "/admin/billing",
        icon: "shield-alert",
      }));
    if (rows.length > 0) await supabase.from("notifications").insert(rows);
  } catch (err) {
    console.error("[payments] dispute admin alert failed", err);
  }
}

/**
 * Przywrócenie dostępu po wygranym sporze. Odwraca dokładnie to, co zrobiło
 * odebranie: status źródła płatności wraca na opłacony, a uprawnienie jest
 * nadawane ponownie na tych samych zasadach co przy pierwotnym zakupie.
 */
async function restoreAccess(event: RefundEvent): Promise<RefundOutcome> {
  const supabase = await admin();
  const nowIso = new Date().toISOString();

  if (event.subscriptionId) {
    const { data: sub, error } = await supabase
      .from("subscriptions")
      .select("user_id, price_id, status, current_period_end")
      .eq("provider_subscription_id", event.subscriptionId)
      .eq("environment", event.environment)
      .maybeSingle();
    if (error) throw new Error(`dispute: subscription lookup failed: ${error.message}`);
    if (!sub?.user_id || !sub.price_id) return "skipped";

    const { resolvePlanForPrice } = await import("@/lib/billing/purchaseEffects.server");
    const plan = await resolvePlanForPrice(sub.price_id);
    if (plan) {
      const { syncEntitlementState } = await import("@/lib/billing/entitlementSync.server");
      await syncEntitlementState({
        userId: sub.user_id,
        tenantId: plan.tenantId,
        planId: plan.planId,
        externalRef: event.subscriptionId,
        status: sub.status ?? "active",
        periodEnd: sub.current_period_end ?? null,
      });
    }
    await alertAdminsAboutDispute(event, "won");
    return "subscription_restored";
  }

  if (!event.transactionId) return "skipped";

  const { data: order, error: orderErr } = await supabase
    .from("payment_orders")
    .select(
      "id, user_id, tenant_id, plan_id, kind, entity_type, entity_id, metadata, amount_cents, currency",
    )
    .eq("provider_intent_id", event.transactionId)
    .maybeSingle();
  if (orderErr) throw new Error(`dispute: order lookup failed: ${orderErr.message}`);
  if (!order) return "skipped";

  const { error: flipErr } = await supabase
    .from("payment_orders")
    .update({ status: "paid", updated_at: nowIso })
    .eq("id", order.id);
  if (flipErr) throw new Error(`dispute: order status flip failed: ${flipErr.message}`);

  const { grantEntitlement } = await import("@/lib/billing/grant.server");
  await grantEntitlement(order, event.transactionId);

  const metadata = (order.metadata ?? {}) as Record<string, unknown>;
  const eventId = typeof metadata.event_id === "string" ? metadata.event_id : null;
  if (eventId && order.user_id) {
    const { error: rsvpErr } = await supabase
      .from("event_rsvps")
      .update({ status: "going", updated_at: nowIso })
      .eq("event_id", eventId)
      .eq("user_id", order.user_id);
    if (rsvpErr) throw new Error(`dispute: rsvp restore failed: ${rsvpErr.message}`);
  }

  await alertAdminsAboutDispute(event, "won");
  return "order_restored";
}

/**
 * Jedno wejście dla zwrotów i sporów. Kieruje korektę do właściwego skutku:
 * wygrany spór -> przywrócenie; zwrot/spór otwarty -> odebranie dostępu
 * (subskrypcja -> zamówienie jednorazowe -> darowizna).
 */
export async function applyRefundEffects(event: RefundEvent): Promise<RefundOutcome> {
  if (isDisputeReversed(event)) return restoreAccess(event);
  if (!isRevokingAdjustment(event)) return "skipped";
  if (event.action === "chargeback" || event.action === "chargeback_warning") {
    await alertAdminsAboutDispute(event, "opened");
  }
  if (event.subscriptionId) return revokeSubscription(event);
  if (event.transactionId) return revokeOrder(event);
  console.warn("[payments] adjustment without transaction or subscription", event.adjustmentId);
  return "skipped";
}
