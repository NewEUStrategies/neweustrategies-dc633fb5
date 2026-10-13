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
// SUBSKRYPCJA (S1). Zwrot ani spór NIE anulują subskrypcji u operatora - kolejne
// odnowienia nadal są pobierane. Dlatego korekta faktury za okres, który już
// MINĄŁ (koniec okresu pozycji faktury <= teraz), nie zmienia dostępu (usługa
// została skonsumowana) - zostaje księgowanie i alert dla zespołu. Korekta
// BIEŻĄCEGO okresu (pełny zwrot, spór otwarty, przegrany albo zatrzymany
// zwrotem) zapisuje `refunded` z `canceled_at` = chwila korekty, a
// `syncEntitlementState` przywraca dostęp dopiero za NOWY opłacony okres albo
// po rozstrzygnięciu na naszą korzyść (`force`).
//
// SPORY (S2). Skutek liczymy z BIEŻĄCEGO stanu sporu u operatora, nie ze stanu
// w zdarzeniu - spóźnione `created` po `closed(won)` nie zawiesza ponownie
// dostępu. Przywrócenie po wygranej sprawdza u operatora, czy obciążenie nie
// zostało w międzyczasie ZWRÓCONE. Spór nie wysyła klientowi maila ani dzwonka
// „zwrot płatności" - to potwierdzenie zwrotu, który się nie wydarzył (i dowód
// dla banku przeciwko nam). Zespół dostaje jeden alert na spór i fazę.
//
// Kontrakt błędów jak w pozostałych handlerach: rzucamy przy awarii zapisu
// albo odczytu operatora, żeby operator ponowił dostarczenie zdarzenia.
// Efekty miękkie (mail, CRM, dzwonek) nigdy nie wywracają przetwarzania.
//
// Moduł server-only (klient service_role) - importuj wyłącznie z handlerów.
import type { Tables } from "@/integrations/supabase/types";
import type { PaymentRefundState } from "@/lib/billing/transactions.server";
import { PROFILE_PLAN_PATH } from "@/lib/profile/routes";

/** Kwalifikacja zdarzenia korygującego przysłanego przez operatora. */
export type AdjustmentAction = "refund" | "chargeback" | "chargeback_warning" | "credit" | "other";

export interface RefundEvent {
  /**
   * Identyfikator korekty u operatora - klucz idempotencji maili. Dla sporu
   * Stripe to identyfikator sporu (`dp_...`), dla nieudanego zwrotu -
   * identyfikator zwrotu (`re_...`).
   */
  adjustmentId: string;
  transactionId: string | null;
  subscriptionId: string | null;
  action: AdjustmentAction;
  /** `approved` / `pending_approval` / `rejected` / `reversed`. */
  status: string | null;
  /**
   * Kwota korekty. Dla zwrotu Stripe to `amount_refunded` - wartość
   * NARASTAJĄCA, a nie kwota pojedynczego zwrotu. Dzięki temu dwa częściowe
   * zwroty po 150 zł same złożą się na pełny zwrot 300 zł, bez sumowania po
   * naszej stronie (czyli bez ryzyka podwójnego zliczenia przy ponowieniu).
   */
  amountCents: number | null;
  /** Kwota pierwotnie pobrana - odniesienie dla progu „zwrot pełny". */
  capturedAmountCents?: number | null;
  currency: string | null;
  environment: "sandbox" | "live";
  /**
   * Surowy status operatora (np. `needs_response`, `won`, powód nieudanego
   * zwrotu) - do logów i treści alertu. O skutku decydują `action` i `status`.
   */
  providerStatus?: string | null;
  /**
   * Kod porażki zwrotu u operatora (`expired_or_canceled_card`, …) - tylko
   * dla zwrotu `failed`/`canceled` (`refund.failed`, `refund.updated`).
   */
  failureReason?: string | null;
}

export type RefundOutcome =
  | "skipped"
  | "subscription_refunded"
  | "order_refunded"
  | "donation_refunded"
  | "subscription_restored"
  | "order_restored"
  | "donation_restored"
  | "refund_failure_escalated";

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
  // Nieudany zwrot niczego nie odbiera - przywraca (patrz `applyRefundFailure`).
  if (isFailedRefund(event)) return false;
  if (event.action === "chargeback_warning") {
    return event.status !== "reversed" && event.status !== "rejected";
  }
  // `pending_approval` to dopiero wniosek - dostęp odbieramy po zatwierdzeniu.
  // `reversed` / `rejected` oznaczają, że zwrot nie doszedł do skutku.
  // `succeeded` to potwierdzenie zwrotu u operatora kart - równoważne
  // zatwierdzeniu; bez niego zwrot cicho nie odbierałby dostępu.
  return event.status === null || event.status === "approved" || event.status === "succeeded";
}

/** Korekta jest sporem płatniczym (otwartym albo rozstrzygniętym). */
function isDispute(event: RefundEvent): boolean {
  return event.action === "chargeback" || event.action === "chargeback_warning";
}

/**
 * Zwrot, którego operator NIE wykonał (`refund.failed`, `refund.updated`
 * ze stanem `failed`/`canceled`). Pieniądze zostały u nas: zamówienie wraca
 * do stanu z obciążenia (`applyRefundFailure`), a zlecenie zwrotu zgłoszenia
 * trafia do człowieka (`escalateFailedRefund`, INV-19c).
 */
export function isFailedRefund(event: RefundEvent): boolean {
  return event.action === "refund" && (event.status === "failed" || event.status === "canceled");
}

/** Spór rozstrzygnięty na naszą korzyść - dostęp wraca. */
export function isDisputeReversed(event: RefundEvent): boolean {
  return isDispute(event) && event.status === "reversed";
}

/**
 * Faza sporu - dla skutku, alertu i klucza deduplikacji alertu:
 *   * `open` - spór w toku (`chargeback_warning`),
 *   * `won` - bez utraty środków (`reversed`: `won`, `warning_closed`),
 *   * `prevented` - zatrzymany automatycznym zwrotem (zapobieganie sporom),
 *   * `lost` - środki wróciły do banku.
 */
type DisputePhase = "open" | "won" | "lost" | "prevented";

function disputePhase(event: RefundEvent): DisputePhase {
  if (isDisputeReversed(event)) return "won";
  if (event.action === "chargeback_warning") return "open";
  return event.providerStatus === "prevented" ? "prevented" : "lost";
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/**
 * Kształt identyfikatora operatora. Identyfikator wchodzi do filtra `or(...)`
 * jako TEKST, więc przecinek czy nawias mogłyby rozszerzyć zapytanie na cudze
 * zamówienia - bramkujemy go PRZED zapytaniem, na obu ścieżkach.
 */
const PROVIDER_REFERENCE_SHAPE = /^[A-Za-z0-9_-]{1,255}$/;

/** Identyfikator sporu Stripe - tylko taki da się odczytać u operatora. */
const STRIPE_DISPUTE_SHAPE = /^(dp|du)_[A-Za-z0-9_]{1,250}$/;

/** Płatność, o której stan da się zapytać operatora (`pi_` / `ch_`). */
function isPaymentRef(value: string | null | undefined): value is string {
  return (
    typeof value === "string" &&
    PROVIDER_REFERENCE_SHAPE.test(value) &&
    (value.startsWith("pi_") || value.startsWith("ch_"))
  );
}

/**
 * Kolumny zamówienia czytane przez OBIE ścieżki korekty. `status`
 * i `refunded_amount_cents` są tu regułą, nie wygodą: bez nich zwrot nie ma
 * jak stwierdzić, że zamówienie jest już w całości zwrócone (patrz bramka
 * powtórki w `revokeOrder`). Identyfikatory operatora - bo uprawnienie planu
 * mogło zostać nadane pod każdym z nich (patrz `revokeOrderAccess`).
 */
const ORDER_LOOKUP_COLUMNS =
  "id, user_id, tenant_id, plan_id, kind, entity_type, entity_id, metadata, amount_cents, refunded_amount_cents, currency, status, provider_session_id, provider_intent_id, provider_payment_intent_id";

/** Zamówienie w kształcie czytanym przez korektę - typ z wygenerowanych definicji bazy. */
export type AdjustmentOrder = Pick<
  Tables<"payment_orders">,
  | "id"
  | "user_id"
  | "tenant_id"
  | "plan_id"
  | "kind"
  | "entity_type"
  | "entity_id"
  | "metadata"
  | "amount_cents"
  | "refunded_amount_cents"
  | "currency"
  | "status"
> &
  Partial<
    Pick<
      Tables<"payment_orders">,
      "provider_session_id" | "provider_intent_id" | "provider_payment_intent_id"
    >
  >;

/** Faktura subskrypcji, którą opłaciła korygowana płatność. */
interface InvoiceContext {
  invoiceId: string;
  /** Koniec okresu USŁUGI z pozycji faktury - rozstrzyga regułę „okres minął". */
  periodEnd: string | null;
  billingReason: string | null;
  /** `metadata.orderId` subskrypcji - zamówienie z pierwszej kasy (księgi). */
  orderId: string | null;
}

/**
 * Identyfikatory, pod którymi darowizna mogła zostać zapisana. Wpłata
 * jednorazowa z webhooka trzyma w `provider_intent_id` SESJĘ Checkout
 * (`cs_...`), wpłata cykliczna - fakturę (`in_...`), a starsze wiersze -
 * intencję płatności. Zwrot i spór niosą wyłącznie `pi_`/`ch_`, więc samo
 * `provider_intent_id = pi_` nie trafiało w żadną wpłatę z webhooka.
 */
interface DonationRefs {
  paymentRef: string | null;
  sessionId: string | null;
  invoiceId: string | null;
  /** `metadata.donationId` sesji - TYLKO dla wpłaty jednorazowej (patrz niżej). */
  donationId: string | null;
}

/**
 * W co trafia korekta - rozstrzygane RAZ, przed alertem i przed skutkiem.
 *
 *   * `subscription` - płatność faktury subskrypcji (odnowienie albo pierwsza
 *     faktura). Zamówienie subskrypcyjne nie zna intencji płatności faktur,
 *     więc dopasowanie idzie przez operatora (`resolvePaymentInvoice`);
 *   * `order` - nasze zamówienie; `persistIntent` = intencję płatności
 *     znaleźliśmy dopiero przez sesję Checkout i trzeba ją utrwalić;
 *   * `donation` - wpłata z własnego formularza darowizn (albo płatność, której
 *     nie zna nic innego - wtedy dopasowanie po intencji nie trafi w nic);
 *   * `unmatched` - korekta bez rozpoznawalnej płatności.
 */
type AdjustmentTarget =
  | { kind: "subscription"; subscriptionId: string; invoice: InvoiceContext | null }
  | { kind: "order"; order: AdjustmentOrder; persistIntent: string | null }
  | { kind: "donation"; refs: DonationRefs }
  | { kind: "unmatched" };

type SubscriptionTarget = Extract<AdjustmentTarget, { kind: "subscription" }>;

/** UUID zamówienia z metadanych sesji - tylko taki kształt wolno wpisać do `or(...)`. */
const ORDER_ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Zamówienie wskazane przez korektę operatora - JEDNO miejsce dla odebrania
 * i dla przywrócenia dostępu.
 *
 * TRZY KOLUMNY IDENTYFIKATORA: zwrot przychodzi z identyfikatorem intencji
 * płatności, a zamówienie mogło zapisać sesję checkout albo (historycznie)
 * sesję w polu intencji. Wcześniej ten sam `or(...)` miało wyłącznie
 * odebranie dostępu, a przywrócenie szukało po JEDNEJ kolumnie
 * (`provider_intent_id`) - asymetria działająca jednokierunkowo na niekorzyść
 * klienta: zamówienie zapisane sesją było znajdowane przy odbieraniu dostępu
 * i niewidoczne przy jego przywracaniu (spór wygrany, klient bez dostępu).
 *
 * FILTR ŚRODOWISKA: ta sama reguła P0, którą nazywa `oneTimeFulfilment.server`
 * („realizujemy zamówienie WYŁĄCZNIE zdarzeniem z tego samego środowiska"),
 * tylko o wyższej stawce - zdarzenie z piaskownicy oznaczałoby REALNE
 * zamówienie jako zwrócone i odebrało dostęp. Kolumna weszła jako
 * `NOT NULL DEFAULT 'live'` (migracja
 * `20260731220000_payment_orders_environment_isolation`), więc zamówienia
 * historyczne zostają widoczne dla ruchu produkcyjnego.
 */
async function findOrderForAdjustment(
  event: RefundEvent,
  scope: "refund" | "dispute",
): Promise<AdjustmentOrder | null> {
  const txnId = event.transactionId;
  if (!txnId || !PROVIDER_REFERENCE_SHAPE.test(txnId)) return null;

  const supabase = await admin();
  const { data: matches, error } = await supabase
    .from("payment_orders")
    .select(ORDER_LOOKUP_COLUMNS)
    .or(
      `provider_payment_intent_id.eq.${txnId},provider_intent_id.eq.${txnId},provider_session_id.eq.${txnId}`,
    )
    .eq("environment", event.environment)
    .limit(1);
  if (error) throw new Error(`${scope}: order lookup failed: ${error.message}`);
  return matches?.[0] ?? null;
}

/**
 * Zamówienie sesji Checkout, która pobrała płatność - dla zwrotu, który
 * WYPRZEDZIŁ realizację. Do tej chwili zamówienie zna wyłącznie identyfikator
 * sesji (zapisany przy jej tworzeniu), a nie intencję płatności niesioną przez
 * zwrot. Dopasowanie po sesji albo po `metadata.orderId` sesji, zawsze
 * w środowisku korekty - ta sama reguła P0 co w `findOrderForAdjustment`.
 */
async function findOrderForCheckoutSession(
  event: RefundEvent,
  scope: "refund" | "dispute",
  session: { sessionId: string; orderId: string | null },
): Promise<AdjustmentOrder | null> {
  if (!PROVIDER_REFERENCE_SHAPE.test(session.sessionId)) return null;
  const filters = [`provider_session_id.eq.${session.sessionId}`];
  if (session.orderId && ORDER_ID_SHAPE.test(session.orderId)) {
    filters.push(`id.eq.${session.orderId}`);
  }

  const supabase = await admin();
  const { data: matches, error } = await supabase
    .from("payment_orders")
    .select(ORDER_LOOKUP_COLUMNS)
    .or(filters.join(","))
    .eq("environment", event.environment)
    .limit(1);
  if (error) throw new Error(`${scope}: order lookup failed: ${error.message}`);
  return matches?.[0] ?? null;
}

/**
 * Rozstrzyga, w co trafia korekta: (1) nasze zamówienie po identyfikatorach
 * operatora, (2) subskrypcja, której fakturę opłaciła płatność (albo
 * darowizna cykliczna - po `metadata.purpose` subskrypcji), (3) zamówienie
 * sesji Checkout, która płatność pobrała (zwrot przed realizacją), (4)
 * darowizna - po intencji, sesji i `metadata.donationId` sesji.
 *
 * Kroki 2-3 pytają operatora wyłącznie o płatność (`pi_`/`ch_`) i wyłącznie
 * wtedy, gdy własna baza nie zna transakcji. Awaria operatora RZUCA: zwrot
 * zgubiony „po cichu" zostawiałby dostęp klientowi, który odzyskał pieniądze.
 */
async function resolveAdjustmentTarget(
  event: RefundEvent,
  scope: "refund" | "dispute",
): Promise<AdjustmentTarget> {
  if (event.subscriptionId) {
    return { kind: "subscription", subscriptionId: event.subscriptionId, invoice: null };
  }

  const txnId = event.transactionId;
  if (!txnId || !PROVIDER_REFERENCE_SHAPE.test(txnId)) return { kind: "unmatched" };

  const order = await findOrderForAdjustment(event, scope);
  if (order) return { kind: "order", order, persistIntent: null };
  const legacyDonation: DonationRefs = {
    paymentRef: txnId,
    sessionId: null,
    invoiceId: null,
    donationId: null,
  };
  if (!isPaymentRef(txnId)) return { kind: "donation", refs: legacyDonation };

  const { resolvePaymentInvoice, findCheckoutSessionForPayment } =
    await import("@/lib/billing/transactions.server");
  const invoice = await resolvePaymentInvoice(event.environment, txnId);
  if (invoice?.subscriptionId) {
    // Darowizna cykliczna: subskrypcja bez uprawnienia, wpłata zapisana
    // z fakturą w `provider_intent_id` (pierwsza i każde odnowienie).
    if (invoice.purpose === "donation") {
      return { kind: "donation", refs: { ...legacyDonation, invoiceId: invoice.invoiceId } };
    }
    return {
      kind: "subscription",
      subscriptionId: invoice.subscriptionId,
      invoice: {
        invoiceId: invoice.invoiceId,
        periodEnd: invoice.periodEnd,
        billingReason: invoice.billingReason,
        orderId: invoice.orderId,
      },
    };
  }

  const session = await findCheckoutSessionForPayment(event.environment, txnId);
  const sessionOrder = session ? await findOrderForCheckoutSession(event, scope, session) : null;
  if (sessionOrder) {
    return {
      kind: "order",
      order: sessionOrder,
      persistIntent:
        txnId.startsWith("pi_") && !sessionOrder.provider_payment_intent_id ? txnId : null,
    };
  }
  return {
    kind: "donation",
    refs: {
      ...legacyDonation,
      sessionId: session?.sessionId ?? null,
      // `donationId` sesji jednorazowej wskazuje DOKŁADNIE tę wpłatę. Przy
      // darowiźnie cyklicznej to kotwica PIERWSZEJ wpłaty - dlatego wyżej
      // (ścieżka faktury) go nie przekazujemy.
      donationId: session?.purpose === "donation" ? session.donationId : null,
    },
  };
}

/**
 * Klucze `user_subscriptions`, pod którymi zamówienie mogło nadać plan.
 *
 * Uprawnienie planu bywa kluczowane różnie: finalizacja trybu mock nadaje je
 * pod identyfikatorem zamówienia, realizacja z webhooka - pod identyfikatorem
 * sesji Checkout, a przywrócenie po wygranym sporze - pod identyfikatorem
 * transakcji. `revokeOrderEntitlement` zna wyłącznie klucz zamówienia, więc
 * zwrot planu kupionego przez Stripe zostawiał aktywny wiersz pod kluczem
 * sesji. Identyfikatory operatora są unikalne, więc dodatkowe klucze nie
 * trafią w cudze uprawnienie. Pusta lista = zamówienie nie nadaje planu.
 */
async function planEntitlementRefs(
  order: AdjustmentOrder,
  extraRefs: ReadonlyArray<string | null | undefined> = [],
): Promise<string[]> {
  const { entitlementForOrder } = await import("@/lib/billing/entitlement");
  const entitlement = entitlementForOrder({
    kind: order.kind,
    plan_id: order.plan_id,
    entity_type: order.entity_type,
    entity_id: order.entity_id,
  });
  if (entitlement.type !== "subscription") return [];
  return [
    ...new Set(
      [
        order.id,
        order.provider_session_id,
        order.provider_intent_id,
        order.provider_payment_intent_id,
        ...extraRefs,
      ].filter((ref): ref is string => typeof ref === "string" && ref !== ""),
    ),
  ];
}

/**
 * Odbiera dostęp nadany przez zamówienie OSTATECZNIE (zwrot, spór przegrany)
 * - pod KAŻDYM kluczem, pod którym mógł zostać nadany (`planEntitlementRefs`).
 */
export async function revokeOrderAccess(
  order: AdjustmentOrder,
  revokedAt: string,
  extraRefs: ReadonlyArray<string | null | undefined> = [],
): Promise<void> {
  const { revokeOrderEntitlement, revokeSubscriptionEntitlement } =
    await import("@/lib/billing/grant.server");
  await revokeOrderEntitlement(order, revokedAt);
  for (const ref of await planEntitlementRefs(order, extraRefs)) {
    if (ref !== order.id) await revokeSubscriptionEntitlement(ref, revokedAt);
  }
}

/**
 * Zawieszenie uprawnień planu ZAMÓWIENIA na czas otwartego sporu: dostęp
 * znika od razu (`canceled`, okres kończy się teraz), ale - inaczej niż
 * `refunded` - wraca, gdy spór zostanie wygrany (zwykły `grantEntitlement` traktuje
 * `refunded` jako ostateczny). Klucze zamówienia (`cs_`, identyfikator
 * zamówienia) nie są kluczami subskrypcji, więc żadne `subscription.*` ich
 * nie odświeża. Dotyka wyłącznie wierszy aktywnych: zwrot ani rezygnacja nie
 * są tu nadpisywane.
 */
async function suspendPlanEntitlements(
  externalRefs: ReadonlyArray<string>,
  suspendedAt: string,
): Promise<boolean> {
  if (externalRefs.length === 0) return false;
  const supabase = await admin();
  const { data, error } = await supabase
    .from("user_subscriptions")
    .update({ status: "canceled", current_period_end: suspendedAt, canceled_at: suspendedAt })
    .in("external_ref", [...externalRefs])
    .eq("status", "active")
    .select("id");
  if (error) {
    throw new Error(
      `dispute: user_subscriptions suspend failed (${externalRefs.join(",")}): ${error.message}`,
    );
  }
  return (data?.length ?? 0) > 0;
}

/**
 * Spór otwarty na ZAMÓWIENIU: plan zawieszony (wraca po wygranej), zakup
 * pojedynczej treści odebrany jak przy zwrocie - `user_purchases` przywraca
 * `grantEntitlement` zwykłym upsertem.
 */
async function suspendOrderAccess(order: AdjustmentOrder, suspendedAt: string): Promise<void> {
  const refs = await planEntitlementRefs(order);
  if (refs.length > 0) {
    await suspendPlanEntitlements(refs, suspendedAt);
    return;
  }
  const { revokeOrderEntitlement } = await import("@/lib/billing/grant.server");
  await revokeOrderEntitlement(order, suspendedAt);
}

// --- kwoty -------------------------------------------------------------------

/** Rozliczenie korekty w PODSTAWIE ZAMÓWIENIA (jego waluta i kwota). */
interface OrderRefundAmounts {
  /** Zapisany licznik zwrotów zamówienia. */
  stored: number;
  /** Ile łącznie wróciło do kupującego - to trafia do `refunded_amount_cents`. */
  refundedSoFar: number;
  /** Kwota, względem której zwrot jest „pełny" (kwota zamówienia). */
  basis: number | null;
  /** Licznik po korekcie przekroczył kwotę zamówienia i został zaciśnięty. */
  clamped: boolean;
  reported: number;
  /** Zwrot częściowy: korekta ceny, dostęp zostaje. */
  isPartial: boolean;
}

/**
 * Kwoty korekty przeliczone na podstawę zamówienia.
 *
 * DLACZEGO PRZELICZENIE. Operator podaje kwoty w walucie i podstawie
 * OBCIĄŻENIA (`amount`, `amount_refunded`), a `refunded_amount_cents` jest
 * porównywane z `payment_orders.amount_cents` - przez raporty („przychód netto
 * = amount_cents - refunded_amount_cents") i przez bazę
 * (`payments_apply_event_ticket_outcome` uznaje zwrot za pełny, gdy licznik
 * >= kwota zamówienia). Gdy obie podstawy się różnią (przewalutowanie
 * Adaptive Pricing, podatek doliczony na wierzch w zamówieniach sprzed S5),
 * zwrot zapisany wprost dawał przychód UJEMNY, a TS i baza rozstrzygały
 * „częściowy czy pełny" różnie: TS zostawiał dostęp, baza odwoływała
 * zgłoszenie i oddawała miejsce. Przeliczamy więc proporcją
 * `amount_cents / captured` - zwrot pełny daje dokładnie kwotę zamówienia,
 * częściowy - jej proporcjonalną część, i obie strony widzą to samo.
 *
 * SPÓR DOKŁADA, ZWROT NADPISUJE. `amount_refunded` zwrotu jest narastające
 * (maksimum z zapisanym licznikiem nie liczy niczego podwójnie), a kwota sporu
 * to środki wycofane przez bank PONAD wcześniejsze zwroty - stąd suma.
 * Ponowienie sporu ani przegrana po otwarciu nie doliczają drugi raz:
 * zamówienie jest już zamknięte, a licznik zaciśnięty do kwoty zamówienia.
 */
function orderRefundAmounts(event: RefundEvent, order: AdjustmentOrder): OrderRefundAmounts {
  const stored = order.refunded_amount_cents ?? 0;
  const orderAmount =
    typeof order.amount_cents === "number" && order.amount_cents > 0 ? order.amount_cents : null;
  // Kwota pobrana: z korekty, a bez niej - kwota zamówienia. Jawne zero od
  // operatora znaczy „nie wiem" i NIE pozwala uznać zwrotu za częściowy.
  const captured = event.capturedAmountCents ?? order.amount_cents ?? null;
  const knownCaptured = typeof captured === "number" && captured > 0;
  const chargeCaptured =
    typeof event.capturedAmountCents === "number" && event.capturedAmountCents > 0
      ? event.capturedAmountCents
      : null;
  const toOrder = (cents: number): number =>
    chargeCaptured !== null && orderAmount !== null && chargeCaptured !== orderAmount
      ? Math.round((cents * orderAmount) / chargeCaptured)
      : cents;

  const eventCents = toOrder(Math.max(0, event.amountCents ?? 0));
  // Spór na zamówieniu już zamkniętym (przegrana po otwarciu) nie wycofuje
  // niczego ponad to, co zapisało otwarcie.
  const incoming =
    isDispute(event) && order.status !== "refunded" ? stored + eventCents : eventCents;
  // Operator liczy narastająco, więc bierzemy maksimum z zapisanym stanem -
  // ponowione zdarzenie nie może cofnąć licznika.
  const reported = Math.max(stored, incoming);
  const basis = orderAmount ?? (knownCaptured ? (captured as number) : null);
  const clamped = basis !== null && reported > basis;
  const refundedSoFar = clamped ? (basis as number) : reported;
  return {
    stored,
    refundedSoFar,
    basis,
    clamped,
    reported,
    isPartial:
      event.action === "refund" &&
      knownCaptured &&
      basis !== null &&
      refundedSoFar > 0 &&
      refundedSoFar < basis,
  };
}

/** Licznik zwrotów obciążenia u operatora w podstawie zamówienia (z zaciskiem). */
function orderCentsFromCharge(
  order: Pick<AdjustmentOrder, "amount_cents">,
  state: PaymentRefundState,
): number {
  const orderAmount =
    typeof order.amount_cents === "number" && order.amount_cents > 0 ? order.amount_cents : null;
  if (orderAmount === null) return state.refundedCents;
  const scaled =
    state.amountCents > 0 && state.amountCents !== orderAmount
      ? Math.round((state.refundedCents * orderAmount) / state.amountCents)
      : state.refundedCents;
  return Math.min(orderAmount, Math.max(0, scaled));
}

/** Koniec okresu usługi faktury już minął - korekta nie zmienia dostępu (S1). */
function invoicePeriodEnded(invoice: InvoiceContext | null): boolean {
  if (!invoice?.periodEnd) return false;
  const end = Date.parse(invoice.periodEnd);
  return Number.isFinite(end) && end <= Date.now();
}

// --- skutki: zamówienie ------------------------------------------------------

/**
 * Odbiera uprawnienie zakupu jednorazowego (odblokowanie treści, bilet) -
 * zwrotem albo sporem (otwartym, przegranym, zatrzymanym zwrotem).
 *
 * `persistIntent`: zamówienie znalezione przez sesję Checkout (zwrot przed
 * realizacją) dostaje intencję płatności razem ze stanem zwrotu - kolejne
 * zdarzenia trafią w nie już bez pytania operatora, a późniejsza realizacja
 * zobaczy `refunded` i odmówi (`oneTimeFulfilment.fulfilOrder`).
 */
async function revokeOrder(
  event: RefundEvent,
  order: AdjustmentOrder,
  persistIntent: string | null,
): Promise<RefundOutcome> {
  const supabase = await admin();
  const txnId = event.transactionId ?? order.id;
  const nowIso = new Date().toISOString();
  const amounts = orderRefundAmounts(event, order);
  const { refundedSoFar, isPartial } = amounts;

  // ZACISK DO KWOTY ZAMÓWIENIA. `refunded_amount_cents` jest podstawą rachunku
  // „przychód netto = amount_cents - refunded_amount_cents", więc wartość
  // większa od kwoty zamówienia daje przychód UJEMNY i psuje każde zestawienie,
  // w którym ta kolumna występuje.
  //
  // WYBÓR KSIĘGOWY: ZACISKAMY, NIE ODRZUCAMY ZDARZENIA. Odrzucenie
  // (wyjątek -> ponowienie u operatora) wstrzymałoby ODEBRANIE DOSTĘPU przy
  // korekcie, która u operatora już się wydarzyła: pieniądze są u klienta,
  // a treść zostawałaby otwarta do czasu ręcznej interwencji - i to w pętli,
  // bo kolejne dostarczenia niosłyby tę samą kwotę. Rozjazd kwot nie jest
  // hipotetyczny (zmiana ceny, kupon dopisany po utworzeniu zamówienia, inna
  // waluta zdarzenia), więc gasi się go zapisem spójnym z księgami PLUS
  // ostrzeżeniem - bo jedyne, czego tu naprawdę brakowało, to ŚLAD.
  if (amounts.clamped && !isDispute(event)) {
    console.warn(
      "[payments] refund exceeds captured amount - clamped",
      event.adjustmentId,
      order.id,
      { reported: amounts.reported, captured: amounts.basis },
    );
  }

  const { data: flipped, error: updateErr } = await supabase
    .from("payment_orders")
    .update({
      ...(isPartial ? {} : { status: "refunded" }),
      refunded_amount_cents: refundedSoFar,
      ...(persistIntent ? { provider_payment_intent_id: persistIntent } : {}),
      updated_at: nowIso,
    })
    .eq("id", order.id)
    .neq("status", "refunded")
    .select("id");
  if (updateErr) throw new Error(`refund: order status flip failed: ${updateErr.message}`);

  // BRAMKA POWTÓRZONEGO ZWROTU. Ten sam wzorzec co w `refundDonation`
  // i `revokeSubscriptionEntitlement`: po zapisie czytamy `.select("id")`, czyli
  // wiersze, które NAPRAWDĘ się zmieniły. Bez tego ponowione dostarczenie
  // webhooka przechodziło całą ścieżkę skutków (odebranie uprawnienia,
  // anulowanie zgłoszenia, kolejny dzwonek „Zwrot płatności") i oddawało
  // `order_refunded`, choć baza nie zmieniła ani jednego wiersza.
  //
  // Dowody muszą być DWA, bo każdy z osobna bywa mylący: pusty wynik zapisu
  // zdarza się też wtedy, gdy o ten wiersz konkurowało równoległe dostarczenie
  // (wtedy wolimy przebiec skutki drugi raz - wszystkie są idempotentne), a sam
  // odczyt mógł się zestarzeć. Powtórką nazywamy więc sytuację, w której zapis
  // nie objął żadnego wiersza I wiersz wejściowy jest już zamknięty zwrotem,
  // I to zdarzenie nie podnosi licznika zwrotów. Ta sama bramka zatrzymuje
  // zwrot po samoczynnym zwrocie nadsprzedanego biletu (S3): zamówienie jest
  // już `refunded` z pełną kwotą, więc bez drugiego maila i dzwonka.
  const changedRow = (flipped ?? []).length > 0;
  const settledBefore =
    order.status === "refunded" || (amounts.basis !== null && amounts.stored >= amounts.basis);
  // Porównanie z kwotą, KTÓRĄ WŁAŚNIE ZAPISUJEMY (po zacisku), a nie z surową
  // kwotą zdarzenia: powtórka z zawyżoną kwotą też nie podnosi licznika.
  const bringsNoMoney = amounts.stored >= refundedSoFar;
  if (!changedRow && settledBefore && bringsNoMoney) {
    // Spór PRZEGRANY po sporze otwartym: zamówienie zamknięto już przy
    // otwarciu, a plan był tylko zawieszony - teraz odbieramy go ostatecznie.
    // Bez skutków miękkich: spór nie wysyła klientowi niczego.
    //
    // Zwrot na zamówieniu zamkniętym wcześniej (powtórka, zwrot nadsprzedanego
    // biletu - S3, zwrot w trakcie zapytania banku) nie robi NIC: plan
    // zawieszony przez spór domyka przywrócenie, które widzi zwrot
    // u operatora (`restoreOrder`).
    if (event.action === "chargeback") await revokeOrderAccess(order, nowIso);
    return "skipped";
  }

  const metadata = (order.metadata ?? {}) as Record<string, unknown>;
  const eventId = typeof metadata.event_id === "string" ? metadata.event_id : null;
  const { applyTicketOutcome } = await import("@/lib/billing/oneTimeFulfilment.server");

  if (isPartial) {
    // Korekta ceny, nie rezygnacja: uprawnienie i miejsce zostają, zmienia się
    // tylko rozliczenie - baza przeliczy status i wyśle powiadomienie.
    if (eventId) await applyTicketOutcome(order.id, "partial_refund", refundedSoFar);
    return "order_refunded";
  }

  // Spór OTWARTY zawiesza (dostęp wraca po wygranej), zwrot i spór przegrany
  // odbierają ostatecznie.
  if (event.action === "chargeback_warning") await suspendOrderAccess(order, nowIso);
  else await revokeOrderAccess(order, nowIso);

  // Bilet na wydarzenie: zwrot cofa potwierdzony udział. Wartość `cancelled`
  // (D0-1): CHECK `event_rsvps.status` zna wyłącznie tę pisownię - dawne
  // `canceled` łamało ograniczenie i zwrot wywracał się na tej linii.
  // Tylko zamówienie BEZ `registration_id` (starsza ścieżka RSVP) anulujemy
  // tutaj. Zamówienie związane ze zgłoszeniem zwalnia RSVP w bazie, i to
  // dopiero gdy zwrot faktycznie odwoła zgłoszenie: zwrot nadliczbowej wpłaty
  // (`refund_for_other_order`) zostawia ważny bilet, a więc i jego RSVP.
  const boundToRegistration =
    typeof metadata.registration_id === "string" && metadata.registration_id.length > 0;
  if (eventId && order.user_id && !boundToRegistration) {
    const { error: rsvpErr } = await supabase
      .from("event_rsvps")
      .update({ status: "cancelled", updated_at: nowIso })
      .eq("event_id", eventId)
      .eq("user_id", order.user_id);
    if (rsvpErr) throw new Error(`refund: rsvp cancel failed: ${rsvpErr.message}`);
  }
  if (eventId) {
    // Zwolnione miejsce wraca do puli, a pierwsza osoba z listy rezerwowej
    // wchodzi na jej miejsce - w tej samej operacji co anulowanie zgłoszenia.
    await applyTicketOutcome(order.id, "refunded", refundedSoFar);
  }

  // Mail „Płatność została zwrócona" i dzwonek WYŁĄCZNIE dla zwrotu. Spór to
  // nie zwrot: potwierdzenie zwrotu wysłane przy otwarciu sporu (także przy
  // zapytaniu banku, gdy żadne środki nie ruszyły) klient mógł przekazać
  // bankowi jako dowód przeciwko nam, a po wygranej obiecywało pieniądze,
  // które nigdy nie przyszły.
  if (order.user_id && !isDispute(event)) {
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
    await pushRefundNotification(order.user_id, order.tenant_id);
  }

  return "order_refunded";
}

/** Wynik skutku sporu albo nieudanego zwrotu: wynik dla dziennika + zdanie do alertu. */
interface CorrectionResult {
  outcome: RefundOutcome;
  note: AccessNote;
}

/** Płatność zamówienia, o którą można zapytać operatora. */
function orderPaymentRef(event: RefundEvent, order: AdjustmentOrder): string | null {
  if (isPaymentRef(event.transactionId)) return event.transactionId;
  return isPaymentRef(order.provider_payment_intent_id) ? order.provider_payment_intent_id : null;
}

/**
 * Przywrócenie zamówienia po sporze rozstrzygniętym bez utraty środków
 * (`won`, `warning_closed`).
 *
 * O PRZYWRÓCENIU DECYDUJE OBCIĄŻENIE U OPERATORA, NIE NASZE KSIĘGI. Zamówienie
 * zamknięte sporem wygląda tak samo jak zamknięte zwrotem (`refunded`), więc
 * przywracanie „na ślepo" wskrzeszało zwrócone zamówienia: zwrot, a potem spór
 * wygrany dowodem zwrotu; zapytanie banku rozwiązane pełnym zwrotem (Stripe
 * zamyka je wtedy jako `warning_closed`); ponowiona wygrana po późniejszym
 * zwrocie. Klient miał wtedy i pieniądze, i dostęp, a księgi mówiły `paid`.
 *
 *   * obciążenie zwrócone w całości -> dostęp NIE wraca: plan odbieramy
 *     ostatecznie, a licznik zwrotów odpowiada operatorowi;
 *   * inaczej -> `paid` z licznikiem = PRAWDZIWE zwroty (`amount_refunded`).
 *     Kwota sporu zapisana przy otwarciu znika z księgi - bez tego wygrany
 *     spór liczył się jako przychód zero, a kolejny drobny zwrot (maksimum
 *     z pełną kwotą) odbierał cały dostęp.
 *
 * Stanu nie da się potwierdzić (płatność nieznana operatorowi) -> nic nie
 * przywracamy, a alert prosi o ręczną weryfikację.
 */
async function restoreOrder(event: RefundEvent, order: AdjustmentOrder): Promise<CorrectionResult> {
  const supabase = await admin();
  const nowIso = new Date().toISOString();

  // Spór przed realizacją (zamówienie w toku, anulowane) nie ma czego
  // przywracać - opłacenie należy do realizacji, nie do sporu.
  if (order.status !== "refunded" && order.status !== "paid") {
    console.warn("[payments] dispute won on an unsettled order - nothing to restore", {
      adjustmentId: event.adjustmentId,
      orderId: order.id,
      status: order.status,
    });
    return { outcome: "skipped", note: "none" };
  }

  const paymentRef = orderPaymentRef(event, order);
  const { retrievePaymentRefundState } = await import("@/lib/billing/transactions.server");
  const state = paymentRef ? await retrievePaymentRefundState(event.environment, paymentRef) : null;
  if (!state) {
    console.error("[payments] dispute won but the payment state is unknown - restore skipped", {
      adjustmentId: event.adjustmentId,
      orderId: order.id,
    });
    return { outcome: "skipped", note: "unverified" };
  }
  const refundedCents = orderCentsFromCharge(order, state);

  if (state.fullyRefunded) {
    // Zamówienie zamknięte sporem zostaje zamknięte - teraz już zwrotem.
    // Zamówienia `paid` nie ruszamy: zwrot dojdzie własnym zdarzeniem
    // (`charge.refunded`) razem z biletem, mailem i dzwonkiem.
    if (order.status === "refunded") {
      const { error } = await supabase
        .from("payment_orders")
        .update({ refunded_amount_cents: refundedCents, updated_at: nowIso })
        .eq("id", order.id)
        .eq("status", "refunded");
      if (error) throw new Error(`dispute: order refund sync failed: ${error.message}`);
      await revokeOrderAccess(order, nowIso);
    }
    return { outcome: "skipped", note: "refunded_kept" };
  }

  if (order.status === "refunded") {
    const { error: flipErr } = await supabase
      .from("payment_orders")
      .update({ status: "paid", refunded_amount_cents: refundedCents, updated_at: nowIso })
      .eq("id", order.id)
      .eq("status", "refunded");
    if (flipErr) throw new Error(`dispute: order status flip failed: ${flipErr.message}`);
  }

  // Ten sam klucz, pod którym nadała je realizacja (identyfikator transakcji
  // zapisany jako `provider_intent_id`) - odświeżenie wiersza zamiast
  // drugiego wiersza pod kluczem intencji płatności.
  //
  // `reviveRefunded`: operator potwierdził, że obciążenie NIE zostało zwrócone
  // w całości, więc plan odebrany jako `refunded` zabrał spór, nie zwrot -
  // np. realizacja, która ścigała się z otwarciem sporu, odbiera nadany plan
  // ostatecznie (`oneTimeFulfilment`), a wygrana musi go oddać.
  const { grantEntitlement } = await import("@/lib/billing/grant.server");
  await grantEntitlement(order, order.provider_intent_id ?? event.transactionId, {
    reviveRefunded: true,
  });

  const metadata = (order.metadata ?? {}) as Record<string, unknown>;
  const eventId = typeof metadata.event_id === "string" ? metadata.event_id : null;
  // TA SAMA REGUŁA CO PRZY ODBIERANIU (`revokeOrder`): RSVP dotykamy wyłącznie
  // na starszej ścieżce, BEZ `registration_id`. Zamówienie związane ze
  // zgłoszeniem oddało miejsce przez `payments_apply_event_ticket_outcome`
  // (pula, lista rezerwowa), więc bezwarunkowe `going` dawało link wejścia
  // osobie, której zgłoszenie jest odwołane, a miejsce mogło już przejść na
  // kogoś z kolejki. Decyzja o takim zgłoszeniu idzie do organizatora
  // (zdanie w alercie - `alertAdminsAboutDispute`).
  const boundToRegistration =
    typeof metadata.registration_id === "string" && metadata.registration_id.length > 0;
  if (eventId && order.user_id && !boundToRegistration) {
    const { error: rsvpErr } = await supabase
      .from("event_rsvps")
      .update({ status: "going", updated_at: nowIso })
      .eq("event_id", eventId)
      .eq("user_id", order.user_id);
    if (rsvpErr) throw new Error(`dispute: rsvp restore failed: ${rsvpErr.message}`);
  }
  return { outcome: "order_restored", note: "restored" };
}

/**
 * Nieudany zwrot ZAMÓWIENIA: licznik zwrotów wraca do stanu operatora, a gdy
 * pozostałe zwroty nie są już zwrotem pełnym - zamówienie wraca na `paid`
 * i dostęp wraca (także plan odebrany jako `refunded`: pieniądze są u nas).
 *
 * Bilet NIE wraca sam: zwrot odwołał zgłoszenie i oddał miejsce (być może
 * komuś z listy rezerwowej), więc decyzja należy do organizatora - alert.
 * Obciążenie objęte sporem zostawiamy ścieżce sporu.
 */
async function reopenOrderAfterFailedRefund(
  order: AdjustmentOrder,
  state: PaymentRefundState,
): Promise<CorrectionResult> {
  // Obciążenie objęte sporem: środki wycofane przez bank nie są zwrotem
  // (`amount_refunded` ich nie zna), więc przeliczenie licznika z operatora
  // wymazałoby z ksiąg spór przegrany. Decyduje ścieżka sporu.
  if (state.disputed) return { outcome: "skipped", note: "disputed" };

  const supabase = await admin();
  const nowIso = new Date().toISOString();
  const refundedCents = orderCentsFromCharge(order, state);
  const reopen = !state.fullyRefunded && order.status === "refunded";

  if (!reopen) {
    const { error } = await supabase
      .from("payment_orders")
      .update({ refunded_amount_cents: refundedCents, updated_at: nowIso })
      .eq("id", order.id);
    if (error) throw new Error(`refund failed: order refund sync failed: ${error.message}`);
    return { outcome: "skipped", note: state.fullyRefunded ? "refunded_kept" : "none" };
  }

  const { data: reopened, error: flipErr } = await supabase
    .from("payment_orders")
    .update({ status: "paid", refunded_amount_cents: refundedCents, updated_at: nowIso })
    .eq("id", order.id)
    .eq("status", "refunded")
    .select("id");
  if (flipErr) throw new Error(`refund failed: order status flip failed: ${flipErr.message}`);
  if ((reopened ?? []).length === 0) return { outcome: "skipped", note: "none" };

  const metadata = (order.metadata ?? {}) as Record<string, unknown>;
  if (typeof metadata.event_id === "string") {
    return { outcome: "order_restored", note: "ticket_review" };
  }
  const { grantEntitlement } = await import("@/lib/billing/grant.server");
  await grantEntitlement(order, order.provider_intent_id ?? order.id, { reviveRefunded: true });
  return { outcome: "order_restored", note: "restored" };
}

// --- skutki: subskrypcja -----------------------------------------------------

/** Wiersz `subscriptions` w środowisku korekty (użytkownik, najemca, cena). */
async function loadSubscriptionRow(
  event: RefundEvent,
  subscriptionId: string,
  scope: "refund" | "dispute",
) {
  const supabase = await admin();
  const { data, error } = await supabase
    .from("subscriptions")
    .select("user_id, tenant_id, price_id, status, current_period_end")
    .eq("provider_subscription_id", subscriptionId)
    .eq("environment", event.environment)
    .maybeSingle();
  if (error) throw new Error(`${scope}: subscription lookup failed: ${error.message}`);
  return data;
}

/** CRM: zwrot albo spór przegrany to utrata klienta, nie pauza. Nigdy nie rzuca. */
async function churnSubscriber(userId: string, priceId: string | null): Promise<void> {
  if (!priceId) return;
  const { catalogEntryByPriceId } = await import("@/lib/billing/catalog");
  const tierKey = catalogEntryByPriceId(priceId)?.tierKey ?? null;
  if (!tierKey) return;
  const { syncCrmSubscriptionState } = await import("@/lib/billing/purchaseEffects.server");
  await syncCrmSubscriptionState(userId, tierKey, "churned");
}

/**
 * Księgi zamówienia, które opłaciła korygowana faktura subskrypcji (5.3).
 *
 * Zamówienie subskrypcji domyka pierwsza opłacona faktura (`subscription_create`
 * albo - po okresie próbnym - faktura zapisana w `provider_intent_id`).
 * Korekta TEJ faktury dotyczy pieniędzy z tego zamówienia, więc bez tego
 * zapisu historia klienta i raporty pokazywały zwróconą płatność jako
 * opłaconą. Dostęp NIE zależy od zamówienia (daje go subskrypcja) - to wyłącznie
 * księgowanie. Zamówienie wskazuje `metadata.orderId` subskrypcji, a wiązanie
 * pilnuje NASZ wiersz: ta sama subskrypcja, rodzaj i środowisko.
 */
async function recordSubscriptionOrderCorrection(
  event: RefundEvent,
  target: SubscriptionTarget,
  correction: { kind: "adjustment" } | { kind: "refund_failed"; state: PaymentRefundState },
): Promise<void> {
  const invoice = target.invoice;
  if (!invoice?.orderId || !ORDER_ID_SHAPE.test(invoice.orderId)) return;
  const supabase = await admin();
  const { data: order, error } = await supabase
    .from("payment_orders")
    .select(ORDER_LOOKUP_COLUMNS)
    .eq("id", invoice.orderId)
    .eq("kind", "subscription")
    .eq("provider_subscription_id", target.subscriptionId)
    .eq("environment", event.environment)
    .maybeSingle();
  if (error) throw new Error(`refund: subscription order lookup failed: ${error.message}`);
  if (!order) return;
  const settledByInvoice =
    invoice.billingReason === "subscription_create" ||
    order.provider_intent_id === invoice.invoiceId;
  if (!settledByInvoice) return;

  let patch: { refunded_amount_cents: number; status?: "refunded" | "paid" };
  if (correction.kind === "refund_failed") {
    // Jak w `reopenOrderAfterFailedRefund`: licznik obciążenia objętego
    // sporem nie zna środków wycofanych przez bank.
    if (correction.state.disputed) return;
    const refunded = orderCentsFromCharge(order, correction.state);
    patch = {
      refunded_amount_cents: refunded,
      ...(correction.state.fullyRefunded
        ? {}
        : order.status === "refunded"
          ? { status: "paid" as const }
          : {}),
    };
  } else {
    const amounts = orderRefundAmounts(event, order);
    patch = {
      refunded_amount_cents: amounts.refundedSoFar,
      ...(amounts.isPartial ? {} : { status: "refunded" as const }),
    };
  }
  const { error: writeErr } = await supabase
    .from("payment_orders")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", order.id);
  if (writeErr) throw new Error(`refund: subscription order update failed: ${writeErr.message}`);
}

/**
 * Zwrot płatności faktury subskrypcji.
 *
 *   * zwrot CZĘŚCIOWY - korekta ceny, dostęp zostaje (jak w `revokeOrder`);
 *   * faktura za okres, który MINĄŁ - usługa skonsumowana, dostęp zostaje;
 *     zespół dostaje ślad, klient nie dostaje „dostęp zakończony";
 *   * pełny zwrot bieżącego okresu - `refunded` (S1), mail, dzwonek, CRM.
 *     Subskrypcja u operatora trwa - kolejne opłacone odnowienie przywróci
 *     dostęp (`syncEntitlementState`, nowy okres po korekcie).
 */
async function refundSubscription(
  event: RefundEvent,
  target: SubscriptionTarget,
): Promise<RefundOutcome> {
  const subscriptionId = target.subscriptionId;
  await recordSubscriptionOrderCorrection(event, target, { kind: "adjustment" });

  // Zwrot CZĘŚCIOWY faktury to korekta ceny, nie rezygnacja - ta sama reguła
  // co dla zamówień (`revokeOrder`): dostęp zostaje. Pełny zwrot (albo zwrot
  // bez znanej kwoty pierwotnej) odbiera dostęp, bo bezpieczniej odebrać niż
  // zostawić opłacone uprawnienie po oddaniu pieniędzy.
  const captured = event.capturedAmountCents ?? null;
  const refunded = event.amountCents ?? 0;
  if (typeof captured === "number" && captured > 0 && refunded > 0 && refunded < captured) {
    console.warn("[payments] partial refund of a subscription payment - access kept", {
      adjustmentId: event.adjustmentId,
      subscriptionId,
      refunded,
      captured,
    });
    return "skipped";
  }

  if (invoicePeriodEnded(target.invoice)) {
    await alertAdminsAboutRefund(event, target, await adjustmentTenant(event, target), {
      phase: "past_period",
      note: "past_period",
    });
    return "skipped";
  }

  const sub = await loadSubscriptionRow(event, subscriptionId, "refund");
  const nowIso = new Date().toISOString();
  const { revokeSubscriptionEntitlement } = await import("@/lib/billing/grant.server");
  const revoked = await revokeSubscriptionEntitlement(subscriptionId, nowIso);

  // Nic się nie zmieniło (uprawnienie odebrane już wcześniej - ponowiona
  // dostawa zwrotu albo zwrot w trakcie sporu): skutki miękkie poszły przy
  // pierwszym odebraniu albo nie należą się wcale.
  if (!revoked) return "skipped";
  if (!sub?.user_id) return "subscription_refunded";

  await churnSubscriber(sub.user_id, sub.price_id);
  const { resolvePlanForPrice } = await import("@/lib/billing/purchaseEffects.server");
  const plan = sub.price_id
    ? await resolvePlanForPrice(sub.price_id, { tenantId: sub.tenant_id, userId: sub.user_id })
    : null;

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

  await pushRefundNotification(sub.user_id, sub.tenant_id);

  return "subscription_refunded";
}

/**
 * Spór otwarty / przegrany / zatrzymany zwrotem na płatności faktury
 * subskrypcji.
 *
 * DLACZEGO `refunded`, A NIE ZAWIESZENIE `canceled`. Zawieszenie było
 * cofane przez KAŻDE kolejne `subscription.updated`: zmianę
 * `cancel_at_period_end` w portalu, synchronizację na żądanie klienta,
 * odnowienie - klient sam przywracał sobie dostęp w trakcie sporu.
 * `refunded` z `canceled_at` = teraz trzyma przez cały okres, a wraca
 * wyłącznie z nowym opłaconym okresem albo po wygranej (`force`).
 *
 * Spór przegrany po otwartym nie zmienia już wiersza - i nic nie wysyła:
 * spór nie dostaje maila ani dzwonka klienta w żadnej fazie.
 */
async function disputeSubscription(
  event: RefundEvent,
  target: SubscriptionTarget,
  phase: Exclude<DisputePhase, "won">,
): Promise<CorrectionResult> {
  const final = phase !== "open";
  if (final) await recordSubscriptionOrderCorrection(event, target, { kind: "adjustment" });
  if (invoicePeriodEnded(target.invoice)) return { outcome: "skipped", note: "past_period" };

  const { revokeSubscriptionEntitlement } = await import("@/lib/billing/grant.server");
  const revoked = await revokeSubscriptionEntitlement(
    target.subscriptionId,
    new Date().toISOString(),
  );
  if (final) {
    // CRM to skutek miękki - awaria odczytu nie może zatrzymać sporu.
    try {
      const sub = await loadSubscriptionRow(event, target.subscriptionId, "dispute");
      if (sub?.user_id) await churnSubscriber(sub.user_id, sub.price_id);
    } catch (err) {
      console.error("[payments] dispute CRM churn failed", event.adjustmentId, err);
    }
  }
  return {
    outcome: revoked ? "subscription_refunded" : "skipped",
    note: final ? "revoked" : "suspended",
  };
}

/**
 * Przywraca uprawnienie subskrypcji ze stanu U OPERATORA, z `force` - jedyną
 * drogą, która nadpisuje korektę bieżącego okresu (`refunded`). Wiersz
 * `subscriptions` daje wyłącznie użytkownika i najemcę: jego status mógł się
 * zestarzeć (anulowanie w trakcie sporu), a nadpisanie korekty stanem
 * nieaktualnym dałoby dostęp, którego operator już nie prowadzi.
 */
async function reviveSubscription(
  event: RefundEvent,
  subscriptionId: string,
  scope: "refund" | "dispute",
): Promise<CorrectionResult> {
  const sub = await loadSubscriptionRow(event, subscriptionId, scope);
  if (!sub?.user_id) return { outcome: "skipped", note: "none" };

  const { retrieveSubscriptionState } = await import("@/lib/billing/transactions.server");
  const remote = await retrieveSubscriptionState(event.environment, subscriptionId);
  if (!remote) {
    console.error("[payments] subscription unknown to the provider - restore skipped", {
      adjustmentId: event.adjustmentId,
      subscriptionId,
    });
    return { outcome: "skipped", note: "unverified" };
  }
  const { mapStripeSubscription } = await import("@/lib/billing/stripeEvents.server");
  const current = mapStripeSubscription(remote);
  const priceId = current.items[0]?.price.externalId ?? sub.price_id;
  if (!priceId) return { outcome: "skipped", note: "none" };

  const { resolvePlanForPrice } = await import("@/lib/billing/purchaseEffects.server");
  const plan = await resolvePlanForPrice(priceId, { tenantId: sub.tenant_id, userId: sub.user_id });
  // Cena spoza katalogu: nie ma czego nadać - wynik mówi to wprost, zamiast
  // udawać przywrócenie.
  if (!plan) return { outcome: "skipped", note: "none" };

  const { syncEntitlementState } = await import("@/lib/billing/entitlementSync.server");
  await syncEntitlementState({
    userId: sub.user_id,
    tenantId: plan.tenantId,
    planId: plan.planId,
    externalRef: subscriptionId,
    status: current.status || sub.status || "active",
    periodEnd: current.currentBillingPeriod?.endsAt ?? sub.current_period_end ?? null,
    periodStart: current.currentBillingPeriod?.startsAt ?? null,
    force: true,
  });
  return { outcome: "subscription_restored", note: "restored" };
}

/**
 * Spór na fakturze subskrypcji rozstrzygnięty bez utraty środków. Dostęp
 * wraca tylko wtedy, gdy korekta w ogóle go zabrała (bieżący okres) i gdy
 * obciążenie NIE zostało w międzyczasie zwrócone (zapytanie banku
 * rozwiązane zwrotem) - pełny zwrot bieżącego okresu ma `refunded` na stałe.
 */
async function restoreSubscription(
  event: RefundEvent,
  target: SubscriptionTarget,
): Promise<CorrectionResult> {
  if (invoicePeriodEnded(target.invoice)) return { outcome: "skipped", note: "past_period" };
  if (isPaymentRef(event.transactionId)) {
    const { retrievePaymentRefundState } = await import("@/lib/billing/transactions.server");
    const state = await retrievePaymentRefundState(event.environment, event.transactionId);
    if (state?.fullyRefunded) return { outcome: "skipped", note: "refunded_kept" };
  }
  return reviveSubscription(event, target.subscriptionId, "dispute");
}

// --- skutki: darowizna -------------------------------------------------------

/**
 * Filtr `or(...)` wiersza darowizny - każdy składnik przeszedł bramkę kształtu
 * (tekst wchodzi do PostgREST). `null` = nie ma po czym szukać.
 */
function donationFilter(refs: DonationRefs): string | null {
  const parts = new Set<string>();
  const add = (column: string, value: string | null) => {
    if (value && PROVIDER_REFERENCE_SHAPE.test(value)) parts.add(`${column}.eq.${value}`);
  };
  add("provider_intent_id", refs.paymentRef);
  add("provider_intent_id", refs.invoiceId);
  add("provider_intent_id", refs.sessionId);
  add("provider_session_id", refs.sessionId);
  if (refs.donationId && ORDER_ID_SHAPE.test(refs.donationId)) {
    parts.add(`id.eq.${refs.donationId}`);
  }
  return parts.size > 0 ? [...parts].join(",") : null;
}

/**
 * Zwrot darowizny - bez uprawnień, ale status musi się zgadzać z księgami.
 *
 * Wpłata jest `refunded` wyłącznie wtedy, gdy pieniądze naprawdę wróciły:
 * pełny zwrot albo spór przegrany / zatrzymany zwrotem. Zwrot częściowy
 * zostawia mniejszą, ale wciąż darowiznę; spór otwarty niczego nie przesądza
 * (po wygranej wpłata dawniej zostawała `refunded`).
 *
 * FILTR ŚRODOWISKA jak w rodzeństwie (`revokeOrder`, `refundSubscription`):
 * zdarzenie z piaskownicy nie może zamknąć wpłaty produkcyjnej o tym samym
 * identyfikatorze (migracja `20260831140000_donations_environment_isolation`).
 */
async function refundDonation(event: RefundEvent, refs: DonationRefs): Promise<RefundOutcome> {
  const captured = event.capturedAmountCents ?? null;
  const refunded = event.amountCents ?? 0;
  if (
    event.action === "refund" &&
    typeof captured === "number" &&
    captured > 0 &&
    refunded > 0 &&
    refunded < captured
  ) {
    console.warn("[payments] partial refund of a donation - kept as paid", event.adjustmentId);
    return "skipped";
  }
  const filter = donationFilter(refs);
  if (!filter) return "skipped";
  const supabase = await admin();
  const { data, error } = await supabase
    .from("donations")
    .update({ status: "refunded" })
    .or(filter)
    .eq("environment", event.environment)
    .neq("status", "refunded")
    .select("id");
  if (error) throw new Error(`refund: donation status flip failed: ${error.message}`);
  return data && data.length > 0 ? "donation_refunded" : "skipped";
}

/** Nieudany zwrot darowizny: wpłata wraca na `paid` (pieniądze są u nas). */
async function reopenDonation(event: RefundEvent, refs: DonationRefs): Promise<RefundOutcome> {
  const filter = donationFilter(refs);
  if (!filter) return "skipped";
  const supabase = await admin();
  const { data, error } = await supabase
    .from("donations")
    .update({ status: "paid" })
    .or(filter)
    .eq("environment", event.environment)
    .eq("status", "refunded")
    .select("id");
  if (error) throw new Error(`refund failed: donation reopen failed: ${error.message}`);
  return data && data.length > 0 ? "donation_restored" : "skipped";
}

/**
 * Dzwonek „Zwrot płatności" w aplikacji - wyłącznie dla zwrotu, nigdy dla
 * sporu (patrz `revokeOrder`). Nigdy nie rzuca.
 */
async function pushRefundNotification(
  userId: string,
  // `tenant_id` jest `NOT NULL` na `subscriptions` i `payment_orders`, więc
  // wołający zawsze go mają - dawny strażnik `if (!tenantId) return` był
  // nieosiągalny, odkąd najemca nie pochodzi już z planu.
  tenantId: string,
): Promise<void> {
  try {
    const supabase = await admin();
    await supabase.from("notifications").insert({
      user_id: userId,
      tenant_id: tenantId,
      kind: "billing",
      title_pl: "Zwrot płatności",
      title_en: "Payment refunded",
      body_pl: "Dostęp powiązany ze zwróconą płatnością został zakończony.",
      body_en: "Access linked to the refunded payment has ended.",
      href: PROFILE_PLAN_PATH,
      // Ikona z listy kuratorskiej (`CURATED_ICON_NAMES`): `receipt` jej nie ma
      // i ładował w przeglądarce leniwy rejestr ikon (109 KB) - spec B.7.
      icon: "credit-card",
    });
  } catch (err) {
    console.error("[payments] refund notification failed", err);
  }
}

// --- alerty dla zespołu ------------------------------------------------------

/**
 * Najemca, którego dotyczy korekta - z wiersza subskrypcji, zamówienia albo
 * darowizny wskazanego przez korektę (zawsze w środowisku korekty).
 *
 * Zdarzenie operatora NIE niesie `tenant_id`: jedno konto Stripe obsługuje
 * wiele obszarów roboczych, więc najemcę wyprowadzamy wyłącznie z NASZEGO
 * wiersza. `null` = korekty nie da się przypisać - wtedy nie ma komu wysłać
 * alertu (patrz `alertAdminsAboutDispute`). Nigdy nie rzuca.
 */
async function adjustmentTenant(
  event: RefundEvent,
  target: AdjustmentTarget,
): Promise<string | null> {
  if (target.kind === "order") return target.order.tenant_id;
  try {
    const supabase = await admin();
    if (target.kind === "subscription") {
      const { data } = await supabase
        .from("subscriptions")
        .select("tenant_id")
        .eq("provider_subscription_id", target.subscriptionId)
        .eq("environment", event.environment)
        .maybeSingle();
      if (data) return data.tenant_id;
    }
    const txnId = event.transactionId;
    // Subskrypcja nieznana lokalnie (inne środowisko, sprzed migracji) - spór
    // może nieść też transakcję, a ta wskazuje zamówienie.
    if (target.kind === "subscription" && txnId && PROVIDER_REFERENCE_SHAPE.test(txnId)) {
      const order = await findOrderForAdjustment(event, "dispute");
      if (order) return order.tenant_id;
    }
    const refs: DonationRefs | null =
      target.kind === "donation"
        ? target.refs
        : txnId
          ? { paymentRef: txnId, sessionId: null, invoiceId: null, donationId: null }
          : null;
    const filter = refs ? donationFilter(refs) : null;
    if (!filter) return null;
    const { data: donation } = await supabase
      .from("donations")
      .select("tenant_id")
      .or(filter)
      .eq("environment", event.environment)
      .limit(1)
      .maybeSingle();
    return donation?.tenant_id ?? null;
  } catch (err) {
    console.error("[payments] dispute tenant lookup failed", event.adjustmentId, err);
    return null;
  }
}

/**
 * Zdanie o dostępie klienta w alercie - opisuje to, co NAPRAWDĘ się stało,
 * a nie to, co faza sporu zwykle oznacza (wygrana bez przywrócenia, bo
 * płatność zwrócono; spór o fakturę za zakończony okres).
 */
type AccessNote =
  | "suspended"
  | "revoked"
  | "restored"
  | "refunded_kept"
  | "past_period"
  | "unverified"
  | "disputed"
  | "ticket_review"
  | "pending"
  | "none";

const ACCESS_NOTES: Record<AccessNote, { pl: string; en: string }> = {
  suspended: {
    pl: " Dostęp klienta został wstrzymany do rozstrzygnięcia.",
    en: " Customer access is suspended until the dispute is resolved.",
  },
  revoked: {
    pl: " Dostęp klienta pozostaje odebrany.",
    en: " Customer access stays revoked.",
  },
  restored: {
    pl: " Dostęp klienta przywrócono.",
    en: " Customer access has been restored.",
  },
  refunded_kept: {
    pl: " Płatność została zwrócona, więc dostęp klienta pozostaje odebrany.",
    en: " The payment was refunded, so customer access stays revoked.",
  },
  past_period: {
    pl: " Faktura dotyczy zakończonego okresu - dostęp klienta bez zmian.",
    en: " The invoice covers a past period - customer access is unchanged.",
  },
  unverified: {
    pl: " Nie udało się potwierdzić stanu płatności u operatora - sprawdź dostęp ręcznie.",
    en: " The payment state could not be confirmed with the provider - check access manually.",
  },
  disputed: {
    pl: " Płatność jest objęta sporem - o dostępie zdecyduje rozstrzygnięcie sporu.",
    en: " The payment is disputed - access follows the dispute outcome.",
  },
  ticket_review: {
    pl: " Zamówienie wróciło na opłacone; zgłoszenie na wydarzenie wymaga decyzji organizatora.",
    en: " The order is paid again; the event registration needs an organiser decision.",
  },
  pending: {
    pl: " Zmiana dostępu klienta nie powiodła się i zostanie ponowiona automatycznie.",
    en: " Updating customer access failed and will be retried automatically.",
  },
  none: { pl: "", en: "" },
};

/** Treść alertu dla każdej fazy sporu - PL/EN, bez danych osobowych klienta. */
function disputeAlertCopy(
  phase: DisputePhase,
  ref: string,
  providerStatus: string,
  access: { pl: string; en: string },
): { titlePl: string; titleEn: string; bodyPl: string; bodyEn: string } {
  switch (phase) {
    case "open":
      return {
        titlePl: "Otwarto spór płatniczy",
        titleEn: "Payment dispute opened",
        bodyPl: `Bank otworzył spór dla ${ref}${providerStatus}.${access.pl} Przygotuj dowody w terminie.`,
        bodyEn: `A dispute was opened for ${ref}${providerStatus}.${access.en} Prepare evidence before the deadline.`,
      };
    case "won":
      return {
        titlePl: "Spór płatniczy rozstrzygnięty",
        titleEn: "Payment dispute resolved",
        bodyPl: `Spór dla ${ref}${providerStatus} rozstrzygnięto na naszą korzyść.${access.pl}`,
        bodyEn: `The dispute for ${ref}${providerStatus} was won.${access.en}`,
      };
    case "lost":
      return {
        titlePl: "Spór płatniczy przegrany",
        titleEn: "Payment dispute lost",
        bodyPl: `Spór dla ${ref}${providerStatus} rozstrzygnięto na korzyść klienta. Środki wróciły do banku.${access.pl}`,
        bodyEn: `The dispute for ${ref}${providerStatus} was lost. The funds went back to the bank.${access.en}`,
      };
    case "prevented":
      return {
        titlePl: "Spór zakończony zwrotem płatności",
        titleEn: "Dispute prevented - payment refunded",
        bodyPl: `Spór dla ${ref}${providerStatus} zatrzymano automatycznym zwrotem płatności (zapobieganie sporom).${access.pl}`,
        bodyEn: `The dispute for ${ref}${providerStatus} was prevented by an automatic refund.${access.en}`,
      };
  }
}

/** Ładunek wskazania alertu - identyfikator operatora w adresie, zakodowany. */
function hrefParam(value: string): string {
  return encodeURIComponent(value);
}

/**
 * Alert dla zespołu przy sporze. Spór wymaga ludzkiej reakcji (dowody dla
 * banku w terminie), więc zostawia ślad w panelu - ale WYŁĄCZNIE u
 * administratorów najemcy, którego spór dotyczy.
 *
 * KAŻDA FAZA, RAZ. Otwarcie, wygrana, przegrana i zatrzymanie zwrotem
 * alarmują niezależnie od tego, czy było co odebrać albo przywrócić - termin
 * na dowody biegnie także wtedy. Alert idzie PO skutku (treść mówi, co
 * naprawdę stało się z dostępem), a przy awarii skutku - mimo wszystko, ze
 * zdaniem „zostanie ponowione". Klucz deduplikacji to adres alertu:
 * `/admin/billing?dispute=<spór>&phase=<faza>` + `once`. Wspólny
 * `/admin/billing` sklejał w pięciominutowym oknie `enqueue_notification`
 * DWA różne spory w jeden dzwonek, a ponowienie po kwadransie (redelivery,
 * przegląd zaległych zdarzeń) dawało drugi dzwonek o tym samym sporze.
 *
 * DLACZEGO NIE `user_roles` CAŁEGO WDROŻENIA. Wcześniejsza wersja wybierała
 * każdego z rolą `admin`, bez warunku najemcy, i wstawiała mu dzwonek
 * z identyfikatorem cudzej transakcji (audyt wyd. 12, 16.8: „alert o sporze
 * najemcy A trafia do administratorów wszystkich najemców"). Odbiorców
 * zawęża `notifyTenantAdmins` - rola W TYM najemcy i profil w tym najemcy,
 * każdy dzwonek przez `enqueue_notification`.
 *
 * Spór bez przypisanego najemcy nie idzie do nikogo: zostaje w dzienniku
 * webhooków i w logu serwera (`console.error` niżej), skąd odczyta go
 * operator platformy - lepszy brak dzwonka niż dzwonek u obcej organizacji.
 * Nigdy nie rzuca.
 */
async function alertAdminsAboutDispute(
  event: RefundEvent,
  target: AdjustmentTarget,
  tenantId: string | null,
  phase: DisputePhase,
  note: AccessNote,
): Promise<void> {
  const ref =
    event.transactionId ??
    (target.kind === "subscription" ? target.subscriptionId : null) ??
    event.adjustmentId;
  if (!tenantId) {
    console.error("[payments] dispute without resolvable tenant - no admin alert", {
      adjustmentId: event.adjustmentId,
      phase,
      providerStatus: event.providerStatus ?? null,
    });
    return;
  }
  // Zgłoszenie odwołane przy otwarciu sporu baza zwolniła do puli (i mogła
  // oddać miejsce komuś z listy rezerwowej) - wygrany spór nie ma prawa go po
  // cichu wskrzesić, więc decyzja zostaje u organizatora.
  const metadata =
    target.kind === "order" ? ((target.order.metadata ?? {}) as Record<string, unknown>) : {};
  const registrationNeedsReview =
    phase === "won" &&
    note === "restored" &&
    typeof metadata.event_id === "string" &&
    typeof metadata.registration_id === "string" &&
    metadata.registration_id.length > 0;
  const access = ACCESS_NOTES[note];
  const copy = disputeAlertCopy(
    phase,
    ref,
    event.providerStatus ? ` (${event.providerStatus})` : "",
    registrationNeedsReview
      ? {
          pl: `${access.pl} Zgłoszenie na wydarzenie wymaga decyzji organizatora.`,
          en: `${access.en} The event registration needs an organiser decision.`,
        }
      : access,
  );
  const { notifyTenantAdmins } = await import("@/lib/events/tenantAdminAlert.server");
  await notifyTenantAdmins({
    tenantId,
    kind: "billing",
    ...copy,
    href: `/admin/billing?dispute=${hrefParam(event.adjustmentId || ref)}&phase=${phase}`,
    icon: "credit-card",
    once: true,
  });
}

/**
 * Alert dla zespołu przy zwrocie, który nie zrobił tego, czego można by się
 * spodziewać: zwrot nieudany (pieniądze wróciły na saldo) albo zwrot faktury
 * za zakończony okres (dostęp bez zmian). Raz na zwrot i fazę (`once`).
 * Nigdy nie rzuca.
 */
async function alertAdminsAboutRefund(
  event: RefundEvent,
  target: AdjustmentTarget,
  tenantId: string | null,
  alert: { phase: "failed" | "past_period"; note: AccessNote },
): Promise<void> {
  const ref =
    event.transactionId ??
    (target.kind === "subscription" ? target.subscriptionId : null) ??
    event.adjustmentId;
  if (!tenantId) {
    console.error("[payments] refund alert without resolvable tenant", {
      adjustmentId: event.adjustmentId,
      phase: alert.phase,
    });
    return;
  }
  const access = ACCESS_NOTES[alert.note];
  const failure = event.failureReason ?? event.providerStatus;
  const reason = failure ? ` (${failure})` : "";
  const copy =
    alert.phase === "failed"
      ? {
          titlePl: "Zwrot płatności nie powiódł się",
          titleEn: "Refund failed",
          bodyPl: `Zwrot ${event.adjustmentId} dla ${ref}${reason} nie doszedł do skutku - środki wróciły na saldo.${access.pl}`,
          bodyEn: `Refund ${event.adjustmentId} for ${ref}${reason} failed - the funds returned to the balance.${access.en}`,
        }
      : {
          titlePl: "Zwrot faktury za zakończony okres",
          titleEn: "Refund of a past-period invoice",
          bodyPl: `Zwrócono płatność ${ref} za okres, który już minął.${access.pl}`,
          bodyEn: `Payment ${ref} for an already finished period was refunded.${access.en}`,
        };
  const { notifyTenantAdmins } = await import("@/lib/events/tenantAdminAlert.server");
  await notifyTenantAdmins({
    tenantId,
    kind: "billing",
    ...copy,
    href: `/admin/billing?refund=${hrefParam(event.adjustmentId || ref)}&phase=${alert.phase}`,
    icon: "credit-card",
    once: true,
  });
}

// --- wejście -----------------------------------------------------------------

/**
 * Spór w stanie BIEŻĄCYM u operatora (S2). Zdarzenia sporu nie mają strażnika
 * kolejności, więc `created` ponowione po `closed(won)` zawieszało dostęp
 * zwycięzcy - i nic go potem nie przywracało. Status, kwota i płatność
 * pochodzą więc z odczytu sporu; awaria odczytu RZUCA (operator ponowi).
 * Korekta spoza Stripe (identyfikator bez `dp_`) zostaje przy stanie
 * ze zdarzenia.
 */
async function withCurrentDisputeState(event: RefundEvent): Promise<RefundEvent> {
  if (!STRIPE_DISPUTE_SHAPE.test(event.adjustmentId)) return event;
  const { retrieveDisputeState } = await import("@/lib/billing/transactions.server");
  const current = await retrieveDisputeState(event.environment, event.adjustmentId);
  if (!current) {
    console.warn("[payments] dispute unknown to the provider - acting on the event payload", {
      adjustmentId: event.adjustmentId,
    });
    return event;
  }
  const { stripeDisputePhase } = await import("@/lib/billing/stripeEvents.server");
  const phase = stripeDisputePhase(current.status);
  const paymentRef = current.paymentIntentId ?? current.chargeId;
  return {
    ...event,
    action: phase.action,
    status: phase.status,
    providerStatus: current.status,
    amountCents: current.amountCents ?? event.amountCents,
    currency: current.currency ?? event.currency,
    transactionId:
      event.transactionId ??
      (paymentRef && PROVIDER_REFERENCE_SHAPE.test(paymentRef) ? paymentRef : null),
  };
}

/** Zwrot (pełny albo częściowy) - skutek według celu. */
async function applyRefund(event: RefundEvent, target: AdjustmentTarget): Promise<RefundOutcome> {
  switch (target.kind) {
    case "subscription":
      return refundSubscription(event, target);
    case "order":
      return revokeOrder(event, target.order, target.persistIntent);
    case "donation":
      return refundDonation(event, target.refs);
    case "unmatched":
      console.warn("[payments] adjustment without transaction or subscription", event.adjustmentId);
      return "skipped";
  }
}

/** Skutek sporu według celu i fazy - bez alertu (alert składa `applyDispute`). */
async function disputeEffect(
  event: RefundEvent,
  target: AdjustmentTarget,
  phase: DisputePhase,
): Promise<CorrectionResult> {
  switch (target.kind) {
    case "subscription":
      return phase === "won"
        ? restoreSubscription(event, target)
        : disputeSubscription(event, target, phase);
    case "order": {
      if (phase === "won") return restoreOrder(event, target.order);
      const outcome = await revokeOrder(event, target.order, target.persistIntent);
      return { outcome, note: phase === "open" ? "suspended" : "revoked" };
    }
    case "donation":
      // Darowizna nie daje dostępu: o statusie wpłaty decydują wyłącznie
      // pieniądze, które naprawdę wróciły do darczyńcy.
      if (phase === "lost" || phase === "prevented") {
        return { outcome: await refundDonation(event, target.refs), note: "none" };
      }
      return { outcome: "skipped", note: "none" };
    case "unmatched":
      console.warn("[payments] adjustment without transaction or subscription", event.adjustmentId);
      return { outcome: "skipped", note: "none" };
  }
}

/**
 * Spór: najemca, skutek, alert. Alert idzie także wtedy, gdy skutek padł
 * (termin na dowody nie czeka na naszą bazę) - a wyjątek leci dalej, żeby
 * operator ponowił zdarzenie. Ponowienie nie dubluje alertu (`once`).
 */
async function applyDispute(event: RefundEvent, target: AdjustmentTarget): Promise<RefundOutcome> {
  const phase = disputePhase(event);
  const tenantId = await adjustmentTenant(event, target);
  let result: CorrectionResult;
  try {
    result = await disputeEffect(event, target, phase);
  } catch (err) {
    await alertAdminsAboutDispute(event, target, tenantId, phase, "pending");
    throw err;
  }
  await alertAdminsAboutDispute(event, target, tenantId, phase, result.note);
  return result.outcome;
}

/** Skutek nieudanego zwrotu według celu - ze stanem obciążenia odczytanym od operatora. */
async function refundFailureEffect(
  event: RefundEvent,
  target: AdjustmentTarget,
): Promise<CorrectionResult> {
  if (target.kind === "unmatched") return { outcome: "skipped", note: "none" };
  const paymentRef =
    target.kind === "order"
      ? orderPaymentRef(event, target.order)
      : isPaymentRef(event.transactionId)
        ? event.transactionId
        : null;
  const { retrievePaymentRefundState } = await import("@/lib/billing/transactions.server");
  const state = paymentRef ? await retrievePaymentRefundState(event.environment, paymentRef) : null;
  if (!state) return { outcome: "skipped", note: "unverified" };

  switch (target.kind) {
    case "order":
      return reopenOrderAfterFailedRefund(target.order, state);
    case "subscription": {
      await recordSubscriptionOrderCorrection(event, target, { kind: "refund_failed", state });
      if (state.fullyRefunded) return { outcome: "skipped", note: "refunded_kept" };
      if (state.disputed) return { outcome: "skipped", note: "disputed" };
      if (invoicePeriodEnded(target.invoice)) return { outcome: "skipped", note: "past_period" };
      return reviveSubscription(event, target.subscriptionId, "refund");
    }
    case "donation":
      if (state.fullyRefunded) return { outcome: "skipped", note: "refunded_kept" };
      return { outcome: await reopenDonation(event, target.refs), note: "none" };
  }
}

/**
 * Nieudany zwrot (`refund.failed`): pieniądze wróciły na saldo serwisu, więc
 * korekta, która odebrała dostęp, przestaje być prawdą.
 *
 * Stan liczymy z obciążenia u operatora (`amount_refunded` po porażce), nie
 * z kwoty zdarzenia: inne zwroty tego samego obciążenia mogły się udać.
 * Dostęp wraca WYŁĄCZNIE wtedy, gdy pozostałe zwroty nie są już zwrotem
 * pełnym; inaczej zostaje księgowanie. Zespół dostaje alert raz na zwrot.
 */
async function applyRefundFailure(event: RefundEvent): Promise<RefundOutcome> {
  const target = await resolveAdjustmentTarget(event, "refund");
  const tenantId = await adjustmentTenant(event, target);
  let result: CorrectionResult;
  try {
    result = await refundFailureEffect(event, target);
  } catch (err) {
    await alertAdminsAboutRefund(event, target, tenantId, { phase: "failed", note: "pending" });
    throw err;
  }
  await alertAdminsAboutRefund(event, target, tenantId, { phase: "failed", note: result.note });
  return result.outcome;
}

/**
 * Zwrot, który nie doszedł do skutku u operatora (INV-19c).
 *
 * Do tej pory taka korekta kończyła się na `isRevokingAdjustment` jako
 * `skipped`, więc zlecenie zwrotu za odrzucone zgłoszenie wisiało w
 * `submitted` bez końca, a pieniądze nie wracały do uczestnika. RPC
 * `_event_registration_refund_failed` przenosi zlecenie o tym identyfikatorze
 * zwrotu do `needs_review` i w TEJ SAMEJ transakcji alarmuje administratorów
 * najemcy - najemcę bierze z wiersza zlecenia, nie z ładunku operatora.
 *
 * Środowisko zdarzenia idzie do RPC jako filtr (ta sama reguła P0 co
 * `findOrderForAdjustment`): zwrot z piaskownicy nie dotyka zlecenia
 * produkcyjnego. Awaria zapisu RZUCA - operator ponowi dostarczenie, a RPC
 * jest idempotentne (drugi `refund.updated` po `refund.failed` nic nie robi).
 */
async function escalateFailedRefund(event: RefundEvent): Promise<RefundOutcome> {
  if (!PROVIDER_REFERENCE_SHAPE.test(event.adjustmentId)) return "skipped";
  const supabase = await admin();
  const { data, error } = await supabase.rpc("_event_registration_refund_failed", {
    p_provider_refund_id: event.adjustmentId,
    p_environment: event.environment,
    p_reason: event.failureReason ?? event.status ?? "failed",
  });
  if (error) throw new Error(`refund failure: escalation failed: ${error.message}`);
  if (data === true) return "refund_failure_escalated";
  // Zwrot spoza zleceń zgłoszeń (np. nadliczbowa wpłata) albo zlecenie, które
  // już czeka na decyzję. Ślad zostaje w dzienniku webhooków i w logu serwera.
  console.warn("[payments] failed refund without escalation", {
    adjustmentId: event.adjustmentId,
    status: event.status,
  });
  return "skipped";
}

/**
 * Nieudany zwrot: obie strony tej samej porażki. Zlecenie zwrotu zgłoszenia
 * o tym identyfikatorze zwrotu idzie do przeglądu (`escalateFailedRefund`,
 * sama baza - PIERWSZE, żeby awaria operatora przy przeliczeniu nie
 * wstrzymała sprawy dla człowieka), a zamówienie, subskrypcja albo darowizna
 * wracają do stanu z obciążenia u operatora (`applyRefundFailure`). Obie
 * ścieżki są idempotentne, więc ponowienie po awarii jednej z nich nie
 * dubluje skutków drugiej.
 */
async function applyFailedRefund(event: RefundEvent): Promise<RefundOutcome> {
  const escalated = await escalateFailedRefund(event);
  const corrected = await applyRefundFailure(event);
  return corrected !== "skipped" ? corrected : escalated;
}

/**
 * Jedno wejście dla zwrotów, sporów i nieudanych zwrotów. Kolejność:
 *   1. nieudany zwrot - osobna ścieżka: przeliczenie zamówienia z obciążenia
 *      i eskalacja zlecenia zwrotu zgłoszenia (INV-19c), nic nie odbiera;
 *   2. spór - stan BIEŻĄCY od operatora (S2);
 *   3. bramka: korekta, która niczego nie odbiera ani nie przywraca (kredyt,
 *      wniosek o zwrot) i nie jest sporem, kończy się bez dotykania bazy;
 *   4. cel korekty - RAZ (zamówienie / subskrypcja przez operatora / sesja
 *      Checkout / darowizna);
 *   5. skutek; przy sporze - alert dla zespołu najemcy w każdej fazie.
 *
 * Zdarzenie kopiujemy na wejściu: cel, alert i skutek mają widzieć TE SAME
 * identyfikatory, nawet gdy wołający zmieni swój obiekt w trakcie.
 */
export async function applyRefundEffects(input: RefundEvent): Promise<RefundOutcome> {
  let event: RefundEvent = { ...input };
  if (isFailedRefund(event)) return applyFailedRefund(event);
  if (isDispute(event)) event = await withCurrentDisputeState(event);

  const dispute = isDispute(event);
  const revoking = !isDisputeReversed(event) && isRevokingAdjustment(event);
  if (!dispute && !revoking) return "skipped";

  const target = await resolveAdjustmentTarget(event, dispute ? "dispute" : "refund");
  return dispute ? applyDispute(event, target) : applyRefund(event, target);
}
