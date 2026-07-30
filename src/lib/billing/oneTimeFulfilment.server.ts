// Realizacja płatności jednorazowych dostawcy (transakcje bez subskrypcji).
//
// Jedno miejsce, w którym „transakcja opłacona” zamienia się w skutek
// biznesowy - tak jak grant.server jest jedynym miejscem nadawania uprawnień:
//   - `kind=order` -> payment_orders: nadanie uprawnienia, zaksięgowanie,
//                     efekty kuponu B2B, maile (subskrypcja / wydarzenie),
//                     potwierdzenie RSVP dla biletu na wydarzenie.
//
// Darowizny NIE przechodzą przez dostawcę (AUP Paddle) - zbiera je zewnętrzny
// serwis zbiórkowy (donationsExternal.ts). Zabłąkany webhook `kind=donation`
// z historycznej transakcji jest logowany i pomijany bez zapisu.
//
// Kontrakt błędów: funkcja RZUCA przy awarii zapisu. Webhook zamienia wyjątek
// na 500, więc dostawca ponawia dostarczenie i realizacja się dokończy.
// Nadanie uprawnienia idzie ZAWSZE przed przestawieniem statusu - retry po
// nieudanym grancie nie może zostać pominięty przez `status='paid'`.

export interface OneTimeTransaction {
  /** Identyfikator transakcji u dostawcy - klucz idempotencji. */
  id: string;
  amountCents: number | null;
  currency: string | null;
  customerEmail: string | null;
  customData: Record<string, unknown> | null;
}

export type OneTimeOutcome = "skipped" | "order" | "oversold_refunded";

function str(source: Record<string, unknown> | null, key: string): string | null {
  const v = source?.[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * Ostatnia bramka limitu miejsc - już po pobraniu pieniędzy.
 *
 * Sprawdzenie przy tworzeniu zamówienia nie wystarcza: między nakładką
 * płatności a webhookiem ostatnie miejsce może zająć ktoś inny. Zamiast
 * sprzedać nieistniejące wejście zwracamy całą kwotę i zostawiamy zamówienie
 * jako zwrócone. Zwraca `true`, gdy zamówienie zostało zamknięte zwrotem.
 */
async function refundIfOversold(
  txn: OneTimeTransaction,
  order: { id: string; user_id: string; tenant_id: string | null; plan_id: string | null },
  eventId: string,
  amountCents: number | null,
  currency: string,
): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { assertSeatAvailable } = await import("@/lib/events/ticket.server");

  try {
    await assertSeatAvailable(supabaseAdmin, eventId, order.user_id);
    return false;
  } catch (err) {
    if (!(err instanceof Error) || err.message !== "event_full") throw err;
  }

  const { resolveEnvironment } = await import("@/lib/billing/paddleTransaction.server");
  const { refundTransactionFully } = await import("@/lib/billing/paddleRefund.server");
  const refund = await refundTransactionFully(resolveEnvironment(null), txn.id, "oversold");
  if (!refund.ok) {
    // Zwrot nie przeszedł u operatora - nie wolno udawać, że sprawa jest
    // zamknięta. Rzucamy, żeby webhook został ponowiony.
    throw new Error(`one-time: oversold refund failed (${txn.id}): ${refund.error}`);
  }

  const nowIso = new Date().toISOString();
  const { error: flipErr } = await supabaseAdmin
    .from("payment_orders")
    .update({
      status: "refunded",
      provider: "paddle",
      provider_intent_id: txn.id,
      updated_at: nowIso,
      ...(txn.customerEmail ? { receipt_email: txn.customerEmail } : {}),
    })
    .eq("id", order.id);
  if (flipErr) throw new Error(`one-time: oversold status flip failed: ${flipErr.message}`);

  const { notifyRefundEmail } = await import("@/lib/billing/notifications.server");
  await notifyRefundEmail({
    userId: order.user_id,
    planId: order.plan_id,
    amountCents,
    currency,
    transactionId: txn.id,
    accessUntil: nowIso,
    idempotencySeed: `oversold:${order.id}`,
  });

  if (order.tenant_id) {
    await supabaseAdmin.from("notifications").insert({
      user_id: order.user_id,
      tenant_id: order.tenant_id,
      kind: "billing",
      title_pl: "Brak wolnych miejsc - zwrot płatności",
      title_en: "Event sold out - payment refunded",
      body_pl: "Ostatnie miejsce zajęto przed zaksięgowaniem płatności. Zwróciliśmy pełną kwotę.",
      body_en: "The last seat was taken before your payment settled. We refunded the full amount.",
      href: "/profile/tickets",
      icon: "receipt",
    });
  }

  return true;
}

async function fulfilOrder(txn: OneTimeTransaction, orderId: string): Promise<OneTimeOutcome> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { grantEntitlement } = await import("@/lib/billing/grant.server");

  const { data: order, error } = await supabaseAdmin
    .from("payment_orders")
    .select(
      "id, user_id, tenant_id, plan_id, kind, entity_type, entity_id, amount_cents, currency, metadata",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw new Error(`one-time: order lookup failed: ${error.message}`);
  if (!order) {
    console.warn("[payments] one-time: unknown order", orderId);
    return "skipped";
  }

  const amountCents = txn.amountCents ?? order.amount_cents;
  const currency = (txn.currency ?? order.currency ?? "PLN").toUpperCase();

  const preMetadata = (order.metadata ?? {}) as Record<string, unknown>;
  const ticketEventId = str(preMetadata, "event_id");

  // 0. Bilet: autorytatywna kontrola miejsc PRZED nadaniem uprawnienia.
  if (ticketEventId && order.user_id) {
    const refunded = await refundIfOversold(
      txn,
      { id: order.id, user_id: order.user_id, tenant_id: order.tenant_id, plan_id: order.plan_id },
      ticketEventId,
      amountCents,
      currency,
    );
    if (refunded) return "oversold_refunded";
  }

  // 1. Uprawnienie (idempotentne) - zanim cokolwiek uzna zamówienie za opłacone.
  await grantEntitlement({ ...order, amount_cents: amountCents }, txn.id);

  // 2. Księgowanie - `paid_at` stemplowane dokładnie raz mimo ponowień.
  const { error: updateErr } = await supabaseAdmin
    .from("payment_orders")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      provider: "paddle",
      provider_intent_id: txn.id,
      provider_session_id: txn.id,
      amount_cents: amountCents,
      currency,
      ...(txn.customerEmail ? { receipt_email: txn.customerEmail } : {}),
    })
    .eq("id", order.id)
    .neq("status", "paid");
  if (updateErr) throw new Error(`one-time: order paid flip failed: ${updateErr.message}`);

  // 3. Efekty kuponu B2B - fail-closed na `status='paid'`, więc dopiero teraz.
  const { applyCouponEffectsForOrder } = await import("@/lib/billing/couponEffects.server");
  await applyCouponEffectsForOrder(order.id);

  const metadata = (order.metadata ?? {}) as Record<string, unknown>;
  const eventId = str(metadata, "event_id");

  // 4. Bilet na wydarzenie: opłacenie = potwierdzony zapis.
  if (eventId) {
    const { error: rsvpErr } = await supabaseAdmin.from("event_rsvps").upsert(
      {
        tenant_id: order.tenant_id,
        event_id: eventId,
        user_id: order.user_id,
        status: "going",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "event_id,user_id" },
    );
    if (rsvpErr) throw new Error(`one-time: rsvp confirm failed: ${rsvpErr.message}`);
  }

  // 5. Powiadomienia (fail-soft, idempotentne po id zamówienia).
  const { notifySubscriptionEmail, notifyEventRegistration } =
    await import("@/lib/billing/notifications.server");
  if (order.kind === "subscription") {
    await notifySubscriptionEmail({
      kind: "subscription_confirmed",
      userId: order.user_id,
      planId: order.plan_id,
      amountCents,
      currency,
      idempotencySeed: order.id,
    });
  }
  if (eventId) {
    await notifyEventRegistration({
      userId: order.user_id,
      eventId,
      amountCents,
      currency,
      transactionId: txn.id,
      ticketSeed: order.id,
      idempotencySeed: order.id,
    });
  }
  return "order";
}

/** Rozdziela opłaconą transakcję jednorazową na właściwy skutek biznesowy. */
export async function fulfilOneTimeTransaction(txn: OneTimeTransaction): Promise<OneTimeOutcome> {
  const kind = str(txn.customData, "kind");
  if (kind === "donation") {
    // Darowizny przeniesione do zewnętrznego serwisu zbiórkowego - dostawca
    // nie tworzy już takich transakcji, więc to może być tylko ponowienie
    // historycznego webhooka. Bez zapisu; wpłata jest już zaksięgowana.
    console.warn("[payments] donation webhook ignored (donations moved off-provider)", txn.id);
    return "skipped";
  }

  const orderId = str(txn.customData, "order_id");
  if (orderId) return fulfilOrder(txn, orderId);

  console.warn("[payments] one-time transaction without recognised custom_data", txn.id);
  return "skipped";
}
