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
  createStripeClient: (env: string) => {
    h.envs.push(env);
    return h.stripe;
  },
  getStripeErrorMessage: (e: unknown) => `stripe_error:${(e as Error).message}`,
  resolveEnvironment: (requested?: string | null) => requested ?? "sandbox",
}));

import {
  MIN_ADHOC_AMOUNT_CENTS,
  createAdhocCheckoutSession,
  createAdhocDiscountForCoupon,
  createPlanCheckoutSession,
  resolveOrCreateCustomer,
  resolvePricesByLookupKeys,
  reuseOpenSession,
  type AdhocCheckoutSessionInput,
  type PlanCheckoutSessionInput,
} from "@/lib/billing/adhocCheckout.server";

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

const stripePrice = (over: Record<string, unknown> = {}): Stripe.Price =>
  ({
    id: "price_1",
    lookup_key: "pro_monthly",
    type: "recurring",
    ...over,
  }) as unknown as Stripe.Price;

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

  it("odrzuca zero, kwoty ujemne i wartości nieliczbowe", async () => {
    for (const amountCents of [0, -1, -5000, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = await createAdhocCheckoutSession(adhoc({ amountCents }));
      expect(result, `amountCents=${amountCents}`).toEqual({ ok: false, error: "amount_too_low" });
    }
    expect(h.fns.sessionsCreate).not.toHaveBeenCalled();
  });

  it("przepuszcza dokładnie minimum operatora", async () => {
    const result = await createAdhocCheckoutSession(adhoc({ amountCents: MIN_ADHOC_AMOUNT_CENTS }));

    expect(MIN_ADHOC_AMOUNT_CENTS).toBe(50);
    expect(result).toEqual({ ok: true, clientSecret: "cs_secret_1", sessionId: "cs_1" });
    expect(lastSession().line_items[0].price_data?.unit_amount).toBe(50);
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
      product_data: { name: "Dostęp do artykułu" },
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
    for (const purpose of ["content_unlock", "event_ticket", "donation"] as const) {
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

  it("nie zatrzymuje nieliczbowej liczebności na progu 1", async () => {
    // UWAGA: dokumentuje obecne zachowanie, patrz raport.
    await createAdhocCheckoutSession(adhoc({ quantity: Number.NaN }));

    expect(lastSession().line_items[0].quantity).toBeNaN();
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
      data: [stripePrice({ type: "one_time", product: { id: "prod_1", name: "Kurs online" } })],
    });

    await createPlanCheckoutSession(plan());

    const params = lastSession();
    expect(params.mode).toBe("payment");
    expect(params.payment_intent_data?.description).toBe("Kurs online");
    expect(params.payment_intent_data?.metadata).toEqual(params.metadata);
    expect(params).not.toHaveProperty("subscription_data");
  });

  it("używa opisu zastępczego, gdy produkt nie został rozwinięty", async () => {
    h.fns.pricesList.mockResolvedValue({
      data: [stripePrice({ type: "one_time", product: "prod_1" })],
    });

    await createPlanCheckoutSession(plan());

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

    await createPlanCheckoutSession(plan({ quantity: 250 }));
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
    expect(h.fns.pricesList).toHaveBeenCalledWith({
      lookup_keys: ["pro_monthly", "pro_yearly"],
      active: true,
      expand: ["data.product"],
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
    });

    expect(id).toBe("coupon_generated");
    expect(h.fns.couponsCreate).toHaveBeenCalledWith({
      amount_off: 1990,
      currency: "pln",
      duration: "once",
      name: "Kupon B2B10",
      metadata: { source: "b2b_coupon", code: "B2B10" },
    });
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
