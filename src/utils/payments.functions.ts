import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { StripeEnv } from "@/lib/stripe.server";

const envSchema = z.enum(["sandbox", "live"]);

/** Zamiana czytelnego ID ceny na wewnętrzny identyfikator dostawcy. */
export const resolvePaddlePrice = createServerFn({ method: "GET" })
  .inputValidator((data: { priceId: string; environment: StripeEnv }) =>
    z.object({ priceId: z.string().min(1).max(64), environment: envSchema }).parse(data),
  )
  .handler(async ({ data }) => {
    const { gatewayFetch } = await import("@/lib/stripe.server");
    // Restart integracji (nowe konto operatora, rotacja klucza) unieważnia
    // wewnętrzne identyfikatory cen. Sprawdzenie odcisku jest tanie
    // (debounce w izolacie), a pozwala odtworzyć katalog zanim ktoś kliknie
    // "Kup" i zobaczy błąd.
    const { ensureCatalogSynced } = await import("@/lib/billing/catalogAutoSync.server");
    await ensureCatalogSynced(data.environment).catch((e: unknown) => {
      console.error("[payments] auto-sync check failed", e);
    });
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
    let id = result.data?.[0]?.id;
    if (!id) {
      // Brak ceny to typowy objaw restartu integracji (nowe konto operatora,
      // odtworzone środowisko). Odtwarzamy katalog i próbujemy raz jeszcze,
      // zamiast blokować użytkownikowi zakup.
      const { healCatalogOnce } = await import("@/lib/billing/catalogSync.server");
      await healCatalogOnce(data.environment);
      const retry = await gatewayFetch(
        data.environment,
        `/prices?external_id=${encodeURIComponent(data.priceId)}`,
      );
      if (retry.ok) {
        const retried = (await retry.json()) as { data?: Array<{ id: string }> };
        id = retried.data?.[0]?.id;
      }
    }
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
  .inputValidator((data: { targetPriceId: string; environment: StripeEnv }) =>
    z.object({ targetPriceId: z.string().min(1).max(64), environment: envSchema }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { catalogEntryByPriceId, planChangeDirection } =
      await import("@/lib/billing/catalog");
    const target = catalogEntryByPriceId(data.targetPriceId);
    if (!target) throw new Error("unknown_price");

    const { data: sub, error } = await context.supabase
      .from("subscriptions")
      .select("provider_subscription_id, price_id, status")
      .eq("user_id", context.userId)
      .eq("environment", data.environment)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!sub?.provider_subscription_id) throw new Error("no_active_subscription");

    const direction = planChangeDirection(sub.price_id, target.priceId);
    if (direction === "same") return { ok: true as const, direction };

    const { getPaddleClient } = await import("@/lib/stripe.server");
    const paddlePriceId = await resolvePaddlePrice({
      data: { priceId: target.priceId, environment: data.environment },
    });

    const paddle = getPaddleClient(data.environment);
    await paddle.subscriptions.update(sub.provider_subscription_id, {
      items: [{ priceId: paddlePriceId, quantity: 1 }],
      prorationBillingMode: direction === "upgrade" ? "prorated_immediately" : "do_not_bill",
      ...(direction === "downgrade" ? { onPaymentFailure: "prevent_change" as const } : {}),
    });

    return { ok: true as const, direction };
  });

/** Link do portalu klienta (anulowanie, metoda płatności, faktury). */
export const createPaddlePortalSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { environment: StripeEnv }) =>
    z.object({ environment: envSchema }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: sub, error } = await context.supabase
      .from("subscriptions")
      .select("provider_customer_id, provider_subscription_id")
      .eq("user_id", context.userId)
      .eq("environment", data.environment)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!sub?.provider_customer_id) throw new Error("no_customer");

    const { getPaddleClient } = await import("@/lib/stripe.server");
    const paddle = getPaddleClient(data.environment);
    const session = await paddle.customerPortalSessions.create(
      sub.provider_customer_id,
      sub.provider_subscription_id ? [sub.provider_subscription_id] : [],
    );

    // Portal wystawia osobne, jednorazowe adresy per akcja - dzięki temu
    // profil może otworzyć od razu właściwy ekran (metoda płatności /
    // anulowanie) zamiast zrzucać użytkownika na ogólny pulpit.
    const perSubscription = session.urls.subscriptions?.[0];
    return {
      url: session.urls.general.overview,
      overviewUrl: session.urls.general.overview,
      updatePaymentMethodUrl: perSubscription?.updateSubscriptionPaymentMethod ?? null,
      cancelUrl: perSubscription?.cancelSubscription ?? null,
    };
  });

/**
 * Anulowanie subskrypcji z zachowaniem opłaconego okresu.
 * Dostawca planuje zmianę na koniec bieżącego cyklu - webhook
 * `subscription.updated` domyka stan w bazie.
 */
export const cancelPaddleSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { environment: StripeEnv }) =>
    z.object({ environment: envSchema }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: sub, error } = await context.supabase
      .from("subscriptions")
      .select("provider_subscription_id")
      .eq("user_id", context.userId)
      .eq("environment", data.environment)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!sub?.provider_subscription_id) throw new Error("no_active_subscription");

    const { getPaddleClient } = await import("@/lib/stripe.server");
    await getPaddleClient(data.environment).subscriptions.cancel(sub.provider_subscription_id, {
      effectiveFrom: "next_billing_period",
    });
    return { ok: true as const };
  });

/**
 * Wznowienie subskrypcji. Dwa różne stany, jedna intencja użytkownika:
 * - zaplanowane anulowanie -> kasujemy zmianę, okres biegnie dalej,
 * - subskrypcja wstrzymana  -> wznawiamy ją u operatora od zaraz.
 */
export const resumePaddleSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { environment: StripeEnv }) =>
    z.object({ environment: envSchema }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: sub, error } = await context.supabase
      .from("subscriptions")
      .select("provider_subscription_id, status")
      .eq("user_id", context.userId)
      .eq("environment", data.environment)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!sub?.provider_subscription_id) throw new Error("no_active_subscription");

    const { getPaddleClient } = await import("@/lib/stripe.server");
    const paddle = getPaddleClient(data.environment);

    if (sub.status === "paused") {
      await paddle.subscriptions.resume(sub.provider_subscription_id, {
        effectiveFrom: "immediately",
      });
      return { ok: true as const, mode: "unpaused" as const };
    }

    await paddle.subscriptions.update(sub.provider_subscription_id, { scheduledChange: null });
    return { ok: true as const, mode: "cancellation_reverted" as const };
  });

/**
 * Kod promocyjny dla nakładki płatności: waliduje kupon w bazie i zwraca
 * identyfikator rabatu u dostawcy (tworząc go leniwie, gdy jeszcze nie istnieje).
 */
export const resolvePaddleDiscount = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      code: string;
      planId: string;
      amountCents: number;
      currency: string;
      environment: StripeEnv;
    }) =>
      z
        .object({
          code: z.string().trim().min(1).max(64),
          planId: z.string().uuid(),
          amountCents: z.number().int().positive(),
          currency: z.string().trim().length(3),
          environment: envSchema,
        })
        .parse(data),
  )
  .handler(async ({ data }) => {
    const { resolveDiscountForCoupon } = await import("@/lib/billing/paddleDiscounts.server");
    return await resolveDiscountForCoupon({
      environment: data.environment,
      code: data.code,
      planId: data.planId,
      amountCents: data.amountCents,
      currency: data.currency.toUpperCase(),
    });
  });

/**
 * Podgląd kosztu zmiany planu PRZED potwierdzeniem.
 *
 * Operator liczy proratę po swojej stronie (kredyt za niewykorzystany okres,
 * podatek wg adresu klienta), więc jedynym uczciwym źródłem kwoty jest jego
 * endpoint podglądu. Upgrade pokazuje dopłatę do zapłaty od razu, downgrade -
 * datę i kwotę następnego rozliczenia.
 */
export const previewPaddlePlanChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { targetPriceId: string; environment: StripeEnv }) =>
    z.object({ targetPriceId: z.string().min(1).max(64), environment: envSchema }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { catalogEntryByPriceId, planChangeDirection } =
      await import("@/lib/billing/catalog");
    const target = catalogEntryByPriceId(data.targetPriceId);
    if (!target) throw new Error("unknown_price");

    const { data: sub, error } = await context.supabase
      .from("subscriptions")
      .select("provider_subscription_id, price_id, quantity")
      .eq("user_id", context.userId)
      .eq("environment", data.environment)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!sub?.provider_subscription_id) throw new Error("no_active_subscription");

    const direction = planChangeDirection(sub.price_id, target.priceId);
    if (direction === "same") {
      return {
        ok: true as const,
        direction,
        amountCents: null,
        currency: null,
        nextBilledAt: null,
      };
    }

    const paddlePriceId = await resolvePaddlePrice({
      data: { priceId: target.priceId, environment: data.environment },
    });
    const { gatewayFetch } = await import("@/lib/stripe.server");
    const res = await gatewayFetch(
      data.environment,
      `/subscriptions/${encodeURIComponent(sub.provider_subscription_id)}/preview`,
      {
        method: "PATCH",
        body: JSON.stringify({
          items: [{ price_id: paddlePriceId, quantity: Math.max(1, sub.quantity ?? 1) }],
          proration_billing_mode: direction === "upgrade" ? "prorated_immediately" : "do_not_bill",
          ...(direction === "downgrade"
            ? { billing_cycle: { effective_from: "next_billing_period" } }
            : {}),
        }),
      },
    );
    if (!res.ok) {
      console.error("[payments] plan preview failed", res.status, await res.text());
      // Brak podglądu nie może blokować zmiany planu - UI pokaże samą regułę.
      return {
        ok: false as const,
        direction,
        amountCents: null,
        currency: null,
        nextBilledAt: null,
      };
    }
    const json = (await res.json()) as {
      data?: {
        next_billed_at?: string | null;
        immediate_transaction?: {
          details?: { totals?: { grand_total?: string; currency_code?: string } | null } | null;
        } | null;
        next_transaction?: {
          details?: { totals?: { grand_total?: string; currency_code?: string } | null } | null;
        } | null;
      };
    };
    const totals =
      direction === "upgrade"
        ? json.data?.immediate_transaction?.details?.totals
        : json.data?.next_transaction?.details?.totals;
    const parsed = totals?.grand_total ? Number.parseInt(totals.grand_total, 10) : NaN;
    return {
      ok: true as const,
      direction,
      amountCents: Number.isFinite(parsed) ? parsed : null,
      currency: totals?.currency_code ?? null,
      nextBilledAt: json.data?.next_billed_at ?? null,
    };
  });

/**
 * Samodzielna zmiana liczby miejsc w planie rozliczanym za miejsce.
 * Zwiększenie rozlicza się proporcjonalnie od razu, zmniejszenie obowiązuje od
 * nowego okresu - opłacony okres należy się klientowi w całości.
 */
export const updatePaddleSubscriptionSeats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { quantity: number; environment: StripeEnv }) =>
    z.object({ quantity: z.number().int().min(1).max(500), environment: envSchema }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: sub, error } = await context.supabase
      .from("subscriptions")
      .select("provider_subscription_id, price_id, quantity, status")
      .eq("user_id", context.userId)
      .eq("environment", data.environment)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!sub?.provider_subscription_id) throw new Error("no_active_subscription");

    const { catalogEntryByPriceId } = await import("@/lib/billing/catalog");
    const entry = catalogEntryByPriceId(sub.price_id);
    if (!entry?.perSeat) throw new Error("not_per_seat_plan");

    const { updateSubscriptionQuantity } = await import("@/lib/billing/paddleSubscription.server");
    const result = await updateSubscriptionQuantity(data.environment, sub.provider_subscription_id, {
      priceExternalId: entry.priceId,
      quantity: data.quantity,
      previousQuantity: sub.quantity ?? 1,
    });
    if (!result.ok) {
      console.error("[payments] seat change failed", sub.provider_subscription_id, result.error);
      throw new Error("seat_change_failed");
    }
    // Stan w bazie domknie webhook `subscription.updated`; zwracamy wartość
    // docelową, żeby panel nie migotał starą liczbą do czasu dostarczenia.
    return {
      ok: true as const,
      quantity: result.quantity,
      immediate: data.quantity > (sub.quantity ?? 1),
    };
  });
