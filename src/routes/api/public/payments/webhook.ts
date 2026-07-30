// Odbiornik zdarzeń od dostawcy płatności.
// Autoryzacja: wyłącznie podpis kryptograficzny dostawcy (bez sesji Supabase) -
// trasa musi pozostać publiczna, dlatego cała weryfikacja dzieje się poniżej.
import { createFileRoute } from "@tanstack/react-router";
import { verifyWebhook, EventName, type PaddleEnv } from "@/lib/paddle.server";
import { planChangeDirection } from "@/lib/billing/paddleCatalog";
import { accessPeriodFromEvent } from "@/lib/billing/accessPeriod";
import { runAfterResponse } from "@/lib/http/waitUntil.server";

type SubscriptionData = {
  id: string;
  customerId: string;
  status: string;
  customData?: { userId?: string } | null;
  currentBillingPeriod?: { startsAt?: string; endsAt?: string } | null;
  scheduledChange?: { action?: string } | null;
  items: Array<{
    quantity?: number;
    price: { id: string; importMeta?: { externalId?: string | null } | null };
    product?: { id: string; importMeta?: { externalId?: string | null } | null } | null;
  }>;
};

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function readIds(data: SubscriptionData) {
  const item = data.items?.[0];
  return {
    priceId: item?.price?.importMeta?.externalId ?? null,
    productId: item?.product?.importMeta?.externalId ?? null,
    quantity: item?.quantity ?? 1,
  };
}

async function handleCreated(data: SubscriptionData, env: PaddleEnv) {
  const userId = data.customData?.userId;
  const { priceId, productId, quantity } = readIds(data);
  if (!userId) {
    console.error("[payments] missing customData.userId", data.id);
    return;
  }
  if (!priceId || !productId) {
    console.warn("[payments] missing importMeta.externalId", data.id);
    return;
  }

  const supabase = await admin();
  const { error } = await supabase.from("subscriptions").upsert(
    {
      user_id: userId,
      paddle_subscription_id: data.id,
      paddle_customer_id: data.customerId,
      product_id: productId,
      price_id: priceId,
      status: data.status,
      quantity,
      current_period_start: data.currentBillingPeriod?.startsAt ?? null,
      current_period_end: data.currentBillingPeriod?.endsAt ?? null,
      environment: env,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "paddle_subscription_id" },
  );
  if (error) throw new Error(`subscriptions upsert failed: ${error.message}`);

  const { applyPurchaseEffects } = await import("@/lib/billing/paddleEffects.server");
  await applyPurchaseEffects({
    userId,
    priceId,
    subscriptionId: data.id,
    periodEnd: data.currentBillingPeriod?.endsAt ?? null,
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
async function handleUpdated(data: SubscriptionData, env: PaddleEnv) {
  const supabase = await admin();
  const { priceId: eventPriceId, quantity } = readIds(data);

  const { data: existing } = await supabase
    .from("subscriptions")
    .select("user_id, price_id, status, current_period_end")
    .eq("paddle_subscription_id", data.id)
    .eq("environment", env)
    .maybeSingle();

  // Kolejność dostarczenia zdarzeń nie jest gwarantowana: `activated` potrafi
  // wyprzedzić `created`. Bez wiersza subskrypcji UPDATE trafiłby w pustkę i
  // zakup przepadłby po cichu - dlatego zakładamy go tą samą ścieżką co przy
  // utworzeniu (upsert, więc późniejsze `created` niczego nie zdubluje).
  if (!existing && data.customData?.userId) {
    await handleCreated(data, env);
    return;
  }


  // Zdarzenia stanu (pauza, wznowienie, past_due) bywają bez okresu
  // rozliczeniowego - wtedy zapisana data końca dostępu musi zostać nietknięta.
  const period = accessPeriodFromEvent({
    kind: "updated",
    eventPeriodEnd: data.currentBillingPeriod?.endsAt ?? null,
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
      cancel_at_period_end: data.scheduledChange?.action === "cancel",
      updated_at: new Date().toISOString(),
    })
    .eq("paddle_subscription_id", data.id)
    .eq("environment", env);
  if (error) throw new Error(`subscriptions update failed: ${error.message}`);

  // Zdarzenia stanu (pauza, wznowienie, past_due) potrafią nie nieść pozycji
  // cennika - wtedy pracujemy na cenie zapisanej przy subskrypcji.
  const priceId = eventPriceId ?? existing?.price_id ?? null;

  // Plan Zespół: zmiana liczby opłaconych miejsc oraz stanu subskrypcji musi
  // natychmiast przełożyć się na limit i uprawnienia całego zespołu.
  const { applySubscriptionSeats, applySubscriptionOrgState } = await import(
    "@/lib/organizations/teamSeats.server"
  );
  await applySubscriptionOrgState({ subscriptionId: data.id, status: data.status, priceId });
  await applySubscriptionSeats({ subscriptionId: data.id, quantity, priceId });

  if (!existing?.user_id || !priceId) return;


  // Każda aktualizacja (pauza, wznowienie, past_due, nowy okres) musi trafić do
  // uprawnień, nie tylko zmiana planu.
  const { resolvePlanForPrice, applyStatusTransitionEffects } = await import(
    "@/lib/billing/paddleEffects.server"
  );
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


  const { applyPlanChangeEffects } = await import("@/lib/billing/paddleEffects.server");
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

async function handleCanceled(data: SubscriptionData, env: PaddleEnv) {
  const supabase = await admin();
  const { data: existing } = await supabase
    .from("subscriptions")
    .select("user_id, price_id, current_period_end")
    .eq("paddle_subscription_id", data.id)
    .eq("environment", env)
    .maybeSingle();

  const { error } = await supabase
    .from("subscriptions")
    .update({ status: "canceled", updated_at: new Date().toISOString() })
    .eq("paddle_subscription_id", data.id)
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

  const { applyCancellationEffects } = await import("@/lib/billing/paddleEffects.server");

  await applyCancellationEffects({
    userId: existing.user_id,
    priceId: existing.price_id,
    subscriptionId: data.id,
    periodEnd: canceledPeriod.accessUntil,
    environment: env,
  });
}

type TransactionData = {
  id: string;
  subscriptionId?: string | null;
  customerId?: string | null;
  currencyCode?: string | null;
  customData?: Record<string, unknown> | null;
  customer?: { email?: string | null } | null;
  details?: { totals?: { grandTotal?: string | null } | null } | null;
  payments?: Array<{ errorCode?: string | null }> | null;
  billingPeriod?: { endsAt?: string | null } | null;
};

function amountFromTransaction(data: TransactionData): number | null {
  const raw = data.details?.totals?.grandTotal;
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

async function handleTransaction(
  data: TransactionData,
  env: PaddleEnv,
  occurredAt: string,
  kind: "failed" | "paid",
) {
  // Transakcja bez subskrypcji = płatność jednorazowa (odblokowanie treści,
  // bilet, darowizna). Rozpoznanie idzie po `custom_data`, które ustawia
  // serwer przy tworzeniu transakcji - klient nie ma jak go podmienić.
  if (!data.subscriptionId) {
    if (kind !== "paid") return;
    const { fulfilOneTimeTransaction } = await import("@/lib/billing/oneTimeFulfilment.server");
    await fulfilOneTimeTransaction({
      id: data.id,
      amountCents: amountFromTransaction(data),
      currency: data.currencyCode ?? null,
      customerEmail: data.customer?.email ?? null,
      customData: data.customData ?? null,
    });
    return;
  }
  const ctx = {
    subscriptionId: data.subscriptionId,
    environment: env,
    occurredAt,
    amountCents: amountFromTransaction(data),
    currency: data.currencyCode ?? null,
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
async function handleAdjustment(data: Record<string, unknown>, env: PaddleEnv): Promise<void> {
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
    action: (str("action") ?? "other") as "refund" | "chargeback" | "chargeback_warning" | "credit" | "other",
    status: str("status"),
    amountCents: Number.isFinite(amountCents) ? amountCents : null,
    currency: str("currencyCode") ?? totals?.currencyCode ?? null,
    environment: env,
  });
}


async function handleWebhookRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const env = (url.searchParams.get("env") === "live" ? "live" : "sandbox") as PaddleEnv;

  // Warstwa 1: adres nadawcy musi należeć do operatora (lista pobierana z jego
  // API, nigdy zaszyta w kodzie). Warstwa 2: podpis kryptograficzny poniżej.
  const { isAllowedWebhookIp } = await import("@/lib/billing/webhookIpAllowlist.server");
  if (!(await isAllowedWebhookIp(request, env))) {
    console.warn("[payments] webhook rejected - IP spoza allowlisty");
    return new Response("Forbidden", { status: 403 });
  }

  let event: Awaited<ReturnType<typeof verifyWebhook>>;
  try {
    event = await verifyWebhook(request, env);
  } catch (e) {
    console.error("[payments] webhook signature rejected", e);
    return new Response("Invalid signature", { status: 400 });
  }


  const { claimWebhookEvent, finishWebhookEvent } = await import(
    "@/lib/billing/webhookLog.server"
  );
  const raw = event.data as unknown as Record<string, unknown>;
  const occurredAt =
    typeof event.occurredAt === "string" ? event.occurredAt : new Date().toISOString();
  const ref = {
    eventId: event.eventId,
    eventType: String(event.eventType),
    environment: env,
    occurredAt,
    subscriptionId:
      (typeof raw.subscriptionId === "string" ? raw.subscriptionId : null) ??
      (typeof raw.id === "string" && String(event.eventType).startsWith("subscription.")
        ? raw.id
        : null),
    customerId: typeof raw.customerId === "string" ? raw.customerId : null,
    userId:
      typeof (raw.customData as { userId?: string } | null)?.userId === "string"
        ? (raw.customData as { userId?: string }).userId ?? null
        : null,
    payload: event as unknown,
  };

  // Idempotencja: operator ponawia dostarczenie tego samego zdarzenia.
  const fresh = await claimWebhookEvent(ref).catch((e) => {
    console.error("[payments] webhook log failed", e);
    return true;
  });
  if (!fresh) return Response.json({ received: true, duplicate: true });

  // Czas obsługi trafia do dziennika - w panelu widać od razu, czy handler
  // zaczyna się ślimaczyć (operator ponawia po timeoucie).
  const startedAt = Date.now();

  // Zdarzenie od operatora to najwcześniejszy sygnał, że integracja znowu
  // żyje (np. po podłączeniu nowego konta). Kontrola odcisku i ewentualne
  // odtworzenie katalogu idą "za odpowiedzią", żeby nie opóźniać ACK.
  runAfterResponse(
    import("@/lib/billing/catalogAutoSync.server")
      .then(({ ensureCatalogSynced }) => ensureCatalogSynced(env))
      .catch((e: unknown) => console.error("[payments] auto-sync check failed", e)),
  );

  try {
    switch (event.eventType) {
      case EventName.SubscriptionCreated:
        await handleCreated(event.data as unknown as SubscriptionData, env);
        break;
      // Wszystkie zdarzenia zmiany stanu subskrypcji dzielą jedną obsługę -
      // operator wysyła je jako osobne typy, ale autorytatywny jest `status`.
      case EventName.SubscriptionUpdated:
      case EventName.SubscriptionActivated:
      case EventName.SubscriptionTrialing:
      case EventName.SubscriptionPastDue:
      case EventName.SubscriptionPaused:
      case EventName.SubscriptionResumed:
      case EventName.SubscriptionImported:
        await handleUpdated(event.data as unknown as SubscriptionData, env);
        break;

      case EventName.SubscriptionCanceled:
        await handleCanceled(event.data as unknown as SubscriptionData, env);
        break;
      case EventName.TransactionPaymentFailed:
        await handleTransaction(event.data as unknown as TransactionData, env, occurredAt, "failed");
        break;
      case EventName.TransactionCompleted:
        await handleTransaction(event.data as unknown as TransactionData, env, occurredAt, "paid");
        break;
      case EventName.AdjustmentCreated:
      case EventName.AdjustmentUpdated:
        await handleAdjustment(event.data as unknown as Record<string, unknown>, env);
        break;
      default:
        await finishWebhookEvent(ref, "skipped", { durationMs: Date.now() - startedAt });
        return Response.json({ received: true });
    }
    await finishWebhookEvent(ref, "processed", { durationMs: Date.now() - startedAt });
    return Response.json({ received: true });
  } catch (e) {
    console.error("[payments] webhook error", e);
    await finishWebhookEvent(ref, "failed", {
      error: e instanceof Error ? e.message : String(e),
      durationMs: Date.now() - startedAt,
    });
    return new Response("Webhook error", { status: 500 });
  }
}

/** Wejście dla testów - identyczna ścieżka jak trasa HTTP. */
export const __handleForTests = handleWebhookRequest;

export const Route = createFileRoute("/api/public/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => handleWebhookRequest(request),
    },
  },
});


