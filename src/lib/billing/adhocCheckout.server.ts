// Serwerowa warstwa tworzenia sesji Stripe Embedded Checkout.
//
// Zastępuje dawny `paddleTransaction.server.ts`. Wszystkie kwoty są wyliczane
// SERWEROWO (plan / reguła dostępu / bilet / kupon / waluta prezentacji) -
// klient nigdy nie przekazuje ceny. Dla subskrypcji korzystamy z cen
// katalogowych (`lookup_key`, patrz `catalog.ts`) - tylko taka sesja zakłada u
// Stripe cykl rozliczeniowy, trial i zdarzenia `customer.subscription.*`. Dla
// kwot ad-hoc (odblokowanie treści, bilet) tworzymy `price_data` osadzoną
// w pozycji, więc kwota nie pochodzi z żadnego katalogu. Darowizny mają własną
// ścieżkę (`donations.server.ts`) z własnym rejestrem - tutaj nie wchodzą.
//
// IDEMPOTENCJA. Każde wywołanie operatora, które coś ZAKŁADA (sesja, kupon),
// niesie klucz wyprowadzony z identyfikatora zamówienia i celu wywołania.
// Ponowienie tego samego żądania (sieć, retry SDK, podwójny handler) oddaje
// wtedy ten sam obiekt zamiast drugiej sesji albo drugiego kuponu na jedno
// zamówienie. Stripe odrzuca klucz użyty ponownie z INNYMI parametrami, więc
// klucz jest per zamówienie i per cel - nigdy wspólny.
//
// Moduł jest server-only (klucze bramki) - importuj wyłącznie z handlerów
// `createServerFn`.
import type Stripe from "stripe";
import { getStripeClient, resolveEnvironment, type StripeEnv } from "@/lib/stripe.server";
import { normalizeCheckoutLocale, type CheckoutLocale } from "@/lib/billing/checkoutLocale";
import {
  checkoutSessionParams,
  DEFAULT_CHECKOUT_SETTINGS,
  type CheckoutSessionParams,
  type CheckoutSettings,
} from "@/lib/billing/checkoutSettings";
import { isBelowMinimumCharge } from "@/lib/billing/chargeMinimum";
import type { StripeRecurringCycle } from "@/lib/billing/planPricing";

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

/**
 * Górny limit ilości na pozycji sesji. Wołający, który rozbija sumę na
 * „N × cena", MUSI go znać - ilość ucięta tutaj po cichu dałaby w nakładce
 * inną kwotę niż zamówienie.
 */
export const MAX_LINE_QUANTITY = 100;

/**
 * Liczba sztuk pozycji sesji: całkowita, 1..`MAX_LINE_QUANTITY`. Wartość
 * nieliczbowa schodzi na jedną sztukę - `NaN` przechodził dotąd do operatora
 * jako ilość pozycji, a bramka minimum liczy kwotę od tej samej liczby.
 */
function lineQuantityOf(quantity: number | undefined): number {
  if (typeof quantity !== "number" || !Number.isFinite(quantity)) return 1;
  return Math.min(Math.max(Math.trunc(quantity), 1), MAX_LINE_QUANTITY);
}

/**
 * Stripe przyjmuje nazwę kuponu do 40 znaków i ODRZUCA dłuższą. Nazwa fazy
 * sprzedaży sklejona z kodem („Pierwsza fala sprzedaży + PARTNER2026CEE")
 * potrafi ją przekroczyć - a odrzucony kupon to rabat, którego kupujący nie
 * zobaczy w nakładce.
 */
export const STRIPE_COUPON_NAME_MAX = 40;

/** Nazwa kuponu operatora dla kodu, przycięta do limitu Stripe. */
export function stripeCouponName(code: string): string {
  return `Kupon ${code}`.slice(0, STRIPE_COUPON_NAME_MAX).trimEnd();
}

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

/**
 * Ceny katalogowe rozwiązane hurtowo po czytelnym `lookup_key`.
 *
 * `data.tiers` jest rozwijane jawnie: operator NIE oddaje progów ceny
 * schodkowej bez rozwinięcia, a bramka kasy (`planPriceMismatch`) liczy z nich
 * kwotę za zamówioną liczbę miejsc. Bez progów cena Zespołu wyglądałaby jak
 * cena bez kwoty i każda sesja kończyłaby się odmową.
 */
export async function resolvePricesByLookupKeys(
  stripe: Stripe,
  lookupKeys: string[],
): Promise<Map<string, Stripe.Price>> {
  if (lookupKeys.length === 0) return new Map();
  const result = await stripe.prices.list({
    lookup_keys: lookupKeys,
    active: true,
    expand: ["data.product", "data.tiers"],
  });
  const map = new Map<string, Stripe.Price>();
  for (const price of result.data) {
    if (price.lookup_key) map.set(price.lookup_key, price);
  }
  return map;
}

/** Klucz idempotencji sesji Checkout zamówienia - jedna sesja na zamówienie. */
export function checkoutSessionIdempotencyKey(orderId: string): string {
  return `checkout_session:${orderId}`;
}

/** Klucz idempotencji kuponu operatora zamówienia - jeden rabat na zamówienie. */
export function checkoutCouponIdempotencyKey(orderId: string): string {
  return `checkout_coupon:${orderId}`;
}

/**
 * Rabat wyłącznie wewnętrzny (kupon B2B bez odpowiednika w Stripe): tworzymy
 * jednorazowy kupon Stripe o dokładnie tej samej kwocie, jaką wyliczyła baza
 * (`validate_b2b_coupon`), żeby nakładka pokazała identyczną kwotę co
 * podsumowanie zamówienia. `duration: "once"` - kupon dotyczy tylko tej sesji.
 *
 * `orderId` jest WYMAGANY: klucz idempotencji pochodzi z zamówienia, więc
 * ponowione żądanie nie zakłada u operatora drugiego kuponu na ten sam rabat
 * (osierocone kupony `amount_off` na wspólnym koncie to rabaty bez właściciela).
 */
export async function createAdhocDiscountForCoupon(
  stripe: Stripe,
  input: { code: string; discountCents: number; currency: string; orderId: string },
): Promise<string | null> {
  if (input.discountCents <= 0) return null;
  const coupon = await stripe.coupons.create(
    {
      amount_off: Math.round(input.discountCents),
      currency: input.currency.toLowerCase(),
      duration: "once",
      name: stripeCouponName(input.code),
      metadata: { source: "b2b_coupon", code: input.code },
    },
    { idempotencyKey: checkoutCouponIdempotencyKey(input.orderId) },
  );
  return coupon.id;
}

export interface PlanCheckoutSessionInput {
  environment: StripeEnv;
  /** Czytelny identyfikator ceny z `BILLING_CATALOG` (`lookup_key` w Stripe). */
  priceLookupKey: string;
  quantity?: number;
  /**
   * Tryb, którego oczekuje ZAMÓWIENIE (wycena planu, `planPricing.ts`). Cena
   * u operatora o innym typie (cykliczna zamiast jednorazowej i odwrotnie) to
   * sesja na coś innego niż zamówienie - odmowa `price_mismatch`.
   */
  expectedMode: "payment" | "subscription";
  /** Waluta zamówienia - cena u operatora w innej walucie to też `price_mismatch`. */
  expectedCurrency: string;
  /**
   * Cykl planu w słowniku operatora (`planPricing.ts`); `null` dla planu
   * jednorazowego. Cena rozliczana w innym cyklu (co dwa tygodnie zamiast co
   * rok) to `price_mismatch`.
   */
  expectedRecurring: StripeRecurringCycle | null;
  /**
   * Kwota BRUTTO pozycji za `quantity` sztuk, przed rabatem i podatkiem - ta,
   * którą zapisało zamówienie (wycena planu). Cena, która za tę ilość naliczy
   * cokolwiek innego (dryf kwoty, inne progi), to `price_mismatch`.
   */
  expectedAmountCents: number;
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
 * Kwota, którą operator naliczy za `quantity` sztuk tej ceny - przed rabatem
 * i podatkiem. `null`, gdy cena liczy w sposób, którego kasa nie wycenia
 * (kwota dowolna, przekształcenie ilości, stawka ułamkowa, schodki inne niż
 * `volume`, brak rozwiniętych progów) - bramka traktuje to jak niezgodność.
 */
export function stripePriceAmountCents(price: Stripe.Price, quantity: number): number | null {
  if (price.custom_unit_amount || price.transform_quantity) return null;
  if (price.billing_scheme === "tiered") {
    // Katalog zakłada wyłącznie schodki `volume` (catalogSync): WSZYSTKIE
    // sztuki po stawce progu, który osiągnęła ilość.
    if (price.tiers_mode !== "volume" || !Array.isArray(price.tiers)) return null;
    const tier = price.tiers.find((t) => t.up_to === null || quantity <= t.up_to);
    if (!tier || typeof tier.unit_amount !== "number") return null;
    return tier.unit_amount * quantity + (tier.flat_amount ?? 0);
  }
  return typeof price.unit_amount === "number" ? price.unit_amount * quantity : null;
}

/** Oczekiwania zamówienia wobec ceny pod `lookup_key` (z wyceny planu). */
export interface PlanPriceExpectation {
  mode: "payment" | "subscription";
  currency: string;
  recurring: StripeRecurringCycle | null;
  amountCents: number;
  quantity: number;
}

/**
 * Powód niezgodności ceny u operatora z zamówieniem albo `null`, gdy cena
 * pobierze dokładnie to, co zapisało zamówienie: ten sam typ (cykliczna /
 * jednorazowa), waluta, cykl (`interval` + `interval_count`, rozliczanie za
 * ilość, nie za zużycie) i kwota za zamówioną liczbę sztuk.
 */
export function planPriceMismatch(
  price: Stripe.Price,
  expected: PlanPriceExpectation,
): "mode" | "currency" | "interval" | "amount" | null {
  const mode = price.type === "recurring" ? "subscription" : "payment";
  if (mode !== expected.mode) return "mode";
  if ((price.currency ?? "").toLowerCase() !== expected.currency.toLowerCase()) {
    return "currency";
  }
  const recurring = price.recurring ?? null;
  if (expected.recurring === null) {
    if (recurring !== null) return "interval";
  } else if (
    recurring === null ||
    recurring.interval !== expected.recurring.interval ||
    recurring.interval_count !== expected.recurring.intervalCount ||
    (recurring.usage_type ?? "licensed") !== "licensed"
  ) {
    return "interval";
  }
  if (stripePriceAmountCents(price, expected.quantity) !== expected.amountCents) return "amount";
  return null;
}

/**
 * Tworzy Embedded Checkout Session z ceny katalogowej. Tryb (subscription vs
 * payment) wynika z `price.type` - katalog zawiera też ceny jednorazowe.
 *
 * BRAMKA SPÓJNOŚCI CENY Z ZAMÓWIENIEM. Wołający podaje tryb, walutę, cykl
 * i kwotę brutto, które wynikają z planu zamówienia. Cena pod `lookup_key` jest
 * u operatora obiektem zmiennym (synchronizacja katalogu, ręczna edycja
 * w panelu, przeniesiony klucz, cena zbudowana z planu innego najemcy na
 * wspólnym koncie) - gdy cokolwiek z tego się nie zgadza, sesja pobrałaby
 * pieniądze za coś innego, niż zapisaliśmy: subskrypcję zamiast zakupu
 * jednorazowego, euro zamiast złotych, rozliczenie co dwa tygodnie zamiast
 * co rok albo inną kwotę (przegląd PAY-01, 0.1 - dotąd bramka sprawdzała
 * wyłącznie typ i walutę, a resztę wykrywała realizacja PO pobraniu pieniędzy).
 * Odmawiamy ZANIM powstanie klient i sesja, a wołający zamyka zamówienie jako
 * `failed` i zwalnia kupon.
 */
export async function createPlanCheckoutSession(
  input: PlanCheckoutSessionInput,
): Promise<CheckoutSessionResult> {
  try {
    const stripe = await getStripeClient(input.environment);
    const prices = await resolvePricesByLookupKeys(stripe, [input.priceLookupKey]);
    const price = prices.get(input.priceLookupKey);
    if (!price) return { ok: false, error: "price_missing" };

    // Literalna unia, NIE `NonNullable<SessionCreateParams["mode"]>`: od
    // stripe@22.6 ten typ dopuszcza też `string & Record<never, never>`
    // (otwarta unia dla nowych trybów SDK), więc przez `sessionFlags`, które
    // przyjmuje wyłącznie `"payment" | "subscription"`, już nie przechodził.
    // Zawężamy u ŹRÓDŁA - to nasz kontrakt, nie kontrakt SDK.
    const mode: "payment" | "subscription" =
      price.type === "recurring" ? "subscription" : "payment";
    // Ilość liczona PRZED bramką - kwotę ceny sprawdzamy dokładnie dla tej
    // liczby sztuk, która pójdzie w pozycji sesji.
    const quantity = lineQuantityOf(input.quantity);
    const mismatch = planPriceMismatch(price, {
      mode: input.expectedMode,
      currency: input.expectedCurrency,
      recurring: input.expectedRecurring,
      amountCents: input.expectedAmountCents,
      quantity,
    });
    if (mismatch) {
      console.error("[payments] plan price mismatch", {
        orderId: input.orderId,
        lookupKey: input.priceLookupKey,
        reason: mismatch,
        expectedMode: input.expectedMode,
        priceMode: mode,
        expectedCurrency: input.expectedCurrency,
        priceCurrency: (price.currency ?? "").toLowerCase(),
        expectedRecurring: input.expectedRecurring,
        priceRecurring: price.recurring
          ? { interval: price.recurring.interval, intervalCount: price.recurring.interval_count }
          : null,
        expectedAmountCents: input.expectedAmountCents,
        priceAmountCents: stripePriceAmountCents(price, quantity),
        quantity,
      });
      return { ok: false, error: "price_mismatch" };
    }

    const customerId = await resolveOrCreateCustomer(stripe, {
      userId: input.userId,
      email: input.customerEmail,
    });

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

    const session = await stripe.checkout.sessions.create(params, {
      idempotencyKey: checkoutSessionIdempotencyKey(input.orderId),
    });
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
  /**
   * Cel płatności ad-hoc, do metadanych i webhooka. Darowizny tu NIE ma: ma
   * własną ścieżkę z rejestrem (`donations.server.ts`), a sesja ad-hoc
   * z `purpose: "donation"` pobierała pieniądze, których webhook nie miał
   * gdzie zaksięgować (brak wiersza `donations` -> `skipped`).
   */
  purpose: "content_unlock" | "event_ticket";
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
  /** Podatek wliczony w cenę (`inclusive`) albo doliczany (`exclusive`). */
  taxBehavior?: "inclusive" | "exclusive";
}

/**
 * Flagi tenantu dla sesji ad-hoc - z jedną regułą, której ustawienia NIE
 * nadpiszą: BILET NIE DOSTAJE POLA KODU STRIPE.
 *
 * Kod wpisany w nakładce operatora omija WSZYSTKO, co wie baza: zakres
 * wydarzenia i biletu (`validate_event_ticket_coupon`), rozbicie na miejsca,
 * limit użyć i wiersz realizacji - `amount_off` schodzi raz z całej sesji,
 * a webhook potwierdza miejsce po niższej kwocie bez pytania. Kody biletów
 * przyjmuje wyłącznie nasze pole.
 *
 * REGUŁA STOI TUTAJ, A NIE U WOŁAJĄCEGO. Sesję biletu budują DWIE ścieżki: kasa
 * biletów (`createCheckoutOrder`) i server fn ad-hoc
 * (`stripeCheckout.functions.ts` -> `buildAdhocOrder`), która przyjmuje
 * `purpose: "event_ticket"` prosto z żądania. Wyłączenie tylko w pierwszej
 * zostawiało drugą z polem kodu z ustawień tenantu - a do obejścia
 * wystarczało ręcznie złożone żądanie. Treść i plany zostają przy ustawieniach
 * tenantu bez zmian.
 */
function adhocSessionSettings(input: AdhocCheckoutSessionInput): CheckoutSettings | undefined {
  if (input.purpose !== "event_ticket") return input.settings;
  return { ...(input.settings ?? DEFAULT_CHECKOUT_SETTINGS), allow_promotion_codes: false };
}

/**
 * Kod podatkowy pozycji `price_data` dla płaszczyzny operatora (MoR).
 *
 * Operator odrzuca sesję `managed_payments`, której produkt nie ma kodu
 * podatkowego ("the product tax code is missing") - próbny zakup 2026-09-28
 * pokazał, że KAŻDA sesja ad-hoc padała na tym przed wyświetleniem kasy.
 * Tylko treść cyfrowa jest towarem, który operator obsługuje jako MoR.
 */
export const ADHOC_DIGITAL_TAX_CODE = "txcd_10000000";

/**
 * Czy sesja ad-hoc może jechać płaszczyzną operatora. Wstęp na wydarzenie
 * stacjonarne nie jest produktem cyfrowym - operator nie obsługuje go jako
 * MoR, więc sesja idzie bez `managed_payments` (podatek biletu niesie
 * `tax_behavior`, a fakturę wystawia organizator modułem faktur).
 */
export function adhocAllowsManagedPayments(purpose: AdhocCheckoutSessionInput["purpose"]): boolean {
  return purpose === "content_unlock";
}

function adhocFlags(input: AdhocCheckoutSessionInput, hasCustomer: boolean): SessionCreateParams {
  const flags = sessionFlags(adhocSessionSettings(input), {
    mode: "payment",
    hasCustomer,
    hasDiscount: !!input.discount,
  });
  if (!adhocAllowsManagedPayments(input.purpose)) {
    const { managed_payments: _managed, ...rest } = flags;
    void _managed;
    return rest;
  }
  return flags;
}

/**
 * Tworzy Embedded Checkout Session z ceną osadzoną w pozycji (`price_data`) -
 * jedyny sposób na kwotę wyliczoną dynamicznie serwerowo (kupon, waluta
 * prezentacji, cena wydarzenia). Odrzuca kwoty poniżej minimum operatora
 * W WALUCIE POZYCJI (`chargeMinimum.ts` - 2,00 zł, 0,50 EUR), liczone od sumy
 * za wszystkie sztuki, bo minimum dotyczy obciążenia, nie stawki.
 */
export async function createAdhocCheckoutSession(
  input: AdhocCheckoutSessionInput,
): Promise<CheckoutSessionResult> {
  const lineQuantity = lineQuantityOf(input.quantity);
  if (
    !Number.isFinite(input.amountCents) ||
    input.amountCents <= 0 ||
    isBelowMinimumCharge(Math.round(input.amountCents) * lineQuantity, input.currency)
  ) {
    return { ok: false, error: "amount_too_low" };
  }
  try {
    const stripe = await getStripeClient(input.environment);
    const quantity = lineQuantity;

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
            ...(input.taxBehavior ? { tax_behavior: input.taxBehavior } : {}),
            product_data: {
              name: input.name.slice(0, 200),
              ...(input.description ? { description: input.description.slice(0, 200) } : {}),
              ...(adhocAllowsManagedPayments(input.purpose)
                ? { tax_code: ADHOC_DIGITAL_TAX_CODE }
                : {}),
            },
          },
        },
      ],
      metadata,
      payment_intent_data: {
        description: input.name.slice(0, 200),
        metadata,
      },
      // Jak wyżej - flagi tenantu. Tu klient bywa nieprzypięty (wołający bez
      // konta), więc `customer_creation=always` dojedzie wtedy, gdy sesja
      // musi zapisać NIP, policzyć podatek albo wystawić fakturę.
      ...(input.discount ? { discounts: [{ coupon: input.discount.coupon }] } : {}),
      ...adhocFlags(input, !!customerId),
    } as SessionCreateParams;

    const session = await stripe.checkout.sessions.create(params, {
      idempotencyKey: checkoutSessionIdempotencyKey(input.orderId),
    });
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
    const stripe = await getStripeClient(environment);
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.status !== "open" || !session.client_secret) return null;
    return { ok: true, clientSecret: session.client_secret, sessionId: session.id };
  } catch (e) {
    console.error("[payments] reuse session lookup failed", sessionId, e);
    return null;
  }
}
