// Serwerowe tworzenie sesji Stripe Embedded Checkout.
//
// Kwota NIGDY nie pochodzi od klienta - ten moduł jest ostatnim miejscem, w
// którym da się ją zepsuć (waluta, minimum operatora, liczebność, kupon), więc
// testujemy dokładnie to, co leci do operatora: parametry sesji. Wymieniamy
// wyłącznie klienta Stripe; `normalizeCheckoutLocale` zostaje prawdziwy, bo
// język formularza jest częścią kontraktu tej warstwy.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

import { catalogEntryByPriceId } from "@/lib/billing/catalog";

const h = vi.hoisted(() => {
  const fns = {
    customersSearch: vi.fn(),
    customersList: vi.fn(),
    customersUpdate: vi.fn(),
    customersCreate: vi.fn(),
    pricesList: vi.fn(),
    subscriptionsList: vi.fn(),
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
    subscriptions: { list: fns.subscriptionsList },
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
  MIN_ADHOC_AMOUNT_CENTS,
  STRIPE_COUPON_NAME_MAX,
  catalogPriceMismatch,
  stripePriceAmountFor,
  createAdhocCheckoutSession,
  createAdhocDiscountForCoupon,
  createPlanCheckoutSession,
  resolveOrCreateCustomer,
  resolvePricesByLookupKeys,
  reuseOpenSession,
  stripeCouponName,
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

/** Cena `pro_monthly` u operatora - zgodna z `plan()` (kwota, waluta, cykl). */
const stripePrice = (over: Record<string, unknown> = {}): Stripe.Price =>
  ({
    id: "price_1",
    lookup_key: "pro_monthly",
    type: "recurring",
    billing_scheme: "per_unit",
    unit_amount: 12900,
    currency: "pln",
    recurring: { interval: "month", interval_count: 1 },
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
  expectedAmountCents: 12900,
  expectedCurrency: "PLN",
  ...over,
});

beforeEach(() => {
  h.envs.length = 0;
  h.fns.customersSearch.mockResolvedValue({ data: [] });
  h.fns.customersList.mockResolvedValue({ data: [] });
  h.fns.customersUpdate.mockResolvedValue({ id: "cus_existing" });
  h.fns.customersCreate.mockResolvedValue({ id: "cus_new" });
  h.fns.pricesList.mockResolvedValue({ data: [stripePrice()] });
  h.fns.subscriptionsList.mockResolvedValue({ data: [] });
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
      data: [
        stripePrice({
          lookup_key: "decision_lab_seat",
          type: "one_time",
          recurring: null,
          unit_amount: 1600000,
          product: { id: "prod_1", name: "Kurs online" },
        }),
      ],
    });

    await createPlanCheckoutSession(
      plan({ priceLookupKey: "decision_lab_seat", expectedAmountCents: 1600000 }),
    );

    const params = lastSession();
    expect(params.mode).toBe("payment");
    expect(params.payment_intent_data?.description).toBe("Kurs online");
    expect(params.payment_intent_data?.metadata).toEqual(params.metadata);
    expect(params).not.toHaveProperty("subscription_data");
  });

  it("używa opisu zastępczego, gdy produkt nie został rozwinięty", async () => {
    h.fns.pricesList.mockResolvedValue({
      data: [
        stripePrice({
          lookup_key: "decision_lab_seat",
          type: "one_time",
          recurring: null,
          unit_amount: 1600000,
          product: "prod_1",
        }),
      ],
    });

    await createPlanCheckoutSession(
      plan({ priceLookupKey: "decision_lab_seat", expectedAmountCents: 1600000 }),
    );

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
    // Kwota oczekiwana liczy się od ilości PO przycięciu - ta sama, którą
    // operator pomnoży przez cenę.
    await createPlanCheckoutSession(plan({ quantity: 0 }));
    expect(lastSession().line_items[0].quantity).toBe(1);

    await createPlanCheckoutSession(plan({ quantity: 250, expectedAmountCents: 100 * 12900 }));
    expect(lastSession().line_items[0].quantity).toBe(100);
  });

  it("rozwiązuje klienta po użytkowniku i e-mailu z zamówienia", async () => {
    await createPlanCheckoutSession(plan({ customerEmail: "kupujacy@example.com" }));

    expect(h.fns.customersSearch).toHaveBeenCalledWith(
      expect.objectContaining({ query: "metadata['userId']:'user-1'" }),
    );
    expect(h.fns.customersCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "kupujacy@example.com",
        metadata: { userId: "user-1", accountEmail: "kupujacy@example.com" },
      }),
      expect.objectContaining({
        idempotencyKey: expect.stringMatching(/^customer-create:user-1:/),
      }),
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

  it("przejmuje klienta BEZ właściciela znalezionego po e-mailu - atomowo, kluczem na kliencie", async () => {
    // Zmienione zachowanie (audyt SUB-12): zapis idzie z kluczem idempotencji
    // przypiętym do KLIENTA, więc równoległe przejęcie przez inne konto
    // (te same klucz, inne parametry) operator odrzuca.
    h.fns.customersList.mockResolvedValue({ data: [{ id: "cus_by_mail", metadata: {} }] });
    h.fns.customersUpdate.mockResolvedValue({ id: "cus_by_mail", metadata: { userId: "user-1" } });

    const id = await resolveOrCreateCustomer(asStripe(), {
      userId: "user-1",
      email: "a@example.com",
    });

    expect(id).toBe("cus_by_mail");
    // Bez tego zapisu webhook nie odwzoruje klienta na konto w naszej bazie.
    expect(h.fns.customersUpdate).toHaveBeenCalledWith(
      "cus_by_mail",
      { metadata: { userId: "user-1" } },
      { idempotencyKey: "customer-adopt:cus_by_mail" },
    );
    expect(h.fns.customersCreate).not.toHaveBeenCalled();
  });

  it("zakłada klienta z identyfikatorem użytkownika, gdy nie ma dopasowania", async () => {
    const id = await resolveOrCreateCustomer(asStripe(), {
      userId: "user-1",
      email: "a@example.com",
      name: "Anna Kowalska",
    });

    expect(id).toBe("cus_new");
    expect(h.fns.customersCreate).toHaveBeenCalledWith(
      {
        email: "a@example.com",
        name: "Anna Kowalska",
        metadata: { userId: "user-1", accountEmail: "a@example.com" },
      },
      { idempotencyKey: expect.stringMatching(/^customer-create:user-1:[0-9a-f]{24}$/) },
    );
  });

  it("pomija wyszukiwanie po e-mailu, gdy e-maila nie znamy", async () => {
    const id = await resolveOrCreateCustomer(asStripe(), { userId: "user-1", email: null });

    expect(id).toBe("cus_new");
    expect(h.fns.customersList).not.toHaveBeenCalled();
    expect(h.fns.customersCreate).toHaveBeenCalledWith(
      { email: undefined, name: undefined, metadata: { userId: "user-1" } },
      { idempotencyKey: expect.stringMatching(/^customer-create:user-1:/) },
    );
  });
});

// ── Audyt SUB-12: przejęcie cudzego klienta operatora po e-mailu ───────────
describe("resolveOrCreateCustomer - klient INNEGO konta nigdy nie jest przejmowany", () => {
  it("klient z innym `metadata.userId` znaleziony po e-mailu NIE jest przejmowany - powstaje nowy", async () => {
    // Przekazana firmowa skrzynka / wspólne biuro@: dawniej pierwszy klient
    // o tym adresie dostawał nadpisane `metadata.userId`, a nowe konto
    // widziało w portalu faktury, karty i subskrypcje poprzedniej osoby.
    h.fns.customersList.mockResolvedValue({
      data: [{ id: "cus_poprzedniej_osoby", metadata: { userId: "user-poprzedni" } }],
    });

    const id = await resolveOrCreateCustomer(asStripe(), {
      userId: "user-nowy",
      email: "biuro@example.com",
    });

    expect(id).toBe("cus_new");
    expect(h.fns.customersUpdate).not.toHaveBeenCalled();
    expect(h.fns.customersCreate).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ userId: "user-nowy" }) }),
      expect.anything(),
    );
  });

  it("klient tego SAMEGO konta znaleziony po e-mailu jest użyty bez żadnego zapisu", async () => {
    // Wyszukiwarka operatora widzi świeże metadane z opóźnieniem - lista po
    // adresie musi rozpoznać własnego klienta, a nie przejmować go od nowa.
    h.fns.customersList.mockResolvedValue({
      data: [{ id: "cus_moj", metadata: { userId: "user-1" } }],
    });

    const id = await resolveOrCreateCustomer(asStripe(), {
      userId: "user-1",
      email: "a@example.com",
    });

    expect(id).toBe("cus_moj");
    expect(h.fns.customersUpdate).not.toHaveBeenCalled();
    expect(h.fns.customersCreate).not.toHaveBeenCalled();
  });

  it("z kilku klientów o tym adresie pomija cudzego i przejmuje tego bez właściciela", async () => {
    h.fns.customersList.mockResolvedValue({
      data: [
        { id: "cus_cudzy", metadata: { userId: "user-inny" } },
        { id: "cus_bez_wlasciciela", metadata: {} },
      ],
    });
    h.fns.customersUpdate.mockResolvedValue({
      id: "cus_bez_wlasciciela",
      metadata: { userId: "user-1" },
    });

    const id = await resolveOrCreateCustomer(asStripe(), {
      userId: "user-1",
      email: "biuro@example.com",
    });

    expect(id).toBe("cus_bez_wlasciciela");
    expect(h.fns.customersUpdate).toHaveBeenCalledTimes(1);
    expect(h.fns.customersUpdate.mock.calls[0]?.[0]).toBe("cus_bez_wlasciciela");
    expect(h.fns.customersList).toHaveBeenCalledWith({ email: "biuro@example.com", limit: 10 });
  });

  it("PRZEGRANY wyścig o przejęcie (błąd idempotencji) kończy się własnym, nowym klientem", async () => {
    // Inne konto przejęło klienta pierwsze: ten sam klucz `customer-adopt:<id>`
    // z innymi parametrami operator odrzuca błędem idempotencji.
    h.fns.customersList.mockResolvedValue({ data: [{ id: "cus_sporny", metadata: {} }] });
    h.fns.customersUpdate.mockRejectedValue(
      Object.assign(new Error("Keys for idempotent requests must match parameters"), {
        type: "StripeIdempotencyError",
        rawType: "idempotency_error",
      }),
    );

    const id = await resolveOrCreateCustomer(asStripe(), {
      userId: "user-1",
      email: "biuro@example.com",
    });

    expect(id).toBe("cus_new");
  });

  it("odpowiedź przejęcia z INNYM właścicielem nie oddaje klienta", async () => {
    h.fns.customersList.mockResolvedValue({ data: [{ id: "cus_sporny", metadata: {} }] });
    h.fns.customersUpdate.mockResolvedValue({ id: "cus_sporny", metadata: { userId: "user-2" } });

    const id = await resolveOrCreateCustomer(asStripe(), {
      userId: "user-1",
      email: "biuro@example.com",
    });

    expect(id).toBe("cus_new");
  });

  it("inny błąd przejęcia NIE jest połykany", async () => {
    h.fns.customersList.mockResolvedValue({ data: [{ id: "cus_sporny", metadata: {} }] });
    h.fns.customersUpdate.mockRejectedValue(new Error("api_down"));

    await expect(
      resolveOrCreateCustomer(asStripe(), { userId: "user-1", email: "biuro@example.com" }),
    ).rejects.toThrow("api_down");
    expect(h.fns.customersCreate).not.toHaveBeenCalled();
  });

  it("zakładanie klienta ma DETERMINISTYCZNY klucz idempotencji (to samo konto i dane = ten sam klucz)", async () => {
    await resolveOrCreateCustomer(asStripe(), { userId: "user-1", email: "a@example.com" });
    await resolveOrCreateCustomer(asStripe(), { userId: "user-1", email: "a@example.com" });
    await resolveOrCreateCustomer(asStripe(), { userId: "user-1", email: "b@example.com" });

    const keys = h.fns.customersCreate.mock.calls.map(
      (c) => (c[1] as { idempotencyKey: string }).idempotencyKey,
    );
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
  });
});

describe("resolveOrCreateCustomer - zmiana adresu konta dociera do operatora", () => {
  it("klient z adresem sprzed zmiany dostaje adres konta i znacznik `accountEmail`", async () => {
    h.fns.customersSearch.mockResolvedValue({
      data: [{ id: "cus_known", email: "stary@example.com", metadata: { userId: "user-1" } }],
    });

    const id = await resolveOrCreateCustomer(asStripe(), {
      userId: "user-1",
      email: "nowy@example.com",
    });

    expect(id).toBe("cus_known");
    expect(h.fns.customersUpdate).toHaveBeenCalledWith(
      "cus_known",
      { email: "nowy@example.com", metadata: { accountEmail: "nowy@example.com" } },
      { idempotencyKey: expect.stringMatching(/^customer-email:cus_known:[0-9a-f]{24}$/) },
    );
  });

  it("adres ustawiony przez klienta w portalu (różny od wysłanego) zostaje nietknięty", async () => {
    h.fns.customersSearch.mockResolvedValue({
      data: [
        {
          id: "cus_known",
          email: "faktury@firma.example",
          metadata: { userId: "user-1", accountEmail: "stary@example.com" },
        },
      ],
    });

    await resolveOrCreateCustomer(asStripe(), { userId: "user-1", email: "nowy@example.com" });

    expect(h.fns.customersUpdate).not.toHaveBeenCalled();
  });

  it("zgodny adres nie generuje zapisu u operatora", async () => {
    h.fns.customersSearch.mockResolvedValue({
      data: [{ id: "cus_known", email: "a@example.com", metadata: { userId: "user-1" } }],
    });

    await resolveOrCreateCustomer(asStripe(), { userId: "user-1", email: "a@example.com" });

    expect(h.fns.customersUpdate).not.toHaveBeenCalled();
  });
});

// ── Audyt SUB-05: kwota zamówienia MUSI zgadzać się z ceną operatora ──────
describe("createPlanCheckoutSession - zgodność ceny operatora z zamówieniem", () => {
  it("cena operatora × ilość RÓŻNA od kwoty zamówienia: odmowa przed klientem i sesją", async () => {
    // Najemca B ma plan „member/month" za 19 zł, a cena wspólna `pro_monthly`
    // kosztuje 129 zł: zamówienie zapisałoby 19 zł, operator pobrałby 129 zł.
    const result = await createPlanCheckoutSession(plan({ expectedAmountCents: 1900 }));

    expect(result).toEqual({ ok: false, error: "price_mismatch" });
    expect(h.fns.customersSearch).not.toHaveBeenCalled();
    expect(h.fns.sessionsCreate).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      "[payments] catalog price mismatch - checkout refused",
      expect.objectContaining({ reason: "amount", expectedAmountCents: 1900 }),
    );
  });

  it("ilość wchodzi do porównania: 3 miejsca to 3 × cena, nie cena jednej sztuki", async () => {
    const tooLow = await createPlanCheckoutSession(
      plan({ quantity: 3, expectedAmountCents: 12900 }),
    );
    expect(tooLow).toEqual({ ok: false, error: "price_mismatch" });

    const exact = await createPlanCheckoutSession(
      plan({ quantity: 3, expectedAmountCents: 3 * 12900 }),
    );
    expect(exact.ok).toBe(true);
    expect(lastSession().line_items[0].quantity).toBe(3);
  });

  it("inna waluta ceny niż zamówienia: odmowa", async () => {
    const result = await createPlanCheckoutSession(plan({ expectedCurrency: "EUR" }));

    expect(result).toEqual({ ok: false, error: "price_mismatch" });
  });

  it("cena w INNYM cyklu pod kluczem miesięcznym (np. roczna): odmowa", async () => {
    h.fns.pricesList.mockResolvedValue({
      data: [stripePrice({ recurring: { interval: "year", interval_count: 1 } })],
    });

    expect(await createPlanCheckoutSession(plan())).toEqual({
      ok: false,
      error: "price_mismatch",
    });
  });

  it("klucz ceny spoza `BILLING_CATALOG` jest odrzucany, zanim kasa zapyta operatora", async () => {
    const result = await createPlanCheckoutSession(plan({ priceLookupKey: "zmyslony_klucz" }));

    expect(result).toEqual({ ok: false, error: "price_not_in_catalog" });
    expect(h.envs).toEqual([]);
  });

  it("cena schodkowa Zespołu (`volume`): 12 miejsc po stawce progu przechodzi, inna kwota nie", async () => {
    h.fns.pricesList.mockResolvedValue({
      data: [
        stripePrice({
          lookup_key: "team_monthly_seat",
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

    const ok = await createPlanCheckoutSession(
      plan({ priceLookupKey: "team_monthly_seat", quantity: 12, expectedAmountCents: 12 * 7900 }),
    );
    expect(ok.ok).toBe(true);

    const wrong = await createPlanCheckoutSession(
      plan({ priceLookupKey: "team_monthly_seat", quantity: 12, expectedAmountCents: 12 * 9900 }),
    );
    expect(wrong).toEqual({ ok: false, error: "price_mismatch" });
  });
});

describe("kwota ceny operatora - kształty, których nie zgadujemy", () => {
  const price = (over: Record<string, unknown>) => stripePrice(over);

  it("cena płaska: stawka × ilość", () => {
    expect(stripePriceAmountFor(price({}), 4)).toBe(4 * 12900);
  });

  it("tryb `graduated`: każdy przedział po własnej stawce, z opłatą stałą", () => {
    const graduated = price({
      billing_scheme: "tiered",
      tiers_mode: "graduated",
      unit_amount: null,
      tiers: [
        { up_to: 2, unit_amount: 1000, flat_amount: 500 },
        { up_to: null, unit_amount: 800, flat_amount: null },
      ],
    });
    expect(stripePriceAmountFor(graduated, 5)).toBe(2 * 1000 + 500 + 3 * 800);
  });

  it("przekształcanie ilości, kwota od klienta, ułamkowa stawka i progi bez rozwinięcia: `null`", () => {
    expect(stripePriceAmountFor(price({ transform_quantity: { divide_by: 2 } }), 1)).toBeNull();
    expect(stripePriceAmountFor(price({ custom_unit_amount: { minimum: 100 } }), 1)).toBeNull();
    expect(stripePriceAmountFor(price({ unit_amount: null }), 1)).toBeNull();
    expect(
      stripePriceAmountFor(price({ billing_scheme: "tiered", tiers: undefined }), 1),
    ).toBeNull();
  });

  it("kwota, której nie da się policzyć, jest rozjazdem (`unverifiable_amount`)", () => {
    const entry = catalogEntryByPriceId("pro_monthly")!;
    expect(
      catalogPriceMismatch(price({ unit_amount: null }), {
        entry,
        quantity: 1,
        expectedAmountCents: 12900,
        expectedCurrency: "PLN",
      }),
    ).toBe("unverifiable_amount");
  });

  it("pozycja jednorazowa wymaga ceny BEZ cyklu", () => {
    const entry = catalogEntryByPriceId("decision_lab_seat")!;
    expect(
      catalogPriceMismatch(price({ unit_amount: 1600000 }), {
        entry,
        quantity: 1,
        expectedAmountCents: 1600000,
        expectedCurrency: "PLN",
      }),
    ).toBe("cycle");
  });
});

// ── Audyt SUB-13: druga subskrypcja i ponowny trial ─────────────────────────
describe("createPlanCheckoutSession - druga subskrypcja i trial raz na konto", () => {
  const sub = (status: string, metadata: Record<string, string> = {}) => ({
    id: `sub_${status}`,
    status,
    metadata,
  });

  it("ŻYWA subskrypcja planu u operatora: odmowa `subscription_exists`, sesja NIE powstaje", async () => {
    for (const status of ["active", "trialing", "past_due", "unpaid", "paused", "incomplete"]) {
      h.fns.sessionsCreate.mockClear();
      h.fns.subscriptionsList.mockResolvedValue({ data: [sub(status, { planId: "plan_plus" })] });

      const result = await createPlanCheckoutSession({ ...plan(), trialDays: 14 });

      expect(result, status).toEqual({ ok: false, error: "subscription_exists" });
      expect(h.fns.sessionsCreate, status).not.toHaveBeenCalled();
    }
    expect(h.fns.subscriptionsList).toHaveBeenCalledWith({
      customer: "cus_new",
      status: "all",
      limit: 100,
    });
  });

  it("ponowny zakup po anulowaniu: subskrypcja powstaje, ale BEZ triala", async () => {
    // Cykl „anuluj w trialu → kup ponownie" dawał dostęp bez końca.
    h.fns.subscriptionsList.mockResolvedValue({ data: [sub("canceled")] });

    const result = await createPlanCheckoutSession({ ...plan(), trialDays: 14 });

    expect(result.ok).toBe(true);
    expect(lastSession().subscription_data).not.toHaveProperty("trial_period_days");
  });

  it("subskrypcja DAROWIZNY nie blokuje zakupu i nie zużywa triala", async () => {
    h.fns.subscriptionsList.mockResolvedValue({
      data: [sub("active", { purpose: "donation" }), sub("canceled", { purpose: "donation" })],
    });

    const result = await createPlanCheckoutSession({ ...plan(), trialDays: 14 });

    expect(result.ok).toBe(true);
    expect(lastSession().subscription_data?.trial_period_days).toBe(14);
  });

  it("pierwsza płatność, która nigdy nie przeszła (`incomplete_expired`), nie zużywa triala", async () => {
    h.fns.subscriptionsList.mockResolvedValue({ data: [sub("incomplete_expired")] });

    await createPlanCheckoutSession({ ...plan(), trialDays: 14 });

    expect(lastSession().subscription_data?.trial_period_days).toBe(14);
  });

  it("historia z bazy (`trialEligible: false`) zdejmuje trial nawet przy pustej historii u operatora", async () => {
    await createPlanCheckoutSession({ ...plan(), trialDays: 14, trialEligible: false });

    expect(lastSession().subscription_data).not.toHaveProperty("trial_period_days");
  });

  it("zakup jednorazowy nie pyta o subskrypcje i nie jest przez nie blokowany", async () => {
    h.fns.pricesList.mockResolvedValue({
      data: [
        stripePrice({
          lookup_key: "decision_lab_seat",
          type: "one_time",
          recurring: null,
          unit_amount: 1600000,
        }),
      ],
    });
    h.fns.subscriptionsList.mockResolvedValue({ data: [sub("active")] });

    const result = await createPlanCheckoutSession(
      plan({ priceLookupKey: "decision_lab_seat", expectedAmountCents: 1600000 }),
    );

    expect(result.ok).toBe(true);
    expect(h.fns.subscriptionsList).not.toHaveBeenCalled();
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
    // `data.tiers` jest potrzebne kontroli kwoty przed sesją (cena schodkowa
    // Zespołu bez rozwiniętych progów nie da się porównać z zamówieniem).
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
    });

    expect(h.fns.couponsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Kupon Pierwsza fala sprzedaży + PARTNER-",
        metadata: {
          source: "b2b_coupon",
          code: "Pierwsza fala sprzedaży + PARTNER-STRATEGICZNY-2026",
        },
      }),
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
