// Serwerowa warstwa tworzenia sesji Stripe Embedded Checkout.
//
// Zastępuje dawny `paddleTransaction.server.ts`. Wszystkie kwoty są wyliczane
// SERWEROWO (plan / reguła dostępu / bilet / kupon / waluta prezentacji) -
// klient nigdy nie przekazuje ceny. Dla subskrypcji korzystamy z cen
// katalogowych (`lookup_key`, patrz `catalog.ts`) - tylko taka sesja zakłada u
// Stripe cykl rozliczeniowy, trial i zdarzenia `customer.subscription.*`. Dla
// kwot ad-hoc (darowizna administracyjna, odblokowanie treści, bilet)
// tworzymy `price_data` osadzoną w pozycji, więc kwota nie pochodzi z żadnego
// katalogu.
//
// Moduł jest server-only (klucze bramki) - importuj wyłącznie z handlerów
// `createServerFn`.
import type Stripe from "stripe";
import { createStripeClient, resolveEnvironment, type StripeEnv } from "@/lib/stripe.server";
import { normalizeCheckoutLocale, type CheckoutLocale } from "@/lib/billing/checkoutLocale";
import {
  checkoutSessionParams,
  DEFAULT_CHECKOUT_SETTINGS,
  type CheckoutSessionParams,
  type CheckoutSettings,
} from "@/lib/billing/checkoutSettings";

// SDK Stripe (esm) nie eksportuje `Stripe.Checkout.SessionCreateParams` jako
// nazwanego typu - wyprowadzamy go z sygnatury metody, żeby nie duplikować
// kształtu API. `managed_payments` należy do preview API (dahlia) i nie ma go
// jeszcze w typach SDK, stąd rozszerzenie o to jedno pole.
type SessionCreateParams = Parameters<Stripe["checkout"]["sessions"]["create"]>[0] & {
  managed_payments?: { enabled: boolean };
};

// Kontrakt czystego opisu z `checkoutSettings.ts` vs faktyczny kształt API
// Stripe, pilnowany przez kompilator: (a) każdy klucz musi istnieć w
// `SessionCreateParams` - literówka w nazwie parametru nie przejdzie budowania;
// (b) typy wartości muszą być przypisywalne (sprawdza `sessionFlags` niżej).
type UnknownStripeParamKeys = Exclude<keyof CheckoutSessionParams, keyof SessionCreateParams>;
type AssertParamsMatchStripe = UnknownStripeParamKeys extends never ? true : never;
const _paramsMatchStripe: AssertParamsMatchStripe = true;
void _paramsMatchStripe;

// Flagi tenantu (kupony / Stripe Tax / NIP / faktury) wjeżdżają do sesji
// dokładnie w tym jednym miejscu na ścieżkę.
function sessionFlags(
  settings: CheckoutSettings | undefined,
  context: { mode: "payment" | "subscription"; hasCustomer: boolean; hasDiscount: boolean },
): SessionCreateParams {
  return checkoutSessionParams(settings ?? DEFAULT_CHECKOUT_SETTINGS, context);
}

export { resolveEnvironment };
export type { StripeEnv };

/** Minimalna kwota dopuszczana przez Stripe dla obciążeń kartą (50 groszy/centów). */
export const MIN_ADHOC_AMOUNT_CENTS = 50;

export type CheckoutSessionResult =
  { ok: true; clientSecret: string; sessionId: string } | { ok: false; error: string };

/**
 * Znajduje istniejącego klienta Stripe po `metadata.userId`, potem po
 * e-mailu, a w ostatniej kolejności zakłada nowego. Zawsze ustawia
 * `metadata.userId`, żeby webhook mógł jednoznacznie odwzorować klienta na
 * konto w naszej bazie.
 */
export async function resolveOrCreateCustomer(
  stripe: Stripe,
  input: { userId: string; email?: string | null; name?: string | null },
): Promise<string> {
  const byUserId = await stripe.customers.search({
    query: `metadata['userId']:'${input.userId}'`,
    limit: 1,
  });
  if (byUserId.data[0]) return byUserId.data[0].id;

  if (input.email) {
    const existing = await stripe.customers.list({ email: input.email, limit: 1 });
    const match = existing.data[0];
    if (match) {
      await stripe.customers.update(match.id, { metadata: { userId: input.userId } });
      return match.id;
    }
  }

  const created = await stripe.customers.create({
    email: input.email ?? undefined,
    name: input.name ?? undefined,
    metadata: { userId: input.userId },
  });
  return created.id;
}

/** Ceny katalogowe rozwiązane hurtowo po czytelnym `lookup_key`. */
export async function resolvePricesByLookupKeys(
  stripe: Stripe,
  lookupKeys: string[],
): Promise<Map<string, Stripe.Price>> {
  if (lookupKeys.length === 0) return new Map();
  const result = await stripe.prices.list({
    lookup_keys: lookupKeys,
    active: true,
    expand: ["data.product"],
  });
  const map = new Map<string, Stripe.Price>();
  for (const price of result.data) {
    if (price.lookup_key) map.set(price.lookup_key, price);
  }
  return map;
}

/**
 * Rabat wyłącznie wewnętrzny (kupon B2B bez odpowiednika w Stripe): tworzymy
 * jednorazowy kupon Stripe o dokładnie tej samej kwocie, jaką wyliczyła baza
 * (`validate_b2b_coupon`), żeby nakładka pokazała identyczną kwotę co
 * podsumowanie zamówienia. `duration: "once"` - kupon dotyczy tylko tej sesji.
 */
export async function createAdhocDiscountForCoupon(
  stripe: Stripe,
  input: { code: string; discountCents: number; currency: string },
): Promise<string | null> {
  if (input.discountCents <= 0) return null;
  const coupon = await stripe.coupons.create({
    amount_off: Math.round(input.discountCents),
    currency: input.currency.toLowerCase(),
    duration: "once",
    name: `Kupon ${input.code}`,
    metadata: { source: "b2b_coupon", code: input.code },
  });
  return coupon.id;
}

export interface PlanCheckoutSessionInput {
  environment: StripeEnv;
  /** Czytelny identyfikator ceny z `BILLING_CATALOG` (`lookup_key` w Stripe). */
  priceLookupKey: string;
  quantity?: number;
  planId: string;
  orderId: string;
  userId: string;
  customerEmail?: string | null;
  returnUrl: string;
  /** Rabat wyprowadzony z kuponu B2B - identyfikator kuponu/kodu promo Stripe. */
  discount?: { coupon: string } | { promotionCode: string } | null;
  /** Język formularza Stripe (ramka nie dziedziczy naszego i18n). */
  locale?: CheckoutLocale;
  /**
   * Okres próbny planu w dniach (0 = brak). MUSI trafić do sesji, bo u tego
   * operatora trial NIE siedzi na cenie - inaczej niż u poprzedniego. Katalog
   * zapisuje `trial_days` wyłącznie do metadanych ceny (catalogSync), a metadane
   * są dla Stripe bezwładne: bez `subscription_data.trial_period_days` karta
   * zostaje obciążona od razu, mimo że plan i cennik obiecują okres próbny.
   */
  trialDays?: number;
  /** Ustawienia checkoutu tenantu (kupony, VAT, NIP, faktura). */
  settings?: CheckoutSettings;
}

/**
 * Tworzy Embedded Checkout Session z ceny katalogowej. Tryb (subscription vs
 * payment) wynika z `price.type` - katalog może w przyszłości zawierać też
 * ceny jednorazowe.
 */
export async function createPlanCheckoutSession(
  input: PlanCheckoutSessionInput,
): Promise<CheckoutSessionResult> {
  try {
    const stripe = createStripeClient(input.environment);
    const prices = await resolvePricesByLookupKeys(stripe, [input.priceLookupKey]);
    const price = prices.get(input.priceLookupKey);
    if (!price) return { ok: false, error: "price_missing" };

    const customerId = await resolveOrCreateCustomer(stripe, {
      userId: input.userId,
      email: input.customerEmail,
    });

    const mode: NonNullable<SessionCreateParams["mode"]> =
      price.type === "recurring" ? "subscription" : "payment";
    const quantity = Math.min(Math.max(Math.trunc(input.quantity ?? 1), 1), 100);

    const productName =
      typeof price.product === "object" && price.product && "name" in price.product
        ? (price.product as Stripe.Product).name
        : undefined;

    const discounts = input.discount
      ? [
          "coupon" in input.discount
            ? { coupon: input.discount.coupon }
            : { promotion_code: input.discount.promotionCode },
        ]
      : undefined;

    // Operator przyjmuje 1-730 dni; ułamki i wartości spoza zakresu odrzuca
    // błędem walidacji, więc normalizujemy tutaj, a nie u wołającego.
    const trialPeriodDays =
      mode === "subscription" && Number.isFinite(input.trialDays)
        ? Math.min(Math.max(Math.trunc(input.trialDays as number), 0), 730)
        : 0;

    const params: SessionCreateParams = {
      mode,
      ui_mode: "embedded_page",
      locale: normalizeCheckoutLocale(input.locale),
      return_url: input.returnUrl,
      customer: customerId,
      line_items: [{ price: price.id, quantity }],
      metadata: { userId: input.userId, planId: input.planId, orderId: input.orderId },
      ...(discounts ? { discounts } : {}),
      ...(mode === "subscription"
        ? {
            subscription_data: {
              metadata: { userId: input.userId, planId: input.planId, orderId: input.orderId },
              // Trial przekazujemy TYLKO gdy plan go ma - `trial_period_days: 0`
              // jest u operatora błędem walidacji, nie "brakiem triala".
              ...(trialPeriodDays ? { trial_period_days: trialPeriodDays } : {}),
            },
          }
        : {
            payment_intent_data: {
              description: productName ?? "Zamówienie",
              metadata: { userId: input.userId, planId: input.planId, orderId: input.orderId },
            },
          }),
      // Kupony, Stripe Tax, NIP, faktury i płaszczyzna rozliczeniowa
      // (`managed_payments` vs własny `automatic_tax`) - wszystko z ustawień
      // tenantu, rozstrzygnięte w `checkoutSessionParams`. Sesja z rabatem
      // operatora nie dostanie pola na kod promocyjny, a klient jest tu zawsze
      // przypięty, więc `customer_creation` nigdy nie wjedzie.
      ...sessionFlags(input.settings, {
        mode,
        hasCustomer: true,
        hasDiscount: !!discounts,
      }),
    } as SessionCreateParams;

    const session = await stripe.checkout.sessions.create(params);
    if (!session.client_secret) return { ok: false, error: "session_missing_client_secret" };
    return { ok: true, clientSecret: session.client_secret, sessionId: session.id };
  } catch (e) {
    const { getStripeErrorMessage } = await import("@/lib/stripe.server");
    console.error("[payments] plan checkout session failed", e);
    return { ok: false, error: getStripeErrorMessage(e) };
  }
}

export interface AdhocCheckoutSessionInput {
  environment: StripeEnv;
  /** Nazwa pozycji widoczna dla kupującego. */
  name: string;
  description?: string;
  amountCents: number;
  currency: string;
  quantity?: number;
  orderId: string;
  /** Cel płatności ad-hoc, do metadanych i webhooka. */
  purpose: "content_unlock" | "event_ticket" | "donation";
  userId?: string | null;
  customerEmail?: string | null;
  returnUrl: string;
  metadata?: Record<string, string>;
  /** Język formularza Stripe (ramka nie dziedziczy naszego i18n). */
  locale?: CheckoutLocale;
  /** Flagi checkoutu tenantu zamówienia (brak -> bezpieczne domyślne). */
  settings?: CheckoutSettings;
  /**
   * Rabat pokazywany w nakładce (faza sprzedaży, benefit planu). Pozycja jest
   * wtedy wyceniona ceną regularną, a różnicę zdejmuje kupon operatora - klient
   * widzi, ile i za co dostał zniżki, a kwota do zapłaty pozostaje ta sama.
   */
  discount?: { coupon: string } | null;
}

/**
 * Tworzy Embedded Checkout Session z ceną osadzoną w pozycji (`price_data`) -
 * jedyny sposób na kwotę wyliczoną dynamicznie serwerowo (kupon, waluta
 * prezentacji, cena wydarzenia). Odrzuca kwoty poniżej minimum operatora.
 */
export async function createAdhocCheckoutSession(
  input: AdhocCheckoutSessionInput,
): Promise<CheckoutSessionResult> {
  if (!Number.isFinite(input.amountCents) || input.amountCents < MIN_ADHOC_AMOUNT_CENTS) {
    return { ok: false, error: "amount_too_low" };
  }
  try {
    const stripe = createStripeClient(input.environment);
    const quantity = Math.min(Math.max(Math.trunc(input.quantity ?? 1), 1), 100);

    let customerId: string | undefined;
    if (input.userId) {
      customerId = await resolveOrCreateCustomer(stripe, {
        userId: input.userId,
        email: input.customerEmail,
      });
    }

    const metadata: Record<string, string> = {
      orderId: input.orderId,
      purpose: input.purpose,
      ...(input.userId ? { userId: input.userId } : {}),
      ...(input.metadata ?? {}),
    };

    const params: SessionCreateParams = {
      mode: "payment",
      ui_mode: "embedded_page",
      locale: normalizeCheckoutLocale(input.locale),
      return_url: input.returnUrl,
      ...(customerId ? { customer: customerId } : {}),
      ...(!customerId && input.customerEmail ? { customer_email: input.customerEmail } : {}),
      line_items: [
        {
          quantity,
          price_data: {
            currency: input.currency.toLowerCase(),
            unit_amount: Math.round(input.amountCents),
            product_data: {
              name: input.name.slice(0, 200),
              ...(input.description ? { description: input.description.slice(0, 200) } : {}),
            },
          },
        },
      ],
      metadata,
      payment_intent_data: {
        description: input.name.slice(0, 200),
        metadata,
      },
      // Jak wyżej - flagi tenantu. Tu klient bywa nieprzypięty (anonimowa
      // darowizna), więc `customer_creation=always` dojedzie wtedy, gdy sesja
      // musi zapisać NIP, policzyć podatek albo wystawić fakturę.
      ...(input.discount ? { discounts: [{ coupon: input.discount.coupon }] } : {}),
      ...sessionFlags(input.settings, {
        mode: "payment",
        hasCustomer: !!customerId,
        hasDiscount: !!input.discount,
      }),
    } as SessionCreateParams;

    const session = await stripe.checkout.sessions.create(params);
    if (!session.client_secret) return { ok: false, error: "session_missing_client_secret" };
    return { ok: true, clientSecret: session.client_secret, sessionId: session.id };
  } catch (e) {
    const { getStripeErrorMessage } = await import("@/lib/stripe.server");
    console.error("[payments] adhoc checkout session failed", e);
    return { ok: false, error: getStripeErrorMessage(e) };
  }
}

/**
 * Idempotentne otwarcie sesji dla istniejącego zamówienia: jeśli zamówienie ma
 * już `provider_session_id` w stanie oczekującym, próbujemy odtworzyć sesję
 * zamiast tworzyć drugą (unika podwójnego checkoutu przy podwójnym kliknięciu
 * / retry sieciowym).
 */
export async function reuseOpenSession(
  environment: StripeEnv,
  sessionId: string,
): Promise<CheckoutSessionResult | null> {
  try {
    const stripe = createStripeClient(environment);
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.status !== "open" || !session.client_secret) return null;
    return { ok: true, clientSecret: session.client_secret, sessionId: session.id };
  } catch (e) {
    console.error("[payments] reuse session lookup failed", sessionId, e);
    return null;
  }
}
