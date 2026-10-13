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
  /**
   * Status korekty u operatora. Paddle: `approved` / `pending_approval` /
   * `rejected` / `reversed`. Stripe: zwrot - status obiektu Refund
   * (`succeeded`, ...), spór - surowy `Dispute.status` (`STRIPE_DISPUTE_*`).
   */
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
 * Statusy sporu Stripe (`Dispute.status`), które normalizacja
 * (`stripeEvents.server`: `charge.dispute.created` i `charge.dispute.closed`)
 * przekazuje BEZ tłumaczenia - o skutku decyduje to jedno miejsce, wspólne dla
 * zamówień, subskrypcji i darowizn.
 *
 * Wcześniej spór przechodził wyłącznie przy statusie `null` / `approved` /
 * `succeeded` (słownik Paddle), których Stripe dla sporu nigdy nie wysyła -
 * każdy prawdziwy `charge.dispute.created` kończył się `skipped`, a wygrana
 * (`won`) nie miała żadnej drogi do przywrócenia (przegląd adwersaryjny,
 * poz. 26).
 *
 *  - FORMALNY SPÓR: środki są pobrane z konta serwisu od otwarcia
 *    (`needs_response`, `under_review`) do przegranej (`lost`) - odbieramy.
 *  - ZAPYTANIE banku (`warning_needs_response`, `warning_under_review`,
 *    `warning_closed`): pieniądze NIE zostały pobrane - nie odbieramy.
 *  - `prevented`: spór zablokowany przed powstaniem - nic się nie stało.
 *  - `won`: rozstrzygnięty na naszą korzyść - dostęp wraca.
 */
const STRIPE_DISPUTE_REVOKING: ReadonlySet<string> = new Set([
  "needs_response",
  "under_review",
  "lost",
]);
const STRIPE_DISPUTE_NON_REVOKING: ReadonlySet<string> = new Set([
  "warning_needs_response",
  "warning_under_review",
  "warning_closed",
  "prevented",
  "won",
]);
const STRIPE_DISPUTE_WON = "won";
/** Spór rozstrzygnięty na niekorzyść - dostęp zniknął już przy otwarciu. */
const STRIPE_DISPUTE_LOST = "lost";

/**
 * Korekty, które odbierają dostęp.
 *
 * Spór (`chargeback_warning`) liczy się od chwili otwarcia: bank już wycofuje
 * środki, a rozstrzygnięcie trwa tygodniami. Trzymanie dostępu przez ten czas
 * oznaczałoby darmową treść na koszt serwisu - dlatego odbieramy od razu i
 * przywracamy, gdy spór zostanie wygrany (`reversed` / Stripe `won`).
 */
export function isRevokingAdjustment(event: RefundEvent): boolean {
  if (event.action === "credit" || event.action === "other") return false;
  if (event.action === "chargeback_warning") {
    return event.status !== "reversed" && event.status !== "rejected";
  }
  if (event.action === "chargeback" && event.status !== null) {
    if (STRIPE_DISPUTE_REVOKING.has(event.status)) return true;
    if (STRIPE_DISPUTE_NON_REVOKING.has(event.status)) return false;
  }
  // `pending_approval` to dopiero wniosek - dostęp odbieramy po zatwierdzeniu.
  // `reversed` / `rejected` oznaczają, że zwrot nie doszedł do skutku.
  // `succeeded` to potwierdzenie zwrotu u operatora kart - równoważne
  // zatwierdzeniu; bez niego zwrot cicho nie odbierałby dostępu.
  return event.status === null || event.status === "approved" || event.status === "succeeded";
}

/**
 * Zwrot, którego operator NIE wykonał (`refund.failed`, `refund.updated`
 * ze stanem `failed`/`canceled`). Pieniądze zostały u nas, więc niczego nie
 * odbieramy ani nie przywracamy - sprawę trzeba oddać człowiekowi.
 */
export function isFailedRefund(event: RefundEvent): boolean {
  return event.action === "refund" && (event.status === "failed" || event.status === "canceled");
}

/** Spór rozstrzygnięty na naszą korzyść - dostęp wraca (Paddle `reversed`, Stripe `won`). */
export function isDisputeReversed(event: RefundEvent): boolean {
  if (event.action !== "chargeback" && event.action !== "chargeback_warning") return false;
  return (
    event.status === "reversed" ||
    (event.action === "chargeback" && event.status === STRIPE_DISPUTE_WON)
  );
}

/** Mapuje akcję operatora na czytelny powód w dzienniku i CRM. */
function reasonLabel(action: AdjustmentAction): string {
  return action === "chargeback" ? "chargeback" : "refund";
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
 * powtórki w `revokeOrder`).
 */
const ORDER_LOOKUP_COLUMNS =
  "id, user_id, tenant_id, plan_id, kind, entity_type, entity_id, metadata, amount_cents, refunded_amount_cents, currency, status";

/** Zamówienie w kształcie czytanym przez korektę - typ z wygenerowanych definicji bazy. */
type AdjustmentOrder = Pick<
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
>;

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

/** Odbiera uprawnienie subskrypcyjne powiązane z subskrypcją operatora. */
async function revokeSubscription(event: RefundEvent): Promise<RefundOutcome> {
  const supabase = await admin();
  const subscriptionId = event.subscriptionId;
  if (!subscriptionId) return "skipped";

  const nowIso = new Date().toISOString();

  const { data: sub, error: subErr } = await supabase
    .from("subscriptions")
    .select("user_id, tenant_id, price_id")
    .eq("provider_subscription_id", subscriptionId)
    .eq("environment", event.environment)
    .maybeSingle();
  if (subErr) throw new Error(`refund: subscription lookup failed: ${subErr.message}`);

  const { revokeSubscriptionEntitlement } = await import("@/lib/billing/grant.server");
  const revoked = await revokeSubscriptionEntitlement(subscriptionId, nowIso);

  if (!sub?.user_id) return revoked ? "subscription_refunded" : "skipped";

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

/** Odbiera uprawnienie zakupu jednorazowego (odblokowanie treści, bilet). */
async function revokeOrder(event: RefundEvent): Promise<RefundOutcome> {
  const supabase = await admin();
  const txnId = event.transactionId;
  if (!txnId) return "skipped";

  const nowIso = new Date().toISOString();

  // Kształt identyfikatora bramkujemy PRZED zapytaniem - patrz
  // `PROVIDER_REFERENCE_SHAPE`. Obcy kształt kończy korektę bez dotykania bazy.
  if (!PROVIDER_REFERENCE_SHAPE.test(txnId)) return "skipped";

  const order = await findOrderForAdjustment(event, "refund");
  if (!order) return await revokeDonation(event);

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
  if (!changedRow && settledBefore && bringsNoMoney) return "skipped";

  const metadata = (order.metadata ?? {}) as Record<string, unknown>;
  const eventId = typeof metadata.event_id === "string" ? metadata.event_id : null;
  const { applyTicketOutcome } = await import("@/lib/billing/oneTimeFulfilment.server");

  if (isPartial) {
    // Korekta ceny, nie rezygnacja: uprawnienie i miejsce zostają, zmienia się
    // tylko rozliczenie - baza przeliczy status i wyśle powiadomienie.
    if (eventId) await applyTicketOutcome(order.id, "partial_refund", refundedSoFar);
    return "order_refunded";
  }

  const { revokeOrderEntitlement } = await import("@/lib/billing/grant.server");
  await revokeOrderEntitlement(order, nowIso);

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

/** Kolumny darowizny czytane przez korektę (zwrot, spór, wygrany spór). */
const DONATION_LOOKUP_COLUMNS = "id, tenant_id, amount_cents, refunded_amount_cents, status";

type AdjustmentDonation = Pick<
  Tables<"donations">,
  "id" | "tenant_id" | "amount_cents" | "refunded_amount_cents" | "status"
>;

/**
 * Powiązania intencji płatności po stronie operatora: faktura, którą opłaciła
 * (rata darowizny cyklicznej), i sesja checkout, z której powstała (wpłata
 * jednorazowa). Webhook faktury w API Basil NIE niesie intencji, a wiersze
 * jednorazowe sprzed 20261012 trzymały w `provider_intent_id` sesję - bez tego
 * mostu zwrot żadnej z tych wpłat nie trafiał w darowiznę (audyt SUB-09).
 * Błąd operatora RZUCA: korekta wraca do ponowienia zamiast udawać „nie nasze".
 */
async function operatorRefsForIntent(
  environment: RefundEvent["environment"],
  intentId: string,
): Promise<{ invoiceId: string | null; sessionId: string | null }> {
  const { getStripeClient, getStripeErrorMessage } = await import("@/lib/stripe.server");
  try {
    const stripe = await getStripeClient(environment);
    const [payments, sessions] = await Promise.all([
      stripe.invoicePayments.list({
        payment: { type: "payment_intent", payment_intent: intentId },
        limit: 1,
      }),
      stripe.checkout.sessions.list({ payment_intent: intentId, limit: 1 }),
    ]);
    const invoice = payments.data[0]?.invoice;
    return {
      invoiceId: typeof invoice === "string" ? invoice : (invoice?.id ?? null),
      sessionId: sessions.data[0]?.id ?? null,
    };
  } catch (error) {
    throw new Error(`refund: operator lookup failed: ${getStripeErrorMessage(error)}`);
  }
}

/** Identyfikator wiersza darowizny z metadanych operatora (uuid) - bramka przed zapytaniem. */
const DONATION_ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Czy faktura operatora to RATA NASZEJ DAROWIZNY CYKLICZNEJ, której księga
 * jeszcze nie zna (przegląd adwersaryjny, poz. 25).
 *
 * Kolejność zdarzeń, której wcześniej nic nie łapało: `invoice.paid` raty
 * pada (np. chwilowe 500) i czeka na ponowienie operatora, a w tym czasie
 * ratę zwrócono. `charge.refunded` nie znajdował wiersza - kotwica nie ma
 * jeszcze ani intencji, ani faktury, a sesja checkout w trybie subskrypcji
 * ma `payment_intent = null`, więc most sesji też milczy - i kończył się
 * `skipped`, czyli „przetworzony" bez ponowienia. Ponowione `invoice.paid`
 * księgowało potem ratę jako opłaconą: zwrócone pieniądze w statystykach,
 * eksporcie i w przedłużonym statusie wspierającego.
 *
 * Ratę rozpoznaje TA SAMA normalizacja, którą faktura przejdzie przy
 * księgowaniu (`normalizeStripeEvent` dla `invoice.paid` - te same zapasowe
 * pola API Basil), plus DOWÓD LOKALNY: wiersz darowizny tej subskrypcji albo
 * kotwica z `metadata.donationId`, oba w środowisku korekty. Bez dowodu
 * lokalnego faktura nie jest „nasza" (wspólne konto operatora, inne
 * wdrożenie) i korekta nie może wisieć w ponowieniach. Faktura bez
 * subskrypcji nie jest ratą.
 */
async function isUnbookedDonationInstallment(
  environment: RefundEvent["environment"],
  invoiceId: string,
): Promise<boolean> {
  const { getStripeClient, getStripeErrorMessage } = await import("@/lib/stripe.server");
  let invoice: Record<string, unknown>;
  try {
    const stripe = await getStripeClient(environment);
    invoice = (await stripe.invoices.retrieve(invoiceId)) as unknown as Record<string, unknown>;
  } catch (error) {
    throw new Error(`refund: operator lookup failed: ${getStripeErrorMessage(error)}`);
  }
  const { normalizeStripeEvent } = await import("@/lib/billing/stripeEvents.server");
  const normalized = normalizeStripeEvent({
    id: `refund-bridge:${invoiceId}`,
    type: "invoice.paid",
    created: 0,
    data: { object: invoice },
  });
  const tx = (normalized?.data ?? null) as {
    subscriptionId?: unknown;
    customData?: Record<string, unknown> | null;
  } | null;
  const subscriptionId = typeof tx?.subscriptionId === "string" ? tx.subscriptionId : null;
  if (!subscriptionId || !PROVIDER_REFERENCE_SHAPE.test(subscriptionId)) return false;

  const supabase = await admin();
  const bySubscription = await supabase
    .from("donations")
    .select("id")
    .eq("provider_subscription_id", subscriptionId)
    .eq("environment", environment)
    .limit(1);
  if (bySubscription.error) {
    throw new Error(`refund: donation lookup failed: ${bySubscription.error.message}`);
  }
  if ((bySubscription.data ?? []).length > 0) return true;

  // Kotwica bez powiązanej subskrypcji (zawiodły też zdarzenia, które ją
  // wiążą) - rozpoznawalna wyłącznie po metadanych subskrypcji darowizny.
  const custom = tx?.customData ?? null;
  const donationId = custom?.purpose === "donation" ? custom.donationId : null;
  if (typeof donationId !== "string" || !DONATION_ID_SHAPE.test(donationId)) return false;
  const byAnchor = await supabase
    .from("donations")
    .select("id")
    .eq("id", donationId)
    .eq("environment", environment)
    .limit(1);
  if (byAnchor.error) throw new Error(`refund: donation lookup failed: ${byAnchor.error.message}`);
  return (byAnchor.data ?? []).length > 0;
}

async function donationBy(
  column: "provider_intent_id" | "provider_invoice_id" | "provider_session_id",
  value: string,
  environment: RefundEvent["environment"],
): Promise<AdjustmentDonation | null> {
  const supabase = await admin();
  const { data, error } = await supabase
    .from("donations")
    .select(DONATION_LOOKUP_COLUMNS)
    .eq(column, value)
    .eq("environment", environment)
    .limit(1);
  if (error) throw new Error(`refund: donation lookup failed: ${error.message}`);
  return (data?.[0] as AdjustmentDonation | undefined) ?? null;
}

async function lookupDonationForAdjustment(event: RefundEvent): Promise<AdjustmentDonation | null> {
  const txnId = event.transactionId;
  if (!txnId || !PROVIDER_REFERENCE_SHAPE.test(txnId)) return null;

  const direct = await donationBy("provider_intent_id", txnId, event.environment);
  if (direct || !txnId.startsWith("pi_")) return direct;

  const refs = await operatorRefsForIntent(event.environment, txnId);
  if (refs.invoiceId && PROVIDER_REFERENCE_SHAPE.test(refs.invoiceId)) {
    const byInvoice = await donationBy("provider_invoice_id", refs.invoiceId, event.environment);
    if (byInvoice) return byInvoice;
    // Rata naszej darowizny, której faktura jeszcze się nie zaksięgowała:
    // WYJĄTEK, nie `null`. Dziennik zapisze `failed`, operator ponowi
    // `charge.refunded` w tym samym oknie co `invoice.paid`, a po
    // zaksięgowaniu raty ponowienie trafi w nią zwykłą regułą zwrotu
    // (pełny -> `refunded`, częściowy -> licznik). Oznaczenie oczekującej
    // kotwicy jako zwróconej nie wystarcza: księgowanie widzi wtedy kotwicę
    // „nie pending" i dopisuje świeży opłacony wiersz `renewal:in_...`.
    if (await isUnbookedDonationInstallment(event.environment, refs.invoiceId)) {
      throw new Error(`refund: donation installment ${refs.invoiceId} not booked yet - retry`);
    }
  }
  if (refs.sessionId && PROVIDER_REFERENCE_SHAPE.test(refs.sessionId)) {
    return donationBy("provider_session_id", refs.sessionId, event.environment);
  }
  return null;
}

/**
 * Jedno wyszukanie darowizny na JEDNO zdarzenie korekty. Alert o sporze
 * (`disputeTenant`) i odebranie (`revokeDonation`) pytają o ten sam wiersz -
 * bez pamięci każdy z nich płaciłby osobno za dwa zapytania do operatora.
 */
const donationLookups = new WeakMap<RefundEvent, Promise<AdjustmentDonation | null>>();

/**
 * Darowizna wskazana przez korektę - JEDNO miejsce dla zwrotu, sporu
 * i wygranego sporu (ta sama lekcja co `findOrderForAdjustment`).
 *
 * Kolejność: intencja wprost (wpłata jednorazowa od 20261012), potem most
 * u operatora - faktura (raty cykliczne, `provider_invoice_id`) i sesja
 * (wpłaty jednorazowe sprzed poprawki, `provider_session_id`). Każde zapytanie
 * wiąże ŚRODOWISKO korekty (20260831140000): zdarzenie z piaskownicy nie
 * zamknie wpłaty produkcyjnej.
 */
function findDonationForAdjustment(event: RefundEvent): Promise<AdjustmentDonation | null> {
  let lookup = donationLookups.get(event);
  if (!lookup) {
    lookup = lookupDonationForAdjustment(event);
    donationLookups.set(event, lookup);
  }
  return lookup;
}

/**
 * Zwrot / obciążenie zwrotne darowizny - bez uprawnień, ale status musi się
 * zgadzać z księgami, a status wspierającego zniknąć razem z pieniędzmi.
 *
 * ZWROT CZĘŚCIOWY jak w `revokeOrder`: `amount_refunded` od operatora jest
 * narastający, zapis zaciśnięty do kwoty wpłaty, a status `refunded` dopiero
 * przy pełnym zwrocie - częściowy zostawia wpłatę opłaconą (statystyki liczą
 * kwotę netto), więc nie odbiera statusu wspierającego. Licznik tylko rośnie
 * (`refunded_amount_cents < nowa wartość`): spóźnione zdarzenie z mniejszą
 * sumą nie cofa zapisu.
 *
 * SPÓR nie jest zwrotem: wpłata przestaje się liczyć od otwarcia sporu (status
 * `refunded`), ale licznik zwrotów zostaje nietknięty - wygrany spór
 * (`restoreDonation`) przywraca ją bez zgadywania, ile „oddano".
 *
 * Cofnięcie statusu wspierającego robi baza: `tg_donations_grant_supporter`
 * (20261013090000) przelicza przydział z pozostałych opłaconych wpłat
 * i odbiera go, gdy żadna go już nie uzasadnia.
 */
async function revokeDonation(event: RefundEvent): Promise<RefundOutcome> {
  const donation = await findDonationForAdjustment(event);
  if (!donation) return "skipped";
  const supabase = await admin();

  if (event.action !== "refund") {
    const { data, error } = await supabase
      .from("donations")
      .update({ status: "refunded" })
      .eq("id", donation.id)
      .eq("environment", event.environment)
      .neq("status", "refunded")
      .select("id");
    if (error) throw new Error(`refund: donation status flip failed: ${error.message}`);
    return data && data.length > 0 ? "donation_refunded" : "skipped";
  }

  const captured = event.capturedAmountCents ?? donation.amount_cents ?? null;
  const knownCaptured = typeof captured === "number" && captured > 0;
  const reported = Math.max(donation.refunded_amount_cents ?? 0, event.amountCents ?? 0);
  const refundedSoFar = knownCaptured && reported > captured ? captured : reported;
  const isPartial = knownCaptured && refundedSoFar > 0 && refundedSoFar < captured;

  let flip = supabase
    .from("donations")
    .update({
      ...(isPartial ? {} : { status: "refunded" }),
      refunded_amount_cents: refundedSoFar,
    })
    .eq("id", donation.id)
    .eq("environment", event.environment)
    .neq("status", "refunded");
  if (isPartial) flip = flip.lt("refunded_amount_cents", refundedSoFar);
  const { data, error } = await flip.select("id");
  if (error) throw new Error(`refund: donation status flip failed: ${error.message}`);
  return data && data.length > 0 ? "donation_refunded" : "skipped";
}

/**
 * Zwrot darowizny stwierdzony POZA webhookiem (uzgodnienie w panelu,
 * `donationsAdmin.server`) - ta sama reguła zwrotu częściowego i ten sam zapis
 * co `charge.refunded`, bez przechodzenia przez ścieżkę zamówień.
 */
export async function applyDonationRefundEffects(event: RefundEvent): Promise<RefundOutcome> {
  if (!isRevokingAdjustment(event)) return "skipped";
  return revokeDonation(event);
}

/**
 * Wygrany spór o darowiznę - wpłata wraca do ksiąg (a trigger przywraca status
 * wspierającego). Przywracamy WYŁĄCZNIE wiersz zamknięty sporem: pełny zwrot
 * (`refunded_amount_cents` >= kwota) to pieniądze oddane darczyńcy i wygrany
 * spór niczego w tym nie zmienia.
 */
async function restoreDonation(event: RefundEvent): Promise<RefundOutcome> {
  const donation = await findDonationForAdjustment(event);
  if (!donation || donation.status !== "refunded") return "skipped";
  if ((donation.refunded_amount_cents ?? 0) >= donation.amount_cents) return "skipped";

  const supabase = await admin();
  const { data, error } = await supabase
    .from("donations")
    .update({ status: "paid" })
    .eq("id", donation.id)
    .eq("environment", event.environment)
    .eq("status", "refunded")
    .select("id");
  if (error) throw new Error(`dispute: donation restore failed: ${error.message}`);
  if (!data || data.length === 0) return "skipped";
  await alertAdminsAboutDispute(event, "won", donation.tenant_id);
  return "donation_restored";
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
async function disputeTenant(event: RefundEvent): Promise<string | null> {
  try {
    const supabase = await admin();
    if (event.subscriptionId) {
      const { data } = await supabase
        .from("subscriptions")
        .select("tenant_id")
        .eq("provider_subscription_id", event.subscriptionId)
        .eq("environment", event.environment)
        .maybeSingle();
      if (data) return data.tenant_id;
    }
    const txnId = event.transactionId;
    if (!txnId || !PROVIDER_REFERENCE_SHAPE.test(txnId)) return null;
    const order = await findOrderForAdjustment(event, "dispute");
    if (order) return order.tenant_id;
    const { data: donation } = await supabase
      .from("donations")
      .select("tenant_id")
      .eq("provider_intent_id", txnId)
      .eq("environment", event.environment)
      .limit(1)
      .maybeSingle();
    if (donation) return donation.tenant_id;
    // Rata cykliczna i wpłata sprzed 20261012 nie mają intencji w wierszu -
    // ten sam most u operatora co przy odebraniu (wynik jest zapamiętany).
    return (await findDonationForAdjustment(event))?.tenant_id ?? null;
  } catch (err) {
    console.error("[payments] dispute tenant lookup failed", event.adjustmentId, err);
    return null;
  }
}

/**
 * Alert dla zespołu przy sporze. Spór wymaga ludzkiej reakcji (dowody dla
 * banku w terminie), więc zostawia ślad w panelu - ale WYŁĄCZNIE u
 * administratorów najemcy, którego spór dotyczy.
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
  phase: "opened" | "won",
  tenantId: string | null,
  options: { registrationNeedsReview?: boolean } = {},
): Promise<void> {
  const ref = event.transactionId ?? event.subscriptionId ?? event.adjustmentId;
  if (!tenantId) {
    console.error("[payments] dispute without resolvable tenant - no admin alert", {
      adjustmentId: event.adjustmentId,
      phase,
    });
    return;
  }
  // Zgłoszenie odwołane przy otwarciu sporu baza zwolniła do puli (i mogła
  // oddać miejsce komuś z listy rezerwowej) - wygrany spór nie ma prawa go po
  // cichu wskrzesić, więc decyzja zostaje u organizatora.
  const reviewPl = options.registrationNeedsReview
    ? " Zgłoszenie na wydarzenie wymaga decyzji organizatora."
    : "";
  const reviewEn = options.registrationNeedsReview
    ? " The event registration needs an organiser decision."
    : "";
  const { notifyTenantAdmins } = await import("@/lib/events/tenantAdminAlert.server");
  await notifyTenantAdmins({
    tenantId,
    kind: "billing",
    titlePl: phase === "opened" ? "Otwarto spór płatniczy" : "Spór płatniczy rozstrzygnięty",
    titleEn: phase === "opened" ? "Payment dispute opened" : "Payment dispute resolved",
    bodyPl:
      phase === "opened"
        ? `Bank otworzył spór dla ${ref}. Dostęp klienta został wstrzymany - przygotuj dowody.`
        : `Spór dla ${ref} rozstrzygnięto na naszą korzyść. Dostęp klienta przywrócono.${reviewPl}`,
    bodyEn:
      phase === "opened"
        ? `A dispute was opened for ${ref}. Customer access is suspended - prepare evidence.`
        : `The dispute for ${ref} was won. Customer access has been restored.${reviewEn}`,
    href: "/admin/billing",
    icon: "credit-card",
  });
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
      .select(
        "user_id, tenant_id, price_id, status, current_period_start, current_period_end, first_payment_failed_at",
      )
      .eq("provider_subscription_id", event.subscriptionId)
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
      const { accessPeriodFromEvent } = await import("@/lib/billing/accessPeriod");
      const status = sub.status ?? "active";
      await syncEntitlementState({
        userId: sub.user_id,
        tenantId: plan.tenantId,
        planId: plan.planId,
        externalRef: event.subscriptionId,
        status,
        // Ta sama reguła karencji co w webhooku (audyt SUB-03): zaległa
        // subskrypcja nie odzyskuje dostępu do końca nieopłaconego okresu.
        periodEnd: accessPeriodFromEvent({
          kind: "updated",
          storedPeriodEnd: sub.current_period_end ?? null,
          status,
          periodStart: sub.current_period_start ?? null,
          firstPaymentFailedAt: sub.first_payment_failed_at ?? null,
        }).accessUntil,
      });
    }
    await alertAdminsAboutDispute(event, "won", sub.tenant_id);
    return "subscription_restored";
  }

  if (!event.transactionId) return "skipped";

  // TA SAMA funkcja wyszukująca co przy odbieraniu dostępu - inaczej zamówienie
  // zapisane identyfikatorem sesji checkout jest znajdowane przy zwrocie
  // i niewidoczne przy przywracaniu (spór wygrany, a klient bezpowrotnie bez
  // dostępu i bez żadnego sygnału, bo wynikiem jest wtedy `skipped`).
  const order = await findOrderForAdjustment(event, "dispute");
  if (!order) return restoreDonation(event);

  const { error: flipErr } = await supabase
    .from("payment_orders")
    .update({ status: "paid", updated_at: nowIso })
    .eq("id", order.id);
  if (flipErr) throw new Error(`dispute: order status flip failed: ${flipErr.message}`);

  const { grantEntitlement } = await import("@/lib/billing/grant.server");
  await grantEntitlement(order, event.transactionId);

  const metadata = (order.metadata ?? {}) as Record<string, unknown>;
  const eventId = typeof metadata.event_id === "string" ? metadata.event_id : null;
  // TA SAMA REGUŁA CO PRZY ODBIERANIU (`revokeOrder`): RSVP dotykamy wyłącznie
  // na starszej ścieżce, BEZ `registration_id`. Zamówienie związane ze
  // zgłoszeniem oddało miejsce przez `payments_apply_event_ticket_outcome`
  // (pula, lista rezerwowa), więc bezwarunkowe `going` dawało link wejścia
  // osobie, której zgłoszenie jest odwołane, a miejsce mogło już przejść na
  // kogoś z kolejki. Decyzja o takim zgłoszeniu idzie do organizatora.
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

  await alertAdminsAboutDispute(event, "won", order.tenant_id, {
    registrationNeedsReview: Boolean(eventId) && boundToRegistration,
  });
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
 * Jedno wejście dla zwrotów i sporów. Kieruje korektę do właściwego skutku:
 * wygrany spór -> przywrócenie (zamówienie albo darowizna); zwrot, który nie
 * doszedł -> eskalacja; zwrot/spór otwarty -> odebranie dostępu (subskrypcja ->
 * zamówienie jednorazowe -> darowizna).
 */
export async function applyRefundEffects(event: RefundEvent): Promise<RefundOutcome> {
  if (isDisputeReversed(event)) return restoreAccess(event);
  if (isFailedRefund(event)) return escalateFailedRefund(event);
  if (!isRevokingAdjustment(event)) return "skipped";
  // Przegrany spór (`charge.dispute.closed`, `lost`) odbiera dostęp tak samo -
  // na wypadek, gdyby otwarcie nigdy nie dotarło - ale NIE jest otwarciem:
  // alert „przygotuj dowody" po zamknięciu sprawy byłby fałszywy.
  const opensDispute =
    (event.action === "chargeback" || event.action === "chargeback_warning") &&
    event.status !== STRIPE_DISPUTE_LOST;
  if (opensDispute) {
    await alertAdminsAboutDispute(event, "opened", await disputeTenant(event));
  }
  if (event.subscriptionId) return revokeSubscription(event);
  if (event.transactionId) return revokeOrder(event);
  console.warn("[payments] adjustment without transaction or subscription", event.adjustmentId);
  return "skipped";
}
