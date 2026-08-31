// Logika zamówień ad-hoc (odblokowanie treści, bilet, darowizna) dla Stripe
// Embedded Checkout. Plik serwerowy - `stripeCheckout.functions.ts` pozostaje
// cienkim wrapperem `createServerFn` (patrz dyrektywy repo).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StripeEnv } from "@/lib/stripe.server";
import type { CheckoutLocale } from "@/lib/billing/checkoutLocale";
import { markOrderSession } from "@/lib/billing/markOrderSession.server";

export interface AdhocOrderInput {
  purpose: "content_unlock" | "event_ticket" | "donation";
  entityType?: "post" | "page";
  entityId?: string;
  eventId?: string;
  amountCents?: number;
  currency?: "PLN" | "EUR";
  returnUrl: string;
}

export interface BuildAdhocOrderArgs {
  data: AdhocOrderInput;
  environment: StripeEnv;
  supabase: SupabaseClient;
  userId: string;
  email: string | null;
  /** Język ramki Stripe Checkout. */
  locale?: CheckoutLocale;
}

export type BuildAdhocOrderResult =
  { ok: true; clientSecret: string; orderId: string } | { ok: false; error: string };

interface ResolvedAmount {
  amountCents: number;
  currency: string;
  name: string;
  metadata: Record<string, string>;
  entityType: string | null;
  entityId: string | null;
}

/**
 * Kwota NIGDY nie pochodzi z klienta dla treści i biletów - jest doczytywana
 * serwerowo z reguły dostępu / wydarzenia. Dla darowizny kwotę podaje
 * ofiarodawca, ale walidujemy minimum operatora (50 gr / 0,50 EUR).
 */
async function resolveAmount(
  supabase: SupabaseClient,
  data: AdhocOrderInput,
  userId: string,
): Promise<ResolvedAmount | { error: string }> {
  if (data.purpose === "event_ticket") {
    if (!data.eventId) return { error: "entity_required" };
    const { data: ev, error } = await supabase
      .from("events")
      .select("id, title_pl, title_en, ticket_price_cents, ticket_currency, status, starts_at")
      .eq("id", data.eventId)
      .maybeSingle();
    if (error) throw error;
    if (!ev || !ev.ticket_price_cents || Number(ev.ticket_price_cents) <= 0) {
      return { error: "ticket_not_available" };
    }
    if (ev.status !== "published") return { error: "ticket_not_available" };
    if (ev.starts_at && new Date(String(ev.starts_at)).getTime() < Date.now()) {
      return { error: "event_finished" };
    }
    // BRAK MIEJSC WRACA KANAŁEM ODMOWY, nie wyjątkiem. `assertSeatAvailable`
    // sygnalizuje pełną salę wyjątkiem `event_full` (tak samo czyta go
    // `oneTimeFulfilment.server.ts`, dopasowując po komunikacie), a ta funkcja
    // nie ma wokół wyceny żadnego `try` - więc najczęstsza odmowa popularnego
    // wydarzenia leciała przez server fn na zewnątrz jako błąd serwera.
    // Kupujący widział wtedy ogólne „coś poszło nie tak" zamiast zdania
    // o braku miejsc, klikał ponownie, a w logu zostawał wyjątek nieodróżnialny
    // od awarii bazy. Wszystkie pozostałe odmowy biletowe (`entity_required`,
    // `ticket_not_available`, `event_finished`, `ticket_included_in_plan`) już
    // wracały tym kanałem - ta jedna była wyjątkiem od reguły.
    //
    // Kod odmowy zostaje `event_full` (bez zmiany kontraktu
    // `assertSeatAvailable`, z którego korzysta też domykanie zamówień), więc
    // wywołujący dostaje tę samą nazwę, którą moduł biletów posługuje się od
    // zawsze. Inne wyjątki (awaria odczytu miejsc) lecą dalej - one NIE są
    // odmową i nie wolno ich zamieniać w „brak miejsc".
    const { assertSeatAvailable } = await import("@/lib/events/ticket.server");
    try {
      await assertSeatAvailable(supabase, String(ev.id), userId);
    } catch (err) {
      if (!(err instanceof Error) || err.message !== "event_full") throw err;
      return { error: "event_full" };
    }
    // Benefity planu liczone TĄ SAMĄ regułą, co w kasie biletowej
    // (`checkout.functions`): stawki ulgowe płacą mniej, a nieużyta pula
    // pokrywa bilet w całości. Kwota zero oznacza, że płatność jest w ogóle
    // niepotrzebna - bilet odstępuje `rsvp_event`, konsumując pulę.
    const { ticketPriceForCaller } = await import("@/lib/events/ticketAllowance.server");
    const priced = await ticketPriceForCaller(supabase, Number(ev.ticket_price_cents));
    if (priced.amountCents <= 0) return { error: "ticket_included_in_plan" };
    return {
      amountCents: priced.amountCents,
      currency: String(ev.ticket_currency ?? "PLN"),
      name: String(ev.title_pl || ev.title_en || "Bilet"),
      metadata: { event_id: String(ev.id) },
      entityType: null,
      entityId: null,
    };
  }

  if (data.purpose === "content_unlock") {
    if (!data.entityType || !data.entityId) return { error: "entity_required" };
    const { data: rule, error } = await supabase
      .from("content_access_public")
      .select("mode, one_time_price_cents, one_time_currency")
      .eq("entity_type", data.entityType)
      .eq("entity_id", data.entityId)
      .maybeSingle();
    if (error) throw error;
    if (
      !rule ||
      rule.mode !== "paid" ||
      !rule.one_time_price_cents ||
      Number(rule.one_time_price_cents) <= 0
    ) {
      return { error: "one_time_not_available" };
    }
    const table = data.entityType === "post" ? "posts" : "pages";
    const { data: row } = await supabase
      .from(table)
      .select("title_pl, title_en")
      .eq("id", data.entityId)
      .maybeSingle();
    return {
      amountCents: Number(rule.one_time_price_cents),
      currency: String(rule.one_time_currency ?? "PLN"),
      name: String(row?.title_pl || row?.title_en || "Dostęp do treści"),
      metadata: {},
      entityType: data.entityType,
      entityId: data.entityId,
    };
  }

  if (!data.amountCents || data.amountCents < 50) return { error: "amount_too_low" };
  return {
    amountCents: Math.round(data.amountCents),
    currency: data.currency ?? "PLN",
    name: "Darowizna",
    metadata: {},
    entityType: null,
    entityId: null,
  };
}

/**
 * Tworzy zamówienie `payment_orders` w stanie `pending`, otwiera sesję
 * Embedded Checkout i stempluje na zamówieniu identyfikator sesji. Porażka po
 * stronie operatora oznacza zamówienie `failed` - nigdy wiszące `pending`.
 */
export async function buildAdhocOrder(args: BuildAdhocOrderArgs): Promise<BuildAdhocOrderResult> {
  const { data, environment, supabase, userId, email, locale } = args;

  const resolved = await resolveAmount(supabase, data, userId);
  if ("error" in resolved) return { ok: false, error: resolved.error };

  const { data: order, error: insertErr } = await supabase
    .from("payment_orders")
    .insert({
      user_id: userId,
      kind: "one_time",
      status: "pending",
      amount_cents: resolved.amountCents,
      currency: resolved.currency,
      entity_type: resolved.entityType,
      entity_id: resolved.entityId,
      provider: "stripe",
      receipt_email: email,
      environment,
      metadata: { label: resolved.name, purpose: data.purpose, ...resolved.metadata },
    } as never)
    .select("id, tenant_id")
    .single();
  if (insertErr) throw insertErr;

  const [{ createAdhocCheckoutSession }, { loadCheckoutSettings }] = await Promise.all([
    import("@/lib/billing/adhocCheckout.server"),
    import("@/lib/billing/checkoutSettings.server"),
  ]);
  // Flagi checkoutu tenantu zamówienia - te same, co dla planów z katalogu.
  // Klient jest tu nietypowany (`SupabaseClient` bez generyka `Database`), więc
  // zawężamy `tenant_id` jawnie zamiast ufać wnioskowaniu.
  const orderTenantId = typeof order.tenant_id === "string" ? order.tenant_id : null;
  const settings = await loadCheckoutSettings(supabase, orderTenantId);
  const result = await createAdhocCheckoutSession({
    environment,
    name: resolved.name,
    amountCents: resolved.amountCents,
    currency: resolved.currency,
    orderId: order.id,
    purpose: data.purpose,
    userId,
    customerEmail: email,
    returnUrl: data.returnUrl,
    locale,
    metadata: resolved.metadata,
    settings,
  });

  if (!result.ok) {
    await markOrderSession(supabase, { orderId: order.id, sessionId: null, status: "failed" });
    return { ok: false, error: result.error };
  }

  await markOrderSession(supabase, {
    orderId: order.id,
    sessionId: result.sessionId,
    status: "processing",
  });

  return { ok: true, clientSecret: result.clientSecret, orderId: order.id };
}
