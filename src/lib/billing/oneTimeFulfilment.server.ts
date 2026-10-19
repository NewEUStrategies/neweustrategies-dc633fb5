// Realizacja płatności jednorazowych dostawcy (transakcje bez subskrypcji).
//
// Jedno miejsce, w którym „transakcja opłacona” zamienia się w skutek
// biznesowy - tak jak grant.server jest jedynym miejscem nadawania uprawnień:
//   - `kind=order` -> payment_orders: nadanie uprawnienia, zaksięgowanie,
//                     efekty kuponu B2B, maile (subskrypcja / wydarzenie),
//                     potwierdzenie RSVP dla biletu na wydarzenie,
//   - `purpose=donation` -> rejestr `donations` (wpłata JEDNORAZOWA; ratę
//                     cykliczną księguje faktura w `webhookDispatch.server`).
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
//     Faktura domyka wyłącznie zamówienie, które sesja już ostemplowała.
//
// Kwota (S5): `amount_cents` opłaconego zamówienia to kwota POBRANA brutto
// (suma sesji / faktury z doliczonym podatkiem) - tak czytają ją zwroty,
// faktury wydarzeń i przychód. Porównanie z zamówieniem idzie natomiast po
// `subtotal - rabat` (kwota po NASZYM kuponie, przed podatkiem), a bez tego
// rozbicia (stary ładunek, faktura) nie idzie wcale. Rozjazd nie blokuje
// księgowania (pieniądze już pobrano), ale oznacza zamówienie do weryfikacji
// i alarmuje administratorów najemcy. Kod promocyjny obcego najemcy albo spoza
// zakresu kuponu WSTRZYMUJE nadanie (S8, `promotionCodeScope.server`).
//
// PRZEGLĄD ZAPADA RAZ - przy przejściu na `paid` (albo przy pierwszym
// stemplu sesji) - i zostaje w `metadata.review`. Powtórka zdarzenia czyta
// zapisaną decyzję zamiast liczyć ją od nowa: kupon wyłączony PO zakupie nie
// może zamienić opłaconego i nadanego zamówienia we „wstrzymane".
//
// BILET: MIEJSCE DAJE TYLKO BAZA (audyt TIX-05, TIX-08). Odpowiedź
// `payments_apply_event_ticket_outcome` rozstrzyga, co webhook robi dalej
// (`paidTicketVerdict`): zgłoszenie z miejscem -> RSVP i mail; zakup bez
// zgłoszenia -> miejsce RSVP pod blokadą wydarzenia
// (`_event_rsvp_claim_paid_seat`, brak miejsca = zwrot); odmowa bazy (cudze
// zgłoszenie, zła kwota, druga wpłata) -> BEZ RSVP i bez „miejsce
// zarezerwowane", zwrot w kolejce i zawiadomienie kupującego oraz
// organizatora. Błąd RPC to wyjątek (ponowienie), a nie cicha zgoda.
//
// Bilet za ZERO (kod 100%, TIX-13a) przechodzi tę samą ścieżkę rozliczenia
// (`settleFreeTicketOrder`), tylko bez operatora - nie ma czego zwracać ani
// sprawdzać u Stripe.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import type { StripeEnv } from "@/lib/stripe.server";
import type { TicketOutcomePayload } from "@/lib/events/registrationOutcomeNotify.server";
import type { AdjustmentOrder } from "@/lib/billing/refunds.server";
import { isTicketPaymentRefusal, paidTicketVerdict } from "@/lib/events/paidAdmission";
import { isMigrationPending } from "@/lib/supabase/migrationPending";
import { entitlementForOrder } from "@/lib/billing/entitlement";
import {
  isPromotionHoldReason,
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

/**
 * Zamówienie w kształcie potrzebnym realizacji (odczyt z `payment_orders`).
 * `currency`, `environment` (20260731220000, DEFAULT 'live'), `status`,
 * `provider` i `refunded_amount_cents` są w bazie NOT NULL - bez zapasów
 * na brak, którego wiersz nie ma.
 */
interface FulfilOrderRow {
  id: string;
  user_id: string | null;
  tenant_id: string;
  plan_id: string | null;
  kind: "subscription" | "one_time";
  entity_type: "post" | "page" | "media" | null;
  entity_id: string | null;
  amount_cents: number;
  currency: string;
  metadata: Json;
  environment: string;
  status: string;
  provider: string;
  refunded_amount_cents: number;
  provider_session_id: string | null;
  provider_intent_id: string | null;
  provider_payment_intent_id: string | null;
}

const FULFIL_ORDER_COLUMNS =
  "id, user_id, tenant_id, plan_id, kind, entity_type, entity_id, amount_cents, currency, metadata, environment, status, provider, refunded_amount_cents, provider_session_id, provider_intent_id, provider_payment_intent_id";

/**
 * Sposób rozliczenia: wpłata operatora (w środowisku zdarzenia - tam idzie
 * zwrot i odczyt kodów promocyjnych) albo zamówienie darmowe (kod 100%,
 * `settleFreeTicketOrder`) - to drugie nie ma czego zwracać ani sprawdzać
 * u operatora.
 */
type SettlementMode =
  { provider: "stripe"; env: StripeEnv } | { provider: "coupon"; couponId: string };

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
function currencyOf(txn: OneTimeTransaction, order: { currency: string }): string {
  return (txn.currency ?? order.currency).toUpperCase();
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
  status: string;
  refunded_amount_cents: number;
  amount_cents: number;
}): boolean {
  if (order.status === "refunded") return true;
  const refunded = order.refunded_amount_cents;
  if (!(refunded > 0)) return false;
  const basis = positiveCents(order.amount_cents);
  return basis === null || refunded >= basis;
}

/**
 * Licznik zwrotu sprzed realizacji w podstawie kwoty POBRANEJ (2.8 / 5.9).
 *
 * `refunds.server` zapisuje zwrot, który wyprzedził realizację, w podstawie
 * ówczesnej kwoty zamówienia (oczekiwanej, netto): `round(zwrot * kwota /
 * pobrane)`. Realizacja nadpisuje potem `amount_cents` kwotą pobraną brutto
 * (S5) i licznik w starej podstawie zaniżał zwrot - po zwrocie 85 zł
 * z 98,40 zł przychód netto wychodził 29,29 zł zamiast 13,40 zł. Przeliczamy
 * więc licznik razem z kwotą, NAJMNIEJSZĄ kwotą, która daje zapisany licznik:
 * nigdy nie zawyża zwrotu (kolejna korekta operatora bierze maksimum
 * z zapisanym licznikiem, więc zawyżenie zostałoby na zawsze). Gdy kilka
 * kwot operatora daje ten sam licznik (podatek na wierzch), wynik bywa niższy
 * o grosz - dokładną kwotę wpisze następna korekta operatora (narastająco).
 * `null` - licznik zostaje (brak zwrotu albo ta sama podstawa).
 */
function refundInCollectedBasis(
  refunded: number,
  basis: number | null,
  collected: number | null,
): number | null {
  const prior = positiveCents(basis);
  const target = positiveCents(collected);
  if (!(refunded > 0) || prior === null || target === null || prior === target) return null;
  const smallest = Math.ceil(((2 * refunded - 1) * target) / (2 * prior));
  return Math.min(target, Math.max(0, smallest));
}

/**
 * Statusy, z których wolno przejść na `paid` (domknięcie subskrypcji, bilet
 * za zero). NIE `refunded` (zwrot wyprzedził realizację - pieniądze już
 * wróciły) i NIE `canceled` (zamówienie zamknięte, rezerwacja kuponu oddana).
 * `failed` tak: porażka mogła dotyczyć wcześniejszej próby, a operator
 * potwierdza właśnie pobrane pieniądze. Wpłata za zamówienie jednorazowe -
 * patrz `SETTLEABLE_STATUSES`.
 */
const PAYABLE_STATUSES = ["pending", "processing", "failed"] as const;

/**
 * Statusy, z których WPŁATA OPERATORA za zamówienie jednorazowe przechodzi na
 * `paid`: kasa w toku oraz `canceled` - opłacona sesja na anulowanym
 * zamówieniu to realna wpłata, którą trzeba rozliczyć (#498). Nigdy
 * `refunded` - zwrot nie wraca do `paid` (PAY-07, `refundedInFull`).
 * Zamówienie darmowe (kod 100%) rozlicza się wyłącznie z `PAYABLE_STATUSES`:
 * anulowane oddało już kod do puli, a pieniędzy, które trzeba rozliczyć, nie ma.
 */
const SETTLEABLE_STATUSES = [...PAYABLE_STATUSES, "canceled"] as const;

/** Statusy kasy w toku - jedyne, które zamyka wygaśnięcie albo porażka płatności. */
const OPEN_STATUSES = ["pending", "processing"] as const;

/** Tolerancja porównania kwot: jedna jednostka waluty (zaokrąglenia operatora). */
const AMOUNT_TOLERANCE_CENTS = 1;

/**
 * Bieżący status zamówienia - po zapisie warunkowym, który nie przestawił
 * żadnego wiersza. Błąd odczytu RZUCA (webhook wróci).
 */
async function currentOrderStatus(orderId: string, scope: string): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("payment_orders")
    .select("status")
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw new Error(`${scope}: order state lookup failed: ${error.message}`);
  return data?.status ?? null;
}

/**
 * Zapis z przeliczonym licznikiem zwrotu nie przeszedł, a zamówienie wciąż
 * czeka na płatność: licznik zmienił zwrot zapisany w międzyczasie (warunek
 * `refunded_amount_cents` = odczyt). Starej podstawy nie wolno nadpisać,
 * a cichy `skipped` zostawiłby opłacone zamówienie w toku - RZUCAMY, żeby
 * ponowienie przeliczyło licznik od nowa. `payable` - statusy, z których
 * próbował przejść ten zapis (wpłata operatora rozlicza też `canceled`).
 */
function refundCounterRaced(
  status: string | null,
  orderId: string,
  scope: string,
  payable: readonly string[] = PAYABLE_STATUSES,
): void {
  if (status !== null && payable.includes(status)) {
    throw new Error(`${scope}: refund counter changed while settling (${orderId})`);
  }
}

/** Zamówienie w kształcie czytanym przez cykl życia (wygaśnięcie, porażka, domknięcie). */
interface LifecycleOrder {
  id: string;
  user_id: string | null;
  tenant_id: string;
  plan_id: string | null;
  kind: string;
  status: string;
  amount_cents: number;
  currency: string;
  refunded_amount_cents: number;
  metadata: Record<string, unknown> | null;
  environment: string;
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
 * z piaskownicy nie zamyka i nie domyka zamówienia produkcyjnego. Kolumna
 * jest NOT NULL (20260731220000: wiersze sprzed niej dostały `live`).
 */
function sameEnvironment(
  order: { id: string; environment: string },
  env: StripeEnv,
  scope: string,
) {
  if (order.environment === env) return true;
  console.warn(
    `[payments] ${scope}: environment mismatch - order ${order.id} is '${order.environment}', webhook is '${env}'; skipping`,
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
  reason?: { cancel_reason: "session_expired" },
): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // Powód zamknięcia idzie W TYM SAMYM zapisie co status (S3, P22): wyzwalacz
  // `payment_orders_checkout_emit` rozróżnia porzuconą kasę
  // (`checkout.abandoned.v1`) od anulowania ręcznego po
  // `metadata.cancel_reason` w wierszu NEW - osobny, późniejszy zapis
  // metadanych przyszedłby już po zdarzeniu. Metadane są scalane, nie
  // zastępowane (kupon, wydarzenie, przegląd zostają).
  const metadata = reason ? { ...(order.metadata ?? {}), ...reason } : null;
  const { data, error } = await supabaseAdmin
    .from("payment_orders")
    .update({
      status,
      updated_at: new Date().toISOString(),
      ...(metadata ? { metadata: metadata as Json } : {}),
    })
    .eq("id", order.id)
    .in("status", [...OPEN_STATUSES])
    .select("id");
  if (error) throw new Error(`${scope}: order status flip failed: ${error.message}`);
  return data.length > 0;
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
  if (!couponId || !order.user_id) return false;
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
  order: { amount_cents: number; currency: string },
): AmountMismatch | null {
  if (typeof txn.amountSubtotalCents !== "number") return null;
  const expected = order.amount_cents;
  const charged = txn.amountSubtotalCents - (txn.amountDiscountCents ?? 0);
  const expectedCurrency = order.currency.toUpperCase();
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

/**
 * Przegląd zapisany na zamówieniu przy przejściu na `paid` albo przy stemplu
 * sesji (`metadata.review`). Powtórka zdarzenia dokańcza z niego alert (raz na
 * incydent) i rozstrzyga wstrzymanie - bez ponownej oceny kodów, której wynik
 * zależy od stanu kuponu w chwili powtórki, a nie zakupu.
 */
function storedReview(metadata: Record<string, unknown> | null): OrderReview | null {
  const review = metadata?.["review"];
  if (review === null || typeof review !== "object" || Array.isArray(review)) return null;
  const reason = (review as { reason?: unknown }).reason;
  if (reason !== "amount_mismatch" && !isPromotionHoldReason(reason)) return null;
  return review as OrderReview;
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
  order: { id: string; tenant_id: string },
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
 * Brak miejsca po wpłacie za zakup BEZ zgłoszenia (RSVP) - już po pobraniu
 * pieniędzy.
 *
 * Sprawdzenie przy tworzeniu zamówienia nie wystarcza: między nakładką
 * płatności a webhookiem ostatnie miejsce może zająć ktoś inny. Decyzję podjęła
 * baza pod blokadą (`_event_rsvp_claim_paid_seat` -> `event_full`); tu zwracamy
 * całą kwotę i zamykamy zamówienie. Zamówienie darmowe (kod 100%) nie ma czego
 * zwracać u operatora: zostaje anulowane, a użycie kodu wraca do puli.
 *
 * KSIĘGI ZWROTU NA ZAMÓWIENIU (S3, 5.2 / 7.7). Stripe dosyła potem własne
 * `charge.refunded` tego samego zwrotu, a `refunds.server` znajduje zamówienie
 * przez sesję płatności. Zamknięcie bez `refunded_amount_cents` wyglądało tam
 * jak NOWY zwrot: drugi mail o zwrocie, drugi dzwonek, drugi wynik biletu.
 * Zapisujemy więc pobraną kwotę brutto jako zwróconą (pełny zwrot oddaje
 * całą intencję płatności) i intencję płatności - korekta operatora trafia
 * wtedy w bramkę powtórki i nie robi nic.
 */
async function refundOversold(
  txn: OneTimeTransaction,
  order: FulfilOrderRow,
  /** Właściciel zamówienia - wołający dochodzi tu wyłącznie z kontem. */
  userId: string,
  amountCents: number,
  currency: string,
  mode: SettlementMode,
): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const nowIso = new Date().toISOString();
  // Kupujący słyszy „kod wrócił do puli" tylko wtedy, gdy baza go oddała.
  let couponReleased = false;
  if (mode.provider === "coupon") {
    const { error: flipErr } = await supabaseAdmin
      .from("payment_orders")
      .update({ status: "canceled", updated_at: nowIso })
      .eq("id", order.id);
    if (flipErr) throw new Error(`one-time: free order cancel failed: ${flipErr.message}`);
    // Wspólna ścieżka zwolnienia, jak `releaseOrderCoupon`. Gołe RPC
    // `release_b2b_coupon_for_user` nie miało powrotu do starej funkcji, więc
    // na bazie bez migracji 20261007140200 (pas produkcyjny przed 0305)
    // użycie kodu przepadało - a anulowanego zamówienia nic już nie rozlicza
    // ponownie (`_event_free_ticket_orders_unsettled` bierze pending/paid).
    const { releaseCouponForUser } = await import("@/lib/billing/couponRpc.server");
    const { data, error: releaseErr } = await releaseCouponForUser(supabaseAdmin, {
      tenantId: order.tenant_id,
      userId,
      couponId: mode.couponId,
      orderId: order.id,
    });
    if (releaseErr) {
      console.error("[payments] free order coupon release failed", order.id, releaseErr.message);
    }
    couponReleased = !releaseErr && data === true;
  } else {
    // Zwrot w ŚRODOWISKU ZDARZENIA, nie w domyślnym (PAY-14b).
    // `resolveEnvironment(null)` dawało `sandbox` wszędzie poza produkcją -
    // podgląd z kluczami live zlecał zwrot transakcji live kluczem piaskownicy,
    // operator odpowiadał „nie ma takiej płatności", a webhook kręcił się
    // w ponowieniach.
    const { refundTransactionFully } = await import("@/lib/billing/refundProvider.server");
    const refund = await refundTransactionFully(mode.env, txn.id, "oversold");
    if (!refund.ok) {
      // Zwrot nie przeszedł u operatora - nie wolno udawać, że sprawa jest
      // zamknięta. Rzucamy, żeby webhook został ponowiony.
      throw new Error(`one-time: oversold refund failed (${txn.id}): ${refund.error}`);
    }

    const { error: flipErr } = await supabaseAdmin
      .from("payment_orders")
      .update({
        status: "refunded",
        provider: "stripe",
        provider_intent_id: txn.id,
        ...(txn.paymentIntentId ? { provider_payment_intent_id: txn.paymentIntentId } : {}),
        amount_cents: amountCents,
        refunded_amount_cents: amountCents,
        currency,
        updated_at: nowIso,
        ...(txn.customerEmail ? { receipt_email: txn.customerEmail } : {}),
      })
      .eq("id", order.id);
    if (flipErr) throw new Error(`one-time: oversold status flip failed: ${flipErr.message}`);

    await applyTicketOutcome(order.id, "refunded");

    const { notifyRefundEmail } = await import("@/lib/billing/notifications.server");
    await notifyRefundEmail({
      userId,
      planId: order.plan_id,
      amountCents,
      currency,
      transactionId: txn.id,
      accessUntil: nowIso,
      idempotencySeed: `oversold:${order.id}`,
    });
  }

  await supabaseAdmin.from("notifications").insert({
    user_id: userId,
    tenant_id: order.tenant_id,
    kind: "billing",
    title_pl: "Brak wolnych miejsc - zwrot płatności",
    title_en: "Event sold out - payment refunded",
    body_pl:
      mode.provider !== "coupon"
        ? "Ostatnie miejsce zajęto przed zaksięgowaniem płatności. Zwróciliśmy pełną kwotę."
        : couponReleased
          ? "Ostatnie miejsce zajęto, zanim bilet został wydany. Kod wrócił do puli."
          : "Ostatnie miejsce zajęto, zanim bilet został wydany. Zamówienie zostało anulowane.",
    body_en:
      mode.provider !== "coupon"
        ? "The last seat was taken before your payment settled. We refunded the full amount."
        : couponReleased
          ? "The last seat was taken before your ticket was issued. Your code is usable again."
          : "The last seat was taken before your ticket was issued. Your order was canceled.",
    href: "/profile/tickets",
    icon: "receipt",
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Miejsce RSVP dla wpłaty bez zgłoszenia - JEDNA decyzja w bazie pod blokadą
 * wiersza wydarzenia (TIX-08). Dwa webhooki o ostatnie miejsce nie przejdą
 * już obu odczytów przed zapisem. `full` = zwrot.
 *
 * OKNO WDROŻENIA: bez funkcji w bazie (migracja przed kodem) zostaje dawny
 * odczyt + zapis - bez blokady, ale nie gorszy niż przed zmianą.
 */
async function claimPaidRsvpSeat(
  order: FulfilOrderRow,
  userId: string,
  eventId: string,
): Promise<"seated" | "full"> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("_event_rsvp_claim_paid_seat", {
    p_order_id: order.id,
  });
  if (!error) {
    const verdict = asRecord(data);
    if (verdict?.ok === true) return "seated";
    if (verdict?.reason === "event_full") return "full";
    throw new Error(`one-time: rsvp seat claim refused (${order.id}): ${String(verdict?.reason)}`);
  }
  if (!isMigrationPending(error)) {
    throw new Error(`one-time: rsvp seat claim failed (${order.id}): ${error.message}`);
  }

  const { assertSeatAvailable } = await import("@/lib/events/ticket.server");
  try {
    await assertSeatAvailable(supabaseAdmin, eventId, userId);
  } catch (err) {
    if (err instanceof Error && err.message === "event_full") return "full";
    throw err;
  }
  const { error: rsvpErr } = await supabaseAdmin.from("event_rsvps").upsert(
    {
      tenant_id: order.tenant_id,
      event_id: eventId,
      user_id: userId,
      status: "going",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "event_id,user_id" },
  );
  if (rsvpErr) throw new Error(`one-time: rsvp confirm failed: ${rsvpErr.message}`);
  return "seated";
}

/**
 * Przenosi wynik płatności na zgłoszenie uczestnika (potwierdzenie, brak
 * zapłaty, zwrot + promocja z listy rezerwowej). Jedna funkcja bazowa, więc
 * webhook i panel admina dają identyczny skutek. Brak zgłoszenia to normalny
 * przypadek (RSVP bez formularza) - wraca jako `registration_not_found`.
 *
 * BŁĄD RPC PRZY WPŁACIE RZUCA (TIX-05). Dotąd połykany błąd dawał `null`,
 * a `null` czytało się jak „miejsce jest Twoje": kupujący dostawał RSVP i link
 * wejścia, a zgłoszenie zostawało nieopłacone, bez kodu QR. Wyjątek zamienia
 * się w 500, operator ponawia webhook (rozliczenie wpłaty jest idempotentne
 * i biegnie od nowa), a funkcja bazowa - dla tego samego zamówienia też.
 * Zwrot zostaje fail-soft (`null`): powtórka zwrotu kończy się `skipped`,
 * zanim doszłaby tu drugi raz, więc wyjątek niczego by nie dokończył -
 * zgłoszenie po awarii poprawia organizator. Zamknięcie kasy (wygaśnięcie,
 * odrzucona płatność) rzuca na życzenie (`throwOnError`, 4.6).
 *
 * Zwraca ładunek RPC - wołający czyta z niego, czy wpłata dała miejsce
 * (`paidTicketVerdict`), zanim potwierdzi RSVP.
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
    if (outcome === "paid") {
      throw new Error(`one-time: ticket outcome failed (${orderId}): ${error.message}`);
    }
    if (options.throwOnError) {
      throw new Error(`ticket outcome failed (${orderId}, ${outcome}): ${error.message}`);
    }
    return null;
  }
  const payload = asPayload(data);
  if (payload === null) {
    if (outcome === "paid") throw new Error(`one-time: ticket outcome unreadable (${orderId})`);
    return null;
  }
  if (options.notify === false) return payload;

  // Powiadomienie idzie po zapisie i nigdy go nie unieważnia (fail-soft).
  try {
    const { notifyTicketOutcome, notifyTicketRefusal } =
      await import("@/lib/events/registrationOutcomeNotify.server");
    if (outcome === "paid" && isTicketPaymentRefusal(payload)) {
      await notifyTicketRefusal(payload);
    } else {
      await notifyTicketOutcome(payload);
    }
  } catch (err) {
    console.error("[payments] ticket outcome notify failed", orderId, err);
  }

  // BILETY Z KODEM QR po opłaceniu: płacący i każdy gość jego grupy dostaje
  // osobny mail od razu. Wyłącznie po wpłacie, którą baza ZAPISAŁA na
  // zgłoszeniu (`applied`) - odmowa (cudze zgłoszenie, druga wpłata) też niesie
  // `registration_id`, ale kodu nie dostaje. Ponowiony webhook dokańcza
  // wysyłkę (rozliczenie jest idempotentne), a podwójnemu wydaniu zapobiega
  // baza (zajęcie i `ticket_code_sent_at`). Czego ta ścieżka nie domknie,
  // zbierze cron (`event-ticket-codes`). Wiersz w kolejce albo czekający na
  // decyzję kodu nie dostanie - baza wydaje go wyłącznie zgłoszeniu z miejscem.
  if (
    outcome === "paid" &&
    payload.applied === true &&
    typeof payload.registration_id === "string"
  ) {
    const { issueAndSendTicketCodes } = await import("@/lib/events/ticketCodeNotify.server");
    await issueAndSendTicketCodes(payload.registration_id);
  }
  return payload;
}

/**
 * Zamówienie zamknięte bez płatności - teraz albo przez wcześniejszą dostawę.
 *
 * Warunkowe zamknięcie, które nie trafiło w wiersz widziany przez NAS jako kasa
 * w toku, znaczy, że status zmienił w międzyczasie ktoś inny - np. kasa,
 * która unieważnia zastąpione zamówienie jako `canceled` i zwolnienie kuponu
 * zostawia temu webhookowi (`adhocCheckout.server.ts`). Stary odczyt
 * (`processing`) pomijał wtedy zwolnienie, a zdarzenie kończyło się bez
 * ponowienia - użycie kodu przepadało. Pytamy więc bazę o bieżący status.
 */
async function closedUnpaid(
  order: LifecycleOrder,
  closedNow: boolean,
  scope: string,
): Promise<boolean> {
  if (closedNow) return true;
  const status = (OPEN_STATUSES as readonly string[]).includes(order.status ?? "")
    ? await currentOrderStatus(order.id, scope)
    : order.status;
  return status === "failed" || status === "canceled";
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
 * oddaje miejsca. Zamówienie nieznane bazie dostaje wyłącznie wynik biletu.
 * Błąd zapisu wyniku biletu RZUCA (4.6), więc webhook wróci.
 */
export async function markOneTimePaymentFailed(
  customData: Record<string, unknown> | null,
  env: StripeEnv,
): Promise<void> {
  const orderId = orderIdOf(customData);
  if (!orderId) return;

  const order = await loadLifecycleOrder(orderId, "payment failed");
  if (order && !sameEnvironment(order, env, "payment failed")) return;
  const closed = order ? await closeOpenOrder(order, "failed", "payment failed") : false;
  const unpaid = order ? await closedUnpaid(order, closed, "payment failed") : false;

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
  if (order.provider_session_id && order.provider_session_id !== sessionId) {
    console.warn("[payments] expire: session does not match order - skipping", orderId, sessionId);
    return false;
  }

  const closed = await closeOpenOrder(order, "canceled", "expire", {
    cancel_reason: "session_expired",
  });
  const unpaid = await closedUnpaid(order, closed, "expire");
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
 * FAKTURA DOMYKA WYŁĄCZNIE ZAMÓWIENIE OSTEMPLOWANE PRZEZ SESJĘ TEJ SAMEJ
 * SUBSKRYPCJI (`provider_subscription_id`). Metadane `orderId` niesie KAŻDA
 * faktura subskrypcji założonej w naszej kasie - także sprzed wdrożenia
 * domknięcia, gdy zamówienia subskrypcji zostawały na zawsze w `processing`
 * bez identyfikatora subskrypcji. Bez tego warunku pierwsze odnowienie po
 * wdrożeniu „opłacało" takie zamówienie miesiące po zakupie: kwota
 * odnowienia, `paid_at` z dnia odnowienia i efekty kuponu na nowo. Faktura,
 * która wyprzedziła sesję (Stripe wysyła je równolegle), też niczego nie
 * zmienia - domknie je sesja, która jako jedyna niesie rozbicie kwoty
 * i kody promocyjne, więc przegląd kwoty (PAY-06) nie zależy od kolejności
 * dostaw. Trial: sesja stempluje zamówienie od razu, a faktura opłacająca
 * okres po trialu przychodzi dni później.
 *
 * PRZEGLĄD (rozjazd kwoty, kody promocyjne) liczy WYŁĄCZNIE pierwsza dostawa
 * sesji - zamówienie jeszcze bez stempla i bez `paid`. Kod obcego najemcy
 * albo spoza zakresu kuponu oznacza zamówienie do przeglądu z alertem, ale
 * niczego nie wstrzymuje: dostęp daje `subscription.*` (S8). Powtórka sesji
 * nie ocenia kodów od nowa (wynik zależałby od stanu kuponu w chwili
 * powtórki), tylko dokańcza alert zapisanej flagi (raz na incydent).
 * Faktura NIE nadpisuje `provider_session_id` (to identyfikator sesji, nie
 * faktury) i nie przechodzi porównania kwoty - nie ma rozbicia.
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
  // Stempel sesji tej subskrypcji: jedyny dowód, że zamówienie przeszło przez
  // domknięcie (zapisuje go wyłącznie ta funkcja, zawsze najpierw z sesji).
  const stamped =
    Boolean(txn.subscriptionId) && order.provider_subscription_id === txn.subscriptionId;
  if (!fromSession && !stamped) {
    console.warn(
      "[payments] subscription settle: invoice for an order not stamped by its session",
      {
        orderId,
        invoiceId: txn.id,
        status: order.status,
      },
    );
    return "skipped";
  }
  // Odnowienie: zamówienie opłaciła wcześniej INNA transakcja, a faktura nie
  // niesie niczego do przeglądu - jeden odczyt, bez zapisu.
  if (!fromSession && order.status === "paid" && order.provider_intent_id !== txn.id) {
    return "skipped";
  }
  const charged = positiveCents(collectedCentsOf(txn));
  // Trial: sesja bez pozycji do zapłaty (`subtotal` = 0) - porównywać nie ma
  // czego. Rabat 100% na pozycji ma `subtotal` > 0 i porównanie przechodzi.
  const trial = charged === null && (txn.amountSubtotalCents ?? 0) === 0;
  const firstReview = fromSession && !stamped && order.status !== "paid";
  const promo = firstReview
    ? await reviewPromotionCodes(env, txn.promotionCodeIds, {
        id: order.id,
        tenantId: order.tenant_id,
        planId: order.plan_id,
        eventId: null,
      })
    : NO_PROMOTION_CODE_REVIEW;
  const review = firstReview ? orderReview(trial ? null : amountMismatch(txn, order), promo) : null;
  // Powtórka sesji: flaga zapisana przy pierwszej dostawie - jej alert mógł
  // nie wyjść (awaria procesu po zapisie), a `once` nie zdubluje dzwonka.
  const pendingReview = fromSession && !firstReview ? storedReview(order.metadata) : null;
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
    const { data: stamps, error } = await supabaseAdmin
      .from("payment_orders")
      .update(providerIds)
      .eq("id", order.id)
      .in("status", [...PAYABLE_STATUSES])
      .select("id");
    if (error) throw new Error(`subscription settle: provider ids stamp failed: ${error.message}`);
    const changed = stamps.length > 0;
    if (changed && review) await alertOrderReview(order, review);
    if (pendingReview) await alertOrderReview(order, pendingReview);
    return changed ? "stamped" : "skipped";
  }

  // Zwrot sprzed domknięcia przechodzi razem z kwotą na podstawę pobraną.
  const refundedSoFar = order.refunded_amount_cents;
  const rebasedRefund = refundInCollectedBasis(refundedSoFar, order.amount_cents, charged);
  const flip = supabaseAdmin
    .from("payment_orders")
    .update({
      ...providerIds,
      status: "paid",
      paid_at: paidAtOf(txn),
      provider_intent_id: txn.id,
      ...(txn.paymentIntentId ? { provider_payment_intent_id: txn.paymentIntentId } : {}),
      amount_cents: charged,
      currency: currencyOf(txn, order),
      ...(rebasedRefund !== null ? { refunded_amount_cents: rebasedRefund } : {}),
    })
    .eq("id", order.id)
    .in("status", [...PAYABLE_STATUSES]);
  const { data: settled, error } = await (
    rebasedRefund !== null ? flip.eq("refunded_amount_cents", refundedSoFar) : flip
  ).select("id");
  if (error) throw new Error(`subscription settle: order paid flip failed: ${error.message}`);
  const changed = settled.length > 0;
  // Powtórka TEGO SAMEGO zdarzenia, które opłaciło zamówienie (np. po awarii
  // procesu między zapisem a efektami) - dokańcza efekty kuponu. Odnowienie
  // (inna faktura) trafia w zamówienie opłacone wcześniej i nie robi nic.
  const replay = !changed && order.status === "paid" && order.provider_intent_id === txn.id;
  if (!changed && !replay) {
    // Równoległa dostawa tej samej sesji zdążyła pierwsza (zapisała ten sam
    // przegląd) albo zwrot zmienił licznik w międzyczasie - wtedy ponowienie.
    if (rebasedRefund !== null) {
      refundCounterRaced(
        await currentOrderStatus(order.id, "subscription settle"),
        order.id,
        "subscription settle",
      );
    }
    return "skipped";
  }
  if (review) await alertOrderReview(order, review);
  if (pendingReview) await alertOrderReview(order, pendingReview);

  // Efekty kuponu B2B - fail-closed na `status='paid'` i idempotentne po
  // stronie bazy (zatrzask `effects_applied_at`).
  const { applyCouponEffectsForOrder } = await import("@/lib/billing/couponEffects.server");
  await applyCouponEffectsForOrder(order.id);
  return changed ? "settled" : "skipped";
}

async function loadOrder(orderId: string): Promise<FulfilOrderRow | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // `environment` (kolumna z 20260731220000) nie jest jeszcze w wygenerowanym
  // types.ts; nazwanie jej w .select() zatruwałoby typ całego wiersza, więc dla
  // tego odczytu rzutujemy klienta na luźny typ (konwencja jak invoice.server).
  const { data: order, error } = await (supabaseAdmin as unknown as SupabaseClient)
    .from("payment_orders")
    .select(FULFIL_ORDER_COLUMNS)
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw new Error(`one-time: order lookup failed: ${error.message}`);
  return (order as FulfilOrderRow | null) ?? null;
}

async function fulfilOrder(
  txn: OneTimeTransaction,
  orderId: string,
  env: StripeEnv,
): Promise<OneTimeOutcome> {
  const order = await loadOrder(orderId);
  if (!order) {
    console.warn("[payments] one-time: unknown order", orderId);
    return "skipped";
  }

  // IZOLACJA SANDBOX/LIVE (P0): realizujemy zamówienie WYŁĄCZNIE zdarzeniem z
  // tego samego środowiska, w którym powstało. Bez tego sandboxowy webhook
  // (opłacony kartą testową) mógłby zrealizować realne zamówienie. Odpowiednik
  // `.eq("environment", env)` ze ścieżki subskrypcyjnej.
  if (!sameEnvironment(order, env, "one-time")) return "skipped";
  return (await settleOrder(txn, order, { provider: "stripe", env })).outcome;
}

/** Wynik rozliczenia darmowego zamówienia - kasa mówi z niego kupującemu prawdę. */
export interface FreeTicketSettlement {
  outcome: Exclude<OneTimeOutcome, "donation" | "held">;
  /** Miejsce potwierdzone (zgłoszenie z miejscem albo RSVP przyznane pod blokadą). */
  seated: boolean;
}

/**
 * Zamówienie biletu za ZERO (kod 100%, TIX-13a) - rozliczenie bez operatora.
 * Woła je kasa (`createCheckoutOrder`) zaraz po zarezerwowaniu użycia kodu,
 * a ponawia tick zadań (`runUnsettledFreeTicketOrders`); reszta jest tą samą
 * ścieżką co wpłata z webhooka: zgłoszenie, kod QR, RSVP, maile.
 *
 * PONOWIENIE. Darmowe zamówienie nie ma webhooka, który powtórzyłby rozliczenie
 * urwane po księgowaniu - dlatego `paid` też przechodzi: cała ścieżka jest
 * idempotentna dla tego samego zamówienia (RPC, klucze idempotencji maili,
 * dzwonki na `newly_settled`), tak jak przy ponowionym webhooku.
 *
 * Inne zamówienie jest pomijane - ta funkcja nie może oznaczyć jako opłaconego
 * niczego, za co ktoś powinien zapłacić: tylko zamówienie biletu za zero,
 * założone z kodem (`provider = coupon`, `coupon_id` w metadanych), oczekujące
 * albo już zaksięgowane - nigdy anulowane. Baza i tak porównuje kwotę z ceną
 * biletu (`_event_ticket_order_mismatch`: kwota + rabat kodu >= cena).
 */
export async function settleFreeTicketOrder(orderId: string): Promise<FreeTicketSettlement> {
  const order = await loadOrder(orderId);
  const meta = asRecord(order?.metadata);
  const couponId = str(meta, "coupon_id");
  if (
    !order ||
    order.amount_cents !== 0 ||
    order.kind !== "one_time" ||
    (order.status !== "pending" && order.status !== "paid") ||
    order.provider !== "coupon" ||
    !str(meta, "event_id") ||
    !couponId
  ) {
    console.warn("[payments] free ticket order rejected", orderId);
    return { outcome: "skipped", seated: false };
  }
  const settled = await settleOrder(
    {
      id: `free_${order.id}`,
      amountCents: 0,
      currency: order.currency,
      customerEmail: null,
      customData: null,
    },
    order,
    { provider: "coupon", couponId },
  );
  // `skipped` = zamówienie zamknięte między odczytem a księgowaniem - kasa nie
  // obiecuje wtedy biletu, a tick liczy je jako porażkę.
  const outcome =
    settled.outcome === "oversold_refunded" || settled.outcome === "skipped"
      ? settled.outcome
      : "order";
  return { outcome, seated: settled.seated };
}

/** Bilans jednego przebiegu ponowień darmowych zamówień (tick zadań). */
export interface UnsettledFreeTicketOrdersResult {
  claimed: number;
  settled: number;
  failed: number;
  deferred: number;
  skipped?: "migration_pending";
}

/**
 * Ponawia rozliczenie darmowych zamówień biletowych, które utknęły (kasa
 * urwała się przed księgowaniem albo po nim). Listę wskazuje baza
 * (`_event_free_ticket_orders_unsettled`: same fakty - status, zgłoszenie,
 * RSVP, znacznik odmowy). Błąd jednego zamówienia nie zatrzymuje reszty;
 * zamówienie, które znów padło, wróci w następnym ticku.
 */
export async function runUnsettledFreeTicketOrders(
  admin: SupabaseClient<Database>,
  limit = 10,
  deadlineAt: number = Date.now() + 5_000,
): Promise<UnsettledFreeTicketOrdersResult> {
  const result: UnsettledFreeTicketOrdersResult = {
    claimed: 0,
    settled: 0,
    failed: 0,
    deferred: 0,
  };
  if (Date.now() > deadlineAt) return result;
  const { data, error } = await admin.rpc("_event_free_ticket_orders_unsettled", {
    p_limit: limit,
  });
  if (error) {
    if (isMigrationPending(error)) return { ...result, skipped: "migration_pending" };
    throw new Error(`free ticket orders lookup failed: ${error.message}`);
  }
  const ids = (Array.isArray(data) ? data : []).filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
  for (const id of ids) {
    result.claimed += 1;
    if (Date.now() > deadlineAt) {
      result.deferred += 1;
      continue;
    }
    try {
      const settled = await settleFreeTicketOrder(id);
      if (settled.outcome === "skipped") result.failed += 1;
      else result.settled += 1;
    } catch (err) {
      result.failed += 1;
      console.error(
        "[payments] free ticket order retry failed",
        id,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  return result;
}

/** Skutek rozliczenia: wynik dla webhooka i to, czy miejsce zostało potwierdzone. */
interface SettledOrder {
  outcome: OneTimeOutcome;
  seated: boolean;
}

/**
 * Rozliczenie opłaconego zamówienia jednorazowego - JEDNA ścieżka dla wpłaty
 * operatora (`fulfilOrder`) i biletu za zero (`settleFreeTicketOrder`):
 * bramka zwrotu, przegląd kwoty i kodów promocyjnych, uprawnienie,
 * księgowanie, efekty kuponu, rozstrzygnięcie miejsca przez bazę i maile.
 */
async function settleOrder(
  txn: OneTimeTransaction,
  order: FulfilOrderRow,
  mode: SettlementMode,
): Promise<SettledOrder> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { grantEntitlement } = await import("@/lib/billing/grant.server");

  // BRAMKA ZWROTU - PRZED uprawnieniem. Zwrot PEŁNY, który wyprzedził
  // realizację (albo powtórka realizacji po zwrocie), zastaje zamówienie
  // `refunded` lub z licznikiem zwrotów równym kwocie. Grant w tym miejscu
  // wskrzeszał dostęp klientowi, który ma już pieniądze z powrotem, a od
  // 20261012 dyspozytor ponawia `transaction.completed` także po błędzie
  // zapisu dokumentu - księgowanie przestawiłoby zwrot (odmowa wpłaty, pełna
  // sala) z powrotem na opłacone. Zwrot CZĘŚCIOWY (korekta ceny) realizacji
  // nie blokuje - patrz `refundedInFull`.
  const orderStatus = order.status;
  const refundedSoFar = order.refunded_amount_cents;
  if (refundedInFull(order)) {
    console.warn("[payments] one-time: order already refunded - fulfilment refused", order.id);
    return { outcome: "skipped", seated: false };
  }

  // Księgi dostają kwotę POBRANĄ brutto (S5) - zwroty, faktury wydarzeń
  // i przychód czytają `amount_cents` jako pieniądze, które wpłynęły.
  // Porównanie z zamówieniem idzie po `subtotal - rabat`; rozjazd NIE blokuje
  // realizacji (operator przyjął płatność), ale daje flagę i alert.
  const amountCents = collectedCentsOf(txn) ?? order.amount_cents;
  const currency = currencyOf(txn, order);
  // Powtórka opłaconego zamówienia nie ocenia niczego od nowa: `amount_cents`
  // jest już kwotą pobraną brutto (nie oczekiwaną netto), a o kodach
  // promocyjnych rozstrzygnęło przejście na `paid` - patrz krok 0.
  const settledBefore = orderStatus === "paid";
  const mismatch = settledBefore ? null : amountMismatch(txn, order);
  // Zwrot częściowy sprzed realizacji przechodzi na podstawę kwoty pobranej
  // RAZEM z kwotą (jeden zapis) - patrz `refundInCollectedBasis`.
  const rebasedRefund = settledBefore
    ? null
    : refundInCollectedBasis(refundedSoFar, order.amount_cents, amountCents);

  const preMetadata = asRecord(order.metadata) ?? {};
  const eventId = str(preMetadata, "event_id");

  // 0. Kody promocyjne operatora (S8). Kod obcego najemcy albo spoza zakresu
  // kuponu: pieniądze pobrane, więc zamówienie jest `paid` (księgi muszą się
  // zgadzać z operatorem), ale dostępu NIE nadajemy - decyduje administrator.
  // Bilet za zero nie przeszedł przez operatora - nie ma czego sprawdzać.
  //
  // DECYZJA ZAPADA RAZ, przy przejściu na `paid`, i zostaje w
  // `metadata.review`. Powtórka (ponowienie z panelu, zamiatarka, dostawa po
  // awarii procesu, tick darmowych zamówień) czyta ją z zamówienia:
  // wstrzymane zostaje wstrzymane, a opłacone i nadane dokańcza skutki. Ocena
  // od nowa zależała od stanu kuponu w chwili POWTÓRKI - kupon wyłączony po
  // zakupie dawał `held`, alarm „dostępu nie nadano" przy aktywnym dostępie
  // i urwane efekty kuponu, biletu i maili przerwanej pierwszej dostawy.
  // Miejsca to nie dotyczy: rozstrzyga je baza (krok 4), idempotentnie dla
  // tego samego zamówienia.
  const recorded = settledBefore ? storedReview(preMetadata) : null;
  if (recorded && isPromotionHoldReason(recorded.reason)) {
    // Alert raz na incydent (`once`) - dokańcza ten, którego pierwsza dostawa
    // mogła nie wysłać po zapisie wstrzymania.
    await alertOrderReview(order, recorded, true);
    return { outcome: "held", seated: false };
  }
  const promo =
    !settledBefore && mode.provider === "stripe"
      ? await reviewPromotionCodes(mode.env, txn.promotionCodeIds, {
          id: order.id,
          tenantId: order.tenant_id,
          planId: order.plan_id,
          eventId,
        })
      : NO_PROMOTION_CODE_REVIEW;
  const review = orderReview(mismatch, promo);
  const metadata = reviewedMetadata(preMetadata, review, promo.unscopedIds);
  const paidPatch = {
    status: "paid" as const,
    paid_at: paidAtOf(txn),
    provider: mode.provider,
    provider_intent_id: txn.id,
    provider_session_id: txn.sessionId ?? txn.id,
    ...(txn.paymentIntentId ? { provider_payment_intent_id: txn.paymentIntentId } : {}),
    ...(txn.customerId ? { provider_customer_id: txn.customerId } : {}),
    amount_cents: amountCents,
    ...(rebasedRefund !== null ? { refunded_amount_cents: rebasedRefund } : {}),
    currency,
    ...(metadata ? { metadata } : {}),
    ...(txn.customerEmail ? { receipt_email: txn.customerEmail } : {}),
  };
  const payable = mode.provider === "stripe" ? SETTLEABLE_STATUSES : PAYABLE_STATUSES;
  // Przejście na `paid` WYŁĄCZNIE ze statusu, który wolno rozliczyć. Przy
  // przeliczanym liczniku zwrotu także pod warunkiem, że licznik jest tym,
  // który przeczytaliśmy - zwrot zapisany w międzyczasie nie może zostać
  // nadpisany starą podstawą.
  const flipToPaid = () => {
    const flip = supabaseAdmin
      .from("payment_orders")
      .update(paidPatch)
      .eq("id", order.id)
      .in("status", [...payable]);
    return (rebasedRefund !== null ? flip.eq("refunded_amount_cents", refundedSoFar) : flip).select(
      "id",
    );
  };

  if (promo.hold && review) {
    const { data: held, error: holdErr } = await flipToPaid();
    if (holdErr) throw new Error(`one-time: order hold flip failed: ${holdErr.message}`);
    // Zero przestawionych wierszy = zwrot albo zamknięcie wyprzedziło zapis
    // (kody ocenia wyłącznie dostawa zamówienia nieopłaconego); dostępu i tak
    // nie ma, alarmu też nie. Wyjątek: zwrot częściowy zmienił licznik
    // w międzyczasie - zamówienie czeka na ponowienie.
    if (held.length === 0) {
      if (rebasedRefund !== null) {
        refundCounterRaced(
          await currentOrderStatus(order.id, "one-time"),
          order.id,
          "one-time",
          payable,
        );
      }
      return { outcome: "skipped", seated: false };
    }
    await alertOrderReview(order, review, true);
    return { outcome: "held", seated: false };
  }

  // 1. Uprawnienie (idempotentne) - zanim cokolwiek uzna zamówienie za opłacone.
  await grantEntitlement({ ...order, amount_cents: amountCents }, txn.id);

  // 2. Księgowanie - `paid_at` stemplowane dokładnie raz mimo ponowień,
  // i WYŁĄCZNIE ze statusu, który wolno rozliczyć (`SETTLEABLE_STATUSES` /
  // `PAYABLE_STATUSES`): zwrócone zamówienie nie wraca na opłacone. Zwrot
  // częściowy sprzed realizacji zostaje w księgach - przeliczony na podstawę
  // kwoty pobranej.
  const { data: flipped, error: updateErr } = await flipToPaid();
  if (updateErr) throw new Error(`one-time: order paid flip failed: ${updateErr.message}`);

  if (flipped.length === 0) {
    // Nic się nie przestawiło: albo powtórka (zamówienie już `paid` - skutki
    // niżej są idempotentne), albo zwrot WYPRZEDZIŁ nadanie między naszym
    // odczytem a zapisem. W drugim przypadku uprawnienie z kroku 1 nie ma
    // pokrycia w pieniądzach i musi zniknąć od razu - także pod kluczem
    // transakcji, pod którym właśnie je nadaliśmy. Zwrot CZĘŚCIOWY w tym
    // oknie (licznik inny niż przeliczany) zostawia zamówienie w toku -
    // uprawnienie ma pokrycie, a ponowienie dokończy księgowanie.
    const current = await currentOrderStatus(order.id, "one-time");
    if (rebasedRefund !== null) refundCounterRaced(current, order.id, "one-time", payable);
    if (current !== "paid") {
      console.error(
        "[payments] one-time: order closed while fulfilling - entitlement revoked",
        order.id,
        current,
      );
      const { revokeOrderAccess } = await import("@/lib/billing/refunds.server");
      await revokeOrderAccess(order as unknown as AdjustmentOrder, new Date().toISOString(), [
        txn.id,
      ]);
      return { outcome: "skipped", seated: false };
    }
    // Powtórka: flaga zapisana przy przejściu na `paid` - jej alert mógł nie
    // wyjść (awaria procesu po zapisie), a `once` nie zdubluje dzwonka.
    if (recorded) await alertOrderReview(order, recorded);
  } else if (review) {
    await alertOrderReview(order, review);
  }

  // 3. Efekty kuponu B2B - fail-closed na `status='paid'`, więc dopiero teraz.
  const { applyCouponEffectsForOrder } = await import("@/lib/billing/couponEffects.server");
  await applyCouponEffectsForOrder(order.id);

  // Zamówienie zanonimizowane (konto usunięte, dowód księgowy został -
  // migracja 20260803090002): punkty 1-3 wciąż mają sens, bo dotyczą ksiąg.
  // RSVP, dzwonek i mail nie mają już adresata - kończymy tutaj, zamiast
  // rzucać i skazywać webhook na wieczne ponowienia.
  const userId = order.user_id;
  if (!userId) {
    console.warn("[payments] one-time: order has no owner (anonymised), effects skipped", order.id);
    return { outcome: "order", seated: false };
  }

  // 4. Bilet na wydarzenie. NAJPIERW zgłoszenie: to samo zdarzenie płatności
  // potwierdza zgłoszenie z formularza, wydaje kod QR i zdejmuje wpis z listy
  // rezerwowej - albo zostawia wpłatę w kolejce / w oczekiwaniu na decyzję,
  // albo ODMAWIA wpłaty (cudze zgłoszenie, zła kwota, druga wpłata).
  //
  // RSVP 'going' DOPIERO PO ODPOWIEDZI BAZY i tylko przy potwierdzonym
  // miejscu: zgłoszenie z miejscem albo zakup bez zgłoszenia, któremu baza
  // przyznała miejsce RSVP pod blokadą. Ponowienie webhooka jest bezpieczne:
  // RPC są idempotentne dla tego samego zamówienia, mail i SMS mają klucze
  // idempotencji, a dzwonki stoją na `newly_settled`.
  let seated = false;
  if (eventId) {
    const ticket = await applyTicketOutcome(order.id, "paid");
    const verdict = paidTicketVerdict(ticket);
    if (verdict === "seated") {
      const { error: rsvpErr } = await supabaseAdmin.from("event_rsvps").upsert(
        {
          tenant_id: order.tenant_id,
          event_id: eventId,
          user_id: userId,
          status: "going",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "event_id,user_id" },
      );
      if (rsvpErr) throw new Error(`one-time: rsvp confirm failed: ${rsvpErr.message}`);
      seated = true;
    } else if (verdict === "rsvp") {
      if ((await claimPaidRsvpSeat(order, userId, eventId)) === "full") {
        await refundOversold(txn, order, userId, amountCents, currency, mode);
        return { outcome: "oversold_refunded", seated: false };
      }
      seated = true;
    } else if (verdict === "refused") {
      console.warn("[payments] one-time: ticket payment refused", order.id, ticket?.reason);
    }
    // Zwrot częściowy sprzed realizacji (2.8 / 5.9): wpłata dała miejsce,
    // a rozliczenie zgłoszenia ma pokazać korektę ceny. Bez powiadomienia -
    // klient dostał już mail o zwrocie z obsługi korekty. Baza porównuje
    // licznik z `amount_cents`, więc idzie w tej samej (pobranej) podstawie.
    // Odmówiona wpłata idzie w całości do zwrotu w kolejce bazy - korekty nie
    // ma na czym zapisać.
    if (refundedSoFar > 0 && verdict !== "refused") {
      await applyTicketOutcome(order.id, "partial_refund", rebasedRefund ?? refundedSoFar, {
        notify: false,
      });
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
      userId,
      planId: order.plan_id,
      amountCents,
      currency,
      idempotencySeed: order.id,
    });
  }
  // „Miejsce zarezerwowane" tylko przy potwierdzonym miejscu. Kupujący
  // w kolejce albo czekający na decyzję dostał już właściwy mail
  // (`event_ticket_paid_waitlisted` / `_pending`), a odmówiona wpłata -
  // zawiadomienie o zwrocie (`notifyTicketRefusal`) z `applyTicketOutcome`.
  if (eventId && seated) {
    await notifyEventRegistration({
      userId,
      eventId,
      amountCents,
      currency,
      transactionId: txn.id,
      ticketSeed: order.id,
      idempotencySeed: order.id,
    });
  }
  return { outcome: "order", seated };
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
    //
    // DWA RÓŻNE IDENTYFIKATORY, każdy w swojej kolumnie: sesja (`cs_...`,
    // `txn.id`) odnajduje wiersz, a intencja płatności (`pi_...`) jest kluczem,
    // po którym przychodzi zwrot i spór. Dawniej w `provider_intent_id` lądowała
    // sesja, więc `charge.refunded` (niosący `pi_...`) nigdy nie trafiał
    // w darowiznę: zwrócona wpłata zostawała `paid` razem ze statusem
    // wspierającego (audyt SUB-09). Środowisko zdarzenia bramkuje zapis tak
    // samo jak przy zamówieniu (`fulfilOrder`).
    const { settleDonation } = await import("@/lib/billing/donations.server");
    const settled = await settleDonation({
      environment: env,
      donationId: str(txn.customData, "donationId"),
      sessionId: txn.sessionId ?? str(txn.customData, "sessionId") ?? txn.id,
      intentId: txn.paymentIntentId ?? null,
      amountCents: txn.amountCents,
      currency: txn.currency,
      donorEmail: txn.customerEmail,
      // Chwila zapłaty wg operatora, jak przy zamówieniu: powtórka (zamiatarka,
      // ponowienie) nie przenosi wpłaty do okresu, w którym ją zaksięgowano.
      paidAt: paidAtOf(txn),
    });
    return settled ? "donation" : "skipped";
  }

  const orderId = str(txn.customData, "orderId") ?? str(txn.customData, "order_id");
  if (orderId) return fulfilOrder(txn, orderId, env);

  console.warn("[payments] one-time transaction without recognised custom_data", txn.id);
  return "skipped";
}
