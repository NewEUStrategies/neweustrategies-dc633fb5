import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { PaddleEnv } from "@/lib/paddle.server";

const envSchema = z.enum(["sandbox", "live"]);

/** Zamiana czytelnego ID ceny na wewnętrzny identyfikator dostawcy. */
export const resolvePaddlePrice = createServerFn({ method: "GET" })
  .inputValidator((data: { priceId: string; environment: PaddleEnv }) =>
    z.object({ priceId: z.string().min(1).max(64), environment: envSchema }).parse(data),
  )
  .handler(async ({ data }) => {
    const { gatewayFetch } = await import("@/lib/paddle.server");
    const response = await gatewayFetch(
      data.environment,
      `/prices?external_id=${encodeURIComponent(data.priceId)}`,
    );
    if (!response.ok) {
      const body = await response.text();
      console.error(`[payments] price lookup failed [${response.status}]: ${body}`);
      throw new Error("price_lookup_failed");
    }
    const result = (await response.json()) as { data?: Array<{ id: string }> };
    const id = result.data?.[0]?.id;
    if (!id) throw new Error("price_not_found");
    return id;
  });

/**
 * Zmiana planu istniejącej subskrypcji.
 * - upgrade  -> natychmiast, z rozliczeniem proporcjonalnym,
 * - downgrade -> zaplanowane na koniec opłaconego okresu (bez proraty).
 */
export const changePaddlePlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { targetPriceId: string; environment: PaddleEnv }) =>
    z.object({ targetPriceId: z.string().min(1).max(64), environment: envSchema }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { catalogEntryByPriceId, planChangeDirection } = await import(
      "@/lib/billing/paddleCatalog"
    );
    const target = catalogEntryByPriceId(data.targetPriceId);
    if (!target) throw new Error("unknown_price");

    const { data: sub, error } = await context.supabase
      .from("subscriptions")
      .select("paddle_subscription_id, price_id, status")
      .eq("user_id", context.userId)
      .eq("environment", data.environment)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!sub?.paddle_subscription_id) throw new Error("no_active_subscription");

    const direction = planChangeDirection(sub.price_id, target.priceId);
    if (direction === "same") return { ok: true as const, direction };

    const { getPaddleClient } = await import("@/lib/paddle.server");
    const paddlePriceId = await resolvePaddlePrice({
      data: { priceId: target.priceId, environment: data.environment },
    });

    const paddle = getPaddleClient(data.environment);
    await paddle.subscriptions.update(sub.paddle_subscription_id, {
      items: [{ priceId: paddlePriceId, quantity: 1 }],
      prorationBillingMode:
        direction === "upgrade" ? "prorated_immediately" : "do_not_bill",
      ...(direction === "downgrade" ? { onPaymentFailure: "prevent_change" as const } : {}),
    });

    return { ok: true as const, direction };
  });

/** Link do portalu klienta (anulowanie, metoda płatności, faktury). */
export const createPaddlePortalSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { environment: PaddleEnv }) =>
    z.object({ environment: envSchema }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: sub, error } = await context.supabase
      .from("subscriptions")
      .select("paddle_customer_id, paddle_subscription_id")
      .eq("user_id", context.userId)
      .eq("environment", data.environment)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!sub?.paddle_customer_id) throw new Error("no_customer");

    const { getPaddleClient } = await import("@/lib/paddle.server");
    const paddle = getPaddleClient(data.environment);
    const session = await paddle.customerPortalSessions.create(
      sub.paddle_customer_id,
      sub.paddle_subscription_id ? [sub.paddle_subscription_id] : [],
    );
    return { url: session.urls.general.overview };
  });
