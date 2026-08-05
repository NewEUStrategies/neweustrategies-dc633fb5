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
import { createStripeClient, type StripeEnv, type VerifiedWebhookEvent } from "@/lib/stripe.server";

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
 */
export async function buildReconcileReport(
  environment: StripeEnv,
  sinceHours: number,
): Promise<ReconcileReport> {
  const hours = Math.min(Math.max(Math.round(sinceHours), 1), 24 * 30);
  const sinceMs = Date.now() - hours * 3600_000;
  const sinceIso = new Date(sinceMs).toISOString();
  const stripe = createStripeClient(environment);
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
    .eq("environment", environment)
    .gte("created_at", sinceIso);
  if (logErr) throw new Error(`nie udało się odczytać dziennika zdarzeń: ${logErr.message}`);
  const logged = new Map((loggedRows ?? []).map((r) => [r.event_id, r.status]));

  for (const event of supported) {
    const status = logged.get(event.id);
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
    scannedEvents: supported.length,
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

  await log.claimWebhookEvent({
    eventId: event.id,
    eventType: event.type,
    environment,
    occurredAt,
    payload: { eventType: normalized.eventType, data: normalized.data },
  });

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

/** Naprawia pojedynczą rozbieżność z raportu. */
export async function repairReconcileIssue(
  environment: StripeEnv,
  kind: ReconcileKind,
  reference: string,
): Promise<RepairOutcome> {
  const stripe = createStripeClient(environment);

  if (kind === "event") {
    const event = (await stripe.events.retrieve(reference)) as unknown as VerifiedWebhookEvent;
    return replayEvent(event, environment, reference);
  }

  if (kind === "order") {
    const supabase = await admin();
    const { data: order, error } = await supabase
      .from("payment_orders")
      .select("id, provider_session_id, environment")
      .eq("id", reference)
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
  const synthetic: VerifiedWebhookEvent = {
    id: `reconcile_${subscription.id}_${subscription.status}`,
    type: "customer.subscription.updated",
    created: Math.floor(Date.now() / 1000),
    data: { object: subscription as unknown as Record<string, unknown> },
  } as VerifiedWebhookEvent;
  return replayEvent(synthetic, environment, reference);
}
