// Realizacja płatności jednorazowych dostawcy (transakcje bez subskrypcji).
//
// Jedno miejsce, w którym „transakcja opłacona” zamienia się w skutek
// biznesowy - tak jak grant.server jest jedynym miejscem nadawania uprawnień:
//   - `kind=order`     -> payment_orders: nadanie uprawnienia, zaksięgowanie,
//                         efekty kuponu B2B, maile (subskrypcja / wydarzenie),
//                         potwierdzenie RSVP dla biletu na wydarzenie,
//   - `kind=donation`  -> INSERT do public.donations (idempotentnie po id
//                         transakcji).
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

export type OneTimeOutcome = "skipped" | "order" | "donation";

function str(source: Record<string, unknown> | null, key: string): string | null {
  const v = source?.[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
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
  const { notifySubscriptionEmail, notifyEventRegistration } = await import(
    "@/lib/billing/notifications.server"
  );
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

async function fulfilDonation(txn: OneTimeTransaction): Promise<OneTimeOutcome> {
  const tenantId = str(txn.customData, "tenant_id");
  if (!tenantId) {
    console.warn("[payments] donation without tenant_id", txn.id);
    return "skipped";
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("donations").upsert(
    {
      tenant_id: tenantId,
      amount_cents: txn.amountCents ?? 0,
      currency: (txn.currency ?? "PLN").toUpperCase(),
      message: str(txn.customData, "message"),
      user_id: str(txn.customData, "user_id"),
      donor_email: txn.customerEmail,
      provider: "paddle",
      provider_session_id: txn.id,
      provider_intent_id: txn.id,
      status: "paid",
    },
    { onConflict: "provider_session_id", ignoreDuplicates: true },
  );
  if (error) throw new Error(`one-time: donation insert failed: ${error.message}`);
  return "donation";
}

/** Rozdziela opłaconą transakcję jednorazową na właściwy skutek biznesowy. */
export async function fulfilOneTimeTransaction(txn: OneTimeTransaction): Promise<OneTimeOutcome> {
  const kind = str(txn.customData, "kind");
  if (kind === "donation") return fulfilDonation(txn);

  const orderId = str(txn.customData, "order_id");
  if (orderId) return fulfilOrder(txn, orderId);

  console.warn("[payments] one-time transaction without recognised custom_data", txn.id);
  return "skipped";
}
