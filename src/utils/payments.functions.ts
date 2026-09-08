import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getStripeErrorMessage, type StripeEnv } from "@/lib/stripe.server";

const envSchema = z.enum(["sandbox", "live"]);

/** Zamiana czytelnego identyfikatora ceny (`lookup_key`) na `price_...` u Stripe. */
export const resolveStripePrice = createServerFn({ method: "GET" })
  .inputValidator((data: { priceId: string; environment: StripeEnv }) =>
    z.object({ priceId: z.string().min(1).max(64), environment: envSchema }).parse(data),
  )
  .handler(async ({ data }) => {
    // Restart integracji (nowe konto operatora, rotacja klucza) unieważnia
    // wewnętrzne identyfikatory cen. Sprawdzenie odcisku jest tanie
    // (debounce w izolacie), a pozwala odtworzyć katalog zanim ktoś kliknie
    // "Kup" i zobaczy błąd.
    const { ensureCatalogSynced } = await import("@/lib/billing/catalogAutoSync.server");
    await ensureCatalogSynced(data.environment).catch((e: unknown) => {
      console.error("[payments] auto-sync check failed", e);
    });

    const { resolveProviderPriceId } = await import("@/lib/billing/subscriptionProvider.server");
    const id = await resolveProviderPriceId(data.environment, data.priceId);
    if (!id) throw new Error("price_not_found");
    return id;
  });

/**
 * Zmiana planu istniejącej subskrypcji.
 * - upgrade  -> natychmiast, z rozliczeniem proporcjonalnym,
 * - downgrade -> zaplanowane na koniec opłaconego okresu (bez proraty).
 */
export const changeStripePlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { targetPriceId: string; environment: StripeEnv }) =>
    z.object({ targetPriceId: z.string().min(1).max(64), environment: envSchema }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { catalogEntryByPriceId, planChangeDirection } = await import("@/lib/billing/catalog");
    const target = catalogEntryByPriceId(data.targetPriceId);
    if (!target) throw new Error("unknown_price");

    const { data: sub, error } = await context.supabase
      .from("subscriptions")
      .select("provider_subscription_id, price_id, status, quantity")
      .eq("user_id", context.userId)
      .eq("environment", data.environment)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!sub?.provider_subscription_id) throw new Error("no_active_subscription");

    const direction = planChangeDirection(sub.price_id, target.priceId);
    if (direction === "same") return { ok: true as const, direction };

    const { changeSubscriptionPrice } = await import("@/lib/billing/subscriptionProvider.server");
    const result = await changeSubscriptionPrice(data.environment, sub.provider_subscription_id, {
      newPriceExternalId: target.priceId,
      quantity: sub.quantity ?? 1,
      direction,
    });
    if (!result.ok) {
      console.error("[payments] plan change failed", sub.provider_subscription_id, result.error);
      return { error: result.error };
    }

    return { ok: true as const, direction };
  });

/** Link do portalu klienta (anulowanie, zmiana planu/ceny, metoda płatności, faktury). */
export const createStripePortalSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { environment: StripeEnv; returnPath?: string }) =>
    z.object({ environment: envSchema, returnPath: z.string().max(300).optional() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: sub, error } = await context.supabase
      .from("subscriptions")
      .select("provider_customer_id")
      .eq("user_id", context.userId)
      .eq("environment", data.environment)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!sub?.provider_customer_id) return { error: "no_customer" as const };

    try {
      const { createStripeClient } = await import("@/lib/stripe.server");
      const { absoluteReturnUrl } = await import("@/lib/billing/returnUrl.server");
      const stripe = createStripeClient(data.environment);
      // Powrót na ekran, z którego użytkownik wszedł do portalu (ścieżka jest
      // sanityzowana - tylko adresy względne w obrębie serwisu).
      const returnUrl = absoluteReturnUrl(data.returnPath);
      const session = await stripe.billingPortal.sessions.create({
        customer: sub.provider_customer_id,
        return_url: returnUrl,
      });

      // Stripe otwiera jeden ogólny portal (bez osobnych podadresów per akcja
      // jak w Paddle) - użytkownik samodzielnie wybiera anulowanie/płatność.
      return {
        url: session.url,
        overviewUrl: session.url,
        updatePaymentMethodUrl: null,
        cancelUrl: null,
      };
    } catch (e) {
      return { error: getStripeErrorMessage(e) };
    }
  });

/**
 * Anulowanie subskrypcji z zachowaniem opłaconego okresu.
 * Dostawca planuje zmianę na koniec bieżącego cyklu - webhook
 * `customer.subscription.updated` domyka stan w bazie.
 */
export const cancelStripeSubscription = createServerFn({ method: "POST" })
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

    const { cancelSubscriptionAtPeriodEnd } =
      await import("@/lib/billing/subscriptionProvider.server");
    const result = await cancelSubscriptionAtPeriodEnd(
      data.environment,
      sub.provider_subscription_id,
    );
    if (!result.ok) return { error: result.error };
    return { ok: true as const };
  });

/**
 * Wznowienie subskrypcji. Dwa różne stany, jedna intencja użytkownika:
 * - zaplanowane anulowanie -> kasujemy zmianę, okres biegnie dalej,
 * - subskrypcja wstrzymana  -> wznawiamy ją u operatora od zaraz.
 */
export const resumeStripeSubscription = createServerFn({ method: "POST" })
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

    const { resumePausedSubscription, resumeScheduledCancellation } =
      await import("@/lib/billing/subscriptionProvider.server");

    if (sub.status === "paused") {
      const result = await resumePausedSubscription(data.environment, sub.provider_subscription_id);
      if (!result.ok) return { error: result.error };
      return { ok: true as const, mode: "unpaused" as const };
    }

    const result = await resumeScheduledCancellation(
      data.environment,
      sub.provider_subscription_id,
    );
    if (!result.ok) return { error: result.error };
    return { ok: true as const, mode: "cancellation_reverted" as const };
  });

/**
 * Kod promocyjny dla nakładki płatności: waliduje kupon w bazie i zwraca
 * identyfikator rabatu u dostawcy (tworząc go leniwie, gdy jeszcze nie istnieje).
 */
export const resolveStripeDiscount = createServerFn({ method: "POST" })
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
    const { resolveDiscountForCoupon } = await import("@/lib/billing/discounts.server");
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
 * Korzystamy z `invoices.createPreview` z tymczasową podmianą
 * pozycji, żeby pokazać dopłatę (upgrade) albo kwotę kolejnego rozliczenia
 * (downgrade) bez faktycznego dotykania subskrypcji.
 */
export const previewStripePlanChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { targetPriceId: string; environment: StripeEnv }) =>
    z.object({ targetPriceId: z.string().min(1).max(64), environment: envSchema }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { catalogEntryByPriceId, planChangeDirection } = await import("@/lib/billing/catalog");
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

    try {
      const { resolveProviderPriceId } = await import("@/lib/billing/subscriptionProvider.server");
      const providerPriceId = await resolveProviderPriceId(data.environment, target.priceId);
      if (!providerPriceId) {
        return {
          ok: false as const,
          direction,
          amountCents: null,
          currency: null,
          nextBilledAt: null,
        };
      }

      const { createStripeClient } = await import("@/lib/stripe.server");
      const stripe = createStripeClient(data.environment);
      const current = await stripe.subscriptions.retrieve(sub.provider_subscription_id);
      const itemId = current.items.data[0]?.id;
      const upcoming = await stripe.invoices.createPreview({
        subscription: sub.provider_subscription_id,
        subscription_details: {
          items: itemId
            ? [
                {
                  id: itemId,
                  price: providerPriceId,
                  quantity: Math.max(1, sub.quantity ?? 1),
                },
              ]
            : undefined,
          proration_behavior: direction === "upgrade" ? "always_invoice" : "none",
        },
      });

      return {
        ok: true as const,
        direction,
        amountCents: upcoming.amount_due ?? null,
        currency: upcoming.currency?.toUpperCase() ?? null,
        nextBilledAt: upcoming.next_payment_attempt
          ? new Date(upcoming.next_payment_attempt * 1000).toISOString()
          : null,
      };
    } catch (e) {
      console.error("[payments] plan preview failed", getStripeErrorMessage(e));
      // Brak podglądu nie może blokować zmiany planu - UI pokaże samą regułę.
      return {
        ok: false as const,
        direction,
        amountCents: null,
        currency: null,
        nextBilledAt: null,
      };
    }
  });

/**
 * Samodzielna zmiana liczby miejsc w planie rozliczanym za miejsce.
 * Zwiększenie rozlicza się proporcjonalnie od razu, zmniejszenie obowiązuje od
 * nowego okresu - opłacony okres należy się klientowi w całości.
 */
export const updateStripeSubscriptionSeats = createServerFn({ method: "POST" })
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

    const { updateSubscriptionQuantity } =
      await import("@/lib/billing/subscriptionProvider.server");
    const result = await updateSubscriptionQuantity(
      data.environment,
      sub.provider_subscription_id,
      {
        priceExternalId: entry.priceId,
        quantity: data.quantity,
        previousQuantity: sub.quantity ?? 1,
      },
    );
    if (!result.ok) {
      console.error("[payments] seat change failed", sub.provider_subscription_id, result.error);
      return { error: result.error };
    }
    // Stan w bazie domknie webhook `customer.subscription.updated`; zwracamy
    // wartość docelową, żeby panel nie migotał starą liczbą do czasu dostarczenia.
    return {
      ok: true as const,
      quantity: result.quantity,
      immediate: data.quantity > (sub.quantity ?? 1),
    };
  });

/**
 * Samoobsługowa synchronizacja: pobiera stan subskrypcji wołającego u operatora
 * i przepuszcza go przez tę samą ścieżkę co webhook. Użytkownik używa jej, gdy
 * po zakupie lub zmianie planu panel pokazuje nieaktualny stan (spóźniony
 * webhook). Idempotentna - powtórzenie nie duplikuje uprawnień ani dokumentów.
 */
export const syncMyBillingFromProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { environment: StripeEnv }) =>
    z.object({ environment: envSchema }).parse(data),
  )
  .handler(async ({ data, context }) => {
    // Identyfikatory czytamy pod RLS wołającego - warstwa serwerowa nigdy nie
    // decyduje samodzielnie, czyje subskrypcje pobiera od operatora.
    const { data: rows, error } = await context.supabase
      .from("subscriptions")
      .select("provider_subscription_id")
      .eq("user_id", context.userId)
      .eq("environment", data.environment)
      .order("created_at", { ascending: false })
      .limit(10);
    if (error) throw error;

    const localIds = (rows ?? [])
      .map((row) => row.provider_subscription_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);

    try {
      const { syncUserSubscriptionsFromProvider } = await import("@/lib/billing/selfSync.server");
      const result = await syncUserSubscriptionsFromProvider(
        data.environment,
        context.userId,
        localIds,
      );
      return { ok: true as const, ...result };
    } catch (e: unknown) {
      console.error("[payments] self sync failed", e);
      return { error: getStripeErrorMessage(e) };
    }
  });

/**
 * Podgląd domyślnej metody płatności wołającego (marka + cztery ostatnie
 * cyfry). Identyfikator klienta czytamy pod RLS wołającego z tabeli
 * `subscriptions` - warstwa serwerowa nigdy nie decyduje samodzielnie, czyją
 * kartę pobiera od operatora.
 */
export const getMyPaymentMethod = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { environment: StripeEnv }) =>
    z.object({ environment: envSchema }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("subscriptions")
      .select("provider_customer_id, provider_subscription_id")
      .eq("user_id", context.userId)
      .eq("environment", data.environment)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) throw error;

    const row = rows?.[0] ?? null;
    const customerId = row?.provider_customer_id ?? null;
    if (!customerId) return { method: null };

    try {
      const { fetchPaymentMethodPreview } = await import("@/lib/billing/paymentMethod.server");
      const method = await fetchPaymentMethodPreview({
        customerId,
        subscriptionId: row?.provider_subscription_id ?? null,
        environment: data.environment,
      });
      return { method };
    } catch (e: unknown) {
      console.error("[payments] payment method preview failed", e);
      return { error: getStripeErrorMessage(e) };
    }
  });
