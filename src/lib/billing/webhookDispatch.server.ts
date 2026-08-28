// Rdzeń obsługi zdarzeń operatora płatności - oddzielony od trasy HTTP.
//
// Dzięki temu ten sam kod obsługuje:
//   1. zdarzenie przychodzące (trasa `/api/public/payments/webhook`, po
//      weryfikacji podpisu),
//   2. ponowne przetworzenie z panelu admina (`webhookRetry.functions`), gdzie
//      podpisu już nie ma - pracujemy na ładunku zapisanym w dzienniku.
// Cała logika jest idempotentna, więc powtórka nie dubluje skutków.
//
// Moduł server-only (klient service_role) - importuj wyłącznie z handlerów.
import { planChangeDirection } from "@/lib/billing/catalog";
import { accessPeriodFromEvent } from "@/lib/billing/accessPeriod";
import type { StripeEnv } from "@/lib/stripe.server";

export type SubscriptionData = {
  id: string;
  customerId: string;
  status: string;
  customData?: { userId?: string; purpose?: string; donationId?: string } | null;
  currentBillingPeriod?: { startsAt?: string; endsAt?: string } | null;
  scheduledChange?: { action?: string } | null;
  items: Array<{
    quantity?: number;
    /** Koniec okresu próbnego dla pozycji (operator podaje go per pozycja). */
    trialDates?: { startsAt?: string | null; endsAt?: string | null } | null;
    price: {
      id: string;
      externalId?: string | null;
      trialPeriod?: { interval?: string | null; frequency?: number | null } | null;
    };
    product?: { id: string; externalId?: string | null } | null;
  }>;
};

export type TransactionData = {
  id: string;
  subscriptionId?: string | null;
  customerId?: string | null;
  /** Identyfikator intencji płatności - klucz dopasowania przy zwrocie. */
  paymentIntentId?: string | null;
  currencyCode?: string | null;
  customData?: Record<string, unknown> | null;
  customer?: { email?: string | null } | null;
  details?: { totals?: { grandTotal?: string | null } | null } | null;
  payments?: Array<{ errorCode?: string | null }> | null;
  billingPeriod?: { endsAt?: string | null } | null;
};

/** Wynik obsługi: `skipped` = zdarzenie spoza zakresu integracji. */
export type DispatchOutcome = "processed" | "skipped";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function readIds(data: SubscriptionData) {
  const item = data.items?.[0];
  return {
    priceId: item?.price?.externalId ?? null,
    productId: item?.product?.externalId ?? null,
    quantity: item?.quantity ?? 1,
    /** Koniec triala: pozycja zdarzenia jest jedynym wiarygodnym źródłem. */
    trialEndsAt: item?.trialDates?.endsAt ?? null,
  };
}

/**
 * Strażnik kolejności zdarzeń subskrypcji.
 *
 * Operator nie gwarantuje kolejności dostarczenia, a ponowna dostawa starego
 * zdarzenia potrafi cofnąć stan (np. `past_due` po `activated`). Kolumna
 * `last_event_at` przechowuje znacznik NAJŚWIEŻSZEGO zastosowanego zdarzenia;
 * warunkowy UPDATE (`last_event_at < occurredAt`) jest atomowy, więc dwa
 * równoległe zdarzenia nie przeskoczą się nawzajem.
 *
 * @returns `true` gdy zdarzenie jest świeższe niż zapisany stan (lub wiersza
 *          jeszcze nie ma - wtedy przetwarzamy, bo to ścieżka zakładania).
 */
async function claimSubscriptionEvent(
  subscriptionId: string,
  env: StripeEnv,
  occurredAt: string,
): Promise<boolean> {
  const iso = new Date(occurredAt);
  if (Number.isNaN(iso.getTime())) return true; // brak wiarygodnego czasu - nie blokujemy
  const stamp = iso.toISOString();

  const supabase = await admin();
  const { data: claimed, error } = await supabase
    .from("subscriptions")
    .update({ last_event_at: stamp })
    .eq("provider_subscription_id", subscriptionId)
    .eq("environment", env)
    .or(`last_event_at.is.null,last_event_at.lt.${stamp}`)
    .select("id");
  if (error) throw new Error(`subscription event claim failed: ${error.message}`);
  if (claimed && claimed.length > 0) return true;

  // Zero zaktualizowanych wierszy: albo subskrypcji jeszcze nie ma (zdarzenie
  // wyprzedziło `created`), albo zapisany stan jest nowszy.
  const { data: exists, error: existsErr } = await supabase
    .from("subscriptions")
    .select("id")
    .eq("provider_subscription_id", subscriptionId)
    .eq("environment", env)
    .maybeSingle();
  if (existsErr) throw new Error(`subscription lookup failed: ${existsErr.message}`);
  return !exists;
}

async function handleCreated(data: SubscriptionData, env: StripeEnv, occurredAt?: string) {
  const userId = data.customData?.userId;
  const { priceId, productId, quantity, trialEndsAt } = readIds(data);
  if (!userId) {
    console.error("[payments] missing customData.userId", data.id);
    return;
  }
  if (!priceId || !productId) {
    console.warn("[payments] missing lookup_key/metadata.lovable_external_id", data.id);
    return;
  }

  const supabase = await admin();
  const { error } = await supabase.from("subscriptions").upsert(
    {
      user_id: userId,
      provider_subscription_id: data.id,
      provider_customer_id: data.customerId,
      product_id: productId,
      price_id: priceId,
      status: data.status,
      quantity,
      current_period_start: data.currentBillingPeriod?.startsAt ?? null,
      current_period_end: data.currentBillingPeriod?.endsAt ?? null,
      // Okres próbny: zapisujemy datę końca, żeby profil i panel pokazywały
      // "trial do ...", a przypomnienia potrafiły uprzedzić pierwsze obciążenie.
      trial_ends_at: trialEndsAt,
      environment: env,
      // Znacznik ostatniego zastosowanego zdarzenia - podstawa strażnika
      // kolejności przy późniejszych aktualizacjach.
      ...(occurredAt ? { last_event_at: new Date(occurredAt).toISOString() } : {}),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "provider_subscription_id" },
  );
  if (error) throw new Error(`subscriptions upsert failed: ${error.message}`);

  const { applyPurchaseEffects } = await import("@/lib/billing/purchaseEffects.server");
  await applyPurchaseEffects({
    userId,
    priceId,
    subscriptionId: data.id,
    // W trialu dostęp trwa do końca okresu próbnego - dopiero pierwsze
    // obciążenie przesuwa go na pełny cykl rozliczeniowy.
    periodEnd: data.currentBillingPeriod?.endsAt ?? trialEndsAt ?? null,
    environment: env,
    status: data.status,
  });

  // Plan Zespół: liczba opłaconych miejsc ustala limit organizacji.
  const { applySubscriptionSeats } = await import("@/lib/organizations/teamSeats.server");
  await applySubscriptionSeats({ subscriptionId: data.id, quantity, priceId });
}

/**
 * Wspólna ścieżka dla wszystkich zdarzeń zmieniających stan subskrypcji:
 * `updated`, `activated`, `trialing`, `past_due`, `paused`, `resumed`.
 * Operator wysyła je jako osobne typy, ale ładunek ma identyczny kształt, a
 * autorytatywne jest pole `status` - dlatego obsługa jest jedna i idempotentna.
 */
async function handleUpdated(data: SubscriptionData, env: StripeEnv, occurredAt: string) {
  const supabase = await admin();
  const { priceId: eventPriceId, quantity, trialEndsAt } = readIds(data);

  const { data: existing } = await supabase
    .from("subscriptions")
    .select("user_id, price_id, status, current_period_end")
    .eq("provider_subscription_id", data.id)
    .eq("environment", env)
    .maybeSingle();

  // Kolejność dostarczenia zdarzeń nie jest gwarantowana: `activated` potrafi
  // wyprzedzić `created`. Bez wiersza subskrypcji UPDATE trafiłby w pustkę i
  // zakup przepadłby po cichu - dlatego zakładamy go tą samą ścieżką co przy
  // utworzeniu (upsert, więc późniejsze `created` niczego nie zdubluje).
  if (!existing && data.customData?.userId) {
    await handleCreated(data, env, occurredAt);
    return;
  }

  // Zdarzenia stanu (pauza, wznowienie, past_due) bywają bez okresu
  // rozliczeniowego - wtedy zapisana data końca dostępu musi zostać nietknięta.
  const period = accessPeriodFromEvent({
    kind: "updated",
    eventPeriodEnd: data.currentBillingPeriod?.endsAt ?? trialEndsAt ?? null,
    storedPeriodEnd: existing?.current_period_end ?? null,
    status: data.status,
  });

  const { error } = await supabase
    .from("subscriptions")
    .update({
      status: data.status,
      ...(eventPriceId ? { price_id: eventPriceId } : {}),
      quantity,
      ...(data.currentBillingPeriod?.startsAt
        ? { current_period_start: data.currentBillingPeriod.startsAt }
        : {}),
      current_period_end: period.periodEnd,
      // Wyjście z triala (`activated`) czyści datę - zdarzenie nie niesie już
      // `trialDates`, a zostawiona data sugerowałaby trwający okres próbny.
      trial_ends_at: data.status === "trialing" ? trialEndsAt : null,
      cancel_at_period_end: data.scheduledChange?.action === "cancel",
      updated_at: new Date().toISOString(),
    })
    .eq("provider_subscription_id", data.id)
    .eq("environment", env);
  if (error) throw new Error(`subscriptions update failed: ${error.message}`);

  // Zdarzenia stanu (pauza, wznowienie, past_due) potrafią nie nieść pozycji
  // cennika - wtedy pracujemy na cenie zapisanej przy subskrypcji.
  const priceId = eventPriceId ?? existing?.price_id ?? null;

  // Plan Zespół: zmiana liczby opłaconych miejsc oraz stanu subskrypcji musi
  // natychmiast przełożyć się na limit i uprawnienia całego zespołu.
  const { applySubscriptionSeats, applySubscriptionOrgState } =
    await import("@/lib/organizations/teamSeats.server");
  await applySubscriptionOrgState({ subscriptionId: data.id, status: data.status, priceId });
  await applySubscriptionSeats({ subscriptionId: data.id, quantity, priceId });

  if (!existing?.user_id || !priceId) return;

  // Każda aktualizacja (pauza, wznowienie, past_due, nowy okres) musi trafić do
  // uprawnień, nie tylko zmiana planu.
  const { resolvePlanForPrice, applyStatusTransitionEffects } =
    await import("@/lib/billing/purchaseEffects.server");
  const plan = await resolvePlanForPrice(priceId);
  if (plan) {
    const { syncEntitlementState } = await import("@/lib/billing/entitlementSync.server");
    await syncEntitlementState({
      userId: existing.user_id,
      tenantId: plan.tenantId,
      planId: plan.planId,
      externalRef: data.id,
      status: data.status,
      periodEnd: period.accessUntil,
    });
  }

  // CRM + powiadomienie użytkownika przy zmianie samego stanu.
  await applyStatusTransitionEffects({
    userId: existing.user_id,
    priceId,
    subscriptionId: data.id,
    periodEnd: period.accessUntil,
    previousStatus: existing.status ?? null,
    status: data.status,
  });

  const direction = eventPriceId ? planChangeDirection(existing.price_id, eventPriceId) : "same";
  if (direction === "same") return;

  const { applyPlanChangeEffects } = await import("@/lib/billing/purchaseEffects.server");
  await applyPlanChangeEffects({
    userId: existing.user_id,
    priceId,
    previousPriceId: existing.price_id,
    direction,
    subscriptionId: data.id,
    periodEnd: period.accessUntil,
    environment: env,
  });
}

async function handleCanceled(data: SubscriptionData, env: StripeEnv) {
  const supabase = await admin();
  const { data: existing } = await supabase
    .from("subscriptions")
    .select("user_id, price_id, current_period_end")
    .eq("provider_subscription_id", data.id)
    .eq("environment", env)
    .maybeSingle();

  const { error } = await supabase
    .from("subscriptions")
    .update({ status: "canceled", trial_ends_at: null, updated_at: new Date().toISOString() })
    .eq("provider_subscription_id", data.id)
    .eq("environment", env);
  if (error) throw new Error(`subscriptions cancel failed: ${error.message}`);

  const canceledPeriod = accessPeriodFromEvent({
    kind: "canceled",
    eventPeriodEnd: data.currentBillingPeriod?.endsAt ?? null,
    storedPeriodEnd: existing?.current_period_end ?? null,
    status: "canceled",
  });

  if (!existing?.user_id || !existing.price_id) return;

  // Anulowanie planu Zespół wstrzymuje organizację - miejsca zostają, ale
  // przestają nadawać uprawnienia.
  const { applySubscriptionOrgState } = await import("@/lib/organizations/teamSeats.server");
  await applySubscriptionOrgState({
    subscriptionId: data.id,
    status: "canceled",
    priceId: existing.price_id,
  });

  const { applyCancellationEffects } = await import("@/lib/billing/purchaseEffects.server");
  await applyCancellationEffects({
    userId: existing.user_id,
    priceId: existing.price_id,
    subscriptionId: data.id,
    periodEnd: canceledPeriod.accessUntil,
    environment: env,
  });
}

function amountFromTransaction(data: TransactionData): number | null {
  const raw = data.details?.totals?.grandTotal;
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

async function handleTransaction(
  data: TransactionData,
  env: StripeEnv,
  occurredAt: string,
  kind: "failed" | "paid",
) {
  // Transakcja bez subskrypcji = płatność jednorazowa (odblokowanie treści,
  // bilet, darowizna). Rozpoznanie idzie po `custom_data`, które ustawia
  // serwer przy tworzeniu transakcji - klient nie ma jak go podmienić.
  if (!data.subscriptionId) {
    if (kind === "failed") {
      // Odrzucona płatność jednorazowa: zgłoszenie na wydarzenie zostaje, ale
      // musi być widoczne jako NIEOPŁACONE - inaczej organizator wpuściłby na
      // salę osobę, której karta nie przeszła.
      const { markOneTimePaymentFailed } =
        await import("@/lib/billing/oneTimeFulfilment.server");
      await markOneTimePaymentFailed(data.customData ?? null);
      return;
    }
    if (kind !== "paid") return;
    const { fulfilOneTimeTransaction } = await import("@/lib/billing/oneTimeFulfilment.server");
    await fulfilOneTimeTransaction(
      {
        id: data.id,
        amountCents: amountFromTransaction(data),
        currency: data.currencyCode ?? null,
        customerEmail: data.customer?.email ?? null,
        customData: data.customData ?? null,
        sessionId: data.id,
        paymentIntentId: data.paymentIntentId ?? null,
        customerId: data.customerId ?? null,
      },
      env,
    );
    return;
  }
  // Odnowienie darowizny cyklicznej: brak uprawnień i windykacji planów -
  // każda opłacona faktura ma zostać zaksięgowana jako osobna wpłata.
  if (data.customData?.purpose === "donation") {
    if (kind !== "paid") return;
    const { recordRecurringDonationPayment } = await import("@/lib/billing/donations.server");
    await recordRecurringDonationPayment({
      donationId: (data.customData.donationId as string | undefined) ?? null,
      subscriptionId: data.subscriptionId,
      invoiceId: data.id,
      amountCents: amountFromTransaction(data),
      currency: data.currencyCode ?? null,
      donorEmail: data.customer?.email ?? null,
    });
    return;
  }

  const ctx = {
    subscriptionId: data.subscriptionId,
    environment: env,
    occurredAt,
    amountCents: amountFromTransaction(data),
    currency: data.currencyCode ?? null,
    // Klucz deduplikacji windykacji: `transaction.payment_failed` i
    // `transaction.past_due` opisują TĘ SAMĄ nieudaną transakcję.
    transactionId: data.id,
  };
  const dunning = await import("@/lib/billing/dunning.server");
  if (kind === "failed") await dunning.applyPaymentFailedEffects(ctx);
  else await dunning.applyPaymentRecoveredEffects(ctx);
}

/**
 * Korekty rozliczeniowe operatora: zwrot, obciążenie zwrotne, kredyt.
 *
 * Payload korekty jest luźniejszy niż subskrypcyjny (SDK nie eksportuje dla
 * niego stabilnego typu), więc czytamy pola defensywnie i całą decyzję
 * przekazujemy do `applyRefundEffects`.
 */
async function handleAdjustment(data: Record<string, unknown>, env: StripeEnv): Promise<void> {
  const str = (key: string): string | null =>
    typeof data[key] === "string" ? (data[key] as string) : null;

  const totals = data.totals as { total?: string; currencyCode?: string } | undefined;
  const totalRaw = totals?.total;
  const amountCents = totalRaw !== undefined ? Math.round(Number(totalRaw)) : null;

  const { applyRefundEffects } = await import("@/lib/billing/refunds.server");
  await applyRefundEffects({
    adjustmentId: str("id") ?? "",
    transactionId: str("transactionId"),
    subscriptionId: str("subscriptionId"),
    action: (str("action") ?? "other") as
      "refund" | "chargeback" | "chargeback_warning" | "credit" | "other",
    status: str("status"),
    amountCents: Number.isFinite(amountCents) ? amountCents : null,
    currency: str("currencyCode") ?? totals?.currencyCode ?? null,
    environment: env,
  });
}

/**
 * Zapis faktury dla transakcji. Zwraca `true`, gdy coś faktycznie zapisano -
 * `transaction.updated` bez zmian traktujemy jako pominięte zdarzenie.
 */
async function recordDocument(data: unknown, env: StripeEnv): Promise<boolean> {
  const { documentInputFromTransaction, recordTransactionDocument } =
    await import("@/lib/billing/billingDocuments.server");
  const input = documentInputFromTransaction(data, env);
  if (!input) return false;
  const outcome = await recordTransactionDocument(input).catch((e: unknown) => {
    console.error("[payments] billing document failed", input.transactionId, e);
    return "skipped" as const;
  });
  return outcome !== "skipped";
}

/** Typy zdarzeń obsługiwane przez integrację (jedno miejsce prawdy). */
export const HANDLED_EVENT_TYPES = [
  "subscription.created",
  "subscription.updated",
  "subscription.activated",
  "subscription.trialing",
  "subscription.past_due",
  "subscription.paused",
  "subscription.resumed",
  "subscription.imported",
  "subscription.canceled",
  "transaction.completed",
  "transaction.updated",
  "transaction.payment_failed",
  "transaction.past_due",
  "adjustment.created",
  "adjustment.updated",
  "customer.updated",
  "address.updated",
  "business.updated",
] as const;

export interface DispatchInput {
  eventType: string;
  data: unknown;
  environment: StripeEnv;
  occurredAt: string;
}

/**
 * Kieruje zdarzenie do właściwej obsługi. Bez efektów ubocznych poza bazą,
 * więc wywołanie z panelu admina (retry) daje ten sam skutek co dostarczenie
 * przez operatora.
 */
/**
 * Subskrypcja darowizny to nie plan dostępu - nie nadaje uprawnień i nie ma
 * odpowiednika w `BILLING_CATALOG`. Rozpoznajemy ją po `metadata.purpose`
 * ustawianym po stronie serwera przy tworzeniu sesji checkout.
 */
function isDonationSubscription(data: SubscriptionData): boolean {
  return data.customData?.purpose === "donation";
}

async function handleDonationSubscription(data: SubscriptionData, status: string) {
  const { syncDonationSubscription } = await import("@/lib/billing/donations.server");
  await syncDonationSubscription({
    subscriptionId: data.id,
    donationId: data.customData?.donationId ?? null,
    status,
  });
}

export async function dispatchWebhookEvent(input: DispatchInput): Promise<DispatchOutcome> {
  const { eventType, environment: env, occurredAt } = input;

  if (eventType.startsWith("subscription.")) {
    const sub = input.data as SubscriptionData;
    if (isDonationSubscription(sub)) {
      await handleDonationSubscription(
        sub,
        eventType === "subscription.canceled" ? "canceled" : (sub.status ?? "active"),
      );
      return "processed";
    }
  }

  switch (eventType) {
    case "subscription.created":
      await handleCreated(input.data as SubscriptionData, env, occurredAt);
      return "processed";
    // Wszystkie zdarzenia zmiany stanu subskrypcji dzielą jedną obsługę -
    // operator wysyła je jako osobne typy, ale autorytatywny jest `status`.
    case "subscription.updated":
    case "subscription.activated":
    case "subscription.trialing":
    case "subscription.past_due":
    case "subscription.paused":
    case "subscription.resumed":
    case "subscription.imported": {
      const sub = input.data as SubscriptionData;
      // Spóźnione zdarzenie nie może cofnąć nowszego stanu subskrypcji.
      if (!(await claimSubscriptionEvent(sub.id, env, occurredAt))) return "skipped";
      await handleUpdated(sub, env, occurredAt);
      return "processed";
    }
    case "subscription.canceled": {
      const sub = input.data as SubscriptionData;
      if (!(await claimSubscriptionEvent(sub.id, env, occurredAt))) return "skipped";
      await handleCanceled(sub, env);
      return "processed";
    }
    // Nieudane obciążenie: operator sygnalizuje je dwoma zdarzeniami
    // (`payment_failed` przy odrzuceniu, `past_due` przy wejściu transakcji w
    // zaległość). Obsługa jest ta sama, a warstwa windykacji odsiewa duplikat
    // po identyfikatorze transakcji, więc mail idzie dokładnie raz.
    case "transaction.payment_failed":
    case "transaction.past_due":
      await handleTransaction(input.data as TransactionData, env, occurredAt, "failed");
      return "processed";
    case "transaction.completed":
      await recordDocument(input.data, env);
      await handleTransaction(input.data as TransactionData, env, occurredAt, "paid");
      return "processed";
    // Operator nadaje numer faktury i domyka kwoty osobnym zdarzeniem - bez
    // niego dokument w panelu klienta zostałby bez numeru.
    case "transaction.updated":
      return (await recordDocument(input.data, env)) ? "processed" : "skipped";
    case "adjustment.created":
    case "adjustment.updated":
      await handleAdjustment(input.data as Record<string, unknown>, env);
      return "processed";
    // Zmiany danych klienta u operatora (e-mail, adres, dane firmy) wracają do
    // profilu rozliczeniowego - inaczej faktury i stawka podatku rozjeżdżają się.
    case "customer.updated": {
      const { syncCustomerProfile } = await import("@/lib/billing/customerSync.server");
      await syncCustomerProfile(input.data, env);
      return "processed";
    }
    case "address.updated": {
      const { syncCustomerAddress } = await import("@/lib/billing/customerSync.server");
      await syncCustomerAddress(input.data, env);
      return "processed";
    }
    case "business.updated": {
      const { syncCustomerBusiness } = await import("@/lib/billing/customerSync.server");
      await syncCustomerBusiness(input.data, env);
      return "processed";
    }
    default:
      return "skipped";
  }
}
