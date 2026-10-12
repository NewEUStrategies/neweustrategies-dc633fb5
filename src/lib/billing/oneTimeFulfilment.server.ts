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
//
// Cykl życia zamówienia poza „opłacone" też mieszka tutaj - każda kasa, która
// nie kończy się płatnością, MUSI zamknąć zamówienie i oddać rezerwację kuponu
// (inaczej limitowany kod wyczerpują same porzucone kasy):
//   - sesja wygasła (`expireCheckoutOrder`) -> `canceled`,
//   - płatność asynchroniczna odrzucona (`markOneTimePaymentFailed`) -> `failed`,
//   - pierwsza sesja subskrypcji (`settleSubscriptionCheckoutOrder`) -> `paid`
//     BEZ uprawnienia (to nadaje ścieżka `subscription.*`).
//
// Kwota: zamówienie przechowuje kwotę PO naszym kuponie, PRZED podatkiem.
// Realizacja porównuje ją z sesją operatora (`subtotal - rabat`); rozjazd nie
// blokuje księgowania (pieniądze już pobrano), ale oznacza zamówienie do
// weryfikacji i alarmuje administratorów najemcy.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Json } from "@/integrations/supabase/types";
import type { StripeEnv } from "@/lib/stripe.server";
import type { TicketOutcomePayload } from "@/lib/events/registrationOutcomeNotify.server";
import { paidSeatConfirmed } from "@/lib/events/paidAdmission";

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
  /** Subskrypcja operatora założona tą sesją (tylko sesja w trybie `subscription`). */
  subscriptionId?: string | null;
  /** Suma pozycji przed rabatem i podatkiem (`amount_subtotal`). */
  amountSubtotalCents?: number | null;
  /** Rabat zdjęty przez operatora (`total_details.amount_discount`). */
  amountDiscountCents?: number | null;
  /** Podatek doliczony przez operatora (`total_details.amount_tax`). */
  amountTaxCents?: number | null;
  /** Kody promocyjne operatora z sesji (`TransactionData.promotionCodeIds`). */
  promotionCodeIds?: string[] | null;
  /**
   * Skąd pochodzi transakcja (`TransactionData.source`): sesja Checkout albo
   * faktura subskrypcji (pierwsza opłacona faktura domyka zamówienie trialu).
   */
  source?: "checkout_session" | "invoice" | null;
  /** Chwila pobrania wg operatora (czas zdarzenia) - `paid_at` zamówienia. */
  paidAt?: string | null;
}

export type OneTimeOutcome = "skipped" | "order" | "donation" | "oversold_refunded";

function str(source: Record<string, unknown> | null, key: string): string | null {
  const v = source?.[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * Statusy, z których wolno przejść na `paid`. NIE `refunded` (zwrot wyprzedził
 * realizację - pieniądze już wróciły) i NIE `canceled` (zamówienie zamknięte,
 * rezerwacja kuponu oddana). `failed` tak: porażka mogła dotyczyć wcześniejszej
 * próby, a operator potwierdza właśnie pobrane pieniądze.
 */
const PAYABLE_STATUSES = ["pending", "processing", "failed"] as const;

/** Statusy kasy w toku - jedyne, które zamyka wygaśnięcie albo porażka płatności. */
const OPEN_STATUSES = ["pending", "processing"] as const;

/** Tolerancja porównania kwot: jedna jednostka waluty (zaokrąglenia operatora). */
const AMOUNT_TOLERANCE_CENTS = 1;

/** Zamówienie w kształcie czytanym przez cykl życia (wygaśnięcie, porażka, domknięcie). */
interface LifecycleOrder {
  id: string;
  user_id: string | null;
  tenant_id: string | null;
  plan_id: string | null;
  kind: string;
  status: string | null;
  amount_cents: number | null;
  currency: string | null;
  refunded_amount_cents: number | null;
  metadata: Record<string, unknown> | null;
  environment?: string;
  provider_session_id: string | null;
}

const LIFECYCLE_COLUMNS =
  "id, user_id, tenant_id, plan_id, kind, status, amount_cents, currency, refunded_amount_cents, metadata, environment, provider_session_id";

function orderIdOf(customData: Record<string, unknown> | null): string | null {
  return str(customData, "orderId") ?? str(customData, "order_id");
}

async function loadLifecycleOrder(orderId: string, scope: string): Promise<LifecycleOrder | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await (supabaseAdmin as unknown as SupabaseClient)
    .from("payment_orders")
    .select(LIFECYCLE_COLUMNS)
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw new Error(`${scope}: order lookup failed: ${error.message}`);
  if (!data) console.warn(`[payments] ${scope}: unknown order`, orderId);
  return (data as LifecycleOrder | null) ?? null;
}

/**
 * Izolacja sandbox/live (P0) - ta sama reguła co w `fulfilOrder`: zdarzenie
 * z piaskownicy nie zamyka i nie domyka zamówienia produkcyjnego. Wiersz bez
 * kolumny środowiska jest zamówieniem `live` (20260731220000).
 */
function sameEnvironment(
  order: { id: string; environment?: string },
  env: StripeEnv,
  scope: string,
) {
  const orderEnv = order.environment ?? "live";
  if (orderEnv === env) return true;
  console.warn(
    `[payments] ${scope}: environment mismatch - order ${order.id} is '${orderEnv}', webhook is '${env}'; skipping`,
  );
  return false;
}

/**
 * Zamyka kasę, która nie skończy się płatnością (`canceled` po wygaśnięciu,
 * `failed` po odrzuconej płatności). Warunkowo - wyłącznie z `pending` /
 * `processing` - więc spóźnione zdarzenie nie cofnie zamówienia opłaconego
 * ani zwróconego. Zwraca `true`, gdy TO wywołanie zmieniło status.
 */
async function closeOpenOrder(
  order: LifecycleOrder,
  status: "canceled" | "failed",
  scope: string,
): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("payment_orders")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", order.id)
    .in("status", [...OPEN_STATUSES])
    .select("id");
  if (error) throw new Error(`${scope}: order status flip failed: ${error.message}`);
  return (data ?? []).length > 0;
}

/**
 * Oddaje rezerwację kuponu zamówienia, którego nikt nie opłaci.
 *
 * `_redeem_b2b_coupon` zajmuje użycie już przy ZAKŁADANIU zamówienia, a kasa
 * oddawała je wyłącznie przy błędzie tworzenia sesji - porzucona albo
 * odrzucona płatność trzymała użycie na zawsze. Baza oddaje je wyłącznie dla
 * nieopłaconego (`pending` / `failed` / `canceled`) zamówienia TEGO konta
 * w TYM najemcy (20261007140200), więc wołamy PO zamknięciu statusu,
 * z najemcą i kontem z NASZEGO wiersza. Idempotentne: drugie wywołanie oddaje
 * `false`, dlatego wolno je powtarzać przy każdej dostawie zdarzenia.
 *
 * Błąd RZUCA - webhook zostanie ponowiony, a zamknięty już status nie
 * zablokuje ponownej próby zwolnienia.
 */
async function releaseOrderCoupon(order: LifecycleOrder, scope: string): Promise<boolean> {
  const couponId = str(order.metadata, "coupon_id");
  if (!couponId || !order.user_id || !order.tenant_id) return false;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { releaseCouponForUser } = await import("@/lib/billing/couponRpc.server");
  const { data, error } = await releaseCouponForUser(supabaseAdmin, {
    tenantId: order.tenant_id,
    userId: order.user_id,
    couponId,
    orderId: order.id,
  });
  if (error) throw new Error(`${scope}: coupon release failed (${order.id}): ${error.message}`);
  return data === true;
}

/** Wynik porównania kwoty pobranej przez operatora z kwotą zamówienia. */
interface AmountReview {
  /** Kwota pobrana za pozycje po rabacie, przed podatkiem; `null` = brak danych. */
  chargedCents: number | null;
  /** Waluta pobrania (wielkie litery). */
  currency: string;
  /** Flaga do `metadata.review`, gdy kwota albo waluta się nie zgadza. */
  mismatch: {
    reason: "amount_mismatch";
    expected_cents: number;
    expected_currency: string;
    charged_cents: number;
    currency: string;
    flagged_at: string;
  } | null;
}

/**
 * Kwota porównywalna z zamówieniem: `subtotal - rabat` (niezależnie od tego,
 * czy podatek jest wliczony, czy doliczany na wierzch). Bez rozbicia (stary
 * ładunek) - suma końcowa minus podatek.
 */
function chargedCentsOf(txn: OneTimeTransaction): number | null {
  if (typeof txn.amountSubtotalCents === "number") {
    return txn.amountSubtotalCents - (txn.amountDiscountCents ?? 0);
  }
  if (typeof txn.amountCents === "number") return txn.amountCents - (txn.amountTaxCents ?? 0);
  return null;
}

/**
 * Porównanie kwoty z zamówieniem. Zamówienie przechowuje kwotę PO naszym
 * kuponie, PRZED podatkiem (kontrakt obu silników kasy). Rozjazd oznacza, że
 * u operatora zadziałało coś, czego nasza baza nie kontroluje: kod promocyjny
 * Stripe spoza `b2b_coupons`, cena podmieniona w katalogu albo inna waluta.
 */
function reviewAmount(
  txn: OneTimeTransaction,
  order: { amount_cents: number | null; currency: string | null },
): AmountReview {
  const chargedCents = chargedCentsOf(txn);
  const expectedCurrency = (order.currency ?? "PLN").toUpperCase();
  const currency = (txn.currency ?? order.currency ?? "PLN").toUpperCase();
  const expected = order.amount_cents;
  const differs =
    chargedCents !== null &&
    typeof expected === "number" &&
    (currency !== expectedCurrency || Math.abs(chargedCents - expected) > AMOUNT_TOLERANCE_CENTS);
  return {
    chargedCents,
    currency,
    mismatch: differs
      ? {
          reason: "amount_mismatch",
          expected_cents: expected,
          expected_currency: expectedCurrency,
          charged_cents: chargedCents,
          currency,
          flagged_at: new Date().toISOString(),
        }
      : null,
  };
}

function withReviewFlag(
  metadata: Record<string, unknown> | null,
  mismatch: NonNullable<AmountReview["mismatch"]>,
): Json {
  return { ...(metadata ?? {}), review: mismatch } as Json;
}

function formatCents(cents: number, currency: string): string {
  return `${(cents / 100).toFixed(2)} ${currency}`;
}

/**
 * Alarm dla administratorów najemcy: zamówienie wymaga weryfikacji. Ślad
 * w logu zawsze, dzwonek - tylko w najemcy zamówienia. Nigdy nie rzuca:
 * księgowanie płatności już się odbyło i nie może się na alercie wywrócić.
 */
async function alertOrderReview(
  order: { id: string; tenant_id: string | null },
  mismatch: NonNullable<AmountReview["mismatch"]>,
): Promise<void> {
  console.error("[payments] amount mismatch - order flagged for review", order.id, mismatch);
  if (!order.tenant_id) return;
  try {
    const expected = formatCents(mismatch.expected_cents, mismatch.expected_currency);
    const charged = formatCents(mismatch.charged_cents, mismatch.currency);
    const { notifyTenantAdmins } = await import("@/lib/events/tenantAdminAlert.server");
    await notifyTenantAdmins({
      tenantId: order.tenant_id,
      kind: "billing",
      titlePl: "Płatność do weryfikacji",
      titleEn: "Payment needs review",
      bodyPl: `Zamówienie ${order.id}: operator pobrał ${charged} zamiast ${expected}. Płatność zaksięgowano, zamówienie oznaczono do weryfikacji.`,
      bodyEn: `Order ${order.id}: the provider charged ${charged} instead of ${expected}. The payment was recorded and the order flagged for review.`,
      href: "/admin/billing",
      icon: "credit-card",
    });
  } catch (err) {
    console.error("[payments] amount review alert failed", order.id, err);
  }
}

/** Odpowiedź RPC jako obiekt - tablica, skalar i `null` to brak ładunku. */
function asPayload(data: unknown): TicketOutcomePayload | null {
  return data !== null && typeof data === "object" && !Array.isArray(data)
    ? (data as TicketOutcomePayload)
    : null;
}

/**
 * Kody SQLSTATE, po których jedno ponowienie RPC ma sens: zakleszczenie
 * (`40P01`) i konflikt serializacji (`40001`). Funkcja bazowa jest jedną
 * transakcją, więc powtórka po wycofaniu jest bezpieczna - a bez niej
 * zakleszczenie z decyzją organizatora albo awansem z rezerwy kończyło się
 * tak samo jak każdy inny błąd: wpłatą bez zgłoszenia.
 */
const TRANSIENT_SQLSTATES: ReadonlySet<string> = new Set(["40P01", "40001"]);

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
  env: StripeEnv,
): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { assertSeatAvailable } = await import("@/lib/events/ticket.server");

  try {
    await assertSeatAvailable(supabaseAdmin, eventId, order.user_id);
    return false;
  } catch (err) {
    if (!(err instanceof Error) || err.message !== "event_full") throw err;
  }

  // Zwrot w ŚRODOWISKU ZDARZENIA, nie w domyślnym. `resolveEnvironment(null)`
  // dawało `sandbox` wszędzie poza produkcją - podgląd z kluczami live zlecał
  // zwrot transakcji live kluczem piaskownicy, operator odpowiadał
  // „nie ma takiej płatności", a webhook kręcił się w ponowieniach.
  const { refundTransactionFully } = await import("@/lib/billing/refundProvider.server");
  const refund = await refundTransactionFully(env, txn.id, "oversold");
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
 *
 * Zwraca ładunek RPC (albo `null` przy błędzie) - wołający czyta z niego, czy
 * wpłata dała miejsce (`registration_status`), zanim potwierdzi RSVP.
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
  /**
   * `notify: false` - zapis bez maila/SMS-a do uczestnika. Porzucona kasa
   * oddaje bilet z puli (`unpaid`), ale nie jest „odrzuconą płatnością" -
   * mail z takim tytułem mówiłby nieprawdę komuś, kto po prostu zamknął okno.
   */
  options: { notify?: boolean } = {},
): Promise<TicketOutcomePayload | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const args = {
    p_order_id: orderId,
    p_outcome: outcome,
    p_refunded_cents:
      typeof refundedCents === "number" && Number.isFinite(refundedCents)
        ? Math.max(0, Math.round(refundedCents))
        : undefined,
  };
  let { data, error } = await supabaseAdmin.rpc("payments_apply_event_ticket_outcome", args);
  if (error && TRANSIENT_SQLSTATES.has(error.code)) {
    ({ data, error } = await supabaseAdmin.rpc("payments_apply_event_ticket_outcome", args));
  }
  if (error) {
    console.error("[payments] ticket outcome failed", orderId, outcome, error.message);
    return null;
  }
  const payload = asPayload(data);
  if (options.notify === false) return payload;

  // Powiadomienie idzie po zapisie i nigdy go nie unieważnia (fail-soft).
  try {
    const { notifyTicketOutcome } = await import("@/lib/events/registrationOutcomeNotify.server");
    await notifyTicketOutcome(payload ?? {});
  } catch (err) {
    console.error("[payments] ticket outcome notify failed", orderId, err);
  }

  // BILETY Z KODEM QR po opłaceniu: płacący i każdy gość jego grupy dostaje
  // osobny mail od razu. Bez warunku `applied` - ponowiony webhook musi móc
  // dokończyć wysyłkę, a podwójnemu wydaniu zapobiega baza (zajęcie
  // i `ticket_code_sent_at`). Czego ta ścieżka nie domknie, zbierze cron
  // (`event-ticket-codes`). Wiersz w kolejce albo czekający na decyzję kodu
  // nie dostanie - baza wydaje go wyłącznie zgłoszeniu z miejscem.
  if (outcome === "paid" && typeof payload?.registration_id === "string") {
    const { issueAndSendTicketCodes } = await import("@/lib/events/ticketCodeNotify.server");
    await issueAndSendTicketCodes(payload.registration_id);
  }
  return payload;
}

/**
 * Nieudana płatność jednorazowa (`checkout.session.async_payment_failed`):
 * zamówienie -> `failed`, rezerwacja kuponu wraca do puli, zgłoszenie na
 * wydarzenie -> nieopłacone (z mailem - to JEST odrzucona płatność).
 *
 * Bez środowiska (stary wołający) zostaje wyłącznie wynik biletu - zamówienia
 * nie wolno zamknąć zdarzeniem, którego środowiska nie znamy.
 */
export async function markOneTimePaymentFailed(
  customData: Record<string, unknown> | null,
  env?: StripeEnv,
): Promise<void> {
  const orderId = orderIdOf(customData);
  if (!orderId) return;

  const order = env ? await loadLifecycleOrder(orderId, "payment failed") : null;
  if (order && env && !sameEnvironment(order, env, "payment failed")) return;
  const closed = order ? await closeOpenOrder(order, "failed", "payment failed") : false;

  await applyTicketOutcome(orderId, "unpaid");

  // Zwolnienie przy KAŻDEJ dostawie zamkniętego zamówienia, nie tylko przy tej,
  // która zmieniła status: ponowienie po awarii zwolnienia musi je dokończyć.
  if (order && (closed || order.status === "failed" || order.status === "canceled")) {
    await releaseOrderCoupon(order, "payment failed");
  }
}

/**
 * Sesja Checkout wygasła bez płatności (`checkout.session.expired`):
 * zamówienie -> `canceled`, rezerwacja kuponu wraca do puli, a bilet zajęty
 * z puli planu przy kasie z gośćmi wraca do członka (wynik `unpaid` bez
 * powiadomienia - patrz `applyTicketOutcome`).
 *
 * Idempotentne: zamówienie opłacone, zwrócone albo już zamknięte zostaje
 * nietknięte, a zwolnienie kuponu baza wykonuje najwyżej raz. Zwraca `true`,
 * gdy TO wywołanie coś zmieniło (dziennik webhooków: `processed`).
 */
export async function expireCheckoutOrder(
  txn: OneTimeTransaction,
  env: StripeEnv,
): Promise<boolean> {
  const orderId = orderIdOf(txn.customData);
  if (!orderId) return false;
  const order = await loadLifecycleOrder(orderId, "expire");
  if (!order || !sameEnvironment(order, env, "expire")) return false;

  // Wygasła sesja INNA niż zapisana na zamówieniu - zamówienie żyje dalej
  // w nowszej sesji i nie wolno go zamknąć cudzym wygaśnięciem.
  const sessionId = txn.sessionId ?? txn.id;
  if (order.provider_session_id && sessionId && order.provider_session_id !== sessionId) {
    console.warn("[payments] expire: session does not match order - skipping", orderId, sessionId);
    return false;
  }

  const closed = await closeOpenOrder(order, "canceled", "expire");
  if (closed && str(order.metadata, "event_id")) {
    await applyTicketOutcome(order.id, "unpaid", null, { notify: false });
  }
  const released =
    closed || order.status === "canceled" || order.status === "failed"
      ? await releaseOrderCoupon(order, "expire")
      : false;
  return closed || released;
}

/**
 * Pierwsza sesja Checkout subskrypcji została opłacona (albo zaczęła trial):
 * domyka NASZE zamówienie `kind=subscription` - status `paid`, identyfikatory
 * operatora, efekty kuponu - i porównuje pobraną kwotę z zamówieniem.
 *
 * UPRAWNIENIA TU NIE MA. Nadaje je ścieżka `subscription.*` pod kluczem
 * subskrypcji operatora; grant stąd założyłby DRUGI wiersz `user_subscriptions`
 * pod kluczem sesji, którego anulowanie subskrypcji nigdy nie odbierze.
 *
 * Bez tego domknięcia zamówienie subskrypcji wisiało jako `processing` na
 * zawsze: uzgadnianie co noc zgłaszało `order_paid_not_fulfilled`, a jego
 * naprawa (powtórka sesji) niczego nie zmieniała.
 */
export async function settleSubscriptionCheckoutOrder(
  txn: OneTimeTransaction,
  env: StripeEnv,
): Promise<"settled" | "skipped"> {
  const orderId = orderIdOf(txn.customData);
  if (!orderId) return "skipped";
  const order = await loadLifecycleOrder(orderId, "subscription settle");
  if (!order || !sameEnvironment(order, env, "subscription settle")) return "skipped";
  if (order.kind !== "subscription") {
    // Plan jednorazowy przechodzi przez `fulfilOrder` (sesja bez subskrypcji).
    console.warn("[payments] subscription settle: order is not a subscription", orderId);
    return "skipped";
  }
  if (
    order.status === "refunded" ||
    order.status === "canceled" ||
    (order.refunded_amount_cents ?? 0) > 0
  ) {
    console.warn("[payments] subscription settle: order closed - refusing", orderId, order.status);
    return "skipped";
  }

  // Trial (i każda sesja bez pobrania): operator nie pobrał NIC, więc nie ma
  // czego porównywać, a zero w `amount_cents` skasowałoby cenę planu, z której
  // czytają historia płatności i raporty.
  const noCharge = txn.amountCents === 0 && (txn.amountSubtotalCents ?? 0) === 0;
  const review = noCharge ? null : reviewAmount(txn, order);
  const nowIso = new Date().toISOString();

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: settled, error } = await supabaseAdmin
    .from("payment_orders")
    .update({
      status: "paid",
      paid_at: nowIso,
      provider: "stripe",
      provider_intent_id: txn.id,
      provider_session_id: txn.sessionId ?? txn.id,
      ...(txn.subscriptionId ? { provider_subscription_id: txn.subscriptionId } : {}),
      ...(txn.paymentIntentId ? { provider_payment_intent_id: txn.paymentIntentId } : {}),
      ...(txn.customerId ? { provider_customer_id: txn.customerId } : {}),
      ...(review && review.chargedCents !== null
        ? { amount_cents: review.chargedCents, currency: review.currency }
        : {}),
      ...(review?.mismatch ? { metadata: withReviewFlag(order.metadata, review.mismatch) } : {}),
      ...(txn.customerEmail ? { receipt_email: txn.customerEmail } : {}),
      updated_at: nowIso,
    })
    .eq("id", order.id)
    .in("status", [...PAYABLE_STATUSES])
    .select("id");
  if (error) throw new Error(`subscription settle: order paid flip failed: ${error.message}`);
  const changed = (settled ?? []).length > 0;
  if (changed && review?.mismatch) await alertOrderReview(order, review.mismatch);

  // Efekty kuponu B2B - fail-closed na `status='paid'` i idempotentne po
  // stronie bazy, więc także przy powtórce: dokończą to, czego nie dokończyła
  // poprzednia dostawa.
  const { applyCouponEffectsForOrder } = await import("@/lib/billing/couponEffects.server");
  await applyCouponEffectsForOrder(order.id);
  return changed ? "settled" : "skipped";
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
      "id, user_id, tenant_id, plan_id, kind, entity_type, entity_id, amount_cents, currency, metadata, environment, status, refunded_amount_cents, provider_session_id, provider_intent_id, provider_payment_intent_id",
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

  // BRAMKA ZWROTU - PRZED uprawnieniem. Zwrot, który wyprzedził realizację
  // (albo powtórka realizacji po zwrocie), zastaje zamówienie `refunded` lub
  // z zaksięgowaną kwotą zwrotu. Grant w tym miejscu wskrzeszał dostęp
  // klientowi, który ma już pieniądze z powrotem - a `.neq("status","paid")`
  // przestawiało przy okazji zwrócone zamówienie z powrotem na opłacone.
  const orderStatus = typeof order.status === "string" ? order.status : null;
  if (orderStatus === "refunded" || Number(order.refunded_amount_cents ?? 0) > 0) {
    console.warn("[payments] one-time: order already refunded - fulfilment refused", order.id);
    return "skipped";
  }
  // Zamówienie zamknięte (`canceled`: kasa wygasła albo kupon przepadł przed
  // sesją) nie ma prawa dostać płatności. Skoro jednak przyszła, pieniądze są
  // u nas - decyzja (zwrot albo ręczne nadanie) należy do człowieka.
  if (orderStatus === "canceled") {
    console.error("[payments] one-time: payment for a canceled order - needs review", order.id);
    return "skipped";
  }

  // Kwota PO kuponie, PRZED podatkiem - ta sama semantyka co zamówienie.
  // Rozjazd NIE blokuje realizacji: operator przyjął płatność, więc klient
  // dostaje to, za co zapłacił, a księgi - prawdziwą kwotę. Zamówienie
  // dostaje flagę do weryfikacji, a administratorzy najemcy alert.
  const review = reviewAmount(txn, order);
  const amountCents = review.chargedCents ?? order.amount_cents;
  const currency = review.currency;

  const preMetadata = (order.metadata ?? {}) as Record<string, unknown>;
  const ticketEventId = str(preMetadata, "event_id");

  // 0. Bilet: autorytatywna kontrola miejsc PRZED nadaniem uprawnienia.
  //
  // TYLKO DLA ZAKUPU BEZ ZGŁOSZENIA (RSVP, `EventTicketPurchase`). Zamówienie
  // z `registration_id` rozstrzyga baza: `payments_apply_event_ticket_outcome`
  // sprawdza miejsca pod blokadą (wydarzenie -> pula -> zgłoszenie) i przy
  // braku miejsca stawia wpłatę w kolejce OPŁACONEJ. `assertSeatAvailable`
  // liczy RSVP 'going' względem `events.capacity` - inną księgę niż
  // `event_registrations`, ślepą na pule wejściówek - więc zwrot z tej bramki
  // anulowałby zgłoszenie, które baza właśnie zakolejkowała jako opłacone.
  if (ticketEventId && order.user_id && !str(preMetadata, "registration_id")) {
    const refunded = await refundIfOversold(
      txn,
      { id: order.id, user_id: order.user_id, tenant_id: order.tenant_id, plan_id: order.plan_id },
      ticketEventId,
      amountCents,
      currency,
      env,
    );
    if (refunded) return "oversold_refunded";
  }

  // 1. Uprawnienie (idempotentne) - zanim cokolwiek uzna zamówienie za opłacone.
  await grantEntitlement({ ...order, amount_cents: amountCents }, txn.id);

  // 2. Księgowanie - `paid_at` stemplowane dokładnie raz mimo ponowień,
  // i WYŁĄCZNIE z kasy w toku (`PAYABLE_STATUSES`): zwrócone albo zamknięte
  // zamówienie nie wraca na opłacone.
  const { data: flipped, error: updateErr } = await supabaseAdmin
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
      ...(review.mismatch ? { metadata: withReviewFlag(preMetadata, review.mismatch) } : {}),
      ...(txn.customerEmail ? { receipt_email: txn.customerEmail } : {}),
    })
    .eq("id", order.id)
    .in("status", [...PAYABLE_STATUSES])
    .select("id");
  if (updateErr) throw new Error(`one-time: order paid flip failed: ${updateErr.message}`);

  if ((flipped ?? []).length === 0) {
    // Nic się nie przestawiło: albo powtórka (zamówienie już `paid` - skutki
    // niżej są idempotentne), albo zwrot WYPRZEDZIŁ nadanie między naszym
    // odczytem a zapisem. W drugim przypadku uprawnienie z kroku 1 nie ma
    // pokrycia w pieniądzach i musi zniknąć od razu - także pod kluczem
    // transakcji, pod którym właśnie je nadaliśmy.
    const { data: current, error: currentErr } = await supabaseAdmin
      .from("payment_orders")
      .select("status")
      .eq("id", order.id)
      .maybeSingle();
    if (currentErr) throw new Error(`one-time: order state lookup failed: ${currentErr.message}`);
    if (current?.status !== "paid") {
      console.error(
        "[payments] one-time: order closed while fulfilling - entitlement revoked",
        order.id,
        current?.status ?? null,
      );
      const { revokeOrderAccess } = await import("@/lib/billing/refunds.server");
      await revokeOrderAccess(order, new Date().toISOString(), [txn.id]);
      return "skipped";
    }
  } else if (review.mismatch) {
    await alertOrderReview(order, review.mismatch);
  }

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

  // 4. Bilet na wydarzenie. NAJPIERW zgłoszenie: to samo zdarzenie płatności
  // potwierdza zgłoszenie z formularza, wydaje kod QR i zdejmuje wpis z listy
  // rezerwowej - albo, gdy miejsca już nie ma lub bilet wymaga akceptacji,
  // zostawia wpłatę w kolejce / w oczekiwaniu na decyzję.
  //
  // RSVP 'going' DOPIERO PO ODPOWIEDZI BAZY i tylko przy potwierdzonym
  // miejscu. `get_event_access` daje za nie link wejścia, a `loadMyEventTicket`
  // kartę biletu - a kupujący w kolejce albo czekający na decyzję nie ma
  // jeszcze ani jednego, ani drugiego. Ponowienie webhooka po tej zmianie
  // kolejności jest bezpieczne: RPC jest idempotentne dla tego samego
  // zamówienia, mail i SMS mają klucze idempotencji, a dzwonki stoją na
  // `newly_settled`.
  let ticket: TicketOutcomePayload | null = null;
  if (eventId) {
    ticket = await applyTicketOutcome(order.id, "paid");
    if (paidSeatConfirmed(ticket)) {
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
  // „Miejsce zarezerwowane" tylko przy potwierdzonym miejscu. Kupujący
  // w kolejce albo czekający na decyzję dostał już właściwy mail
  // (`event_ticket_paid_waitlisted` / `_pending`) z `applyTicketOutcome`.
  if (eventId && paidSeatConfirmed(ticket)) {
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
