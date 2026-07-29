// Odbiornik zdarzeń od dostawcy płatności.
// Autoryzacja: wyłącznie podpis kryptograficzny dostawcy (bez sesji Supabase) -
// trasa musi pozostać publiczna, dlatego cała weryfikacja dzieje się poniżej.
import { createFileRoute } from "@tanstack/react-router";
import { verifyWebhook, EventName, type PaddleEnv } from "@/lib/paddle.server";
import { planChangeDirection } from "@/lib/billing/paddleCatalog";

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
  });
}

async function handleUpdated(data: SubscriptionData, env: PaddleEnv) {
  const supabase = await admin();
  const { priceId, quantity } = readIds(data);

  const { data: existing } = await supabase
    .from("subscriptions")
    .select("user_id, price_id")
    .eq("paddle_subscription_id", data.id)
    .eq("environment", env)
    .maybeSingle();

  const { error } = await supabase
    .from("subscriptions")
    .update({
      status: data.status,
      ...(priceId ? { price_id: priceId } : {}),
      quantity,
      current_period_start: data.currentBillingPeriod?.startsAt ?? null,
      current_period_end: data.currentBillingPeriod?.endsAt ?? null,
      cancel_at_period_end: data.scheduledChange?.action === "cancel",
      updated_at: new Date().toISOString(),
    })
    .eq("paddle_subscription_id", data.id)
    .eq("environment", env);
  if (error) throw new Error(`subscriptions update failed: ${error.message}`);

  if (!existing?.user_id || !priceId) return;
  const direction = planChangeDirection(existing.price_id, priceId);
  if (direction === "same") return;

  const { applyPlanChangeEffects } = await import("@/lib/billing/paddleEffects.server");
  await applyPlanChangeEffects({
    userId: existing.user_id,
    priceId,
    previousPriceId: existing.price_id,
    direction,
    subscriptionId: data.id,
    periodEnd: data.currentBillingPeriod?.endsAt ?? null,
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

  if (!existing?.user_id || !existing.price_id) return;
  const { applyCancellationEffects } = await import("@/lib/billing/paddleEffects.server");
  await applyCancellationEffects({
    userId: existing.user_id,
    priceId: existing.price_id,
    subscriptionId: data.id,
    periodEnd: existing.current_period_end ?? null,
    environment: env,
  });
}

export const Route = createFileRoute("/api/public/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const env = (url.searchParams.get("env") === "live" ? "live" : "sandbox") as PaddleEnv;
        try {
          const event = await verifyWebhook(request, env);
          switch (event.eventType) {
            case EventName.SubscriptionCreated:
              await handleCreated(event.data as unknown as SubscriptionData, env);
              break;
            case EventName.SubscriptionUpdated:
              await handleUpdated(event.data as unknown as SubscriptionData, env);
              break;
            case EventName.SubscriptionCanceled:
              await handleCanceled(event.data as unknown as SubscriptionData, env);
              break;
            default:
              console.log("[payments] unhandled event", event.eventType);
          }
          return Response.json({ received: true });
        } catch (e) {
          console.error("[payments] webhook error", e);
          return new Response("Webhook error", { status: 400 });
        }
      },
    },
  },
});
