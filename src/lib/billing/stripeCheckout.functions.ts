// Cienki plik z `createServerFn` - patrz dyrektywy repo. Cała logika mieszka
// w `adhocCheckout.server.ts` (Stripe Embedded Checkout).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isBelowMinimumCharge } from "@/lib/billing/chargeMinimum";
import { CHECKOUT_LOCALES } from "@/lib/billing/checkoutLocale";
import { isCodeProbeRateLimited, parseCouponVerdict } from "@/lib/billing/coupons";
import { isPremiumNewsletterConsentVersion } from "@/lib/billing/premiumNewsletter";
import { resolveReturnUrl } from "@/lib/http/resolveReturnUrl";

const envSchema = z.enum(["sandbox", "live"]);
// Język ramki Stripe - musi trafić do sesji, bo checkout nie zna naszego i18n.
const localeSchema = z.enum(CHECKOUT_LOCALES);

// CENA I ILOŚĆ NIE PRZYCHODZĄ Z ŻĄDANIA. Do audytów PAY-01 i SUB-05 schemat
// przyjmował `priceId` i `quantity`, które szły wprost do sesji, a zamówienie
// dostawało `plan_id`, kwotę z planu i zawsze `kind: subscription`. Ręcznie
// złożone żądanie wiązało więc dowolną cenę katalogu z dowolnym planem: kupon
// kwotowy dopasowany do drogiego planu plus `priceId: pro_annual` dawało
// pierwszą fakturę Pro za 0 zł, `quantity: 5` przy planie jednostkowym -
// obciążenie 5 × cena przy zamówieniu za jedną sztukę, a plan z ceną
// jednorazową zakładał zamówienie subskrypcyjne z obcą kwotą. Cenę, ilość,
// kwotę i tryb liczy teraz serwer z wiersza planu (`planPricing.ts`) - tą samą
// funkcją co drugi silnik.
//
// Pola klienta sprzed zmiany (wdrożony `main` wysyłał `priceId` i `quantity`)
// zostają WYŁĄCZNIE jako zgodność wstecz: `priceId` jest asercją (inna cena niż
// pozycja planu = odmowa `plan_price_mismatch`, nigdy źródło ceny), a
// `quantity` to dawna nazwa `seats` - obie liczą się tylko dla planu za miejsce.
const planCheckoutSchema = z.object({
  planId: z.string().uuid(),
  // Liczba miejsc - honorowana WYŁĄCZNIE dla wpisów katalogu `perSeat`
  // (ta sama semantyka co `seats` w `checkout.functions.ts`).
  seats: z.number().int().min(1).max(100).optional(),
  /** Dawna nazwa `seats` (klient sprzed zmiany) - `seats` ma pierwszeństwo. */
  quantity: z.number().int().min(1).max(100).optional(),
  /** Asercja klienta sprzed zmiany: `lookup_key`, który JEGO zdaniem ma plan. */
  priceId: z.string().trim().min(1).max(64).optional(),
  couponCode: z.string().trim().max(64).optional(),
  returnUrl: z.string().url(),
  environment: envSchema.optional(),
  locale: localeSchema.optional(),
  // Zgoda na newsletter z NIEZAZNACZONEGO domyślnie pola (SUB-15). Brak klucza
  // = brak zgody. Wersja musi być w rejestrze treści, bo dowodem jest dokładnie
  // ten tekst, który kupujący widział w tym języku.
  newsletterConsent: z
    .object({
      version: z.string().trim().max(32).refine(isPremiumNewsletterConsentVersion),
      lang: z.enum(["pl", "en"]),
    })
    .strict()
    .optional(),
});

/**
 * Sesja Embedded Checkout dla planu z katalogu (`lookup_key`). Cena katalogowa,
 * ilość, kwota i tryb (subskrypcja / jednorazowa) wynikają z WIERSZA PLANU
 * (`planCheckoutPricing`, wyłącznie dokładna para warstwa-cykl), a sesja
 * odmawia, gdy cena u operatora ma inny typ, walutę, cykl albo kwotę niż
 * zamówienie (`price_mismatch`). Kupon B2B jest walidowany tym samym
 * mechanizmem co w drugim silniku (`validate_b2b_coupon`) od kwoty brutto
 * wyliczonej tutaj, z tym samym minimum operatora po rabacie
 * (`final_amount_too_low`); rabat trafia do operatora jako jednorazowy kupon
 * Stripe o tej samej kwocie.
 *
 * JEDNA SUBSKRYPCJA I JEDEN TRIAL NA KONTO (audyt SUB-13): żywa subskrypcja
 * planu w lustrze `subscriptions` odmawia `subscription_exists` PRZED kuponem
 * i zamówieniem, a wcześniejsza subskrypcja zdejmuje okres próbny; historię
 * u operatora (okno przed webhookiem, druga karta) sprawdza jeszcze
 * `createPlanCheckoutSession` z `adhocCheckout.server.ts`.
 *
 * KWOTA ZAMÓWIENIA = kwota PO kuponie, PRZED podatkiem - ta sama semantyka co
 * w `checkout.functions.ts` (brutto w `metadata.original_amount_cents`, rabat
 * w `metadata.coupon_discount_cents`). Realizacja porównuje ją z kwotą sesji
 * operatora (`amount_subtotal - amount_discount`), więc oba silniki muszą
 * zapisywać to samo.
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
      .select(
        "id, price_cents, currency, active, trial_days, tier_key, interval, volume_threshold_seats, volume_price_cents",
      )
      .eq("id", data.planId)
      .maybeSingle();
    if (planErr) throw planErr;
    if (!plan || !plan.active) return { ok: false as const, error: "plan_not_found" };

    // Wycena PRZED kuponem i zamówieniem: plan bez spójnej ceny katalogowej
    // nie może zarezerwować użycia kuponu ani zostawić zamówienia `pending`.
    const { planCheckoutPricing } = await import("@/lib/billing/planPricing");
    const pricing = planCheckoutPricing(plan, data.seats ?? data.quantity);
    if (!pricing) return { ok: false as const, error: "plan_price_missing" };
    // `priceId` klienta sprzed zmiany tylko jako asercja: inna cena niż pozycja
    // planu to żądanie o coś innego, niż kupujący widział - odmowa, nie sesja
    // (audyt SUB-05; plan Pro z `priceId: "student_monthly"`).
    if (data.priceId !== undefined && data.priceId !== pricing.entry.priceId) {
      return { ok: false as const, error: "plan_price_mismatch" };
    }
    // Plan za zero (albo próg wolumenowy bez stawki) nie jest przedmiotem kasy -
    // ta sama odmowa co w drugim silniku.
    if (pricing.amountCents <= 0) return { ok: false as const, error: "zero_amount" };
    const currency = String(plan.currency);
    const grossCents = pricing.amountCents;

    // Druga subskrypcja i ponowny trial (ta sama reguła co w drugim silniku).
    // Lustro `subscriptions` pod RLS kupującego: konto i najemca z sesji.
    // Konflikt liczony względem KUPOWANEJ pozycji: przejście między modelem
    // za miejsce a indywidualnym to osobny zakup, nie zmiana planu.
    let trialEligible = true;
    if (pricing.kind === "subscription") {
      const { loadLocalPlanSubscriptionHistory, SUBSCRIPTION_EXISTS_ERROR } =
        await import("@/lib/billing/planSubscriptionGuard");
      const history = await loadLocalPlanSubscriptionHistory(supabase, {
        userId,
        environment,
        target: pricing.entry,
      });
      if (history.hasLive) return { ok: false as const, error: SUBSCRIPTION_EXISTS_ERROR };
      trialEligible = !history.hadAny;
    }

    // Rezerwacja kuponu ATOMOWO w bazie - dokładnie ta sama ścieżka co przy
    // zamówieniach ad-hoc (patrz checkout.functions.ts), więc limit użyć nie
    // rozjeżdża się między dwoma silnikami checkoutu.
    let couponId: string | null = null;
    let couponCode: string | null = null;
    // RABAT policzony przez bazę. Idzie w trzy miejsca naraz: do rezerwacji
    // (`_applied_cents`, kolumna o semantyce „rabat", nie „kwota zapłacona"),
    // do kuponu operatora i do metadanych zamówienia, z których historia
    // płatności czyta rabat.
    let couponDiscountCents = 0;
    // Kwota do zapłaty po kuponie (`final_cents` z bazy) - to ją zapisuje
    // zamówienie, a nie cenę planu.
    let amountCents = grossCents;
    if (data.couponCode) {
      const normalizedCode = data.couponCode.trim().toUpperCase();
      // Rola serwisowa z jawnym najemcą, kontem i skrótem adresu - baza liczy
      // pudła tej kasy także po adresie (20261007120200, audyt ed13 N-13-1).
      // Kwota walidacji to BRUTTO z wyceny (ilość, próg wolumenowy), nie
      // `price_cents` - kupon procentowy na pięć miejsc liczy się od pięciu.
      const { validatePlanCouponForUser } = await import("@/lib/billing/couponRpc.server");
      const { data: rows, error: validateErr } = await validatePlanCouponForUser(supabase, {
        userId,
        code: normalizedCode,
        planId: data.planId,
        amountCents: grossCents,
        currency,
      });
      // Limit prób kodów (`_coupon_probe_guard`) wraca WŁASNYM powodem: strona
      // kasy mówi wtedy „odczekaj", a nie „płatności nieskonfigurowane".
      if (validateErr) {
        if (isCodeProbeRateLimited(validateErr)) {
          return { ok: false as const, error: "rate_limited" };
        }
        throw validateErr;
      }
      const row = parseCouponVerdict(rows);
      if (!row || !row.ok) {
        return { ok: false as const, error: (row?.error ?? "not_found") as string };
      }
      couponId = row.coupon_id;
      couponCode = normalizedCode;
      couponDiscountCents = row.discount_cents;
      amountCents = row.final_cents;
      // MINIMUM OPERATORA PO KUPONIE - ta sama reguła i ten sam kod odmowy co
      // w `checkout.functions.ts` (`chargeMinimum.ts`). Dotąd ten silnik nie
      // miał progu: kupon 100% zakładał zamówienie na 0 zł (dla planu
      // jednorazowego - dożywotni dostęp za darmo), a kwota poniżej minimum
      // padała dopiero u operatora, PO zamówieniu i rezerwacji kuponu
      // (przegląd PAY-01, 0.3). Odmowa zapada przed jednym i drugim.
      if (isBelowMinimumCharge(amountCents, currency)) {
        return { ok: false as const, error: "final_amount_too_low" };
      }
    }

    const { data: order, error: insertErr } = await supabase
      .from("payment_orders")
      .insert({
        user_id: userId,
        // Rodzaj z wyceny: plan jednorazowy (Decision Lab) nie jest
        // subskrypcją - realizacja i uprawnienie idą wtedy ścieżką zakupu.
        kind: pricing.kind,
        status: "pending",
        amount_cents: amountCents,
        currency,
        plan_id: data.planId,
        provider: "stripe",
        receipt_email: claims.email ?? null,
        environment,
        // PEŁNY audyt kuponu, w tym samym kształcie co w drugim silniku
        // (`checkout.functions.ts`). `paymentHistory.ts` czyta rabat DOKŁADNIE
        // z tych kluczy, więc bez nich klient widział w swojej historii cenę
        // bez śladu rabatu - przy zamówieniu, które u operatora zostało
        // pomniejszone co do grosza. `coupon_id` jest jedynym powiązaniem
        // zamówienia z konkretnym kuponem poza tabelą realizacji. `quantity`
        // to sztuki pozycji sesji - bez niego kwota za pięć miejsc wyglądała
        // jak cena jednego.
        metadata: {
          quantity: pricing.quantity,
          ...(couponCode
            ? {
                coupon_code: couponCode,
                coupon_id: couponId,
                coupon_discount_cents: couponDiscountCents,
                original_amount_cents: grossCents,
              }
            : {}),
        },
      } as never)
      .select("id, tenant_id")
      .single();
    if (insertErr) throw insertErr;

    const { markOrderSession } = await import("@/lib/billing/markOrderSession.server");

    if (couponId) {
      // `_applied_cents` to RABAT, nie kwota zapłacona - semantyka ustalona
      // jawnie w migracji `20260725090200_fix_coupon_analytics_applied_cents
      // _inversion.sql` (niezmiennik: `original_cents = applied_cents +
      // zapłacone`). Przekazywane tu wcześniej zero łamało ten niezmiennik:
      // raport kosztu kuponów pokazywał zero rabatu, a „przychód netto"
      // w `b2b_coupons_analytics` i w `monetization_dashboard` był zawyżony
      // dokładnie o udzielony rabat - i to tylko dla zamówień z TEGO silnika.
      const { redeemCouponForUser } = await import("@/lib/billing/couponRpc.server");
      const { data: redeemed, error: redeemErr } = await redeemCouponForUser(supabase, {
        tenantId: order.tenant_id,
        userId,
        couponId,
        orderId: order.id,
        appliedCents: couponDiscountCents,
        originalCents: grossCents,
        currency,
      });
      if (redeemErr || !redeemed) {
        await markOrderSession(supabase, {
          orderId: order.id,
          sessionId: null,
          status: "canceled",
        });
        return { ok: false as const, error: "limit_reached" };
      }
    }

    // Odmowa PO założeniu zamówienia: zamówienie dostaje `failed` (nigdy
    // wiszące `pending`), a zarezerwowane użycie kuponu wraca do puli -
    // inaczej limit przepadałby za zamówienie, którego nikt nie opłaci.
    const failOrder = async (error: string) => {
      await markOrderSession(supabase, { orderId: order.id, sessionId: null, status: "failed" });
      if (couponId) {
        const { releaseCouponForUser } = await import("@/lib/billing/couponRpc.server");
        const { error: releaseErr } = await releaseCouponForUser(supabase, {
          tenantId: order.tenant_id,
          userId,
          couponId,
          orderId: order.id,
        });
        if (releaseErr) {
          console.error("[stripe-checkout] coupon release failed", order.id, releaseErr.message);
        }
      }
      return { ok: false as const, error };
    };

    const [
      { createPlanCheckoutSession: createSession, createAdhocDiscountForCoupon },
      { loadCheckoutSettings },
    ] = await Promise.all([
      import("@/lib/billing/adhocCheckout.server"),
      import("@/lib/billing/checkoutSettings.server"),
    ]);

    // Rabat u operatora powstaje DOPIERO PO zamówieniu: klucz idempotencji
    // kuponu pochodzi z `order.id`, więc ponowione żądanie nie zakłada na
    // wspólnym koncie drugiego kuponu `amount_off` na ten sam rabat. Kupon,
    // którego operator nie założył, to sesja po cenie BEZ rabatu przy
    // zamówieniu zapisanym po rabacie - kupujący zapłaciłby więcej, niż
    // pokazała kasa, więc to odmowa, nie cicha sesja bez zniżki.
    let discount: { coupon: string } | null = null;
    if (couponCode && couponDiscountCents > 0) {
      try {
        const { getStripeClient } = await import("@/lib/stripe.server");
        const stripe = await getStripeClient(environment);
        const couponRef = await createAdhocDiscountForCoupon(stripe, {
          code: couponCode,
          discountCents: couponDiscountCents,
          currency,
          orderId: order.id,
        });
        if (!couponRef) return await failOrder("discount_unavailable");
        discount = { coupon: couponRef };
      } catch (e) {
        const { getStripeErrorMessage } = await import("@/lib/stripe.server");
        console.error("[stripe-checkout] provider coupon failed", order.id, e);
        return await failOrder(getStripeErrorMessage(e));
      }
    }

    // Flagi checkoutu tenantu, który stempluje zamówienie - ta sama ścieżka co
    // w `checkout.functions.ts`, żeby oba silniki checkoutu składały sesję
    // identycznie (kupony, Stripe Tax, NIP, faktury).
    const settings = await loadCheckoutSettings(supabase, order.tenant_id);
    const result = await createSession({
      environment,
      priceLookupKey: pricing.entry.priceId,
      quantity: pricing.quantity,
      // Kwota BRUTTO z wyceny (PRZED kuponem) i waluta zamówienia: cena
      // u operatora innego typu, w innej walucie, w innym cyklu albo z inną
      // kwotą za tę liczbę sztuk niż zamówienie kończy się `price_mismatch`,
      // nie sesją.
      expectedAmountCents: grossCents,
      expectedCurrency: currency,
      planId: data.planId,
      orderId: order.id,
      userId,
      customerEmail: claims.email ?? null,
      returnUrl: resolveReturnUrl(data.returnUrl),
      discount,
      locale: data.locale,
      // OKRES PRÓBNY Z PLANU - ta sama reguła co w `checkout.functions.ts`.
      // U Stripe trial nie siedzi na cenie (katalog trzyma `trial_days` tylko
      // w metadanych ceny), więc bez tego pola trasa `/checkout/$planId`
      // obciążała kartę od razu, choć cennik obiecywał okres próbny (audyt
      // wyd. 11/12, defekt wysoki). Plan jednorazowy triala nie ma.
      trialDays: pricing.mode === "subscription" ? Math.max(0, Number(plan.trial_days ?? 0)) : 0,
      trialEligible,
      settings,
      // Chwila zgody = przyjęcie zaznaczonego pola przez serwer (zegar
      // serwera, nie deklaracja klienta). Konto bierze webhook z `userId`
      // w metadanych - nigdy z ładunku.
      newsletterConsent: data.newsletterConsent
        ? { ...data.newsletterConsent, at: new Date().toISOString() }
        : null,
    });

    // Zamówienia, których sesje kasa właśnie wygasiła (druga karta, poprzednia
    // próba) - już nie zostaną opłacone, więc nie mogą wisieć w `processing`.
    for (const supersededId of result.supersededOrderIds ?? []) {
      await markOrderSession(supabase, {
        orderId: supersededId,
        sessionId: null,
        status: "canceled",
      });
    }

    if (!result.ok) return await failOrder(result.error);

    await markOrderSession(supabase, {
      orderId: order.id,
      sessionId: result.sessionId,
      status: "processing",
    });

    return { ok: true as const, clientSecret: result.clientSecret, orderId: order.id };
  });

// Bez `donation` i bez kwoty/waluty od klienta (audyt PAY-16b): darowizna
// przez tę ścieżkę pobierała kwotę podaną w żądaniu, a webhook nie miał jej
// gdzie zaksięgować (brak wiersza `donations`). Darowizny idą przez
// `donations.functions.ts`.
const adhocCheckoutSchema = z.object({
  purpose: z.enum(["content_unlock", "event_ticket"]),
  entityType: z.enum(["post", "page"]).optional(),
  entityId: z.string().uuid().optional(),
  eventId: z.string().uuid().optional(),
  returnUrl: z.string().url(),
  environment: envSchema.optional(),
  locale: localeSchema.optional(),
});

/**
 * Sesja Embedded Checkout z kwotą ad-hoc (odblokowanie treści, bilet). Konto
 * wymagane. Kwota NIGDY nie pochodzi z klienta - jest doczytywana serwerowo
 * z reguły dostępu / wydarzenia.
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
