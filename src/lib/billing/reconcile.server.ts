// Uzgadnianie (rekoncyliacja) danych Stripe z naszą bazą.
//
// Webhook jest ścieżką podstawową, ale nie jest niezawodny: endpoint bywa
// niedostępny, zdarzenie może wpaść w `failed`, a po 3 dobach Stripe przestaje
// ponawiać. Ten moduł porównuje stan u operatora ze stanem lokalnym i - na
// wyraźne żądanie admina - odtwarza brakującą obsługę tą samą ścieżką co
// webhook (`normalizeStripeEvent` + `dispatchWebhookEvent`), więc jest w pełni
// idempotentny i nie duplikuje uprawnień ani maili.
//
// Trzy niezależne sondy:
//   1. `event`        - zdarzenie istnieje u Stripe, brak go w dzienniku (albo
//                       jest w stanie `failed`),
//   2. `order`        - zamówienie wisi w `pending`/`processing`, a sesja
//                       Stripe jest opłacona,
//   3. `subscription` - status subskrypcji w bazie różni się od Stripe.
//
// Moduł server-only (klucze bramki + service_role).
import type Stripe from "stripe";
import { getStripeClient, type StripeEnv, type VerifiedWebhookEvent } from "@/lib/stripe.server";

/** Typy zdarzeń, które nasza integracja umie obsłużyć (reszta jest ignorowana). */
const SUPPORTED_EVENT_TYPES = [
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.resumed",
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "invoice.paid",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
  "charge.refunded",
  "charge.dispute.created",
  "credit_note.created",
  "customer.updated",
] as const;

export type ReconcileKind = "event" | "order" | "subscription";

export interface ReconcileIssue {
  kind: ReconcileKind;
  /** Klucz techniczny - identyfikator zdarzenia, zamówienia albo subskrypcji. */
  reference: string;
  /** Identyfikator zdarzenia Stripe użyty przy naprawie (jeśli znany). */
  eventId: string | null;
  eventType: string | null;
  /** Kod powodu - tłumaczony w UI (`adminReconcile.reasons.*`). */
  reason: string;
  detail: string | null;
  occurredAt: string | null;
  /** Czy ta rozbieżność da się naprawić automatycznie. */
  repairable: boolean;
}

export interface ReconcileReport {
  environment: StripeEnv;
  sinceIso: string;
  /** Zdarzenia operatora PRZYPISANE do tego najemcy - reszta konta go nie dotyczy. */
  scannedEvents: number;
  scannedOrders: number;
  scannedSubscriptions: number;
  issues: ReconcileIssue[];
  /** Ostrzeżenia niedotyczące pojedynczej pozycji (np. limit stronicowania). */
  warnings: string[];
}

export interface RepairOutcome {
  reference: string;
  status: "processed" | "skipped" | "failed";
  error: string | null;
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function isoOf(unixSeconds: number | null | undefined): string | null {
  return typeof unixSeconds === "number" ? new Date(unixSeconds * 1000).toISOString() : null;
}

/** Pobiera zdarzenia Stripe od podanego znacznika czasu (maks. 3 strony po 100). */
async function listStripeEvents(
  stripe: Stripe,
  sinceUnix: number,
): Promise<{ events: Stripe.Event[]; truncated: boolean }> {
  const events: Stripe.Event[] = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < 3; page += 1) {
    const res: Stripe.ApiList<Stripe.Event> = await stripe.events.list({
      limit: 100,
      created: { gte: sinceUnix },
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    events.push(...res.data);
    if (!res.has_more || res.data.length === 0) return { events, truncated: false };
    startingAfter = res.data[res.data.length - 1]?.id;
  }
  return { events, truncated: true };
}

/**
 * Buduje raport rozbieżności. Operacja wyłącznie odczytowa - niczego nie
 * zmienia ani u Stripe, ani w bazie.
 *
 * `tenantId` jest parametrem WYMAGANYM i pochodzi z bramki
 * `assertAdminWithTenant` (tożsamość wołającego), nigdy z ładunku klienta ani
 * z hosta żądania. Wszystkie trzy sondy czytają spod `service_role`, czyli
 * z pominięciem RLS - bez jawnego filtra raport rozbieżności jednego obszaru
 * roboczego wypisywał `event_id`, identyfikatory zamówień i subskrypcji
 * pozostałych, a każda taka pozycja niosła gotowy przycisk „Napraw".
 */
export async function buildReconcileReport(
  environment: StripeEnv,
  sinceHours: number,
  tenantId: string,
): Promise<ReconcileReport> {
  const hours = Math.min(Math.max(Math.round(sinceHours), 1), 24 * 30);
  const sinceMs = Date.now() - hours * 3600_000;
  const sinceIso = new Date(sinceMs).toISOString();
  const stripe = await getStripeClient(environment);
  const supabase = await admin();
  const issues: ReconcileIssue[] = [];
  const warnings: string[] = [];

  // 1. Zdarzenia u Stripe kontra dziennik `payment_webhook_events`.
  const { events, truncated } = await listStripeEvents(stripe, Math.floor(sinceMs / 1000));
  if (truncated) warnings.push("events_truncated");
  const supported = events.filter((e) =>
    (SUPPORTED_EVENT_TYPES as readonly string[]).includes(e.type),
  );

  const { data: loggedRows, error: logErr } = await supabase
    .from("payment_webhook_events")
    .select("event_id, status")
    .eq("tenant_id", tenantId)
    .eq("environment", environment)
    .gte("created_at", sinceIso);
  if (logErr) throw new Error(`nie udało się odczytać dziennika zdarzeń: ${logErr.message}`);
  const logged = new Map((loggedRows ?? []).map((r) => [r.event_id, r.status]));

  // `events.list` czyta CAŁE konto operatora - jedno konto Stripe obsługuje
  // wiele obszarów roboczych - a dziennik wyżej jest już zawężony do najemcy.
  // Samo porównanie tych dwóch zbiorów robiło więc z KAŻDEGO poprawnie
  // obsłużonego zdarzenia cudzego obszaru pozycję `event_missing`: identyfikator
  // i typ zdarzenia na widoku obcego admina, przycisk „Napraw" obok, a właściwy
  // rozjazd utopiony w fałszywych alarmach. Zdarzenie spoza dziennika musi więc
  // najpierw dać się PRZYPISAĆ do naszych wierszy po identyfikatorach operatora.
  const refsByEvent = new Map<string, TenantRefs>();
  for (const event of supported) {
    if (logged.has(event.id)) continue;
    const object: unknown = event.data?.object;
    if (object && typeof object === "object") {
      refsByEvent.set(event.id, refsOfStripeObject(object as Record<string, unknown>));
    }
  }
  const ownedValues = await collectOwnedRefValues(environment, tenantId, [...refsByEvent.values()]);

  let scannedEvents = 0;
  for (const event of supported) {
    const status = logged.get(event.id);
    // Trzy kategorie, nie dwie: wpis w dzienniku najemcy przesądza, że zdarzenie
    // jest nasze; poza dziennikiem rozstrzyga dopasowanie identyfikatorów.
    // Kategoria trzecia - NIEROZSTRZYGNIĘTE - nie jest rozjazdem tego najemcy,
    // więc nie wchodzi ani do licznika, ani do raportu.
    const refs = refsByEvent.get(event.id);
    const ours =
      status !== undefined ||
      (refs !== undefined && refValues(refs).some((v) => ownedValues.has(v)));
    if (!ours) continue;
    scannedEvents += 1;
    if (status === "processed" || status === "skipped") continue;
    issues.push({
      kind: "event",
      reference: event.id,
      eventId: event.id,
      eventType: event.type,
      reason: status ? `event_${status}` : "event_missing",
      detail: null,
      occurredAt: isoOf(event.created),
      repairable: true,
    });
  }

  // 2. Zamówienia wiszące mimo opłaconej sesji. Świeże (< 15 min) pomijamy -
  //    tam webhook zwyczajnie jeszcze nie dotarł.
  const graceIso = new Date(Date.now() - 15 * 60_000).toISOString();
  const { data: orders, error: orderErr } = await supabase
    .from("payment_orders")
    .select("id, status, provider_session_id, created_at")
    .eq("tenant_id", tenantId)
    .eq("environment", environment)
    .eq("provider", "stripe")
    .in("status", ["pending", "processing"])
    .gte("created_at", sinceIso)
    .lte("created_at", graceIso)
    .not("provider_session_id", "is", null)
    .limit(200);
  if (orderErr) throw new Error(`nie udało się odczytać zamówień: ${orderErr.message}`);

  for (const order of orders ?? []) {
    const sessionId = order.provider_session_id;
    if (!sessionId) continue;
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (session.payment_status === "unpaid") continue;
      issues.push({
        kind: "order",
        reference: order.id,
        eventId: null,
        eventType: "checkout.session.completed",
        reason: "order_paid_not_fulfilled",
        detail: sessionId,
        occurredAt: order.created_at,
        repairable: true,
      });
    } catch (err) {
      issues.push({
        kind: "order",
        reference: order.id,
        eventId: null,
        eventType: null,
        reason: "order_session_unreadable",
        detail: err instanceof Error ? err.message : String(err),
        occurredAt: order.created_at,
        repairable: false,
      });
    }
  }

  // 3. Status subskrypcji w bazie kontra Stripe.
  const { data: subs, error: subErr } = await supabase
    .from("subscriptions")
    .select("provider_subscription_id, status, updated_at")
    .eq("tenant_id", tenantId)
    .eq("environment", environment)
    .not("status", "in", "(canceled)")
    .order("updated_at", { ascending: false })
    .limit(200);
  if (subErr) throw new Error(`nie udało się odczytać subskrypcji: ${subErr.message}`);

  for (const sub of subs ?? []) {
    try {
      const remote = await stripe.subscriptions.retrieve(sub.provider_subscription_id);
      if (remote.status === sub.status) continue;
      issues.push({
        kind: "subscription",
        reference: sub.provider_subscription_id,
        eventId: null,
        eventType: "customer.subscription.updated",
        reason: "subscription_status_drift",
        detail: `${sub.status} -> ${remote.status}`,
        occurredAt: sub.updated_at,
        repairable: true,
      });
    } catch (err) {
      issues.push({
        kind: "subscription",
        reference: sub.provider_subscription_id,
        eventId: null,
        eventType: null,
        reason: "subscription_unreadable",
        detail: err instanceof Error ? err.message : String(err),
        occurredAt: sub.updated_at,
        repairable: false,
      });
    }
  }

  return {
    environment,
    sinceIso,
    scannedEvents,
    scannedOrders: (orders ?? []).length,
    scannedSubscriptions: (subs ?? []).length,
    issues,
    warnings,
  };
}

/**
 * Przepuszcza jedno zdarzenie Stripe przez normalną ścieżkę obsługi i zapisuje
 * wynik w dzienniku. Zwraca status końcowy.
 */
async function replayEvent(
  event: VerifiedWebhookEvent,
  environment: StripeEnv,
  reference: string,
): Promise<RepairOutcome> {
  const [{ normalizeStripeEvent }, { dispatchWebhookEvent }, log] = await Promise.all([
    import("@/lib/billing/stripeEvents.server"),
    import("@/lib/billing/webhookDispatch.server"),
    import("@/lib/billing/webhookLog.server"),
  ]);

  const normalized = normalizeStripeEvent(event);
  if (!normalized) return { reference, status: "skipped", error: null };

  const occurredAt =
    typeof event.created === "number"
      ? new Date(event.created * 1000).toISOString()
      : new Date().toISOString();

  // Dziennik webhooków JEST bramką idempotencji: `false` znaczy "to zdarzenie
  // jest już w stanie końcowym (processed/skipped)". Produkcyjna trasa webhooka
  // to honoruje i kończy jako duplikat; naprawa z panelu tego nie robiła, więc
  // powtórne kliknięcie "Napraw" przepuszczało pełny handler dla domkniętego
  // zdarzenia i nadpisywało `processed_at`/`duration_ms` istniejącego wpisu.
  const claimed = await log.claimWebhookEvent({
    eventId: event.id,
    eventType: event.type,
    environment,
    occurredAt,
    payload: { eventType: normalized.eventType, data: normalized.data },
  });
  if (!claimed) return { reference, status: "skipped", error: null };

  const startedAt = Date.now();
  try {
    const outcome = await dispatchWebhookEvent({
      eventType: normalized.eventType,
      data: normalized.data,
      environment,
      occurredAt,
    });
    const status = outcome === "processed" ? "processed" : "skipped";
    await log.finishWebhookEvent({ eventId: event.id, environment }, status, {
      durationMs: Date.now() - startedAt,
    });
    return { reference, status, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await log.finishWebhookEvent({ eventId: event.id, environment }, "failed", {
      error: message,
      durationMs: Date.now() - startedAt,
    });
    return { reference, status: "failed", error: message };
  }
}

/** Identyfikatory operatora, po których da się rozstrzygnąć przynależność. */
interface TenantRefs {
  sessionId?: string | null;
  subscriptionId?: string | null;
  customerId?: string | null;
  paymentIntentId?: string | null;
  chargeId?: string | null;
}

/** Kolumny `payment_orders`, w których leżą identyfikatory operatora. */
const ORDER_REF_COLUMNS = [
  "provider_session_id",
  "provider_subscription_id",
  "provider_customer_id",
  "provider_payment_intent_id",
  "provider_intent_id",
  "provider_charge_id",
] as const;

/** To samo dla `subscriptions`. */
const SUBSCRIPTION_REF_COLUMNS = ["provider_subscription_id", "provider_customer_id"] as const;

/**
 * Wyciąga identyfikatory wiążące z obiektu zdarzenia przysłanego przez Stripe.
 *
 * Zdarzenia korygujące nie niosą ani sesji, ani subskrypcji, a przy płatności
 * gościa nie mają nawet klienta: `charge.refunded` przychodzi jako Charge,
 * a `charge.dispute.created` jako Dispute, więc jedynym wiązaniem z zamówieniem
 * bywa `payment_intent` albo identyfikator obciążenia. Tą samą drogą szuka
 * zamówienia do korekty `refunds.server` (`provider_payment_intent_id`,
 * `provider_intent_id`), a `payment_orders` trzyma też `provider_charge_id` -
 * bez tych dwóch pól WŁASNA naprawa najemcy wracała jako `skipped`.
 */
function refsOfStripeObject(object: Record<string, unknown>): TenantRefs {
  const id = typeof object.id === "string" ? object.id : null;
  const kind = typeof object.object === "string" ? object.object : null;
  const strOf = (value: unknown) => (typeof value === "string" ? value : null);
  return {
    sessionId: kind === "checkout.session" ? id : null,
    subscriptionId: strOf(object.subscription) ?? (kind === "subscription" ? id : null),
    customerId: strOf(object.customer),
    paymentIntentId: strOf(object.payment_intent) ?? (kind === "payment_intent" ? id : null),
    chargeId: strOf(object.charge) ?? (kind === "charge" ? id : null),
  };
}

/** Niepuste identyfikatory z jednego kompletu odwołań. */
function refValues(refs: TenantRefs): string[] {
  return [
    refs.sessionId,
    refs.subscriptionId,
    refs.customerId,
    refs.paymentIntentId,
    refs.chargeId,
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
}

/**
 * Które z podanych identyfikatorów operatora występują w wierszach TEGO najemcy.
 *
 * Raport potrafi nieść setki zdarzeń, więc rozstrzyganie pojedynczo (jak przy
 * naprawie) byłoby setkami zapytań - stąd jedno zapytanie na kolumnę. Wracają
 * WSZYSTKIE identyfikatory z dopasowanych wierszy: skoro wiersz jest nasz, to
 * nasze są też pozostałe jego odwołania, więc kolejne zdarzenie tej samej
 * płatności rozstrzyga się bez dodatkowego pytania.
 */
async function collectOwnedRefValues(
  environment: StripeEnv,
  tenantId: string,
  refsList: TenantRefs[],
): Promise<Set<string>> {
  const owned = new Set<string>();
  if (refsList.length === 0) return owned;

  const distinct = (pick: (refs: TenantRefs) => string | null | undefined) => [
    ...new Set(
      refsList
        .map(pick)
        .filter((value): value is string => typeof value === "string" && value.length > 0),
    ),
  ];
  const sessionIds = distinct((r) => r.sessionId);
  const subscriptionIds = distinct((r) => r.subscriptionId);
  const customerIds = distinct((r) => r.customerId);
  const intentIds = distinct((r) => r.paymentIntentId);
  const chargeIds = distinct((r) => r.chargeId);

  const supabase = await admin();
  const absorb = (
    rows: Record<string, unknown>[] | null,
    columns: readonly string[],
    table: string,
    error: { message: string } | null,
  ) => {
    if (error)
      throw new Error(`nie udało się ustalić właściciela zdarzeń (${table}): ${error.message}`);
    for (const row of rows ?? []) {
      for (const column of columns) {
        const value = row[column];
        if (typeof value === "string" && value.length > 0) owned.add(value);
      }
    }
  };

  const orderLookups: [(typeof ORDER_REF_COLUMNS)[number], string[]][] = [
    ["provider_session_id", sessionIds],
    ["provider_subscription_id", subscriptionIds],
    ["provider_customer_id", customerIds],
    ["provider_payment_intent_id", intentIds],
    ["provider_intent_id", intentIds],
    ["provider_charge_id", chargeIds],
  ];
  for (const [column, values] of orderLookups) {
    if (values.length === 0) continue;
    const { data, error } = await supabase
      .from("payment_orders")
      .select(ORDER_REF_COLUMNS.join(", "))
      .eq("tenant_id", tenantId)
      .eq("environment", environment)
      .in(column, values)
      // Zapytanie i tak jest zawężone listą identyfikatorów - limit jest tylko
      // czapką bezpieczeństwa na wypadek najemcy z gęstą historią płatności.
      .limit(1000);
    absorb(data as Record<string, unknown>[] | null, ORDER_REF_COLUMNS, "payment_orders", error);
  }

  const subscriptionLookups: [(typeof SUBSCRIPTION_REF_COLUMNS)[number], string[]][] = [
    ["provider_subscription_id", subscriptionIds],
    ["provider_customer_id", customerIds],
  ];
  for (const [column, values] of subscriptionLookups) {
    if (values.length === 0) continue;
    const { data, error } = await supabase
      .from("subscriptions")
      .select(SUBSCRIPTION_REF_COLUMNS.join(", "))
      .eq("tenant_id", tenantId)
      .eq("environment", environment)
      .in(column, values)
      .limit(1000);
    absorb(
      data as Record<string, unknown>[] | null,
      SUBSCRIPTION_REF_COLUMNS,
      "subscriptions",
      error,
    );
  }

  return owned;
}

/**
 * Czy obiekt POBRANY OD OPERATORA należy do obszaru roboczego wołającego?
 *
 * Dla `kind: "event"` i `kind: "subscription"` identyfikator przychodzi wprost
 * od klienta (`reconcile.functions.ts`, `z.string().max(255)`), a obiekt jest
 * pobierany ze Stripe'a - czyli poza naszą bazą i poza RLS. Bez tego sprawdzenia
 * admin jednego obszaru odtwarzał przez `dispatchWebhookEvent` cudze rozliczenie
 * (uprawnienia, miejsca, zwroty, dokumenty, poczta), znając sam identyfikator
 * Stripe'a - wektor SZERSZY niż ponowienie z dziennika, bo nie wymagał znajomości
 * UUID wiersza u nas.
 *
 * Przynależność czytamy z NASZYCH tabel najemcowych (`payment_orders`,
 * `subscriptions`), bo tylko one niosą `tenant_id`. Brak dopasowania to ODMOWA
 * (fail-closed) o kształcie nieodróżnialnym od braku danych.
 */
async function belongsToTenant(
  environment: StripeEnv,
  tenantId: string,
  refs: TenantRefs,
): Promise<boolean> {
  const supabase = await admin();

  if (refs.sessionId) {
    const { data } = await supabase
      .from("payment_orders")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("environment", environment)
      .eq("provider_session_id", refs.sessionId)
      .limit(1)
      .maybeSingle();
    if (data) return true;
  }

  if (refs.subscriptionId) {
    const { data } = await supabase
      .from("subscriptions")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("environment", environment)
      .eq("provider_subscription_id", refs.subscriptionId)
      .limit(1)
      .maybeSingle();
    if (data) return true;
  }

  if (refs.customerId) {
    const { data: sub } = await supabase
      .from("subscriptions")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("environment", environment)
      .eq("provider_customer_id", refs.customerId)
      .limit(1)
      .maybeSingle();
    if (sub) return true;

    const { data: order } = await supabase
      .from("payment_orders")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("environment", environment)
      .eq("provider_customer_id", refs.customerId)
      .limit(1)
      .maybeSingle();
    if (order) return true;
  }

  // Ostatnia deska ratunku dla korekt: zwrot i obciążenie zwrotne wiążą się
  // z zamówieniem wyłącznie przez płatność, a płatność gościa nie ma klienta
  // Stripe'a. Kolejność kolumn jak w `refunds.server` - potwierdzamy własność
  // tam, gdzie naprawa i tak będzie szukała zamówienia do skorygowania.
  if (refs.paymentIntentId) {
    for (const column of ["provider_payment_intent_id", "provider_intent_id"] as const) {
      const { data } = await supabase
        .from("payment_orders")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("environment", environment)
        .eq(column, refs.paymentIntentId)
        .limit(1)
        .maybeSingle();
      if (data) return true;
    }
  }

  if (refs.chargeId) {
    const { data } = await supabase
      .from("payment_orders")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("environment", environment)
      .eq("provider_charge_id", refs.chargeId)
      .limit(1)
      .maybeSingle();
    if (data) return true;
  }

  return false;
}

/**
 * Naprawia pojedynczą rozbieżność z raportu.
 *
 * `tenantId` jest parametrem WYMAGANYM - pochodzi z bramki
 * `assertAdminWithTenant`, nigdy z ładunku klienta.
 */
export async function repairReconcileIssue(
  environment: StripeEnv,
  kind: ReconcileKind,
  reference: string,
  tenantId: string,
): Promise<RepairOutcome> {
  const stripe = await getStripeClient(environment);

  if (kind === "event") {
    const event = (await stripe.events.retrieve(reference)) as unknown as VerifiedWebhookEvent;
    const object = event?.data?.object;
    const owned =
      object && typeof object === "object"
        ? await belongsToTenant(environment, tenantId, refsOfStripeObject(object))
        : false;
    if (!owned) return { reference, status: "skipped", error: null };
    return replayEvent(event, environment, reference);
  }

  if (kind === "order") {
    const supabase = await admin();
    const { data: order, error } = await supabase
      .from("payment_orders")
      .select("id, provider_session_id, environment")
      .eq("id", reference)
      // Zamówienie cudzego obszaru ma wyjść jako „brak danych", a nie jako
      // odmowa - inaczej sam komunikat potwierdzałby istnienie zamówienia.
      .eq("tenant_id", tenantId)
      .eq("environment", environment)
      .maybeSingle();
    if (error) throw new Error(`nie udało się odczytać zamówienia: ${error.message}`);
    if (!order?.provider_session_id) return { reference, status: "skipped", error: null };

    const session = await stripe.checkout.sessions.retrieve(order.provider_session_id);
    // Sztuczne zdarzenie o kształcie webhooka - dalej idzie wspólną ścieżką,
    // więc księgowanie zamówienia jest identyczne jak przy dostawie od Stripe.
    const synthetic: VerifiedWebhookEvent = {
      id: `reconcile_${session.id}`,
      type:
        session.payment_status === "unpaid"
          ? "checkout.session.async_payment_failed"
          : "checkout.session.completed",
      created: Math.floor(Date.now() / 1000),
      data: { object: session as unknown as Record<string, unknown> },
    } as VerifiedWebhookEvent;
    return replayEvent(synthetic, environment, reference);
  }

  const subscription = await stripe.subscriptions.retrieve(reference);
  const ownsSubscription = await belongsToTenant(environment, tenantId, {
    subscriptionId: reference,
    customerId: typeof subscription.customer === "string" ? subscription.customer : null,
  });
  if (!ownsSubscription) return { reference, status: "skipped", error: null };
  const synthetic: VerifiedWebhookEvent = {
    id: `reconcile_${subscription.id}_${subscription.status}`,
    type: "customer.subscription.updated",
    created: Math.floor(Date.now() / 1000),
    data: { object: subscription as unknown as Record<string, unknown> },
  } as VerifiedWebhookEvent;
  return replayEvent(synthetic, environment, reference);
}
