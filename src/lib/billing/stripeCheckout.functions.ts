// Cienki plik z `createServerFn` - patrz dyrektywy repo. Cała logika mieszka
// w `adhocCheckout.server.ts` (Stripe Embedded Checkout).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { CHECKOUT_LOCALES } from "@/lib/billing/checkoutLocale";
import { resolveReturnUrl } from "@/lib/http/resolveReturnUrl";

const envSchema = z.enum(["sandbox", "live"]);
// Język ramki Stripe - musi trafić do sesji, bo checkout nie zna naszego i18n.
const localeSchema = z.enum(CHECKOUT_LOCALES);

const planCheckoutSchema = z.object({
  priceId: z.string().trim().min(1).max(64),
  quantity: z.number().int().min(1).max(100).optional(),
  planId: z.string().uuid(),
  couponCode: z.string().trim().max(64).optional(),
  returnUrl: z.string().url(),
  environment: envSchema.optional(),
  locale: localeSchema.optional(),
});

/**
 * Sesja Embedded Checkout dla planu z katalogu (`lookup_key`). Tryb
 * (subskrypcja / jednorazowa) wynika z typu ceny u Stripe. Kupon B2B jest
 * walidowany tym samym mechanizmem co dotychczas (`validate_b2b_coupon`) -
 * jeżeli ma odpowiednik u Stripe, przekazujemy `discounts`; jeśli jest
 * wyłącznie wewnętrzny, zakładamy jednorazowy kupon Stripe o tej samej kwocie.
 */
export const createPlanCheckoutSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => planCheckoutSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { userId, supabase, claims } = context;
    const { resolveEnvironment } = await import("@/lib/billing/adhocCheckout.server");
    const environment = resolveEnvironment(data.environment);

    const { data: plan, error: planErr } = await supabase
      .from("access_plans")
      .select("id, price_cents, currency, active")
      .eq("id", data.planId)
      .maybeSingle();
    if (planErr) throw planErr;
    if (!plan || !plan.active) return { ok: false as const, error: "plan_not_found" };

    // Rezerwacja kuponu ATOMOWO w bazie - dokładnie ta sama ścieżka co przy
    // zamówieniach ad-hoc (patrz checkout.functions.ts), więc limit użyć nie
    // rozjeżdża się między dwoma silnikami checkoutu.
    let discount: { coupon: string } | null = null;
    let couponId: string | null = null;
    let couponCode: string | null = null;
    // RABAT policzony przez bazę. Idzie w dwa miejsca naraz: do rezerwacji
    // (`_applied_cents`, kolumna o semantyce „rabat", nie „kwota zapłacona")
    // i do metadanych zamówienia, z których historia płatności czyta rabat.
    let couponDiscountCents = 0;
    if (data.couponCode) {
      const normalizedCode = data.couponCode.trim().toUpperCase();
      const { data: rows, error: validateErr } = await supabase.rpc("validate_b2b_coupon", {
        _code: normalizedCode,
        _plan_id: data.planId,
        _amount_cents: plan.price_cents,
        _currency: plan.currency,
      });
      if (validateErr) throw validateErr;
      const row = (rows ?? [])[0];
      if (!row || !row.ok) {
        return { ok: false as const, error: (row?.error ?? "not_found") as string };
      }
      couponId = row.coupon_id;
      couponCode = normalizedCode;
      couponDiscountCents = row.discount_cents;
      if (row.discount_cents > 0) {
        const { createAdhocDiscountForCoupon } = await import("@/lib/billing/adhocCheckout.server");
        const { createStripeClient } = await import("@/lib/stripe.server");
        const stripe = createStripeClient(environment);
        const couponRef = await createAdhocDiscountForCoupon(stripe, {
          code: normalizedCode,
          discountCents: row.discount_cents,
          currency: plan.currency,
        });
        if (couponRef) discount = { coupon: couponRef };
      }
    }

    const { data: order, error: insertErr } = await supabase
      .from("payment_orders")
      .insert({
        user_id: userId,
        kind: "subscription",
        status: "pending",
        amount_cents: plan.price_cents,
        currency: plan.currency,
        plan_id: data.planId,
        provider: "stripe",
        receipt_email: claims.email ?? null,
        environment,
        // PEŁNY audyt kuponu, w tym samym kształcie co w drugim silniku
        // (`checkout.functions.ts`). `paymentHistory.ts` czyta rabat DOKŁADNIE
        // z tych kluczy, więc bez nich klient widział w swojej historii cenę
        // bez śladu rabatu - przy zamówieniu, które u operatora zostało
        // pomniejszone co do grosza. `coupon_id` jest jedynym powiązaniem
        // zamówienia z konkretnym kuponem poza tabelą realizacji.
        metadata: couponCode
          ? {
              coupon_code: couponCode,
              coupon_id: couponId,
              coupon_discount_cents: couponDiscountCents,
              original_amount_cents: plan.price_cents,
            }
          : {},
      } as never)
      .select("id, tenant_id")
      .single();
    if (insertErr) throw insertErr;

    if (couponId) {
      // `_applied_cents` to RABAT, nie kwota zapłacona - semantyka ustalona
      // jawnie w migracji `20260725090200_fix_coupon_analytics_applied_cents
      // _inversion.sql` (niezmiennik: `original_cents = applied_cents +
      // zapłacone`). Przekazywane tu wcześniej zero łamało ten niezmiennik:
      // raport kosztu kuponów pokazywał zero rabatu, a „przychód netto"
      // w `b2b_coupons_analytics` i w `monetization_dashboard` był zawyżony
      // dokładnie o udzielony rabat - i to tylko dla zamówień z TEGO silnika.
      const { data: redeemed, error: redeemErr } = await supabase.rpc("redeem_b2b_coupon", {
        _coupon_id: couponId,
        _order_id: order.id,
        _applied_cents: couponDiscountCents,
        _original_cents: plan.price_cents,
        _currency: plan.currency,
      });
      if (redeemErr || !redeemed) {
        await (
          await import("@/lib/billing/markOrderSession.server")
        ).markOrderSession(supabase, { orderId: order.id, sessionId: null, status: "canceled" });
        return { ok: false as const, error: "limit_reached" };
      }
    }

    const [{ createPlanCheckoutSession: createSession }, { loadCheckoutSettings }] =
      await Promise.all([
        import("@/lib/billing/adhocCheckout.server"),
        import("@/lib/billing/checkoutSettings.server"),
      ]);
    // Flagi checkoutu tenantu, który stempluje zamówienie - ta sama ścieżka co
    // w `checkout.functions.ts`, żeby oba silniki checkoutu składały sesję
    // identycznie (kupony, Stripe Tax, NIP, faktury).
    const settings = await loadCheckoutSettings(supabase, order.tenant_id);
    const result = await createSession({
      environment,
      priceLookupKey: data.priceId,
      quantity: data.quantity,
      planId: data.planId,
      orderId: order.id,
      userId,
      customerEmail: claims.email ?? null,
      returnUrl: resolveReturnUrl(data.returnUrl),
      discount,
      locale: data.locale,
      settings,
    });

    if (!result.ok) {
      await (
        await import("@/lib/billing/markOrderSession.server")
      ).markOrderSession(supabase, { orderId: order.id, sessionId: null, status: "failed" });
      if (couponId) {
        await supabase.rpc("release_b2b_coupon", { _coupon_id: couponId, _order_id: order.id });
      }
      return { ok: false as const, error: result.error };
    }

    await (
      await import("@/lib/billing/markOrderSession.server")
    ).markOrderSession(supabase, {
      orderId: order.id,
      sessionId: result.sessionId,
      status: "processing",
    });

    return { ok: true as const, clientSecret: result.clientSecret, orderId: order.id };
  });

const adhocCheckoutSchema = z.object({
  purpose: z.enum(["content_unlock", "event_ticket", "donation"]),
  entityType: z.enum(["post", "page"]).optional(),
  entityId: z.string().uuid().optional(),
  eventId: z.string().uuid().optional(),
  amountCents: z.number().int().positive().optional(),
  currency: z.enum(["PLN", "EUR"]).optional(),
  returnUrl: z.string().url(),
  environment: envSchema.optional(),
  locale: localeSchema.optional(),
});

/**
 * Sesja Embedded Checkout z kwotą ad-hoc (odblokowanie treści, bilet,
 * darowizna). Konto wymagane dla treści/biletów; darowizny mogą być anonimowe.
 * Kwota NIGDY nie pochodzi z klienta dla treści/biletów - jest doczytywana
 * serwerowo z reguły dostępu / wydarzenia; dla darowizny (opcjonalnie
 * anonimowej) kwotę podaje ofiarodawca, ale jest walidowana minimum 50 gr.
 */
export const createAdhocCheckoutSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => adhocCheckoutSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { resolveEnvironment } = await import("@/lib/billing/adhocCheckout.server");
    const environment = resolveEnvironment(data.environment);
    const { buildAdhocOrder } = await import("@/lib/billing/adhocCheckoutOrder.server");
    return buildAdhocOrder({
      data: { ...data, returnUrl: resolveReturnUrl(data.returnUrl) },
      environment,
      supabase: context.supabase,
      userId: context.userId,
      email: context.claims.email ?? null,
      locale: data.locale,
    });
  });
