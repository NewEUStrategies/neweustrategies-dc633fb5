// Serwerowe tworzenie sesji Stripe Embedded Checkout.
//
// Kwota NIGDY nie pochodzi od klienta - ten moduł jest ostatnim miejscem, w
// którym da się ją zepsuć (waluta, minimum operatora, liczebność, kupon), więc
// testujemy dokładnie to, co leci do operatora: parametry sesji. Wymieniamy
// wyłącznie klienta Stripe; `normalizeCheckoutLocale` zostaje prawdziwy, bo
// język formularza jest częścią kontraktu tej warstwy.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

const h = vi.hoisted(() => {
  const fns = {
    customersSearch: vi.fn(),
    customersList: vi.fn(),
    customersUpdate: vi.fn(),
    customersCreate: vi.fn(),
    pricesList: vi.fn(),
    couponsCreate: vi.fn(),
    sessionsCreate: vi.fn(),
    sessionsRetrieve: vi.fn(),
  };
  const stripe = {
    customers: {
      search: fns.customersSearch,
      list: fns.customersList,
      update: fns.customersUpdate,
      create: fns.customersCreate,
    },
    prices: { list: fns.pricesList },
    coupons: { create: fns.couponsCreate },
    checkout: { sessions: { create: fns.sessionsCreate, retrieve: fns.sessionsRetrieve } },
  };
  /** Środowiska, dla których moduł poprosił o klienta operatora. */
  const envs: string[] = [];
  return { fns, stripe, envs };
});

vi.mock("@/lib/stripe.server", () => ({
  getStripeClient: (env: string) => {
    h.envs.push(env);
    return h.stripe;
  },
  getStripeErrorMessage: (e: unknown) => `stripe_error:${(e as Error).message}`,
  resolveEnvironment: (requested?: string | null) => requested ?? "sandbox",
}));

import {
  MAX_LINE_QUANTITY,
  STRIPE_COUPON_NAME_MAX,
  createAdhocCheckoutSession,
  createAdhocDiscountForCoupon,
  createPlanCheckoutSession,
  planPriceMismatch,
  resolveOrCreateCustomer,
  resolvePricesByLookupKeys,
  reuseOpenSession,
  stripeCouponName,
  stripePriceAmountCents,
  type AdhocCheckoutSessionInput,
  type PlanCheckoutSessionInput,
} from "@/lib/billing/adhocCheckout.server";
import { minimumChargeCents } from "@/lib/billing/chargeMinimum";

/** Kształt parametrów sesji, na których zależy nam w asercjach. */
interface SessionParams {
  mode: string;
  ui_mode: string;
  locale: string;
  return_url: string;
  customer?: string;
  customer_email?: string;
  line_items: Array<{
    quantity: number;
    price?: string;
    price_data?: {
      currency: string;
      unit_amount: number;
      product_data: { name: string; description?: string };
    };
  }>;
  metadata: Record<string, string>;
  discounts?: Array<Record<string, string>>;
  subscription_data?: { metadata: Record<string, string>; trial_period_days?: number };
  payment_intent_data?: { description: string; metadata: Record<string, string> };
  managed_payments?: { enabled: boolean };
}

const lastSession = (): SessionParams =>
  h.fns.sessionsCreate.mock.calls.at(-1)![0] as SessionParams;
const asStripe = () => h.stripe as unknown as Stripe;

/**
 * Cena `pro_monthly` w kształcie, który oddaje operator: płaska stawka za
 * sztukę, cykl miesięczny, rozliczenie za ilość. Bramka spójności (PAY-01)
 * porównuje KAŻDE z tych pól z zamówieniem.
 */
const stripePrice = (over: Record<string, unknown> = {}): Stripe.Price =>
  ({
    id: "price_1",
    lookup_key: "pro_monthly",
    type: "recurring",
    currency: "pln",
    billing_scheme: "per_unit",
    unit_amount: 4900,
    recurring: { interval: "month", interval_count: 1, usage_type: "licensed" },
    tiers_mode: null,
    transform_quantity: null,
    custom_unit_amount: null,
    ...over,
  }) as unknown as Stripe.Price;

/** Cena jednorazowa (Decision Lab) - bez cyklu. */
const oneTimePrice = (over: Record<string, unknown> = {}): Stripe.Price =>
  stripePrice({ type: "one_time", recurring: null, ...over });

/** Opcje drugiego argumentu wywołania operatora (`RequestOptions`). */
const requestOptionsOf = (fn: { mock: { calls: unknown[][] } }) => fn.mock.calls.at(-1)?.[1];

const adhoc = (over: Partial<AdhocCheckoutSessionInput> = {}): AdhocCheckoutSessionInput => ({
  environment: "sandbox",
  name: "Dostęp do artykułu",
  amountCents: 1500,
  currency: "PLN",
  orderId: "ord_1",
  purpose: "content_unlock",
  returnUrl: "https://example.com/dziekujemy",
  ...over,
});

const plan = (over: Partial<PlanCheckoutSessionInput> = {}): PlanCheckoutSessionInput => ({
  environment: "sandbox",
  priceLookupKey: "pro_monthly",
  expectedMode: "subscription",
  expectedCurrency: "PLN",
  expectedRecurring: { interval: "month", intervalCount: 1 },
  expectedAmountCents: 4900,
  planId: "plan_pro",
  orderId: "ord_1",
  userId: "user-1",
  returnUrl: "https://example.com/dziekujemy",
  ...over,
});

beforeEach(() => {
  h.envs.length = 0;
  h.fns.customersSearch.mockResolvedValue({ data: [] });
  h.fns.customersList.mockResolvedValue({ data: [] });
  h.fns.customersUpdate.mockResolvedValue({ id: "cus_existing" });
  h.fns.customersCreate.mockResolvedValue({ id: "cus_new" });
  h.fns.pricesList.mockResolvedValue({ data: [stripePrice()] });
  h.fns.couponsCreate.mockResolvedValue({ id: "coupon_generated" });
  h.fns.sessionsCreate.mockResolvedValue({ id: "cs_1", client_secret: "cs_secret_1" });
  h.fns.sessionsRetrieve.mockResolvedValue({
    id: "cs_1",
    status: "open",
    client_secret: "cs_secret_1",
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const fn of Object.values(h.fns)) fn.mockReset();
});

describe("createAdhocCheckoutSession - walidacja kwoty", () => {
  it("odrzuca kwotę poniżej minimum operatora, zanim dotknie Stripe", async () => {
    const result = await createAdhocCheckoutSession(adhoc({ amountCents: 49 }));

    expect(result).toEqual({ ok: false, error: "amount_too_low" });
    expect(h.envs).toEqual([]);
    expect(h.fns.sessionsCreate).not.toHaveBeenCalled();
  });

  it("minimum jest PER WALUTA: 1,99 zł nie przechodzi, choć 50 groszy było progiem (przegląd 0.3)", async () => {
    // Stripe obciąża w złotówkach od 2,00 zł. Wspólny próg 50 jednostek
    // przepuszczał 1,50 zł do operatora, który odrzucał sesję dopiero po
    // założeniu zamówienia.
    for (const amountCents of [150, 199]) {
      const result = await createAdhocCheckoutSession(adhoc({ amountCents, currency: "PLN" }));
      expect(result, `amountCents=${amountCents}`).toEqual({ ok: false, error: "amount_too_low" });
    }
    expect(h.fns.sessionsCreate).not.toHaveBeenCalled();
  });

  it("minimum euro to 0,50 EUR - ta sama reguła, inny próg", async () => {
    expect(await createAdhocCheckoutSession(adhoc({ amountCents: 49, currency: "EUR" }))).toEqual({
      ok: false,
      error: "amount_too_low",
    });
    expect(await createAdhocCheckoutSession(adhoc({ amountCents: 50, currency: "EUR" }))).toEqual({
      ok: true,
      clientSecret: "cs_secret_1",
      sessionId: "cs_1",
    });
  });

  it("minimum dotyczy OBCIĄŻENIA (stawka × ilość), nie stawki jednej sztuki", async () => {
    const result = await createAdhocCheckoutSession(
      adhoc({ amountCents: 100, quantity: 2, currency: "PLN" }),
    );

    expect(result.ok).toBe(true);
    expect(lastSession().line_items[0]).toMatchObject({ quantity: 2 });
  });

  it("odrzuca zero, kwoty ujemne i wartości nieliczbowe", async () => {
    for (const amountCents of [0, -1, -5000, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = await createAdhocCheckoutSession(adhoc({ amountCents }));
      expect(result, `amountCents=${amountCents}`).toEqual({ ok: false, error: "amount_too_low" });
    }
    expect(h.fns.sessionsCreate).not.toHaveBeenCalled();
  });

  it("przepuszcza dokładnie minimum operatora", async () => {
    const minimum = minimumChargeCents("PLN");
    const result = await createAdhocCheckoutSession(adhoc({ amountCents: minimum }));

    expect(minimum).toBe(200);
    expect(result).toEqual({ ok: true, clientSecret: "cs_secret_1", sessionId: "cs_1" });
    expect(lastSession().line_items[0].price_data?.unit_amount).toBe(200);
  });

  it("zaokrągla kwotę ułamkową do pełnych groszy", async () => {
    await createAdhocCheckoutSession(adhoc({ amountCents: 1234.6 }));
    expect(lastSession().line_items[0].price_data?.unit_amount).toBe(1235);

    await createAdhocCheckoutSession(adhoc({ amountCents: 1234.4 }));
    expect(lastSession().line_items[0].price_data?.unit_amount).toBe(1234);
  });
});

describe("createAdhocCheckoutSession - kształt sesji", () => {
  it("osadza serwerową kwotę i walutę w pozycji zamiast sięgać do katalogu", async () => {
    await createAdhocCheckoutSession(adhoc({ amountCents: 9900, currency: "EUR" }));

    const params = lastSession();
    expect(params.mode).toBe("payment");
    expect(params.ui_mode).toBe("embedded_page");
    expect(params.return_url).toBe("https://example.com/dziekujemy");
    expect(params.managed_payments).toEqual({ enabled: true });
    expect(params.line_items[0].price).toBeUndefined();
    expect(params.line_items[0].price_data).toEqual({
      currency: "eur",
      unit_amount: 9900,
      product_data: { name: "Dostęp do artykułu", tax_code: "txcd_10000000" },
    });
  });

  it("przycina nazwę i opis pozycji do limitu operatora", async () => {
    await createAdhocCheckoutSession(
      adhoc({ name: "N".repeat(250), description: "O".repeat(250) }),
    );

    const productData = lastSession().line_items[0].price_data?.product_data;
    expect(productData?.name).toHaveLength(200);
    expect(productData?.description).toHaveLength(200);
    expect(lastSession().payment_intent_data?.description).toHaveLength(200);
  });

  it("pomija opis, gdy go nie podano (Stripe odrzuca pusty string)", async () => {
    await createAdhocCheckoutSession(adhoc());

    expect(lastSession().line_items[0].price_data?.product_data).not.toHaveProperty("description");
  });

  it("przypina znanego użytkownika do klienta Stripe i nie dubluje pola e-mail", async () => {
    h.fns.customersSearch.mockResolvedValue({ data: [{ id: "cus_known" }] });

    await createAdhocCheckoutSession(adhoc({ userId: "user-1", customerEmail: "a@example.com" }));

    const params = lastSession();
    expect(params.customer).toBe("cus_known");
    // `customer` i `customer_email` wykluczają się w API Stripe.
    expect(params).not.toHaveProperty("customer_email");
    expect(params.metadata.userId).toBe("user-1");
  });

  it("dla gościa przekazuje sam e-mail zamiast zakładać konto klienta", async () => {
    await createAdhocCheckoutSession(adhoc({ userId: null, customerEmail: "gosc@example.com" }));

    const params = lastSession();
    expect(params.customer_email).toBe("gosc@example.com");
    expect(params).not.toHaveProperty("customer");
    expect(params.metadata).not.toHaveProperty("userId");
    expect(h.fns.customersSearch).not.toHaveBeenCalled();
    expect(h.fns.customersCreate).not.toHaveBeenCalled();
  });

  it("gość bez e-maila nie dostaje ani klienta, ani pola customer_email", async () => {
    await createAdhocCheckoutSession(adhoc({ userId: null, customerEmail: null }));

    const params = lastSession();
    expect(params).not.toHaveProperty("customer");
    expect(params).not.toHaveProperty("customer_email");
  });

  it("stempluje sesję i intencję płatności tymi samymi metadanymi (webhook czyta je z obu)", async () => {
    await createAdhocCheckoutSession(
      adhoc({ userId: "user-1", metadata: { event_id: "ev_1", label: "Bilet" } }),
    );

    const params = lastSession();
    expect(params.metadata).toEqual({
      orderId: "ord_1",
      purpose: "content_unlock",
      userId: "user-1",
      event_id: "ev_1",
      label: "Bilet",
    });
    expect(params.payment_intent_data?.metadata).toEqual(params.metadata);
    expect(params.payment_intent_data?.description).toBe("Dostęp do artykułu");
  });

  it("metadane wywołującego nadpisują pola bazowe zamówienia", async () => {
    // UWAGA: dokumentuje obecne zachowanie, patrz raport.
    await createAdhocCheckoutSession(
      adhoc({
        userId: "user-1",
        metadata: { orderId: "podmieniony", purpose: "donation", userId: "user-2" },
      }),
    );

    expect(lastSession().metadata).toMatchObject({
      orderId: "podmieniony",
      purpose: "donation",
      userId: "user-2",
    });
  });

  it("przenosi cel płatności do metadanych każdego rodzaju zakupu", async () => {
    for (const purpose of ["content_unlock", "event_ticket"] as const) {
      await createAdhocCheckoutSession(adhoc({ purpose }));
      expect(lastSession().metadata.purpose, purpose).toBe(purpose);
    }
  });

  it("przycina liczebność do zakresu 1-100", async () => {
    const cases: Array<[number | undefined, number]> = [
      [undefined, 1],
      [0, 1],
      [-3, 1],
      [1.9, 1],
      [2.9, 2],
      [100, 100],
      [1000, 100],
    ];

    for (const [quantity, expected] of cases) {
      await createAdhocCheckoutSession(adhoc({ quantity }));
      expect(lastSession().line_items[0].quantity, `quantity=${quantity}`).toBe(expected);
    }
  });

  it("nieliczbowa liczebność schodzi na jedną sztukę - `NaN` nie trafia do operatora", async () => {
    // Do 12.10.2026 `NaN` przechodził jako ilość pozycji. Bramka minimum
    // liczy teraz kwotę od tej samej ilości, więc obie muszą być liczbą.
    const result = await createAdhocCheckoutSession(adhoc({ quantity: Number.NaN }));

    expect(result.ok).toBe(true);
    expect(lastSession().line_items[0].quantity).toBe(1);
  });

  it("normalizuje język formularza operatora (ramka nie dziedziczy naszego i18n)", async () => {
    const cases: Array<[unknown, string]> = [
      [undefined, "pl"],
      ["pl", "pl"],
      ["en", "en"],
      ["en-GB", "en"],
      ["de", "pl"],
    ];

    for (const [locale, expected] of cases) {
      await createAdhocCheckoutSession(
        adhoc({ locale: locale as AdhocCheckoutSessionInput["locale"] }),
      );
      expect(lastSession().locale, String(locale)).toBe(expected);
    }
  });
});

describe("createAdhocCheckoutSession - środowisko i ścieżki błędów", () => {
  it("prosi o klienta dokładnie tego środowiska, którym ostemplowano zamówienie", async () => {
    await createAdhocCheckoutSession(adhoc({ environment: "sandbox" }));
    await createAdhocCheckoutSession(adhoc({ environment: "live" }));

    expect(h.envs).toEqual(["sandbox", "live"]);
  });

  it("zgłasza błąd, gdy operator zwróci sesję bez sekretu (nakładka nie ruszy)", async () => {
    h.fns.sessionsCreate.mockResolvedValue({ id: "cs_1", client_secret: null });

    const result = await createAdhocCheckoutSession(adhoc());

    expect(result).toEqual({ ok: false, error: "session_missing_client_secret" });
  });

  it("zamienia awarię operatora na wynik błędu zamiast rzucać wyjątkiem", async () => {
    h.fns.sessionsCreate.mockRejectedValue(new Error("card_declined"));

    const result = await createAdhocCheckoutSession(adhoc());

    expect(result).toEqual({ ok: false, error: "stripe_error:card_declined" });
    expect(console.error).toHaveBeenCalled();
  });

  it("łapie też awarię na etapie rozwiązywania klienta", async () => {
    h.fns.customersSearch.mockRejectedValue(new Error("rate_limited"));

    const result = await createAdhocCheckoutSession(adhoc({ userId: "user-1" }));

    expect(result).toEqual({ ok: false, error: "stripe_error:rate_limited" });
    expect(h.fns.sessionsCreate).not.toHaveBeenCalled();
  });
});

describe("createPlanCheckoutSession", () => {
  it("odmawia, gdy czytelny klucz ceny nie istnieje w katalogu operatora", async () => {
    h.fns.pricesList.mockResolvedValue({ data: [] });

    const result = await createPlanCheckoutSession(plan());

    expect(result).toEqual({ ok: false, error: "price_missing" });
    expect(h.fns.sessionsCreate).not.toHaveBeenCalled();
  });

  // ── Okres próbny ───────────────────────────────────────────────────────────
  // Odtworzenie ochrony skasowanej przy migracji operatora. U poprzedniego
  // dostawcy trial siedział na cenie i działał sam; tutaj metadane ceny są
  // BEZWŁADNE - bez `subscription_data.trial_period_days` karta zostaje
  // obciążona natychmiast, mimo że plan i cennik obiecują okres próbny.
  it("przekazuje okres próbny planu do sesji subskrypcji", async () => {
    await createPlanCheckoutSession({ ...plan(), trialDays: 7 });

    expect(lastSession().subscription_data?.trial_period_days).toBe(7);
  });

  it("nie wysyła okresu próbnego, gdy plan go nie ma (0 jest błędem walidacji operatora)", async () => {
    await createPlanCheckoutSession({ ...plan(), trialDays: 0 });

    expect(lastSession().subscription_data).not.toHaveProperty("trial_period_days");
  });

  it("pomija okres próbny, gdy nie podano go wcale", async () => {
    await createPlanCheckoutSession(plan());

    expect(lastSession().subscription_data).not.toHaveProperty("trial_period_days");
  });

  it("normalizuje okres próbny: ułamki w dół, wartości ujemne i spoza zakresu odrzucone", async () => {
    await createPlanCheckoutSession({ ...plan(), trialDays: 7.9 });
    expect(lastSession().subscription_data?.trial_period_days).toBe(7);

    await createPlanCheckoutSession({ ...plan(), trialDays: -3 });
    expect(lastSession().subscription_data).not.toHaveProperty("trial_period_days");

    await createPlanCheckoutSession({ ...plan(), trialDays: 5000 });
    expect(lastSession().subscription_data?.trial_period_days).toBe(730);

    await createPlanCheckoutSession({ ...plan(), trialDays: Number.NaN });
    expect(lastSession().subscription_data).not.toHaveProperty("trial_period_days");
  });

  it("dla ceny cyklicznej zakłada subskrypcję i powiela metadane na subskrypcji", async () => {
    const result = await createPlanCheckoutSession(plan());

    const params = lastSession();
    expect(result).toEqual({ ok: true, clientSecret: "cs_secret_1", sessionId: "cs_1" });
    expect(params.mode).toBe("subscription");
    expect(params.line_items).toEqual([{ price: "price_1", quantity: 1 }]);
    expect(params.metadata).toEqual({ userId: "user-1", planId: "plan_pro", orderId: "ord_1" });
    expect(params.subscription_data?.metadata).toEqual(params.metadata);
    // Bez tego webhook `customer.subscription.*` nie ma jak trafić w użytkownika.
    expect(params).not.toHaveProperty("payment_intent_data");
  });

  it("dla ceny jednorazowej przechodzi w tryb payment i opisuje płatność nazwą produktu", async () => {
    h.fns.pricesList.mockResolvedValue({
      data: [oneTimePrice({ product: { id: "prod_1", name: "Kurs online" } })],
    });

    await createPlanCheckoutSession(plan({ expectedMode: "payment", expectedRecurring: null }));

    const params = lastSession();
    expect(params.mode).toBe("payment");
    expect(params.payment_intent_data?.description).toBe("Kurs online");
    expect(params.payment_intent_data?.metadata).toEqual(params.metadata);
    expect(params).not.toHaveProperty("subscription_data");
  });

  it("używa opisu zastępczego, gdy produkt nie został rozwinięty", async () => {
    h.fns.pricesList.mockResolvedValue({
      data: [oneTimePrice({ product: "prod_1" })],
    });

    await createPlanCheckoutSession(plan({ expectedMode: "payment", expectedRecurring: null }));

    expect(lastSession().payment_intent_data?.description).toBe("Zamówienie");
  });

  it("przekazuje rabat jako kupon albo jako kod promocyjny", async () => {
    await createPlanCheckoutSession(plan({ discount: { coupon: "coupon_1" } }));
    expect(lastSession().discounts).toEqual([{ coupon: "coupon_1" }]);

    await createPlanCheckoutSession(plan({ discount: { promotionCode: "promo_1" } }));
    expect(lastSession().discounts).toEqual([{ promotion_code: "promo_1" }]);
  });

  it("nie wysyła pustego pola rabatu, gdy rabatu nie ma", async () => {
    await createPlanCheckoutSession(plan({ discount: null }));
    expect(lastSession()).not.toHaveProperty("discounts");

    await createPlanCheckoutSession(plan());
    expect(lastSession()).not.toHaveProperty("discounts");
  });

  it("przycina liczebność miejsc do zakresu 1-100", async () => {
    await createPlanCheckoutSession(plan({ quantity: 0 }));
    expect(lastSession().line_items[0].quantity).toBe(1);

    // Kwotę bramka liczy od ilości PO przycięciu - tej, która idzie w pozycji.
    await createPlanCheckoutSession(plan({ quantity: 250, expectedAmountCents: 4900 * 100 }));
    expect(lastSession().line_items[0].quantity).toBe(100);
  });

  it("rozwiązuje klienta po użytkowniku i e-mailu z zamówienia", async () => {
    await createPlanCheckoutSession(plan({ customerEmail: "kupujacy@example.com" }));

    expect(h.fns.customersSearch).toHaveBeenCalledWith(
      expect.objectContaining({ query: "metadata['userId']:'user-1'" }),
    );
    expect(h.fns.customersCreate).toHaveBeenCalledWith(
      expect.objectContaining({ email: "kupujacy@example.com", metadata: { userId: "user-1" } }),
    );
    expect(lastSession().customer).toBe("cus_new");
  });

  it("zgłasza brak sekretu sesji i awarię operatora bez rzucania wyjątkiem", async () => {
    h.fns.sessionsCreate.mockResolvedValue({ id: "cs_1", client_secret: undefined });
    expect(await createPlanCheckoutSession(plan())).toEqual({
      ok: false,
      error: "session_missing_client_secret",
    });

    h.fns.sessionsCreate.mockRejectedValue(new Error("api_down"));
    expect(await createPlanCheckoutSession(plan())).toEqual({
      ok: false,
      error: "stripe_error:api_down",
    });
    expect(console.error).toHaveBeenCalled();
  });
});

describe("createPlanCheckoutSession - cena niezgodna z planem (audyt PAY-01)", () => {
  // Cena pod `lookup_key` jest u operatora obiektem zmiennym. Gdy jej typ albo
  // waluta nie zgadza się z zamówieniem, sesja pobrałaby pieniądze za coś
  // innego, niż zapisała baza: subskrypcję zamiast zakupu jednorazowego albo
  // euro zamiast złotych. Odmowa zapada ZANIM powstanie klient i sesja.
  it("cena niezgodna z planem -> odmowa: cena CYKLICZNA dla zamówienia jednorazowego", async () => {
    const result = await createPlanCheckoutSession(plan({ expectedMode: "payment" }));

    expect(result).toEqual({ ok: false, error: "price_mismatch" });
    expect(h.fns.sessionsCreate).not.toHaveBeenCalled();
    expect(h.fns.customersSearch).not.toHaveBeenCalled();
    expect(h.fns.customersCreate).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      "[payments] plan price mismatch",
      expect.objectContaining({ expectedMode: "payment", priceMode: "subscription" }),
    );
  });

  it("cena niezgodna z planem -> odmowa: cena JEDNORAZOWA dla subskrypcji", async () => {
    h.fns.pricesList.mockResolvedValue({ data: [oneTimePrice()] });

    const result = await createPlanCheckoutSession(plan());

    expect(result).toEqual({ ok: false, error: "price_mismatch" });
    expect(h.fns.sessionsCreate).not.toHaveBeenCalled();
  });

  it("cena niezgodna z planem -> odmowa: INNA WALUTA niż zamówienie", async () => {
    h.fns.pricesList.mockResolvedValue({ data: [stripePrice({ currency: "eur" })] });

    const result = await createPlanCheckoutSession(plan({ expectedCurrency: "PLN" }));

    expect(result).toEqual({ ok: false, error: "price_mismatch" });
    expect(h.fns.sessionsCreate).not.toHaveBeenCalled();
  });

  it("waluta porównywana bez względu na wielkość liter (baza PLN, operator pln)", async () => {
    const result = await createPlanCheckoutSession(plan({ expectedCurrency: "PLN" }));

    expect(result).toEqual({ ok: true, clientSecret: "cs_secret_1", sessionId: "cs_1" });
  });

  it("cena bez waluty w odpowiedzi operatora nie przechodzi jako zgodna", async () => {
    h.fns.pricesList.mockResolvedValue({ data: [stripePrice({ currency: undefined })] });

    expect(await createPlanCheckoutSession(plan())).toEqual({
      ok: false,
      error: "price_mismatch",
    });
  });
});

describe("createPlanCheckoutSession - cykl i kwota ceny zgodne z planem (przegląd PAY-01, 0.1)", () => {
  // Do 12.10.2026 bramka porównywała wyłącznie typ i walutę. Cena rozliczana
  // w innym cyklu albo naliczająca inną kwotę przechodziła - rozjazd wychodził
  // dopiero w realizacji, PO pobraniu pieniędzy. Każdy przypadek niżej to
  // odmowa ZANIM powstanie klient i sesja.
  const refused = async (input: PlanCheckoutSessionInput) => {
    expect(await createPlanCheckoutSession(input)).toEqual({ ok: false, error: "price_mismatch" });
    expect(h.fns.sessionsCreate).not.toHaveBeenCalled();
    expect(h.fns.customersSearch).not.toHaveBeenCalled();
  };

  it("plan ROCZNY, cena co DWA TYGODNIE -> odmowa (interval)", async () => {
    h.fns.pricesList.mockResolvedValue({
      data: [stripePrice({ recurring: { interval: "week", interval_count: 2 } })],
    });

    await refused(plan({ expectedRecurring: { interval: "year", intervalCount: 1 } }));
    expect(console.error).toHaveBeenCalledWith(
      "[payments] plan price mismatch",
      expect.objectContaining({ reason: "interval" }),
    );
  });

  it("plan KWARTALNY, cena miesięczna -> odmowa (`interval_count` 1 zamiast 3)", async () => {
    await refused(plan({ expectedRecurring: { interval: "month", intervalCount: 3 } }));
  });

  it("cena rozliczana za ZUŻYCIE (`metered`) nie jest ceną za miejsca -> odmowa", async () => {
    h.fns.pricesList.mockResolvedValue({
      data: [
        stripePrice({ recurring: { interval: "month", interval_count: 1, usage_type: "metered" } }),
      ],
    });

    await refused(plan());
  });

  it("plan jednorazowy, cena z cyklem -> odmowa", async () => {
    h.fns.pricesList.mockResolvedValue({ data: [oneTimePrice({ recurring: {} })] });

    await refused(plan({ expectedMode: "payment", expectedRecurring: null }));
  });

  it("DRYF KWOTY: operator nalicza 99 zł, zamówienie zapisało 49 zł -> odmowa (amount)", async () => {
    h.fns.pricesList.mockResolvedValue({ data: [stripePrice({ unit_amount: 9900 })] });

    await refused(plan({ expectedAmountCents: 4900 }));
    expect(console.error).toHaveBeenCalledWith(
      "[payments] plan price mismatch",
      expect.objectContaining({
        reason: "amount",
        expectedAmountCents: 4900,
        priceAmountCents: 9900,
      }),
    );
  });

  it("kwota liczona za WSZYSTKIE sztuki: 5 miejsc × 99 zł = 495 zł", async () => {
    h.fns.pricesList.mockResolvedValue({ data: [stripePrice({ unit_amount: 9900 })] });

    expect(
      await createPlanCheckoutSession(plan({ quantity: 5, expectedAmountCents: 49500 })),
    ).toMatchObject({ ok: true });
    h.fns.sessionsCreate.mockClear();
    h.fns.customersSearch.mockClear();
    await refused(plan({ quantity: 5, expectedAmountCents: 9900 }));
  });

  it("cena SCHODKOWA (`volume`): 11 miejsc liczy się po stawce progu - zgodna", async () => {
    h.fns.pricesList.mockResolvedValue({
      data: [
        stripePrice({
          billing_scheme: "tiered",
          tiers_mode: "volume",
          unit_amount: null,
          tiers: [
            { up_to: 10, unit_amount: 9900, flat_amount: null },
            { up_to: null, unit_amount: 7900, flat_amount: null },
          ],
        }),
      ],
    });

    expect(
      await createPlanCheckoutSession(plan({ quantity: 11, expectedAmountCents: 86900 })),
    ).toMatchObject({ ok: true });
    expect(lastSession().line_items[0]).toMatchObject({ quantity: 11 });
  });

  it("cena schodkowa z INNYM progiem niż plan -> odmowa", async () => {
    h.fns.pricesList.mockResolvedValue({
      data: [
        stripePrice({
          billing_scheme: "tiered",
          tiers_mode: "volume",
          unit_amount: null,
          tiers: [
            { up_to: 20, unit_amount: 9900, flat_amount: null },
            { up_to: null, unit_amount: 7900, flat_amount: null },
          ],
        }),
      ],
    });

    await refused(plan({ quantity: 11, expectedAmountCents: 86900 }));
  });

  it.each([
    ["schodki bez rozwiniętych progów", { billing_scheme: "tiered", tiers_mode: "volume" }],
    [
      "schodki `graduated`",
      {
        billing_scheme: "tiered",
        tiers_mode: "graduated",
        tiers: [{ up_to: null, unit_amount: 4900, flat_amount: null }],
      },
    ],
    ["kwota dowolna (`custom_unit_amount`)", { custom_unit_amount: { preset: 4900 } }],
    ["przekształcenie ilości", { transform_quantity: { divide_by: 10, round: "up" } }],
    ["stawka ułamkowa (bez `unit_amount`)", { unit_amount: null, unit_amount_decimal: "4900.5" }],
  ])("cena, której kasa nie wycenia (%s) -> odmowa", async (_label, over) => {
    h.fns.pricesList.mockResolvedValue({ data: [stripePrice(over)] });

    await refused(plan());
  });

  it("cena zgodna co do typu, waluty, cyklu i kwoty przechodzi", async () => {
    expect(await createPlanCheckoutSession(plan())).toEqual({
      ok: true,
      clientSecret: "cs_secret_1",
      sessionId: "cs_1",
    });
  });
});

describe("planPriceMismatch / stripePriceAmountCents - czyste reguły bramki", () => {
  const expected = {
    mode: "subscription" as const,
    currency: "PLN",
    recurring: { interval: "month" as const, intervalCount: 1 },
    amountCents: 4900,
    quantity: 1,
  };

  it("zwraca PIERWSZY powód niezgodności w kolejności typ, waluta, cykl, kwota", () => {
    expect(planPriceMismatch(stripePrice(), expected)).toBeNull();
    expect(planPriceMismatch(oneTimePrice(), expected)).toBe("mode");
    expect(planPriceMismatch(stripePrice({ currency: "eur" }), expected)).toBe("currency");
    expect(
      planPriceMismatch(
        stripePrice({ recurring: { interval: "year", interval_count: 1 } }),
        expected,
      ),
    ).toBe("interval");
    expect(planPriceMismatch(stripePrice({ unit_amount: 4800 }), expected)).toBe("amount");
  });

  it("kwota ceny płaskiej to stawka × ilość, schodkowej `volume` - stawka progu × ilość + opłata stała", () => {
    expect(stripePriceAmountCents(stripePrice(), 3)).toBe(14700);
    const tiered = stripePrice({
      billing_scheme: "tiered",
      tiers_mode: "volume",
      unit_amount: null,
      tiers: [
        { up_to: 10, unit_amount: 9900, flat_amount: null },
        { up_to: null, unit_amount: 7900, flat_amount: 500 },
      ],
    });
    expect(stripePriceAmountCents(tiered, 10)).toBe(99000);
    expect(stripePriceAmountCents(tiered, 11)).toBe(87400);
  });
});

describe("idempotencja wywołań operatora (audyt PAY-16a)", () => {
  // Ponowione żądanie (sieć, retry SDK, podwójny handler) bez klucza zakładało
  // drugą sesję albo drugi kupon `amount_off` na wspólnym koncie. Klucz
  // pochodzi z zamówienia i z celu wywołania - Stripe odrzuca klucz użyty
  // ponownie z innymi parametrami, więc nigdy nie jest wspólny dla celów.
  it("sesja planu dostaje klucz idempotencji z zamówienia", async () => {
    await createPlanCheckoutSession(plan({ orderId: "ord_42" }));

    expect(requestOptionsOf(h.fns.sessionsCreate)).toEqual({
      idempotencyKey: "checkout_session:ord_42",
    });
  });

  it("sesja ad-hoc dostaje klucz idempotencji z zamówienia", async () => {
    await createAdhocCheckoutSession(adhoc({ orderId: "ord_43" }));

    expect(requestOptionsOf(h.fns.sessionsCreate)).toEqual({
      idempotencyKey: "checkout_session:ord_43",
    });
  });

  it("kupon operatora dostaje klucz z zamówienia - INNY niż klucz sesji", async () => {
    await createAdhocDiscountForCoupon(asStripe(), {
      code: "B2B10",
      discountCents: 1000,
      currency: "PLN",
      orderId: "ord_44",
    });

    expect(requestOptionsOf(h.fns.couponsCreate)).toEqual({
      idempotencyKey: "checkout_coupon:ord_44",
    });
  });
});

describe("resolveOrCreateCustomer", () => {
  it("zwraca klienta znalezionego po metadata.userId bez zakładania nowego", async () => {
    h.fns.customersSearch.mockResolvedValue({ data: [{ id: "cus_known" }] });

    const id = await resolveOrCreateCustomer(asStripe(), {
      userId: "user-1",
      email: "a@example.com",
    });

    expect(id).toBe("cus_known");
    expect(h.fns.customersList).not.toHaveBeenCalled();
    expect(h.fns.customersCreate).not.toHaveBeenCalled();
  });

  it("dopina metadata.userId do klienta znalezionego po e-mailu", async () => {
    h.fns.customersList.mockResolvedValue({ data: [{ id: "cus_by_mail" }] });

    const id = await resolveOrCreateCustomer(asStripe(), {
      userId: "user-1",
      email: "a@example.com",
    });

    expect(id).toBe("cus_by_mail");
    // Bez tego zapisu webhook nie odwzoruje klienta na konto w naszej bazie.
    expect(h.fns.customersUpdate).toHaveBeenCalledWith("cus_by_mail", {
      metadata: { userId: "user-1" },
    });
    expect(h.fns.customersCreate).not.toHaveBeenCalled();
  });

  it("zakłada klienta z identyfikatorem użytkownika, gdy nie ma dopasowania", async () => {
    const id = await resolveOrCreateCustomer(asStripe(), {
      userId: "user-1",
      email: "a@example.com",
      name: "Anna Kowalska",
    });

    expect(id).toBe("cus_new");
    expect(h.fns.customersCreate).toHaveBeenCalledWith({
      email: "a@example.com",
      name: "Anna Kowalska",
      metadata: { userId: "user-1" },
    });
  });

  it("pomija wyszukiwanie po e-mailu, gdy e-maila nie znamy", async () => {
    const id = await resolveOrCreateCustomer(asStripe(), { userId: "user-1", email: null });

    expect(id).toBe("cus_new");
    expect(h.fns.customersList).not.toHaveBeenCalled();
    expect(h.fns.customersCreate).toHaveBeenCalledWith({
      email: undefined,
      name: undefined,
      metadata: { userId: "user-1" },
    });
  });
});

describe("resolvePricesByLookupKeys", () => {
  it("nie odpytuje operatora o pustą listę kluczy", async () => {
    const prices = await resolvePricesByLookupKeys(asStripe(), []);

    expect(prices.size).toBe(0);
    expect(h.fns.pricesList).not.toHaveBeenCalled();
  });

  it("indeksuje aktywne ceny po czytelnym kluczu i pomija ceny bez klucza", async () => {
    h.fns.pricesList.mockResolvedValue({
      data: [
        stripePrice({ id: "price_m", lookup_key: "pro_monthly" }),
        stripePrice({ id: "price_y", lookup_key: "pro_yearly" }),
        stripePrice({ id: "price_orphan", lookup_key: null }),
      ],
    });

    const prices = await resolvePricesByLookupKeys(asStripe(), ["pro_monthly", "pro_yearly"]);

    expect([...prices.keys()]).toEqual(["pro_monthly", "pro_yearly"]);
    expect(prices.get("pro_monthly")?.id).toBe("price_m");
    // Progi ceny schodkowej operator oddaje WYŁĄCZNIE po rozwinięciu - bez nich
    // bramka kwoty nie policzy ceny Zespołu i odmówi każdej sesji.
    expect(h.fns.pricesList).toHaveBeenCalledWith({
      lookup_keys: ["pro_monthly", "pro_yearly"],
      active: true,
      expand: ["data.product", "data.tiers"],
    });
  });
});

describe("createAdhocDiscountForCoupon", () => {
  it("nie tworzy kuponu dla zerowego ani ujemnego rabatu", async () => {
    for (const discountCents of [0, -100]) {
      const id = await createAdhocDiscountForCoupon(asStripe(), {
        code: "B2B10",
        discountCents,
        currency: "PLN",
        orderId: "ord_1",
      });
      expect(id, `discountCents=${discountCents}`).toBeNull();
    }
    expect(h.fns.couponsCreate).not.toHaveBeenCalled();
  });

  it("tworzy jednorazowy kupon o kwocie wyliczonej przez bazę", async () => {
    const id = await createAdhocDiscountForCoupon(asStripe(), {
      code: "B2B10",
      discountCents: 1990.4,
      currency: "PLN",
      orderId: "ord_1",
    });

    expect(id).toBe("coupon_generated");
    expect(h.fns.couponsCreate).toHaveBeenCalledWith(
      {
        amount_off: 1990,
        currency: "pln",
        duration: "once",
        name: "Kupon B2B10",
        metadata: { source: "b2b_coupon", code: "B2B10" },
      },
      { idempotencyKey: "checkout_coupon:ord_1" },
    );
  });
});

describe("nazwa kuponu operatora - limit Stripe", () => {
  // Stripe ODRZUCA nazwę kuponu dłuższą niż 40 znaków. Faza sprzedaży sklejona
  // z kodem potrafi ją przekroczyć, a odrzucony kupon to rabat, którego
  // kupujący nie zobaczy w nakładce.
  it("krótki kod zostaje bez zmian", () => {
    expect(stripeCouponName("MINUS20")).toBe("Kupon MINUS20");
  });

  it("długa nazwa jest przycinana do limitu i bez spacji na końcu", () => {
    const name = stripeCouponName("Pierwsza fala sprzedaży + PARTNER-STRATEGICZNY-2026");
    expect(STRIPE_COUPON_NAME_MAX).toBe(40);
    expect(name.length).toBeLessThanOrEqual(STRIPE_COUPON_NAME_MAX);
    expect(name).toBe("Kupon Pierwsza fala sprzedaży + PARTNER-");

    // Cięcie wypadające na spacji nie zostawia jej na końcu nazwy.
    expect(stripeCouponName("123456789012345678901234567890123 X")).toBe(
      "Kupon 123456789012345678901234567890123",
    );
  });

  it("kupon operatora dostaje przyciętą nazwę, a kod w metadanych zostaje pełny", async () => {
    await createAdhocDiscountForCoupon(asStripe(), {
      code: "Pierwsza fala sprzedaży + PARTNER-STRATEGICZNY-2026",
      discountCents: 1000,
      currency: "PLN",
      orderId: "ord_1",
    });

    expect(h.fns.couponsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Kupon Pierwsza fala sprzedaży + PARTNER-",
        metadata: {
          source: "b2b_coupon",
          code: "Pierwsza fala sprzedaży + PARTNER-STRATEGICZNY-2026",
        },
      }),
      { idempotencyKey: "checkout_coupon:ord_1" },
    );
  });

  it("limit ilości pozycji jest tym, którym przycinają obie sesje", () => {
    expect(MAX_LINE_QUANTITY).toBe(100);
  });
});

describe("reuseOpenSession - idempotencja podwójnego kliknięcia", () => {
  it("oddaje sekret otwartej sesji zamiast zakładać drugą", async () => {
    const result = await reuseOpenSession("sandbox", "cs_1");

    expect(result).toEqual({ ok: true, clientSecret: "cs_secret_1", sessionId: "cs_1" });
    expect(h.fns.sessionsRetrieve).toHaveBeenCalledWith("cs_1");
    expect(h.fns.sessionsCreate).not.toHaveBeenCalled();
  });

  it("odmawia wznowienia sesji, która nie jest już otwarta", async () => {
    for (const status of ["complete", "expired"]) {
      h.fns.sessionsRetrieve.mockResolvedValue({
        id: "cs_1",
        status,
        client_secret: "cs_secret_1",
      });
      expect(await reuseOpenSession("sandbox", "cs_1"), status).toBeNull();
    }
  });

  it("odmawia wznowienia sesji bez sekretu", async () => {
    h.fns.sessionsRetrieve.mockResolvedValue({ id: "cs_1", status: "open", client_secret: null });

    expect(await reuseOpenSession("sandbox", "cs_1")).toBeNull();
  });

  it("zwraca null zamiast rzucać, gdy operator nie zna sesji", async () => {
    h.fns.sessionsRetrieve.mockRejectedValue(new Error("No such checkout session"));

    expect(await reuseOpenSession("live", "cs_obce")).toBeNull();
    expect(console.error).toHaveBeenCalled();
  });

  it("odpytuje operatora w środowisku zamówienia", async () => {
    await reuseOpenSession("live", "cs_1");

    expect(h.envs).toEqual(["live"]);
  });
});
