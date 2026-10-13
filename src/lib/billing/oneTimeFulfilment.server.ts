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
//   - płatność asynchroniczna odrzucona (`markOneTimePaymentFailed`) -> `failed`
//     - także zamówienie subskrypcji z sesji w trybie `subscription` (S6),
//   - zamówienie subskrypcji (`settleSubscriptionCheckoutOrder`) -> `paid`
//     dopiero przy PIERWSZYM pobraniu pieniędzy (sesja albo pierwsza opłacona
//     faktura po okresie próbnym), BEZ uprawnienia (to nadaje ścieżka
//     `subscription.*`). Trial i sesja bez pobrania tylko stemplują
//     identyfikatory operatora (S4) - nie są przychodem i nie odpalają kuponu.
//
// Kwota (S5): `amount_cents` opłaconego zamówienia to kwota POBRANA brutto
// (suma sesji / faktury z doliczonym podatkiem) - tak czytają ją zwroty,
// faktury wydarzeń i przychód. Porównanie z zamówieniem idzie natomiast po
// `subtotal - rabat` (kwota po NASZYM kuponie, przed podatkiem), a bez tego
// rozbicia (stary ładunek, faktura) nie idzie wcale. Rozjazd nie blokuje
// księgowania (pieniądze już pobrano), ale oznacza zamówienie do weryfikacji
// i alarmuje administratorów najemcy. Kod promocyjny obcego najemcy albo spoza
// zakresu kuponu WSTRZYMUJE nadanie (S8, `promotionCodeScope.server`).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Json } from "@/integrations/supabase/types";
import type { StripeEnv } from "@/lib/stripe.server";
import type { TicketOutcomePayload } from "@/lib/events/registrationOutcomeNotify.server";
import { paidSeatConfirmed } from "@/lib/events/paidAdmission";
import { entitlementForOrder } from "@/lib/billing/entitlement";
import {
  NO_PROMOTION_CODE_REVIEW,
  reviewPromotionCodes,
  type PromotionCodeReview,
  type PromotionHoldReason,
} from "@/lib/billing/promotionCodeScope.server";

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

/**
 * Skutek realizacji. `held` - pieniądze pobrane i zaksięgowane (`paid`), ale
 * dostępu NIE nadano: kod promocyjny spoza najemcy albo zakresu kuponu (S8);
 * decyzja (zwrot albo ręczne nadanie) należy do administratora.
 */
export type OneTimeOutcome = "skipped" | "order" | "donation" | "oversold_refunded" | "held";

/**
 * Skutek domknięcia zamówienia subskrypcji: `settled` - to wywołanie przestawiło
 * zamówienie na `paid`; `stamped` - sesja bez pobrania (trial, rabat 100%)
 * zapisała wyłącznie identyfikatory operatora; `skipped` - nic się nie zmieniło.
 */
export type SubscriptionSettleOutcome = "settled" | "stamped" | "skipped";

function str(source: Record<string, unknown> | null, key: string): string | null {
  const v = source?.[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function positiveCents(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/** Kwota POBRANA brutto (S5): `amount_total` sesji albo `amount_paid` faktury. */
function collectedCentsOf(txn: OneTimeTransaction): number | null {
  return typeof txn.amountCents === "number" && Number.isFinite(txn.amountCents)
    ? txn.amountCents
    : null;
}

/** Waluta księgowania: ze zdarzenia, potem z zamówienia, zawsze wielkimi literami. */
function currencyOf(txn: OneTimeTransaction, order: { currency: string | null }): string {
  return (txn.currency ?? order.currency ?? "PLN").toUpperCase();
}

/**
 * Chwila pobrania wg operatora (czas zdarzenia). Powtórka z uzgadniania albo
 * przeglądu zaległych zdarzeń nie może przenieść starego przychodu na „dziś";
 * nieczytelny znacznik spada na teraz.
 */
function paidAtOf(txn: OneTimeTransaction): string {
  const at = txn.paidAt ? Date.parse(txn.paidAt) : Number.NaN;
  return new Date(Number.isFinite(at) ? at : Date.now()).toISOString();
}

/**
 * Źródło transakcji. Ładunek sprzed wdrożenia (dziennik webhooków, powtórka)
 * nie niesie `source` - rozpoznajemy je po identyfikatorze (S6): `in_...` to
 * faktura, wszystko inne to sesja Checkout.
 */
function sourceOf(txn: OneTimeTransaction): "checkout_session" | "invoice" {
  if (txn.source === "checkout_session" || txn.source === "invoice") return txn.source;
  return txn.id.startsWith("in_") ? "invoice" : "checkout_session";
}

/**
 * Zwrot, który wyprzedził realizację, blokuje ją WYŁĄCZNIE wtedy, gdy oddał
 * całość (2.8 / 5.9). Zwrot częściowy to korekta ceny (`refunds.server` nie
 * zmienia wtedy statusu): odmowa zostawiała klienta, który zapłacił resztę,
 * bez dostępu na zawsze, a naprawa uzgadniania odbijała się od tej samej
 * bramki. Licznik zwrotów `refunds.server` zapisuje w podstawie kwoty
 * zamówienia, więc z nią porównujemy; bez znanej kwoty każdy zwrot jest pełny.
 */
function refundedInFull(order: {
  status: string | null;
  refunded_amount_cents: number | null;
  amount_cents: number | null;
}): boolean {
  if (order.status === "refunded") return true;
  const refunded = Number(order.refunded_amount_cents ?? 0);
  if (!(refunded > 0)) return false;
  const basis = positiveCents(order.amount_cents);
  return basis === null || refunded >= basis;
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
  provider_intent_id: string | null;
  provider_subscription_id: string | null;
}

const LIFECYCLE_COLUMNS =
  "id, user_id, tenant_id, plan_id, kind, status, amount_cents, currency, refunded_amount_cents, metadata, environment, provider_session_id, provider_intent_id, provider_subscription_id";

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

/** Rozjazd kwoty pobranej przez operatora z kwotą zamówienia. */
interface AmountMismatch {
  expected_cents: number;
  expected_currency: string;
  /** Kwota za pozycje po rabacie, PRZED podatkiem (`subtotal - rabat`). */
  charged_cents: number;
  currency: string;
}

/** Powód przeglądu zamówienia (`payment_orders.metadata.review.reason`). */
type ReviewReason = "amount_mismatch" | PromotionHoldReason;

/** Flaga do `metadata.review` - dla administratora i dla uzgadniania. */
interface OrderReview extends Partial<AmountMismatch> {
  reason: ReviewReason;
  promotion_code_ids?: string[];
  flagged_at: string;
}

/**
 * Porównanie kwoty z zamówieniem. Zamówienie przechowuje kwotę PO naszym
 * kuponie, PRZED podatkiem (kontrakt obu silników kasy), więc porównujemy
 * `subtotal - rabat` niezależnie od tego, czy podatek jest wliczony, czy
 * doliczany na wierzch. Rozjazd oznacza, że u operatora zadziałało coś, czego
 * nasza baza nie kontroluje: kod promocyjny Stripe spoza `b2b_coupons`, cena
 * podmieniona w katalogu albo inna waluta.
 *
 * BEZ ROZBICIA KWOTY NIE MA PORÓWNANIA (S5, 4.7). Ładunek sprzed wdrożenia
 * (powtórka z dziennika webhooków) i faktura nie niosą `amount_subtotal`;
 * dawny zapas „suma minus podatek" dawał przy podatku doliczanym na wierzch
 * fałszywy rozjazd, alert i nadpisaną kwotę.
 */
function amountMismatch(
  txn: OneTimeTransaction,
  order: { amount_cents: number | null; currency: string | null },
): AmountMismatch | null {
  if (typeof txn.amountSubtotalCents !== "number") return null;
  const expected = order.amount_cents;
  if (typeof expected !== "number") return null;
  const charged = txn.amountSubtotalCents - (txn.amountDiscountCents ?? 0);
  const expectedCurrency = (order.currency ?? "PLN").toUpperCase();
  const currency = currencyOf(txn, order);
  if (currency === expectedCurrency && Math.abs(charged - expected) <= AMOUNT_TOLERANCE_CENTS) {
    return null;
  }
  return {
    expected_cents: expected,
    expected_currency: expectedCurrency,
    charged_cents: charged,
    currency,
  };
}

/** Flaga przeglądu: kod spoza zakresu wygrywa z samym rozjazdem kwoty (który wyjaśnia). */
function orderReview(
  mismatch: AmountMismatch | null,
  promo: PromotionCodeReview,
): OrderReview | null {
  const flagged_at = new Date().toISOString();
  if (promo.hold) {
    return {
      reason: promo.hold.reason,
      promotion_code_ids: [...promo.hold.promotionCodeIds],
      ...(mismatch ?? {}),
      flagged_at,
    };
  }
  return mismatch ? { reason: "amount_mismatch", ...mismatch, flagged_at } : null;
}

/**
 * Metadane po przeglądzie (`null` = bez zmian). Kod operatora bez najemcy
 * (`promotion_code_unscoped`) nie jest powodem przeglądu, ale zostawia ślad
 * w księgach - inaczej rabat, którego nie dał żaden kupon z bazy, byłby
 * nie do wyjaśnienia.
 */
function reviewedMetadata(
  metadata: Record<string, unknown> | null,
  review: OrderReview | null,
  unscopedIds: readonly string[],
): Json | null {
  if (!review && unscopedIds.length === 0) return null;
  return {
    ...(metadata ?? {}),
    ...(review ? { review } : {}),
    ...(unscopedIds.length > 0 ? { promotion_code_unscoped: [...unscopedIds] } : {}),
  } as Json;
}

function formatCents(cents: number, currency: string): string {
  return `${(cents / 100).toFixed(2)} ${currency}`;
}

interface ReviewCopy {
  titlePl: string;
  titleEn: string;
  bodyPl: string;
  bodyEn: string;
}

/** Treść alertu - wyłącznie identyfikatory i kwoty, bez danych osobowych. */
function reviewCopy(orderId: string, review: OrderReview, held: boolean): ReviewCopy {
  if (review.reason === "amount_mismatch") {
    const expected = formatCents(review.expected_cents ?? 0, review.expected_currency ?? "PLN");
    const charged = formatCents(review.charged_cents ?? 0, review.currency ?? "PLN");
    return {
      titlePl: "Płatność do weryfikacji",
      titleEn: "Payment needs review",
      bodyPl: `Zamówienie ${orderId}: operator pobrał ${charged} zamiast ${expected}. Płatność zaksięgowano, zamówienie oznaczono do weryfikacji.`,
      bodyEn: `Order ${orderId}: the provider charged ${charged} instead of ${expected}. The payment was recorded and the order flagged for review.`,
    };
  }
  const codes = (review.promotion_code_ids ?? []).join(", ");
  const foreign = review.reason === "foreign_promotion_code";
  const whatPl = foreign
    ? `kodem promocyjnym innego serwisu (${codes})`
    : `kodem promocyjnym spoza zakresu kuponu (${codes})`;
  const whatEn = foreign
    ? `a promotion code of another site (${codes})`
    : `a promotion code outside its coupon scope (${codes})`;
  return held
    ? {
        titlePl: "Płatność wstrzymana do weryfikacji",
        titleEn: "Payment held for review",
        bodyPl: `Zamówienie ${orderId} opłacono ${whatPl}. Płatność zaksięgowano, dostępu nie nadano - zdecyduj o zwrocie albo ręcznym nadaniu.`,
        bodyEn: `Order ${orderId} was paid with ${whatEn}. The payment was recorded and access was not granted - refund or grant it manually.`,
      }
    : {
        titlePl: "Płatność do weryfikacji",
        titleEn: "Payment needs review",
        bodyPl: `Zamówienie ${orderId} opłacono ${whatPl}. Płatność zaksięgowano, zamówienie oznaczono do weryfikacji.`,
        bodyEn: `Order ${orderId} was paid with ${whatEn}. The payment was recorded and the order flagged for review.`,
      };
}

/**
 * Alarm dla administratorów najemcy: zamówienie wymaga weryfikacji. Ślad
 * w logu zawsze, dzwonek - tylko w najemcy zamówienia. Nigdy nie rzuca:
 * księgowanie płatności już się odbyło i nie może się na alercie wywrócić.
 *
 * RAZ NA INCYDENT (6.7 / 7.4). Wspólny `/admin/billing` sklejał w oknie
 * deduplikacji `enqueue_notification` różne zamówienia (i spory) w jeden
 * dzwonek, a ponowienie po kwadransie dawało drugi. Href jest unikalny dla
 * zamówienia i powodu (kontrakt `notifyTenantAdmins({ once })`), więc każdy
 * incydent dochodzi dokładnie raz, także przy powtórce zdarzenia.
 */
async function alertOrderReview(
  order: { id: string; tenant_id: string | null },
  review: OrderReview,
  held = false,
): Promise<void> {
  console.error(
    review.reason === "amount_mismatch"
      ? "[payments] amount mismatch - order flagged for review"
      : "[payments] promotion code outside order scope - order flagged for review",
    order.id,
    review,
  );
  if (!order.tenant_id) return;
  try {
    const { notifyTenantAdmins } = await import("@/lib/events/tenantAdminAlert.server");
    await notifyTenantAdmins({
      tenantId: order.tenant_id,
      kind: "billing",
      ...reviewCopy(order.id, review, held),
      href: `/admin/billing?order=${encodeURIComponent(order.id)}&review=${review.reason}`,
      icon: "credit-card",
      once: true,
    });
  } catch (err) {
    console.error("[payments] order review alert failed", order.id, err);
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
 *
 * KSIĘGI ZWROTU NA ZAMÓWIENIU (S3, 5.2 / 7.7). Stripe dosyła potem własne
 * `charge.refunded` tego samego zwrotu, a `refunds.server` znajduje zamówienie
 * przez sesję płatności. Zamknięcie bez `refunded_amount_cents` wyglądało tam
 * jak NOWY zwrot: drugi mail o zwrocie, drugi dzwonek, drugi wynik biletu.
 * Zapisujemy więc pobraną kwotę brutto jako zwróconą (pełny zwrot oddaje
 * całą intencję płatności) i intencję płatności - korekta operatora trafia
 * wtedy w bramkę powtórki i nie robi nic.
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
      ...(txn.paymentIntentId ? { provider_payment_intent_id: txn.paymentIntentId } : {}),
      ...(typeof amountCents === "number"
        ? { amount_cents: amountCents, refunded_amount_cents: amountCents, currency }
        : {}),
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
   *
   * `throwOnError: true` - błąd RPC RZUCA zamiast zwracać `null`. Dla
   * zamknięcia kasy (wygaśnięcie, odrzucona płatność) ten zapis jest JEDYNYM
   * skutkiem dla zgłoszenia i biletu z puli planu: połknięty błąd kończył
   * zdarzenie jako `processed`, a miejsce członka przepadało (4.6).
   */
  options: { notify?: boolean; throwOnError?: boolean } = {},
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
    if (options.throwOnError) {
      throw new Error(`ticket outcome failed (${orderId}, ${outcome}): ${error.message}`);
    }
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

/** Zamówienie zamknięte bez płatności - teraz albo przez wcześniejszą dostawę. */
function closedUnpaid(order: LifecycleOrder, closedNow: boolean): boolean {
  return closedNow || order.status === "failed" || order.status === "canceled";
}

/**
 * Nieudana płatność asynchroniczna sesji Checkout
 * (`checkout.session.async_payment_failed`): zamówienie -> `failed`,
 * rezerwacja kuponu wraca do puli, zgłoszenie na wydarzenie -> nieopłacone
 * (z mailem - to JEST odrzucona płatność).
 *
 * DOWOLNY RODZAJ ZAMÓWIENIA (S6, 4.8 / 5.8 / 7.11). Sesja w trybie
 * `subscription` z metodą odroczoną (SEPA, Bacs) kończy się tym samym
 * zdarzeniem; subskrypcja u operatora nigdy nie wystartuje, a sesja nie
 * wygaśnie (została ukończona). Bez zamknięcia zamówienie wisiało jako
 * `processing`, a limitowany kod trzymał zajęte użycie na zawsze.
 *
 * Wynik biletu tylko dla zamówienia z wydarzeniem, które właśnie albo
 * wcześniej zamknięto bez płatności - zamówienie opłacone inną sesją nie
 * oddaje miejsca. Bez środowiska (stary wołający) zostaje wyłącznie wynik
 * biletu - zamówienia nie wolno zamknąć zdarzeniem, którego środowiska nie
 * znamy. Błąd zapisu wyniku biletu RZUCA (4.6), więc webhook wróci.
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
  const unpaid = order ? closedUnpaid(order, closed) : false;

  if (!order || (unpaid && str(order.metadata, "event_id"))) {
    await applyTicketOutcome(orderId, "unpaid", null, { throwOnError: true });
  }

  // Zwolnienie przy KAŻDEJ dostawie zamkniętego zamówienia, nie tylko przy tej,
  // która zmieniła status: ponowienie po awarii zwolnienia musi je dokończyć.
  if (order && unpaid) await releaseOrderCoupon(order, "payment failed");
}

/**
 * Sesja Checkout wygasła bez płatności (`checkout.session.expired`):
 * zamówienie -> `canceled`, rezerwacja kuponu wraca do puli, a bilet zajęty
 * z puli planu przy kasie z gośćmi wraca do członka (wynik `unpaid` bez
 * powiadomienia - patrz `applyTicketOutcome`).
 *
 * Idempotentne: zamówienie opłacone, zwrócone albo już zamknięte zostaje
 * nietknięte, a zwolnienie kuponu baza wykonuje najwyżej raz. Wynik biletu
 * (też idempotentny w bazie) idzie przy KAŻDEJ dostawie zamkniętego
 * zamówienia, a jego błąd RZUCA (4.6): dawniej szedł tylko z dostawą, która
 * zamknęła status, więc połknięty błąd RPC przepadał - ponowienie widziało
 * zamówienie już zamknięte i nie próbowało drugi raz. Zwraca `true`, gdy TO
 * wywołanie zmieniło status albo oddało kupon (dziennik webhooków: `processed`).
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
  const unpaid = closedUnpaid(order, closed);
  if (unpaid && str(order.metadata, "event_id")) {
    await applyTicketOutcome(order.id, "unpaid", null, { notify: false, throwOnError: true });
  }
  const released = unpaid ? await releaseOrderCoupon(order, "expire") : false;
  return closed || released;
}

/**
 * Domknięcie NASZEGO zamówienia `kind=subscription` (S4). Woła je dyspozytor
 * dla opłaconej transakcji z subskrypcją i `orderId` w metadanych - zarówno
 * dla sesji Checkout, jak i dla faktury (pierwsza opłacona faktura domyka
 * zamówienie po okresie próbnym; odnowienia trafiają w zamówienie już
 * opłacone i nic nie zmieniają). Idempotentne.
 *
 *   - POBRANIE (kwota > 0): `pending` / `processing` / `failed` -> `paid`,
 *     `paid_at` = chwila pobrania wg operatora, `amount_cents` = kwota pobrana
 *     brutto (S5), efekty kuponu B2B - WYŁĄCZNIE przy tym przejściu (albo
 *     przy powtórce zdarzenia, które je wykonało).
 *   - BEZ POBRANIA (trial, rabat 100%): tylko identyfikatory operatora
 *     (subskrypcja, klient, sesja). Status, kwota i `paid_at` zostają, efektów
 *     kuponu nie ma (4.0 / 4.1 / 5.3): `apply_b2b_coupon_effects` nadaje
 *     warstwę członkostwa każdemu zamówieniu `paid`, a nic jej nie odbiera
 *     przy anulowaniu w trakcie trialu - darmowy trial z kuponem dawał
 *     warstwę premium na zawsze, a pulpit liczył każdy trial jako przychód
 *     w cenie planu. Identyfikatory chronią zamówienie przed zamknięciem
 *     cudzym wygaśnięciem sesji i przed usunięciem jako porzucony szkic.
 *
 * Faktura NIE nadpisuje `provider_session_id` (to identyfikator sesji, nie
 * faktury) i nie przechodzi porównania kwoty - nie ma rozbicia `subtotal -
 * rabat`, a pierwsze porównanie zrobiła już sesja. Kod promocyjny obcego
 * najemcy albo spoza zakresu kuponu oznacza zamówienie do przeglądu
 * z alertem, ale niczego nie wstrzymuje: dostęp daje `subscription.*` (S8).
 *
 * UPRAWNIENIA TU NIE MA. Nadaje je ścieżka `subscription.*` pod kluczem
 * subskrypcji operatora; grant stąd założyłby DRUGI wiersz `user_subscriptions`
 * pod kluczem sesji, którego anulowanie subskrypcji nigdy nie odbierze.
 */
export async function settleSubscriptionCheckoutOrder(
  txn: OneTimeTransaction,
  env: StripeEnv,
): Promise<SubscriptionSettleOutcome> {
  const orderId = orderIdOf(txn.customData);
  if (!orderId) return "skipped";
  const order = await loadLifecycleOrder(orderId, "subscription settle");
  if (!order || !sameEnvironment(order, env, "subscription settle")) return "skipped";
  if (order.kind !== "subscription") {
    // Plan jednorazowy przechodzi przez `fulfilOrder` (sesja bez subskrypcji).
    console.warn("[payments] subscription settle: order is not a subscription", orderId);
    return "skipped";
  }
  if (order.status === "canceled" || refundedInFull(order)) {
    console.warn("[payments] subscription settle: order closed - refusing", orderId, order.status);
    return "skipped";
  }
  // Zamówienie domknięte już INNĄ subskrypcją: metadane tej transakcji nie
  // mają prawa go przestawić (identyfikator zapisujemy wyłącznie my).
  if (
    txn.subscriptionId &&
    order.provider_subscription_id &&
    order.provider_subscription_id !== txn.subscriptionId
  ) {
    console.warn("[payments] subscription settle: subscription mismatch - skipping", orderId);
    return "skipped";
  }

  const fromSession = sourceOf(txn) === "checkout_session";
  // Odnowienie: zamówienie opłaciła wcześniej INNA transakcja, a faktura nie
  // niesie niczego do przeglądu - jeden odczyt, bez zapisu.
  if (!fromSession && order.status === "paid" && order.provider_intent_id !== txn.id) {
    return "skipped";
  }
  const charged = positiveCents(collectedCentsOf(txn));
  // Trial: sesja bez pozycji do zapłaty (`subtotal` = 0) - porównywać nie ma
  // czego. Rabat 100% na pozycji ma `subtotal` > 0 i porównanie przechodzi.
  const trial = charged === null && (txn.amountSubtotalCents ?? 0) === 0;
  const promo = fromSession
    ? await reviewPromotionCodes(env, txn.promotionCodeIds, {
        id: order.id,
        tenantId: order.tenant_id,
        planId: order.plan_id,
        eventId: null,
      })
    : NO_PROMOTION_CODE_REVIEW;
  // Porównanie kwoty tylko z zamówieniem NIEOPŁACONYM: po domknięciu
  // `amount_cents` to już kwota pobrana brutto, nie oczekiwana - sesja
  // spóźniona za fakturą dawałaby fałszywy rozjazd przy każdym podatku.
  const review = orderReview(
    fromSession && !trial && order.status !== "paid" ? amountMismatch(txn, order) : null,
    promo,
  );
  const metadata = reviewedMetadata(order.metadata, review, promo.unscopedIds);
  const nowIso = new Date().toISOString();
  const providerIds = {
    provider: "stripe",
    ...(fromSession ? { provider_session_id: txn.sessionId ?? txn.id } : {}),
    ...(txn.subscriptionId ? { provider_subscription_id: txn.subscriptionId } : {}),
    ...(txn.customerId ? { provider_customer_id: txn.customerId } : {}),
    ...(txn.customerEmail ? { receipt_email: txn.customerEmail } : {}),
    ...(metadata ? { metadata } : {}),
    updated_at: nowIso,
  };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  if (charged === null) {
    const { data: stamped, error } = await supabaseAdmin
      .from("payment_orders")
      .update(providerIds)
      .eq("id", order.id)
      .in("status", [...PAYABLE_STATUSES])
      .select("id");
    if (error) throw new Error(`subscription settle: provider ids stamp failed: ${error.message}`);
    const changed = (stamped ?? []).length > 0;
    if (changed && review) await alertOrderReview(order, review);
    return changed ? "stamped" : "skipped";
  }

  const { data: settled, error } = await supabaseAdmin
    .from("payment_orders")
    .update({
      ...providerIds,
      status: "paid",
      paid_at: paidAtOf(txn),
      provider_intent_id: txn.id,
      ...(txn.paymentIntentId ? { provider_payment_intent_id: txn.paymentIntentId } : {}),
      amount_cents: charged,
      currency: currencyOf(txn, order),
    })
    .eq("id", order.id)
    .in("status", [...PAYABLE_STATUSES])
    .select("id");
  if (error) throw new Error(`subscription settle: order paid flip failed: ${error.message}`);
  const changed = (settled ?? []).length > 0;
  // Powtórka TEGO SAMEGO zdarzenia, które opłaciło zamówienie (np. po awarii
  // procesu między zapisem a efektami) - dokańcza efekty kuponu. Odnowienie
  // (inna faktura) trafia w zamówienie opłacone wcześniej i nie robi nic.
  const replay = !changed && order.status === "paid" && order.provider_intent_id === txn.id;
  if (!changed && !replay) {
    // Sesja przyszła PO fakturze, która już domknęła zamówienie (Stripe wysyła
    // zdarzenia równolegle). Kody promocyjne i rozbicie kwoty niesie wyłącznie
    // sesja, więc jej flaga i tak musi trafić do opłaconego zamówienia.
    if (fromSession && metadata) {
      const { data: flagged, error: flagErr } = await supabaseAdmin
        .from("payment_orders")
        .update({ metadata, updated_at: nowIso })
        .eq("id", order.id)
        .eq("status", "paid")
        .select("id");
      if (flagErr) throw new Error(`subscription settle: review flag failed: ${flagErr.message}`);
      if ((flagged ?? []).length > 0 && review) await alertOrderReview(order, review);
    }
    return "skipped";
  }
  if (review) await alertOrderReview(order, review);

  // Efekty kuponu B2B - fail-closed na `status='paid'` i idempotentne po
  // stronie bazy (zatrzask `effects_applied_at`).
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

  // BRAMKA ZWROTU - PRZED uprawnieniem. Zwrot PEŁNY, który wyprzedził
  // realizację (albo powtórka realizacji po zwrocie), zastaje zamówienie
  // `refunded` lub z licznikiem zwrotów równym kwocie. Grant w tym miejscu
  // wskrzeszał dostęp klientowi, który ma już pieniądze z powrotem. Zwrot
  // CZĘŚCIOWY (korekta ceny) realizacji nie blokuje - patrz `refundedInFull`.
  const orderStatus = typeof order.status === "string" ? order.status : null;
  const refundedSoFar = Number(order.refunded_amount_cents ?? 0);
  if (
    refundedInFull({
      status: orderStatus,
      refunded_amount_cents: refundedSoFar,
      amount_cents: typeof order.amount_cents === "number" ? order.amount_cents : null,
    })
  ) {
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

  // Księgi dostają kwotę POBRANĄ brutto (S5) - zwroty, faktury wydarzeń
  // i przychód czytają `amount_cents` jako pieniądze, które wpłynęły.
  // Porównanie z zamówieniem idzie po `subtotal - rabat`; rozjazd NIE blokuje
  // realizacji (operator przyjął płatność), ale daje flagę i alert.
  const amountCents = collectedCentsOf(txn) ?? order.amount_cents;
  const currency = currencyOf(txn, order);
  // Powtórka opłaconego zamówienia nie porównuje: `amount_cents` jest już
  // kwotą pobraną brutto, a nie oczekiwaną kwotą netto.
  const mismatch = orderStatus === "paid" ? null : amountMismatch(txn, order);

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

  // 0b. Kody promocyjne operatora (S8). Kod obcego najemcy albo spoza zakresu
  // kuponu: pieniądze pobrane, więc zamówienie jest `paid` (księgi muszą się
  // zgadzać z operatorem), ale dostępu NIE nadajemy - decyduje administrator.
  const promo = await reviewPromotionCodes(env, txn.promotionCodeIds, {
    id: order.id,
    tenantId: order.tenant_id,
    planId: order.plan_id,
    eventId: ticketEventId,
  });
  const review = orderReview(mismatch, promo);
  const metadata = reviewedMetadata(preMetadata, review, promo.unscopedIds);
  const paidPatch = {
    status: "paid" as const,
    paid_at: paidAtOf(txn),
    provider: "stripe",
    provider_intent_id: txn.id,
    provider_session_id: txn.sessionId ?? txn.id,
    ...(txn.paymentIntentId ? { provider_payment_intent_id: txn.paymentIntentId } : {}),
    ...(txn.customerId ? { provider_customer_id: txn.customerId } : {}),
    ...(typeof amountCents === "number" ? { amount_cents: amountCents } : {}),
    currency,
    ...(metadata ? { metadata } : {}),
    ...(txn.customerEmail ? { receipt_email: txn.customerEmail } : {}),
  };

  if (promo.hold && review) {
    const { data: held, error: holdErr } = await supabaseAdmin
      .from("payment_orders")
      .update(paidPatch)
      .eq("id", order.id)
      .in("status", [...PAYABLE_STATUSES])
      .select("id");
    if (holdErr) throw new Error(`one-time: order hold flip failed: ${holdErr.message}`);
    // Zero przestawionych wierszy przy zamówieniu nieopłaconym = zwrot albo
    // zamknięcie wyprzedziło zapis; dostępu i tak nie ma, alarmu też nie.
    if ((held ?? []).length === 0 && orderStatus !== "paid") return "skipped";
    await alertOrderReview(order, review, true);
    return "held";
  }

  // 1. Uprawnienie (idempotentne) - zanim cokolwiek uzna zamówienie za opłacone.
  await grantEntitlement({ ...order, amount_cents: amountCents }, txn.id);

  // 2. Księgowanie - `paid_at` stemplowane dokładnie raz mimo ponowień,
  // i WYŁĄCZNIE z kasy w toku (`PAYABLE_STATUSES`): zwrócone albo zamknięte
  // zamówienie nie wraca na opłacone. Licznika zwrotów nie dotykamy - zwrot
  // częściowy sprzed realizacji zostaje w księgach.
  const { data: flipped, error: updateErr } = await supabaseAdmin
    .from("payment_orders")
    .update(paidPatch)
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
  } else if (review) {
    await alertOrderReview(order, review);
  }

  // 3. Efekty kuponu B2B - fail-closed na `status='paid'`, więc dopiero teraz.
  const { applyCouponEffectsForOrder } = await import("@/lib/billing/couponEffects.server");
  await applyCouponEffectsForOrder(order.id);

  const eventId = ticketEventId;

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
    // Zwrot częściowy sprzed realizacji (2.8 / 5.9): wpłata dała miejsce,
    // a rozliczenie zgłoszenia ma pokazać korektę ceny. Bez powiadomienia -
    // klient dostał już mail o zwrocie z obsługi korekty.
    if (refundedSoFar > 0) {
      await applyTicketOutcome(order.id, "partial_refund", refundedSoFar, { notify: false });
    }
  }

  // 5. Powiadomienia (fail-soft, idempotentne po id zamówienia). Potwierdzenie
  // planu idzie za KAŻDYM zamówieniem, które daje uprawnienie planu - także
  // za planem jednorazowym (dożywotnim) kupionym przez `/checkout/$planId`,
  // który od PAY-01 ma `kind = one_time` i tracił mail (5.12).
  const { notifySubscriptionEmail, notifyEventRegistration } =
    await import("@/lib/billing/notifications.server");
  if (entitlementForOrder(order).type === "subscription") {
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
