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
import { premiumNewsletterConsentMetadata } from "@/lib/billing/premiumNewsletter";
import {
  checkoutSessionParams,
  DEFAULT_CHECKOUT_SETTINGS,
  type CheckoutSessionParams,
  type CheckoutSettings,
} from "@/lib/billing/checkoutSettings";
import { isBelowMinimumCharge } from "@/lib/billing/chargeMinimum";
import {
  catalogEntryByPriceId,
  catalogCycleMismatch,
  catalogRecurringFor,
  type CatalogPriceEntry,
} from "@/lib/billing/catalog";
import {
  CHECKOUT_SUPERSEDED_ERROR,
  PENDING_FIRST_PAYMENT_STATUS,
  type PlanSubscriptionRecord,
  planSubscriptionHistory,
  SUBSCRIPTION_EXISTS_ERROR,
} from "@/lib/billing/planSubscriptionGuard";

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
 * Wynik sesji PLANU. `supersededOrderIds` = zamówienia tego konta, których
 * otwarte sesje kasa właśnie wygasiła (`listOpenPlanSessions` +
 * `expirePlanSession`) - wołający od razu oznacza je jako anulowane, żeby nie
 * wisiały w `processing` do dostawy zdarzenia. Rezerwację kuponu takiego
 * zamówienia oddaje `checkout.session.expired` (`expireCheckoutOrder`
 * zwalnia kupon także zamówieniu już zamkniętemu jako `canceled`). Pole
 * pojawia się tylko, gdy coś wygaszono.
 */
export type PlanCheckoutSessionResult = CheckoutSessionResult & {
  supersededOrderIds?: string[];
};

/**
 * Metadane klienta: `userId` (właściciel - jedyne powiązanie klienta operatora
 * z kontem) i `accountEmail` (adres konta, który ostatnio wysłaliśmy - pozwala
 * odróżnić adres zmieniony przez nas od adresu ustawionego przez klienta
 * w portalu operatora).
 */
const CUSTOMER_OWNER_KEY = "userId";
const CUSTOMER_ACCOUNT_EMAIL_KEY = "accountEmail";

/** Ile klientów o tym samym adresie bierzemy pod uwagę (wspólne skrzynki). */
const CUSTOMERS_BY_EMAIL_LIMIT = 10;

function customerOwner(customer: Pick<Stripe.Customer, "metadata">): string | null {
  const value = customer.metadata?.[CUSTOMER_OWNER_KEY];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Krótki, deterministyczny skrót do klucza idempotencji. Klucz u operatora ma
 * limit 255 znaków, a adres e-mail sam potrafi mieć 254 - stąd skrót zamiast
 * surowej wartości (i przy okazji adres nie ląduje w logach żądań operatora).
 */
async function idempotencyDigest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest).slice(0, 12))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Czy błąd operatora znaczy „ten sam klucz idempotencji przyszedł z innymi
 * parametrami" (inne konto przejęło klienta pierwsze) albo „klucz jest właśnie
 * w użyciu" (równoległe przejęcie w locie).
 */
function isIdempotencyConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { type?: unknown; rawType?: unknown; code?: unknown };
  return (
    e.type === "StripeIdempotencyError" ||
    e.rawType === "idempotency_error" ||
    e.code === "idempotency_key_in_use"
  );
}

/**
 * Przejęcie klienta BEZ właściciela, warunkowe i atomowe.
 *
 * Stripe nie ma „compare-and-set" na metadanych, więc rolę zamka pełni klucz
 * idempotencji przypięty do KLIENTA (`customer-adopt:<id>`), a nie do konta:
 * pierwsze przejęcie zapisuje się u operatora z parametrami `{ userId: A }`,
 * a równoległe przejęcie przez konto B przychodzi z tym samym kluczem i INNYMI
 * parametrami - operator odrzuca je błędem idempotencji. Przegrany zakłada
 * własnego klienta. Powtórka tego samego konta dostaje odpowiedź z pamięci.
 * Po wygaśnięciu klucza (24 h) klient ma już właściciela w metadanych, więc
 * do przejęcia w ogóle nie dochodzi.
 */
async function adoptUnownedCustomer(
  stripe: Stripe,
  customerId: string,
  userId: string,
): Promise<string | null> {
  try {
    const adopted = await stripe.customers.update(
      customerId,
      { metadata: { [CUSTOMER_OWNER_KEY]: userId } },
      { idempotencyKey: `customer-adopt:${customerId}` },
    );
    return customerOwner(adopted) === userId ? adopted.id : null;
  } catch (error) {
    if (isIdempotencyConflict(error)) return null;
    throw error;
  }
}

/**
 * Adres konta trafia do klienta operatora - tam idą paragony i faktury.
 *
 * Bez tego zmiana adresu logowania nie docierała do operatora: po przekazaniu
 * firmowej skrzynki dokumenty poprzedniej osoby szły dalej na stary adres,
 * czyli do nowego użytkownika tej skrzynki. Adres zmieniony przez klienta
 * w portalu operatora (różny od ostatnio wysłanego `accountEmail`) zostaje -
 * to jego świadomy wybór adresu do faktur. Klient sprzed znacznika
 * `accountEmail` dostaje adres konta raz, razem ze znacznikiem.
 *
 * Platforma uwierzytelniania nie ma haka po potwierdzeniu nowego adresu
 * (zmiana wchodzi w życie po kliknięciu w link), dlatego synchronizacja
 * dzieje się tutaj - przy każdym rozwiązaniu klienta, czyli przed każdą
 * nową płatnością; webhook `customer.updated` przenosi adres dalej do
 * `billing_profiles`.
 */
async function syncAccountEmail(
  stripe: Stripe,
  customer: Stripe.Customer,
  email: string | null | undefined,
): Promise<void> {
  if (!email || customer.email === email) return;
  const synced = customer.metadata?.[CUSTOMER_ACCOUNT_EMAIL_KEY];
  if (synced && customer.email && synced !== customer.email) return;
  // Klucz z PRZEJŚCIA (stary -> nowy adres), nie z samego nowego adresu:
  // równoległe kasy tego samego konta wysyłają jedną zmianę, a powrót do
  // adresu sprzed chwili jest osobnym przejściem z własnym kluczem.
  const transition = `${customer.email ?? ""}\n${email}`;
  await stripe.customers.update(
    customer.id,
    { email, metadata: { [CUSTOMER_ACCOUNT_EMAIL_KEY]: email } },
    { idempotencyKey: `customer-email:${customer.id}:${await idempotencyDigest(transition)}` },
  );
}

/**
 * Klient operatora dla konta - po WŁAŚCICIELU, nigdy po samym adresie.
 *
 * Kolejność:
 *   1. klient z `metadata.userId` = to konto (wyszukiwarka operatora),
 *   2. klient o tym adresie z tym samym właścicielem (wyszukiwarka bywa
 *      opóźniona o kilkadziesiąt sekund wobec świeżo zapisanych metadanych),
 *   3. klient o tym adresie BEZ właściciela - przejęcie warunkowe
 *      (`adoptUnownedCustomer`),
 *   4. nowy klient.
 *
 * KLIENT INNEGO KONTA NIGDY NIE JEST PRZEJMOWANY. Dawniej `list({ email })`
 * brał pierwszego klienta o tym adresie i NADPISYWAŁ mu `metadata.userId`:
 * przekazana firmowa skrzynka albo wspólny adres biuro@ dawały nowemu kontu
 * klienta poprzedniej osoby - portal pokazywał jej faktury, karty
 * i subskrypcje (także darowizn), a webhook przypisywał jej płatności nowemu
 * kontu.
 */
export async function resolveOrCreateCustomer(
  stripe: Stripe,
  input: { userId: string; email?: string | null; name?: string | null },
): Promise<string> {
  const byUserId = await stripe.customers.search({
    query: `metadata['${CUSTOMER_OWNER_KEY}']:'${input.userId}'`,
    limit: 1,
  });
  const owned = byUserId.data[0];
  if (owned) {
    await syncAccountEmail(stripe, owned, input.email);
    return owned.id;
  }

  if (input.email) {
    const sameEmail = await stripe.customers.list({
      email: input.email,
      limit: CUSTOMERS_BY_EMAIL_LIMIT,
    });
    const mine = sameEmail.data.find((c) => customerOwner(c) === input.userId);
    if (mine) return mine.id;
    for (const candidate of sameEmail.data) {
      if (customerOwner(candidate) !== null) continue;
      const adopted = await adoptUnownedCustomer(stripe, candidate.id, input.userId);
      if (adopted) return adopted;
    }
  }

  // Klucz z konta i danych klienta: równoległe pierwsze zakupy tego samego
  // konta (dwie karty, podwójne kliknięcie) dostają JEDNEGO klienta zamiast
  // dwóch, z których jeden zostałby bez subskrypcji i bez historii.
  const created = await stripe.customers.create(
    {
      email: input.email ?? undefined,
      name: input.name ?? undefined,
      metadata: {
        [CUSTOMER_OWNER_KEY]: input.userId,
        ...(input.email ? { [CUSTOMER_ACCOUNT_EMAIL_KEY]: input.email } : {}),
      },
    },
    {
      idempotencyKey: `customer-create:${input.userId}:${await idempotencyDigest(
        `${input.email ?? ""}\n${input.name ?? ""}`,
      )}`,
    },
  );
  return created.id;
}

/**
 * Ceny katalogowe rozwiązane hurtowo po czytelnym `lookup_key`.
 *
 * `data.tiers` jest rozwijane jawnie: operator NIE oddaje progów ceny
 * schodkowej bez rozwinięcia, a bramka kasy (`catalogPriceMismatch`) liczy
 * z nich kwotę za zamówioną liczbę miejsc. Bez progów cena Zespołu wyglądałaby
 * jak cena bez kwoty i każda sesja kończyłaby się odmową.
 *
 * PACZKAMI PO `LOOKUP_KEYS_PER_REQUEST`. Operator przyjmuje najwyżej 10
 * kluczy na jedno `prices.list` i odrzuca dłuższą listę - a katalog ma 11
 * pozycji, więc sonda diagnostyki (cały katalog naraz) kończyła się błędem
 * i pokazywała każdą cenę jako brakującą. Paczki idą równolegle; klucz jest
 * unikalny u operatora, więc paczka oddaje najwyżej 10 cen i mieści się
 * w domyślnej stronie listy. Awaria którejkolwiek paczki to wyjątek, nie
 * częściowa mapa udająca braki w katalogu.
 */
const LOOKUP_KEYS_PER_REQUEST = 10;

export async function resolvePricesByLookupKeys(
  stripe: Stripe,
  lookupKeys: string[],
): Promise<Map<string, Stripe.Price>> {
  const batches: string[][] = [];
  for (let i = 0; i < lookupKeys.length; i += LOOKUP_KEYS_PER_REQUEST) {
    batches.push(lookupKeys.slice(i, i + LOOKUP_KEYS_PER_REQUEST));
  }
  const results = await Promise.all(
    batches.map((batch) =>
      stripe.prices.list({
        lookup_keys: batch,
        active: true,
        expand: ["data.product", "data.tiers"],
      }),
    ),
  );
  const map = new Map<string, Stripe.Price>();
  for (const price of results.flatMap((result) => result.data)) {
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
  /**
   * `false` = kupujący miał już subskrypcję planu (lokalne lustro
   * `subscriptions`), więc trial NIE przysługuje, niezależnie od planu.
   * Brak pola nie zwalnia ze sprawdzenia u operatora (patrz niżej).
   */
  trialEligible?: boolean;
  /**
   * Kwota BRUTTO pozycji za `quantity` sztuk z wyceny planu (`planCheckoutPricing`)
   * - PRZED kuponem (kupon jedzie osobno jako rabat operatora) i przed
   * podatkiem - oraz waluta zamówienia. Cena pod `lookup_key` MUSI dać dokładnie
   * tę kwotę przy tej ilości i w tej walucie: inaczej zamówienie zapisuje jedno,
   * a operator pobiera co innego (dryf kwoty, inne progi, cena innego najemcy
   * na wspólnym koncie) - odmowa `price_mismatch`. Typ i cykl ceny sprawdza
   * bramka względem pozycji katalogu (`catalogCycleMismatch`).
   */
  expectedAmountCents: number;
  expectedCurrency: string;
  /** Ustawienia checkoutu tenantu (kupony, VAT, NIP, faktura). */
  settings?: CheckoutSettings;
  /**
   * Zgoda na newsletter z pola w checkoucie (SUB-15). Jedzie metadanymi sesji
   * i subskrypcji do webhooka - tylko w trybie subskrypcji, bo wyłącznie skutek
   * opłaconej subskrypcji zapisuje na listę. Brak = pole niezaznaczone.
   */
  newsletterConsent?: { version: string; lang: "pl" | "en"; at: string } | null;
}

/**
 * Kwota ceny operatora dla danej ilości albo `null`, gdy kształtu ceny nie
 * umiemy policzyć jednoznacznie (ułamkowa stawka, przekształcanie ilości,
 * kwota wpisywana przez klienta, progi bez rozwinięcia) - wtedy kasa odmawia
 * zamiast zgadywać.
 */
export function stripePriceAmountFor(price: Stripe.Price, quantity: number): number | null {
  if (price.transform_quantity || price.custom_unit_amount) return null;
  if (price.billing_scheme === "tiered") {
    const tiers = price.tiers;
    if (!tiers || tiers.length === 0) return null;
    if (price.tiers_mode === "volume") {
      // Tryb `volume` (Zespół): CAŁA ilość po stawce progu, który osiągnęła.
      const tier = tiers.find((t) => t.up_to === null || quantity <= t.up_to);
      if (!tier || typeof tier.unit_amount !== "number") return null;
      return tier.unit_amount * quantity + (tier.flat_amount ?? 0);
    }
    // Tryb `graduated`: każdy przedział po własnej stawce.
    let total = 0;
    let previous = 0;
    for (const tier of tiers) {
      if (typeof tier.unit_amount !== "number") return null;
      const upTo = tier.up_to ?? Number.POSITIVE_INFINITY;
      const inTier = Math.max(0, Math.min(quantity, upTo) - previous);
      if (inTier > 0) total += tier.unit_amount * inTier + (tier.flat_amount ?? 0);
      previous = upTo;
      if (quantity <= upTo) break;
    }
    return total;
  }
  return typeof price.unit_amount === "number" ? price.unit_amount * quantity : null;
}

/**
 * Powód, dla którego cena operatora NIE odpowiada zamówieniu, albo `null`.
 *
 * Katalog operatora jest wspólny dla instalacji (jedna cena na `lookup_key`),
 * a kwotę zamówienia liczymy z planu NAJEMCY ZAMÓWIENIA. Plan najemcy, którego
 * cena rozjechała się z ceną wspólną, albo cena przestawiona u operatora poza
 * synchronizacją dawały sesję, w której klient płacił inną kwotę niż ta
 * zapisana na zamówieniu (i na fakturze). Sprawdzamy więc wszystko, co
 * decyduje o obciążeniu: kwotę × ilość, walutę, typ ceny (cykliczna albo
 * jednorazowa - czyli tryb sesji, który musi odpowiadać rodzajowi zamówienia
 * z planu) i cykl rozliczany za ilość (albo jego brak). Rodzaj zamówienia
 * i pozycja katalogu pochodzą z tej samej wyceny planu (`planCheckoutPricing`),
 * więc zgodność typu ceny z pozycją to zgodność z zamówieniem (audyt PAY-01).
 */
export function catalogPriceMismatch(
  price: Stripe.Price,
  input: {
    entry: CatalogPriceEntry;
    quantity: number;
    expectedAmountCents: number;
    expectedCurrency: string;
  },
): "currency" | "cycle" | "unverifiable_amount" | "amount" | null {
  if ((price.currency ?? "").toLowerCase() !== input.expectedCurrency.toLowerCase()) {
    return "currency";
  }
  // Ta sama kontrola co w synchronizacji katalogu - cena, którą tu odrzucamy,
  // tam jest odtwarzana w poprawnym cyklu.
  if (catalogCycleMismatch(price, input.entry)) return "cycle";
  // Schodki inne niż `volume` (`graduated`) odmawiamy niezależnie od kwoty dla
  // tej ilości: katalog zakłada wyłącznie `volume` (synchronizacja odtwarza
  // każdy inny kształt), a `graduated` liczy niższą stawkę tylko od nadwyżki -
  // przy innej liczbie miejsc (zmiana w portalu, odnowienie) operator
  // obciążyłby inaczej niż reguła planu, choć ta jedna kwota się zgadza
  // (przegląd PAY-01, 0.1).
  if (price.billing_scheme === "tiered" && price.tiers_mode !== "volume") {
    return "unverifiable_amount";
  }
  const amount = stripePriceAmountFor(price, input.quantity);
  if (amount === null) return "unverifiable_amount";
  if (amount !== Math.round(input.expectedAmountCents)) return "amount";
  return null;
}

/** Odmowa sesji, gdy cena operatora nie zgadza się z zamówieniem. */
export const PRICE_MISMATCH_ERROR = "price_mismatch" as const;

/** Maksymalna liczba subskrypcji klienta sprawdzanych przed sesją. */
const CUSTOMER_SUBSCRIPTIONS_LIMIT = 100;

/** Strony listy otwartych sesji klienta (po 100) - więcej to anomalia, odmawiamy. */
const OPEN_SESSION_PAGES = 3;

/** Sesja planu z tej kasy - zawsze z metadanymi (patrz `isPlanSubscriptionSession`). */
type PlanSession = Stripe.Checkout.Session & { metadata: Stripe.Metadata };

/**
 * Sesja, która po opłaceniu ZAŁOŻY subskrypcję planu: tryb `subscription`,
 * metadane planu z tej kasy i nie darowizna. Darowizny cykliczne też jadą
 * sesją subskrypcyjną na tym samym kliencie (`donations.server`) - nie są
 * planem, więc ich nie ruszamy.
 */
function isPlanSubscriptionSession(session: Stripe.Checkout.Session): session is PlanSession {
  const meta = session.metadata ?? {};
  return (
    session.mode === "subscription" &&
    typeof meta["planId"] === "string" &&
    meta["planId"] !== "" &&
    meta["purpose"] !== "donation"
  );
}

/** Otwarte sesje planu klienta. Nie da się przeczytać wszystkich = rzut (fail-closed). */
async function listOpenPlanSessions(stripe: Stripe, customerId: string): Promise<PlanSession[]> {
  const sessions: PlanSession[] = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < OPEN_SESSION_PAGES; page += 1) {
    const result = await stripe.checkout.sessions.list({
      customer: customerId,
      status: "open",
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    sessions.push(...result.data.filter(isPlanSubscriptionSession));
    const last = result.data.at(-1);
    if (!result.has_more || !last) return sessions;
    startingAfter = last.id;
  }
  throw new Error(`too many open checkout sessions for customer ${customerId}`);
}

/**
 * Wygasza otwartą sesję. `expired` = już nie da się jej opłacić, `completed` =
 * zdążyła się opłacić (subskrypcja istnieje), inny wynik rzuca - sesji, której
 * stanu nie znamy, nie wolno zostawić jako „pewnie wygasła".
 */
async function expirePlanSession(
  stripe: Stripe,
  sessionId: string,
): Promise<"expired" | "completed"> {
  try {
    await stripe.checkout.sessions.expire(sessionId);
    return "expired";
  } catch (error) {
    const fresh = await stripe.checkout.sessions.retrieve(sessionId);
    if (fresh.status === "expired") return "expired";
    if (fresh.status === "complete") return "completed";
    throw error;
  }
}

/** Zamówienie TEGO konta stojące za sesją (metadane stempluje wyłącznie ta kasa). */
function ownOrderId(session: PlanSession, userId: string): string | null {
  const meta = session.metadata;
  const orderId = meta["orderId"];
  return meta["userId"] === userId && typeof orderId === "string" && orderId ? orderId : null;
}

/** Porządek sesji: późniejsza wygrywa, przy tej samej sekundzie rozstrzyga identyfikator. */
function isNewerSession(
  a: Pick<Stripe.Checkout.Session, "id" | "created">,
  b: Pick<Stripe.Checkout.Session, "id" | "created">,
): boolean {
  return a.created !== b.created ? a.created > b.created : a.id > b.id;
}

/**
 * Unieważnia pierwszą fakturę subskrypcji `incomplete` (porzucone albo
 * nieudane 3DS), zanim kasa otworzy nową sesję (reguła 3 strażnika).
 *
 * DLACZEGO FAKTURA, A NIE `subscriptions.cancel`. Anulowanie nie jest
 * warunkowe: 3DS dokończone sekundę wcześniej robi z subskrypcji `active`,
 * a `cancel` zamknąłby opłacony dostęp bez zwrotu. Unieważnienie faktury
 * działa jak compare-and-set po stronie operatora: przechodzi wyłącznie na
 * fakturze otwartej (płatność już nie dojdzie), a na opłaconej odmawia - wtedy
 * subskrypcja jest żywa i obowiązuje zwykła reguła drugiego zakupu. Bez
 * anulowania subskrypcja nie zmienia się w `canceled` (który zużyłby trial),
 * tylko wygasa u operatora sama (`incomplete_expired`) - tą samą drogą co
 * każde porzucone 3DS, więc webhook nie dostaje żadnego nowego stanu.
 *
 * @returns `true` = faktura unieważniona (subskrypcja nie wystartuje),
 *          `false` = faktura opłacona w międzyczasie (subskrypcja żywa).
 *          Każdy inny stan rzuca - kasa odmawia zamiast zgadywać.
 */
async function voidAbandonedFirstInvoice(
  stripe: Stripe,
  subscription: Stripe.Subscription,
): Promise<boolean> {
  const latest = subscription.latest_invoice;
  const invoiceId = typeof latest === "string" ? latest : (latest?.id ?? null);
  if (!invoiceId) throw new Error(`incomplete subscription without invoice: ${subscription.id}`);
  try {
    await stripe.invoices.voidInvoice(
      invoiceId,
      {},
      { idempotencyKey: `void-abandoned-first-invoice:${invoiceId}` },
    );
    return true;
  } catch (error) {
    // Odmowa operatora: faktura już unieważniona (poprzednia próba), opłacona
    // spóźnionym 3DS albo w stanie, którego nie rozumiemy - rozstrzyga odczyt.
    const invoice = await stripe.invoices.retrieve(invoiceId);
    if (invoice.status === "void") return true;
    if (invoice.status === "paid") return false;
    throw error;
  }
}

/**
 * Tworzy Embedded Checkout Session z ceny katalogowej. Tryb (subscription vs
 * payment) wynika z `price.type` - katalog zawiera też ceny jednorazowe.
 *
 * PRZED sesją, w tej kolejności:
 *   1. `lookup_key` musi być pozycją `BILLING_CATALOG`,
 *   2. BRAMKA SPÓJNOŚCI CENY Z ZAMÓWIENIEM (`catalogPriceMismatch`). Wołający
 *      podaje kwotę brutto i walutę z wyceny planu zamówienia, a typ i cykl
 *      ceny wynikają z pozycji katalogu - tej samej, którą wycenił plan
 *      (`planCheckoutPricing`). Cena pod `lookup_key` jest u operatora
 *      obiektem zmiennym (synchronizacja katalogu, ręczna edycja w panelu,
 *      przeniesiony klucz, cena zbudowana z planu najemcy domyślnego na
 *      wspólnym koncie) - gdy cokolwiek się nie zgadza, sesja pobrałaby
 *      pieniądze za coś innego, niż zapisaliśmy: subskrypcję zamiast zakupu
 *      jednorazowego, euro zamiast złotych, rozliczenie co dwa tygodnie
 *      zamiast co rok albo inną kwotę (audyty PAY-01 i SUB-05). Odmawiamy
 *      ZANIM powstanie klient i sesja, a wołający zamyka zamówienie jako
 *      `failed` i zwalnia kupon,
 *   3. subskrypcja - kolejność kroków jest częścią dowodu:
 *      a. WYGASZENIE otwartych sesji planu tego klienta. Strażnik patrzy na
 *         subskrypcje, a te powstają dopiero przy opłaceniu sesji: dwie karty
 *         otwarte przed pierwszą płatnością przechodziły obie i obie dało się
 *         opłacić (dwa obciążenia co cykl, dwa triale). Wygaszamy PRZED
 *         odczytem subskrypcji - sesja opłacona sekundę wcześniej jest wtedy
 *         już subskrypcją w kroku b, a nie otwartą sesją, którą by pominął,
 *      b. pierwsza faktura subskrypcji `incomplete` unieważniona
 *         (`voidAbandonedFirstInvoice`), żeby porzucone 3DS nie zamykało kasy,
 *      c. żywa subskrypcja planu w konflikcie z zakupem odmawia, a trial
 *         dostaje tylko ten, kto nigdy jej nie miał (`planSubscriptionGuard`).
 * Po założeniu sesji (krok 4) drugi przegląd rozstrzyga wyścig z sesją
 * otwartą RÓWNOLEGLE: zostaje nowsza, starsza jest wygaszana - także nasza.
 *
 * KLUCZ IDEMPOTENCJI z zamówienia (`checkoutSessionIdempotencyKey`, ten sam co
 * w sesji ad-hoc): ponowienie żądania przez SDK po zerwanym połączeniu dostaje
 * TĘ SAMĄ sesję zamiast drugiej. Parametry sesji są stałe dla zamówienia
 * (chwilę zgody wylicza wołający raz), więc klucz nigdy nie trafia na inny
 * ładunek. Świadomie BEZ `expires_at`: minimum operatora to 30 minut, więc
 * samo skrócenie życia sesji okna nie zamyka, a parametr zależny od zegara
 * łamałby tożsamość ponowienia.
 */
export async function createPlanCheckoutSession(
  input: PlanCheckoutSessionInput,
): Promise<PlanCheckoutSessionResult> {
  const supersededOrderIds: string[] = [];
  const withSuperseded = (result: CheckoutSessionResult): PlanCheckoutSessionResult =>
    supersededOrderIds.length > 0 ? { ...result, supersededOrderIds } : result;
  try {
    const entry = catalogEntryByPriceId(input.priceLookupKey);
    if (!entry) return { ok: false, error: "price_not_in_catalog" };

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

    const mismatch = catalogPriceMismatch(price, {
      entry,
      quantity,
      expectedAmountCents: input.expectedAmountCents,
      expectedCurrency: input.expectedCurrency,
    });
    if (mismatch) {
      // Głośno w logu: to rozjazd cennika (plan najemcy vs cena wspólna albo
      // ręczna zmiana u operatora), który naprawia operator platformy.
      console.error("[payments] catalog price mismatch - checkout refused", {
        reason: mismatch,
        lookupKey: input.priceLookupKey,
        priceId: price.id,
        orderId: input.orderId,
        quantity,
        priceMode: mode,
        expectedAmountCents: input.expectedAmountCents,
        priceAmountCents: stripePriceAmountFor(price, quantity),
        expectedCurrency: input.expectedCurrency,
        stripeCurrency: price.currency,
        expectedRecurring: catalogRecurringFor(entry),
        priceRecurring: price.recurring
          ? {
              interval: price.recurring.interval,
              interval_count: price.recurring.interval_count,
              usage_type: price.recurring.usage_type,
            }
          : null,
      });
      return { ok: false, error: PRICE_MISMATCH_ERROR };
    }

    const customerId = await resolveOrCreateCustomer(stripe, {
      userId: input.userId,
      email: input.customerEmail,
    });

    // Historia u OPERATORA - widzi okno przed webhookiem (subskrypcja już
    // założona, wiersza `subscriptions` jeszcze nie ma) i subskrypcje, których
    // lustro w bazie nie pokazuje. Dotyczy wyłącznie subskrypcji: zakup
    // jednorazowy nie dubluje cyklu i nie ma triala.
    let trialAllowed = input.trialEligible !== false;
    if (mode === "subscription") {
      // a. Otwarte sesje planu tego klienta - po opłaceniu każda byłaby drugą
      //    subskrypcją. Zasięg = klient (konto) w środowisku tego klienta
      //    operatora, a nie najemca: tak samo liczy strażnik niżej, więc
      //    sesja planu najemcy A blokuje zakup u B tak samo jak subskrypcja.
      for (const open of await listOpenPlanSessions(stripe, customerId)) {
        if ((await expirePlanSession(stripe, open.id)) === "expired") {
          const orderId = ownOrderId(open, input.userId);
          if (orderId) supersededOrderIds.push(orderId);
        }
        // `completed`: sesja zdążyła się opłacić - jej subskrypcję widzi krok c.
      }

      const remote = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: CUSTOMER_SUBSCRIPTIONS_LIMIT,
      });
      const records: PlanSubscriptionRecord[] = [];
      for (const sub of remote.data) {
        const purpose = sub.metadata?.["purpose"];
        let status: string = sub.status;
        // b. Porzucone 3DS: po unieważnieniu faktury subskrypcja nie wystartuje,
        //    więc nie blokuje i nie zużywa triala; opłacona w międzyczasie jest
        //    żywa. Darowizn nie ruszamy - to nie plan.
        if (purpose !== "donation" && status === PENDING_FIRST_PAYMENT_STATUS) {
          status = (await voidAbandonedFirstInvoice(stripe, sub))
            ? PENDING_FIRST_PAYMENT_STATUS
            : "active";
        }
        records.push({
          status,
          purpose,
          lookupKey: sub.items?.data?.[0]?.price?.lookup_key ?? null,
        });
      }
      // c. Konflikt liczony względem KUPOWANEJ pozycji - osobny zakup (inny
      //    model rozliczenia) przechodzi, ale bez triala, jeśli plan już był.
      const history = planSubscriptionHistory(records, entry);
      if (history.hasLive) return withSuperseded({ ok: false, error: SUBSCRIPTION_EXISTS_ERROR });
      if (history.hadAny) trialAllowed = false;
    }

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
    // Trial RAZ na konto: kto miał subskrypcję planu, płaci od pierwszego dnia.
    const trialPeriodDays =
      mode === "subscription" && trialAllowed && Number.isFinite(input.trialDays)
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

    // Zgoda z checkoutu dokładana DO metadanych, nie zamiast nich: subskrypcja
    // u operatora dziedziczy `subscription_data.metadata`, a z niej czyta ją
    // webhook (`readPremiumNewsletterConsentMetadata`).
    if (mode === "subscription" && input.newsletterConsent) {
      const consentMeta = premiumNewsletterConsentMetadata(input.newsletterConsent);
      params.metadata = { ...params.metadata, ...consentMeta };
      params.subscription_data = {
        ...params.subscription_data,
        metadata: { ...params.subscription_data?.metadata, ...consentMeta },
      };
    }

    const session = await stripe.checkout.sessions.create(params, {
      idempotencyKey: checkoutSessionIdempotencyKey(input.orderId),
    });
    if (!session.client_secret) {
      return withSuperseded({ ok: false, error: "session_missing_client_secret" });
    }

    // 4. Wyścig z sesją otwartą RÓWNOLEGLE (druga karta kliknęła w tej samej
    //    chwili, oba przeglądy z kroku a były puste). Każda strona po
    //    założeniu przegląda ponownie i stosuje ten sam porządek: zostaje
    //    NOWSZA sesja. W każdym przeplocie przynajmniej jedna strona widzi
    //    drugą (późniejszy przegląd następuje po obu założeniach), więc
    //    otwarta zostaje dokładnie jedna - nigdy dwie i nigdy żadna.
    if (mode === "subscription") {
      const rivals = (await listOpenPlanSessions(stripe, customerId)).filter(
        (s) => s.id !== session.id,
      );
      const lost = rivals.some((s) => isNewerSession(s, session));
      for (const rival of lost ? [] : rivals) {
        if ((await expirePlanSession(stripe, rival.id)) === "completed") {
          // Starsza sesja zdążyła się opłacić - nasza byłaby drugą subskrypcją.
          await expirePlanSession(stripe, session.id);
          return withSuperseded({ ok: false, error: SUBSCRIPTION_EXISTS_ERROR });
        }
        const orderId = ownOrderId(rival, input.userId);
        if (orderId) supersededOrderIds.push(orderId);
      }
      if (lost) {
        await expirePlanSession(stripe, session.id);
        return withSuperseded({ ok: false, error: CHECKOUT_SUPERSEDED_ERROR });
      }
    }

    return withSuperseded({
      ok: true,
      clientSecret: session.client_secret,
      sessionId: session.id,
    });
  } catch (e) {
    const { getStripeErrorMessage } = await import("@/lib/stripe.server");
    console.error("[payments] plan checkout session failed", e);
    return withSuperseded({ ok: false, error: getStripeErrorMessage(e) });
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
  /**
   * Kod podatkowy produktu Stripe (`txcd_########`) z biletu (TIX-09). Bez
   * niego Stripe Tax liczył bilet jak produkt ogólny, a faktura organizatora
   * brała stawkę z ustawień - stawki rozjeżdżały się dla wydarzeń 8% i zw.
   * Treść cyfrowa zawsze dostaje `ADHOC_DIGITAL_TAX_CODE`.
   */
  taxCode?: string;
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

/** Kod podatkowy pozycji: treść cyfrowa (MoR) albo kod z biletu wydarzenia. */
function adhocTaxCode(input: AdhocCheckoutSessionInput): { tax_code?: string } {
  if (adhocAllowsManagedPayments(input.purpose)) return { tax_code: ADHOC_DIGITAL_TAX_CODE };
  if (input.purpose === "event_ticket" && input.taxCode && /^txcd_[0-9]{8}$/.test(input.taxCode)) {
    return { tax_code: input.taxCode };
  }
  return {};
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
              ...adhocTaxCode(input),
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
