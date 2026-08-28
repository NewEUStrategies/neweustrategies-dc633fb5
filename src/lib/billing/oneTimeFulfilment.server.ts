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

import type { SupabaseClient } from "@supabase/supabase-js";
import type { StripeEnv } from "@/lib/stripe.server";

export interface OneTimeTransaction {
  /** Identyfikator transakcji u dostawcy - klucz idempotencji. */
  id: string;
  amountCents: number | null;
  currency: string | null;
  customerEmail: string | null;
  customData: Record<string, unknown> | null;
  /** Identyfikator sesji checkout (gdy zdarzenie pochodzi z sesji). */
  sessionId?: string | null;
  /** Identyfikator intencji płatności - po nim przychodzi zwrot. */
  paymentIntentId?: string | null;
  /** Identyfikator klienta u operatora - powtarzalne płatności i portal. */
  customerId?: string | null;
}

export type OneTimeOutcome = "skipped" | "order" | "donation" | "oversold_refunded";

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

  const { resolveEnvironment } = await import("@/lib/billing/transactions.server");
  const { refundTransactionFully } = await import("@/lib/billing/refundProvider.server");
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
      provider: "stripe",
      provider_intent_id: txn.id,
      updated_at: nowIso,
      ...(txn.customerEmail ? { receipt_email: txn.customerEmail } : {}),
    })
    .eq("id", order.id);
  if (flipErr) throw new Error(`one-time: oversold status flip failed: ${flipErr.message}`);

  await applyTicketOutcome(order.id, "refunded");

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

/**
 * Przenosi wynik płatności na zgłoszenie uczestnika (potwierdzenie, brak
 * zapłaty, zwrot + promocja z listy rezerwowej). Jedna funkcja bazowa, więc
 * webhook i panel admina dają identyczny skutek. Fail-soft: zamówienie jest
 * już zaksięgowane, a brak zgłoszenia to normalny przypadek (RSVP bez
 * formularza).
 */
export async function applyTicketOutcome(
  orderId: string,
  outcome: "paid" | "unpaid" | "refunded" | "partial_refund",
  /**
   * Suma zwrócona narastająco (Stripe przysyła `amount_refunded` kumulatywnie).
   * Baza sama zdecyduje, czy to jeszcze korekta ceny, czy już pełny zwrot -
   * dzięki temu próg „miejsce wraca do puli" ma JEDNO miejsce w systemie.
   */
  refundedCents?: number | null,
): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("payments_apply_event_ticket_outcome", {
    p_order_id: orderId,
    p_outcome: outcome,
    p_refunded_cents:
      typeof refundedCents === "number" && Number.isFinite(refundedCents)
        ? Math.max(0, Math.round(refundedCents))
        : undefined,
  });
  if (error) {
    console.error("[payments] ticket outcome failed", orderId, outcome, error.message);
    return;
  }

  // Powiadomienie idzie po zapisie i nigdy go nie unieważnia (fail-soft).
  try {
    const { notifyTicketOutcome } = await import("@/lib/events/registrationOutcomeNotify.server");
    await notifyTicketOutcome((data ?? {}) as Record<string, unknown>);
  } catch (err) {
    console.error("[payments] ticket outcome notify failed", orderId, err);
  }
}

/**
 * Nieudana płatność jednorazowa - oznaczamy zgłoszenie jako nieopłacone.
 * Statusu zamówienia nie ruszamy: to robi ścieżka windykacji.
 */
export async function markOneTimePaymentFailed(
  customData: Record<string, unknown> | null,
): Promise<void> {
  const orderId = str(customData, "orderId") ?? str(customData, "order_id");
  if (!orderId) return;
  await applyTicketOutcome(orderId, "unpaid");
}

async function fulfilOrder(
  txn: OneTimeTransaction,
  orderId: string,
  env: StripeEnv,
): Promise<OneTimeOutcome> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { grantEntitlement } = await import("@/lib/billing/grant.server");

  // `environment` (kolumna z 20260731220000) nie jest jeszcze w wygenerowanym
  // types.ts; nazwanie jej w .select() zatruwałoby typ całego wiersza, więc dla
  // tego odczytu rzutujemy klienta na luźny typ (konwencja jak invoice.server).
  const { data: order, error } = await (supabaseAdmin as unknown as SupabaseClient)
    .from("payment_orders")
    .select(
      "id, user_id, tenant_id, plan_id, kind, entity_type, entity_id, amount_cents, currency, metadata, environment",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw new Error(`one-time: order lookup failed: ${error.message}`);
  if (!order) {
    console.warn("[payments] one-time: unknown order", orderId);
    return "skipped";
  }

  // IZOLACJA SANDBOX/LIVE (P0): realizujemy zamówienie WYŁĄCZNIE zdarzeniem z
  // tego samego środowiska, w którym powstało. Bez tego sandboxowy webhook
  // (opłacony kartą testową) mógłby zrealizować realne zamówienie. Odpowiednik
  // `.eq("environment", env)` ze ścieżki subskrypcyjnej.
  const orderEnv = (order as { environment?: string }).environment ?? "live";
  if (orderEnv !== env) {
    console.warn(
      `[payments] one-time: environment mismatch - order ${orderId} is '${orderEnv}', webhook is '${env}'; skipping`,
    );
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
      provider: "stripe",
      provider_intent_id: txn.id,
      provider_session_id: txn.sessionId ?? txn.id,
      ...(txn.paymentIntentId ? { provider_payment_intent_id: txn.paymentIntentId } : {}),
      ...(txn.customerId ? { provider_customer_id: txn.customerId } : {}),
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

  // Zamówienie zanonimizowane (konto usunięte, dowód księgowy został -
  // migracja 20260803090002): punkty 1-3 wciąż mają sens, bo dotyczą ksiąg.
  // RSVP, dzwonek i mail nie mają już adresata - kończymy tutaj, zamiast
  // rzucać i skazywać webhook na wieczne ponowienia.
  if (!order.user_id) {
    console.warn("[payments] one-time: order has no owner (anonymised), effects skipped", order.id);
    return "order";
  }

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

    // Bilet imienny: to samo zdarzenie płatności potwierdza zgłoszenie z
    // formularza, wydaje kod QR i zdejmuje wpis z listy rezerwowej.
    await applyTicketOutcome(order.id, "paid");
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
export async function fulfilOneTimeTransaction(
  txn: OneTimeTransaction,
  env: StripeEnv,
): Promise<OneTimeOutcome> {
  // `kind` to nazwa historyczna (Paddle), `purpose` - obecna (Stripe).
  const kind = str(txn.customData, "purpose") ?? str(txn.customData, "kind");
  if (kind === "donation") {
    // Darowizny mają własny rejestr (`donations`) - księgujemy je tutaj, a nie
    // przez payment_orders: nie nadają żadnego uprawnienia.
    const { settleDonation } = await import("@/lib/billing/donations.server");
    const settled = await settleDonation({
      donationId: str(txn.customData, "donationId"),
      sessionId: str(txn.customData, "sessionId") ?? txn.id,
      intentId: txn.id,
      amountCents: txn.amountCents,
      currency: txn.currency,
      donorEmail: txn.customerEmail,
    });
    return settled ? "donation" : "skipped";
  }

  const orderId = str(txn.customData, "orderId") ?? str(txn.customData, "order_id");
  if (orderId) return fulfilOrder(txn, orderId, env);

  console.warn("[payments] one-time transaction without recognised custom_data", txn.id);
  return "skipped";
}
