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
import type { Tables } from "@/integrations/supabase/types";
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
   * Surowy status operatora (np. `needs_response`, `won`) - wyłącznie do
   * logów i treści alertu. O skutku decydują `action` i `status`.
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
 * ze stanem `failed`/`canceled`). Pieniądze zostały u nas, więc niczego nie
 * odbieramy ani nie przywracamy - sprawę trzeba oddać człowiekowi.
 */
export function isFailedRefund(event: RefundEvent): boolean {
  return event.action === "refund" && (event.status === "failed" || event.status === "canceled");
}

/** Spór rozstrzygnięty na naszą korzyść - dostęp wraca. */
export function isDisputeReversed(event: RefundEvent): boolean {
  return isDispute(event) && event.status === "reversed";
}

/**
 * Faza sporu dla alertu: otwarty (`chargeback_warning`), wygrany
 * (`reversed`) albo przegrany (`chargeback` w każdym innym statusie -
 * normalizator Stripe daje mu `approved`).
 */
type DisputePhase = "opened" | "won" | "lost";

function disputePhase(event: RefundEvent): DisputePhase {
  if (isDisputeReversed(event)) return "won";
  return event.action === "chargeback_warning" ? "opened" : "lost";
}

/** Mapuje akcję operatora na czytelny powód w dzienniku i CRM. */
function reasonLabel(action: AdjustmentAction): string {
  // Spór otwarty (`chargeback_warning` - tak normalizator Stripe nazywa każdy
  // spór w toku) to też obciążenie zwrotne, nie „zwrot płatności".
  return action === "chargeback" || action === "chargeback_warning" ? "chargeback" : "refund";
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

/**
 * W co trafia korekta - rozstrzygane RAZ, przed alertem i przed skutkiem.
 *
 *   * `subscription` - płatność faktury subskrypcji (odnowienie albo pierwsza
 *     faktura). Zamówienie subskrypcyjne nie zna intencji płatności faktur,
 *     więc dopasowanie idzie przez operatora (`resolvePaymentInvoice`);
 *   * `order` - nasze zamówienie; `persistIntent` = intencję płatności
 *     znaleźliśmy dopiero przez sesję Checkout i trzeba ją utrwalić;
 *   * `unmatched` - ani zamówienie, ani subskrypcja (darowizna albo płatność
 *     spoza naszej kasy).
 */
type AdjustmentTarget =
  | { kind: "subscription"; subscriptionId: string }
  | { kind: "order"; order: AdjustmentOrder; persistIntent: string | null }
  | { kind: "unmatched" };

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
 * operatora, (2) subskrypcja, której fakturę opłaciła płatność, (3) zamówienie
 * sesji Checkout, która płatność pobrała (zwrot przed realizacją), (4) nic -
 * wtedy wołający próbuje darowizny.
 *
 * Kroki 2-3 pytają operatora wyłącznie o płatność (`pi_`/`ch_`) i wyłącznie
 * wtedy, gdy własna baza nie zna transakcji. Awaria operatora RZUCA: zwrot
 * zgubiony „po cichu" zostawiałby dostęp klientowi, który odzyskał pieniądze.
 */
async function resolveAdjustmentTarget(
  event: RefundEvent,
  scope: "refund" | "dispute",
): Promise<AdjustmentTarget> {
  if (event.subscriptionId) return { kind: "subscription", subscriptionId: event.subscriptionId };

  const txnId = event.transactionId;
  if (!txnId || !PROVIDER_REFERENCE_SHAPE.test(txnId)) return { kind: "unmatched" };

  const order = await findOrderForAdjustment(event, scope);
  if (order) return { kind: "order", order, persistIntent: null };
  if (!txnId.startsWith("pi_") && !txnId.startsWith("ch_")) return { kind: "unmatched" };

  const { resolvePaymentInvoice, findCheckoutSessionForPayment } =
    await import("@/lib/billing/transactions.server");
  const invoice = await resolvePaymentInvoice(event.environment, txnId);
  if (invoice?.subscriptionId) {
    return { kind: "subscription", subscriptionId: invoice.subscriptionId };
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
  return { kind: "unmatched" };
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
 * Zawieszenie uprawnień planu na czas OTWARTEGO sporu: dostęp znika od razu
 * (`canceled`, okres kończy się teraz), ale - inaczej niż `refunded` - wraca,
 * gdy spór zostanie wygrany (`syncEntitlementState` i `grantEntitlement`
 * traktują `refunded` jako ostateczny). Dotyka wyłącznie wierszy aktywnych:
 * zwrot ani rezygnacja nie są tu nadpisywane.
 *
 * @returns `true` gdy jakikolwiek rekord został zawieszony.
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

/** Odbiera uprawnienie subskrypcyjne powiązane z subskrypcją operatora. */
async function revokeSubscription(
  event: RefundEvent,
  subscriptionId: string,
): Promise<RefundOutcome> {
  // Zwrot CZĘŚCIOWY faktury to korekta ceny, nie rezygnacja - ta sama reguła
  // co dla zamówień (`revokeOrder`): dostęp zostaje. Pełny zwrot (albo zwrot
  // bez znanej kwoty pierwotnej) odbiera dostęp, bo bezpieczniej odebrać niż
  // zostawić opłacone uprawnienie po oddaniu pieniędzy.
  const captured = event.capturedAmountCents ?? null;
  const refunded = event.amountCents ?? 0;
  if (
    event.action === "refund" &&
    typeof captured === "number" &&
    captured > 0 &&
    refunded > 0 &&
    refunded < captured
  ) {
    console.warn("[payments] partial refund of a subscription payment - access kept", {
      adjustmentId: event.adjustmentId,
      subscriptionId,
      refunded,
      captured,
    });
    return "skipped";
  }

  const supabase = await admin();
  const nowIso = new Date().toISOString();

  const { data: sub, error: subErr } = await supabase
    .from("subscriptions")
    .select("user_id, tenant_id, price_id")
    .eq("provider_subscription_id", subscriptionId)
    .eq("environment", event.environment)
    .maybeSingle();
  if (subErr) throw new Error(`refund: subscription lookup failed: ${subErr.message}`);

  // Spór OTWARTY zawiesza dostęp, zwrot i spór przegrany odbierają go
  // ostatecznie. Różnica jest w statusie: `refunded` jest dla
  // `syncEntitlementState` nieodwracalny, więc spór otwarty zapisany tym
  // statusem nigdy nie wracał po wygranej - klient, który miał rację, zostawał
  // bez opłaconego dostępu.
  const { revokeSubscriptionEntitlement } = await import("@/lib/billing/grant.server");
  const revoked =
    event.action === "chargeback_warning"
      ? await suspendPlanEntitlements([subscriptionId], nowIso)
      : await revokeSubscriptionEntitlement(subscriptionId, nowIso);

  // Nic się nie zmieniło (uprawnienie odebrane już wcześniej - np. spór
  // przegrany po sporze otwartym albo ponowiona dostawa zwrotu): skutki
  // miękkie poszły przy pierwszym odebraniu. Bez tej bramki każde kolejne
  // zdarzenie dokładało dzwonek „Obciążenie zwrotne".
  if (!revoked) return "skipped";
  if (!sub?.user_id) return "subscription_refunded";

  const { resolvePlanForPrice, syncCrmSubscriptionState } =
    await import("@/lib/billing/purchaseEffects.server");
  const plan = sub.price_id
    ? await resolvePlanForPrice(sub.price_id, { tenantId: sub.tenant_id, userId: sub.user_id })
    : null;

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

  await pushRefundNotification(sub.user_id, sub.tenant_id, reasonLabel(event.action));

  return "subscription_refunded";
}

/**
 * Odbiera uprawnienie zakupu jednorazowego (odblokowanie treści, bilet).
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

  // Ile łącznie wróciło do kupującego. Operator liczy narastająco, więc bierzemy
  // maksimum z zapisanego stanu - ponowione zdarzenie nie może cofnąć licznika.
  const captured = event.capturedAmountCents ?? order.amount_cents ?? null;
  const knownCaptured = typeof captured === "number" && captured > 0;
  const reported = Math.max(order.refunded_amount_cents ?? 0, event.amountCents ?? 0);

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
  const refundedSoFar = knownCaptured && reported > captured ? captured : reported;
  if (knownCaptured && reported > captured) {
    console.warn(
      "[payments] refund exceeds captured amount - clamped",
      event.adjustmentId,
      order.id,
      { reported, captured },
    );
  }

  // Zwrot częściowy tylko wtedy, gdy znamy kwotę pierwotną I jest ona wyższa.
  // Bez tej wiedzy zakładamy pełny zwrot - bezpieczniej odebrać dostęp niż
  // zostawić opłacone uprawnienie po oddaniu pieniędzy.
  const isPartial =
    event.action === "refund" && knownCaptured && refundedSoFar > 0 && refundedSoFar < captured;

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

  // BRAMKA POWTÓRZONEGO ZWROTU. Ten sam wzorzec co w `revokeDonation`
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
  // I to zdarzenie nie podnosi licznika zwrotów.
  const changedRow = (flipped ?? []).length > 0;
  const settledBefore =
    order.status === "refunded" ||
    (knownCaptured && (order.refunded_amount_cents ?? 0) >= captured);
  // Porównanie z kwotą, KTÓRĄ WŁAŚNIE ZAPISUJEMY (po zacisku), a nie z surową
  // kwotą zdarzenia: powtórka z zawyżoną kwotą też nie podnosi licznika.
  const bringsNoMoney = (order.refunded_amount_cents ?? 0) >= refundedSoFar;
  if (!changedRow && settledBefore && bringsNoMoney) {
    // Spór PRZEGRANY po sporze otwartym: zamówienie zamknięto już przy
    // otwarciu, a plan był tylko zawieszony - teraz odbieramy go ostatecznie.
    // Bez skutków miękkich: klient dostał je przy otwarciu sporu.
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

/**
 * Zwrot darowizny - bez uprawnień, ale status musi się zgadzać z księgami.
 *
 * FILTR ŚRODOWISKA jak w rodzeństwie (`revokeOrder`, `revokeSubscription`):
 * zdarzenie z piaskownicy nie może zamknąć wpłaty produkcyjnej o tym samym
 * identyfikatorze intencji. Kolumnę `donations.environment` dokłada migracja
 * `20260831140000_donations_environment_isolation` (NOT NULL DEFAULT 'live'
 * + CHECK + indeks); filtr działa dopiero po jej wdrożeniu i regeneracji
 * `src/integrations/supabase/types.ts` - kolejność: migracja ->
 * `bun run generate:types` -> filtr.
 */
async function revokeDonation(event: RefundEvent, txnId: string): Promise<RefundOutcome> {
  const supabase = await admin();
  const { data, error } = await supabase
    .from("donations")
    .update({ status: "refunded" })
    .eq("provider_intent_id", txnId)
    .eq("environment", event.environment)
    .neq("status", "refunded")
    .select("id");
  if (error) throw new Error(`refund: donation status flip failed: ${error.message}`);
  return data && data.length > 0 ? "donation_refunded" : "skipped";
}

/** Dzwonek w aplikacji. Nigdy nie rzuca. */
async function pushRefundNotification(
  userId: string,
  // `tenant_id` jest `NOT NULL` na `subscriptions` i `payment_orders`, więc
  // wołający zawsze go mają - dawny strażnik `if (!tenantId) return` był
  // nieosiągalny, odkąd najemca nie pochodzi już z planu.
  tenantId: string,
  reason: string,
): Promise<void> {
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
      // Ikona z listy kuratorskiej (`CURATED_ICON_NAMES`): `receipt` jej nie ma
      // i ładował w przeglądarce leniwy rejestr ikon (109 KB) - spec B.7.
      icon: "credit-card",
    });
  } catch (err) {
    console.error("[payments] refund notification failed", err);
  }
}

/**
 * Najemca, którego dotyczy spór - z wiersza subskrypcji, zamówienia albo
 * darowizny wskazanego przez korektę (zawsze w środowisku korekty).
 *
 * Zdarzenie operatora NIE niesie `tenant_id`: jedno konto Stripe obsługuje
 * wiele obszarów roboczych, więc najemcę wyprowadzamy wyłącznie z NASZEGO
 * wiersza. `null` = sporu nie da się przypisać - wtedy nie ma komu wysłać
 * alertu (patrz `alertAdminsAboutDispute`). Nigdy nie rzuca.
 */
async function disputeTenant(event: RefundEvent, target: AdjustmentTarget): Promise<string | null> {
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
    if (!txnId || !PROVIDER_REFERENCE_SHAPE.test(txnId)) return null;
    // Subskrypcja nieznana lokalnie (inne środowisko, sprzed migracji) - spór
    // może nieść też transakcję, a ta wskazuje zamówienie.
    if (target.kind === "subscription") {
      const order = await findOrderForAdjustment(event, "dispute");
      if (order) return order.tenant_id;
    }
    const { data: donation } = await supabase
      .from("donations")
      .select("tenant_id")
      .eq("provider_intent_id", txnId)
      .eq("environment", event.environment)
      .limit(1)
      .maybeSingle();
    return donation?.tenant_id ?? null;
  } catch (err) {
    console.error("[payments] dispute tenant lookup failed", event.adjustmentId, err);
    return null;
  }
}

/** Treść alertu dla każdej fazy sporu - PL/EN, bez danych osobowych klienta. */
function disputeAlertCopy(
  phase: DisputePhase,
  ref: string,
  providerStatus: string,
  review: { pl: string; en: string },
): { titlePl: string; titleEn: string; bodyPl: string; bodyEn: string } {
  switch (phase) {
    case "opened":
      return {
        titlePl: "Otwarto spór płatniczy",
        titleEn: "Payment dispute opened",
        bodyPl: `Bank otworzył spór dla ${ref}${providerStatus}. Dostęp klienta został wstrzymany - przygotuj dowody.`,
        bodyEn: `A dispute was opened for ${ref}${providerStatus}. Customer access is suspended - prepare evidence.`,
      };
    case "won":
      return {
        titlePl: "Spór płatniczy rozstrzygnięty",
        titleEn: "Payment dispute resolved",
        bodyPl: `Spór dla ${ref}${providerStatus} rozstrzygnięto na naszą korzyść. Dostęp klienta przywrócono.${review.pl}`,
        bodyEn: `The dispute for ${ref}${providerStatus} was won. Customer access has been restored.${review.en}`,
      };
    case "lost":
      return {
        titlePl: "Spór płatniczy przegrany",
        titleEn: "Payment dispute lost",
        bodyPl: `Spór dla ${ref}${providerStatus} rozstrzygnięto na korzyść klienta. Środki wróciły do banku, dostęp pozostaje odebrany.`,
        bodyEn: `The dispute for ${ref}${providerStatus} was lost. The funds went back to the bank and access stays revoked.`,
      };
  }
}

/**
 * Alert dla zespołu przy sporze. Spór wymaga ludzkiej reakcji (dowody dla
 * banku w terminie), więc zostawia ślad w panelu - ale WYŁĄCZNIE u
 * administratorów najemcy, którego spór dotyczy.
 *
 * KAŻDA FAZA, PRZED SKUTKIEM. Otwarcie, wygrana i przegrana alarmują
 * niezależnie od tego, czy znaleźliśmy uprawnienie do odebrania albo
 * przywrócenia - termin na dowody biegnie także wtedy, gdy u nas nie było już
 * czego odbierać. Wcześniej alert stał ZA bramką odbierania dostępu, a ta nie
 * znała statusów Stripe, więc spory nie alarmowały nikogo.
 *
 * DLACZEGO NIE `user_roles` CAŁEGO WDROŻENIA. Wcześniejsza wersja wybierała
 * każdego z rolą `admin`, bez warunku najemcy, i wstawiała mu dzwonek
 * z identyfikatorem cudzej transakcji (audyt wyd. 12, 16.8: „alert o sporze
 * najemcy A trafia do administratorów wszystkich najemców"). Odbiorców
 * zawęża teraz `notifyTenantAdmins` - rola W TYM najemcy i profil w tym
 * najemcy, każdy dzwonek przez `enqueue_notification`.
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
): Promise<void> {
  const phase = disputePhase(event);
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
    typeof metadata.event_id === "string" &&
    typeof metadata.registration_id === "string" &&
    metadata.registration_id.length > 0;
  const copy = disputeAlertCopy(
    phase,
    ref,
    event.providerStatus ? ` (${event.providerStatus})` : "",
    registrationNeedsReview
      ? {
          pl: " Zgłoszenie na wydarzenie wymaga decyzji organizatora.",
          en: " The event registration needs an organiser decision.",
        }
      : { pl: "", en: "" },
  );
  const { notifyTenantAdmins } = await import("@/lib/events/tenantAdminAlert.server");
  await notifyTenantAdmins({
    tenantId,
    kind: "billing",
    ...copy,
    href: "/admin/billing",
    icon: "credit-card",
  });
}

/**
 * Przywrócenie dostępu po wygranym sporze. Odwraca dokładnie to, co zrobiło
 * odebranie: status źródła płatności wraca na opłacony, a uprawnienie jest
 * nadawane ponownie na tych samych zasadach co przy pierwotnym zakupie.
 */
async function restoreAccess(event: RefundEvent, target: AdjustmentTarget): Promise<RefundOutcome> {
  const supabase = await admin();
  const nowIso = new Date().toISOString();

  if (target.kind === "subscription") {
    const subscriptionId = target.subscriptionId;
    const { data: sub, error } = await supabase
      .from("subscriptions")
      .select("user_id, tenant_id, price_id, status, current_period_end")
      .eq("provider_subscription_id", subscriptionId)
      .eq("environment", event.environment)
      .maybeSingle();
    if (error) throw new Error(`dispute: subscription lookup failed: ${error.message}`);
    if (!sub?.user_id || !sub.price_id) return "skipped";

    const { resolvePlanForPrice } = await import("@/lib/billing/purchaseEffects.server");
    const plan = await resolvePlanForPrice(sub.price_id, {
      tenantId: sub.tenant_id,
      userId: sub.user_id,
    });
    if (plan) {
      const { syncEntitlementState } = await import("@/lib/billing/entitlementSync.server");
      await syncEntitlementState({
        userId: sub.user_id,
        tenantId: plan.tenantId,
        planId: plan.planId,
        externalRef: subscriptionId,
        status: sub.status ?? "active",
        periodEnd: sub.current_period_end ?? null,
      });
    }
    return "subscription_restored";
  }

  // TA SAMA funkcja wyszukująca co przy odbieraniu dostępu - inaczej zamówienie
  // zapisane identyfikatorem sesji checkout jest znajdowane przy zwrocie
  // i niewidoczne przy przywracaniu (spór wygrany, a klient bezpowrotnie bez
  // dostępu i bez żadnego sygnału, bo wynikiem jest wtedy `skipped`).
  if (target.kind !== "order") return "skipped";
  const order = target.order;

  const { error: flipErr } = await supabase
    .from("payment_orders")
    .update({ status: "paid", updated_at: nowIso })
    .eq("id", order.id);
  if (flipErr) throw new Error(`dispute: order status flip failed: ${flipErr.message}`);

  // Ten sam klucz, pod którym nadała je realizacja (identyfikator transakcji
  // zapisany jako `provider_intent_id`) - odświeżenie wiersza zamiast
  // drugiego wiersza pod kluczem intencji płatności.
  const { grantEntitlement } = await import("@/lib/billing/grant.server");
  await grantEntitlement(order, order.provider_intent_id ?? event.transactionId);

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
  return "order_restored";
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
 * Jedno wejście dla zwrotów i sporów. Kolejność:
 *   0. zwrot, który nie doszedł -> eskalacja zlecenia zwrotu (INV-19c);
 *   1. bramka: korekta, która niczego nie odbiera ani nie przywraca (kredyt,
 *      wniosek o zwrot) i nie jest sporem, kończy się bez dotykania bazy;
 *   2. cel korekty - RAZ (zamówienie / subskrypcja przez operatora / sesja
 *      Checkout / nic);
 *   3. spór: alert dla zespołu najemcy w każdej fazie, przed skutkiem;
 *   4. skutek: wygrany spór -> przywrócenie; zwrot/spór -> odebranie dostępu
 *      (subskrypcja -> zamówienie -> darowizna).
 *
 * Zdarzenie kopiujemy na wejściu: cel, alert i skutek mają widzieć TE SAME
 * identyfikatory, nawet gdy wołający zmieni swój obiekt w trakcie.
 */
export async function applyRefundEffects(input: RefundEvent): Promise<RefundOutcome> {
  const event: RefundEvent = { ...input };
  // Zwrot, który nie doszedł (INV-19c): pieniądze zostały u nas - eskalacja
  // zlecenia zwrotu, bez odbierania i przywracania dostępu.
  if (isFailedRefund(event)) return escalateFailedRefund(event);
  const dispute = isDispute(event);
  const reversed = isDisputeReversed(event);
  const revoking = !reversed && isRevokingAdjustment(event);
  if (!dispute && !revoking) return "skipped";

  const target = await resolveAdjustmentTarget(event, reversed ? "dispute" : "refund");
  if (dispute) await alertAdminsAboutDispute(event, target, await disputeTenant(event, target));

  if (reversed) return restoreAccess(event, target);
  if (!revoking) return "skipped";
  if (target.kind === "subscription") return revokeSubscription(event, target.subscriptionId);
  if (target.kind === "order") return revokeOrder(event, target.order, target.persistIntent);
  if (event.transactionId && PROVIDER_REFERENCE_SHAPE.test(event.transactionId)) {
    return revokeDonation(event, event.transactionId);
  }
  console.warn("[payments] adjustment without transaction or subscription", event.adjustmentId);
  return "skipped";
}
