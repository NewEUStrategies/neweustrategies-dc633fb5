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
// BILET: MIEJSCE DAJE TYLKO BAZA (audyt TIX-05, TIX-08). Odpowiedź
// `payments_apply_event_ticket_outcome` rozstrzyga, co webhook robi dalej
// (`paidTicketVerdict`): zgłoszenie z miejscem -> RSVP i mail; zakup bez
// zgłoszenia -> miejsce RSVP pod blokadą wydarzenia
// (`_event_rsvp_claim_paid_seat`, brak miejsca = zwrot); odmowa bazy (cudze
// zgłoszenie, zła kwota, druga wpłata) -> BEZ RSVP i bez „miejsce
// zarezerwowane", zwrot w kolejce i zawiadomienie kupującego oraz
// organizatora. Błąd RPC to wyjątek (ponowienie), a nie cicha zgoda.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { StripeEnv } from "@/lib/stripe.server";
import type { TicketOutcomePayload } from "@/lib/events/registrationOutcomeNotify.server";
import { isTicketPaymentRefusal, paidTicketVerdict } from "@/lib/events/paidAdmission";
import { isMigrationPending } from "@/lib/supabase/migrationPending";

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

/** Zamówienie w kształcie potrzebnym realizacji (odczyt z `payment_orders`). */
interface FulfilOrderRow {
  id: string;
  user_id: string | null;
  tenant_id: string;
  plan_id: string | null;
  kind: "subscription" | "one_time";
  entity_type: "post" | "page" | "media" | null;
  entity_id: string | null;
  amount_cents: number;
  currency: string | null;
  metadata: unknown;
  environment?: string | null;
  status?: string | null;
  provider?: string | null;
}

/**
 * Sposób rozliczenia: wpłata operatora albo zamówienie darmowe (kod 100%,
 * `settleFreeTicketOrder`) - to drugie nie ma czego zwracać u operatora.
 */
interface SettlementMode {
  provider: "stripe" | "coupon";
}

function str(source: Record<string, unknown> | null, key: string): string | null {
  const v = source?.[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
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
 */
async function refundOversold(
  txn: OneTimeTransaction,
  order: FulfilOrderRow,
  amountCents: number | null,
  currency: string,
  mode: SettlementMode,
): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  if (!order.user_id) return;

  const nowIso = new Date().toISOString();
  if (mode.provider === "coupon") {
    const { error: flipErr } = await supabaseAdmin
      .from("payment_orders")
      .update({ status: "canceled", updated_at: nowIso })
      .eq("id", order.id);
    if (flipErr) throw new Error(`one-time: free order cancel failed: ${flipErr.message}`);
    const couponId = str(asRecord(order.metadata), "coupon_id");
    if (couponId) {
      const { error: releaseErr } = await supabaseAdmin.rpc("release_b2b_coupon_for_user", {
        _tenant_id: order.tenant_id,
        _user_id: order.user_id,
        _coupon_id: couponId,
        _order_id: order.id,
      });
      if (releaseErr) {
        console.error("[payments] free order coupon release failed", order.id, releaseErr.message);
      }
    }
  } else {
    const { resolveEnvironment } = await import("@/lib/billing/transactions.server");
    const { refundTransactionFully } = await import("@/lib/billing/refundProvider.server");
    const refund = await refundTransactionFully(resolveEnvironment(null), txn.id, "oversold");
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
  }

  if (order.tenant_id) {
    await supabaseAdmin.from("notifications").insert({
      user_id: order.user_id,
      tenant_id: order.tenant_id,
      kind: "billing",
      title_pl: "Brak wolnych miejsc - zwrot płatności",
      title_en: "Event sold out - payment refunded",
      body_pl:
        mode.provider === "coupon"
          ? "Ostatnie miejsce zajęto, zanim bilet został wydany. Kod wrócił do puli."
          : "Ostatnie miejsce zajęto przed zaksięgowaniem płatności. Zwróciliśmy pełną kwotę.",
      body_en:
        mode.provider === "coupon"
          ? "The last seat was taken before your ticket was issued. Your code is usable again."
          : "The last seat was taken before your payment settled. We refunded the full amount.",
      href: "/profile/tickets",
      icon: "receipt",
    });
  }
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
    await assertSeatAvailable(supabaseAdmin, eventId, order.user_id as string);
  } catch (err) {
    if (err instanceof Error && err.message === "event_full") return "full";
    throw err;
  }
  const { error: rsvpErr } = await supabaseAdmin.from("event_rsvps").upsert(
    {
      tenant_id: order.tenant_id,
      event_id: eventId,
      user_id: order.user_id as string,
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
 * Zwrot i nieudana płatność zostają fail-soft (`null`): powtórka zwrotu
 * kończy się `skipped`, zanim doszłaby tu drugi raz, więc wyjątek niczego by
 * nie dokończył - zgłoszenie po awarii poprawia organizator.
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
    return null;
  }
  const payload = asPayload(data);
  if (payload === null) {
    if (outcome === "paid") throw new Error(`one-time: ticket outcome unreadable (${orderId})`);
    return null;
  }

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
  // osobny mail od razu. Bez warunku `applied` - ponowiony webhook musi móc
  // dokończyć wysyłkę, a podwójnemu wydaniu zapobiega baza (zajęcie
  // i `ticket_code_sent_at`). Czego ta ścieżka nie domknie, zbierze cron
  // (`event-ticket-codes`). Wiersz w kolejce albo czekający na decyzję kodu
  // nie dostanie - baza wydaje go wyłącznie zgłoszeniu z miejscem.
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

async function loadOrder(orderId: string): Promise<FulfilOrderRow | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // `environment` (kolumna z 20260731220000) nie jest jeszcze w wygenerowanym
  // types.ts; nazwanie jej w .select() zatruwałoby typ całego wiersza, więc dla
  // tego odczytu rzutujemy klienta na luźny typ (konwencja jak invoice.server).
  const { data: order, error } = await (supabaseAdmin as unknown as SupabaseClient)
    .from("payment_orders")
    .select(
      "id, user_id, tenant_id, plan_id, kind, entity_type, entity_id, amount_cents, currency, metadata, environment, status, provider",
    )
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
  const orderEnv = order.environment ?? "live";
  if (orderEnv !== env) {
    console.warn(
      `[payments] one-time: environment mismatch - order ${orderId} is '${orderEnv}', webhook is '${env}'; skipping`,
    );
    return "skipped";
  }
  // ZWRÓCONE zamówienie nie wraca do `paid`. Od 20261012 dyspozytor ponawia
  // `transaction.completed` po błędzie zapisu dokumentu (webhookDispatch), a
  // księgowanie `.neq("status", "paid")` przestawiłoby zwrot (odmowa wpłaty,
  // pełna sala) z powrotem na opłacone i ponownie wydało skutki zakupu.
  // Anulowane przechodzi: opłacona sesja na anulowanym zamówieniu to realna
  // wpłata, którą trzeba rozliczyć.
  if (order.status === "refunded") {
    console.warn("[payments] one-time: order already refunded, settlement skipped", orderId);
    return "skipped";
  }
  return (await settleOrder(txn, order, { provider: "stripe" })).outcome;
}

/** Wynik rozliczenia darmowego zamówienia - kasa mówi z niego kupującemu prawdę. */
export interface FreeTicketSettlement {
  outcome: Exclude<OneTimeOutcome, "donation">;
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
  if (
    !order ||
    order.amount_cents !== 0 ||
    order.kind !== "one_time" ||
    (order.status !== "pending" && order.status !== "paid") ||
    order.provider !== "coupon" ||
    !str(meta, "event_id") ||
    !str(meta, "coupon_id")
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
    { provider: "coupon" },
  );
  return {
    outcome: settled.outcome === "oversold_refunded" ? "oversold_refunded" : "order",
    seated: settled.seated,
  };
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

async function settleOrder(
  txn: OneTimeTransaction,
  order: FulfilOrderRow,
  mode: SettlementMode,
): Promise<SettledOrder> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { grantEntitlement } = await import("@/lib/billing/grant.server");

  const amountCents = txn.amountCents ?? order.amount_cents;
  const currency = (txn.currency ?? order.currency ?? "PLN").toUpperCase();

  // 1. Uprawnienie (idempotentne) - zanim cokolwiek uzna zamówienie za opłacone.
  await grantEntitlement({ ...order, amount_cents: amountCents }, txn.id);

  // 2. Księgowanie - `paid_at` stemplowane dokładnie raz mimo ponowień.
  const { error: updateErr } = await supabaseAdmin
    .from("payment_orders")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      provider: mode.provider,
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

  const eventId = str(asRecord(order.metadata), "event_id");

  // Zamówienie zanonimizowane (konto usunięte, dowód księgowy został -
  // migracja 20260803090002): punkty 1-3 wciąż mają sens, bo dotyczą ksiąg.
  // RSVP, dzwonek i mail nie mają już adresata - kończymy tutaj, zamiast
  // rzucać i skazywać webhook na wieczne ponowienia.
  if (!order.user_id) {
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
          user_id: order.user_id,
          status: "going",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "event_id,user_id" },
      );
      if (rsvpErr) throw new Error(`one-time: rsvp confirm failed: ${rsvpErr.message}`);
      seated = true;
    } else if (verdict === "rsvp") {
      if ((await claimPaidRsvpSeat(order, eventId)) === "full") {
        await refundOversold(txn, order, amountCents, currency, mode);
        return { outcome: "oversold_refunded", seated: false };
      }
      seated = true;
    } else if (verdict === "refused") {
      console.warn("[payments] one-time: ticket payment refused", order.id, ticket?.reason);
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
  // (`event_ticket_paid_waitlisted` / `_pending`), a odmówiona wpłata -
  // zawiadomienie o zwrocie (`notifyTicketRefusal`) z `applyTicketOutcome`.
  if (eventId && seated) {
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
    });
    return settled ? "donation" : "skipped";
  }

  const orderId = str(txn.customData, "orderId") ?? str(txn.customData, "order_id");
  if (orderId) return fulfilOrder(txn, orderId, env);

  console.warn("[payments] one-time transaction without recognised custom_data", txn.id);
  return "skipped";
}
