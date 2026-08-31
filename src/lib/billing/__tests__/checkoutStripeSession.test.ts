// SESJA U OPERATORA: co dokładnie wychodzi z kasy do Stripe i co się dzieje,
// kiedy operator ODMÓWI.
//
// DLACZEGO OSOBNY PLIK. Wycena i odmowy wejściowe kończą się przed bramką
// płatności (`checkoutOrderPricing`, `checkoutOrderCoupon`). Tutaj bramka jest
// SKONFIGUROWANA, więc handler wchodzi w drugą połowę: cena katalogowa kontra
// cena osadzona, rabat operatora, znacznik sesji na zamówieniu i - najważniejsze
// - sprzątanie po nieudanej sesji.
//
// RYZYKO, KTÓREGO PILNUJE TEN PLIK. Kupon jest rezerwowany PRZED utworzeniem
// sesji. Jeśli operator odmówi, a handler nie zwolni rezerwacji, użycie
// przepada za zamówienie, którego nikt nigdy nie opłaci - kupon partnerski
// „na 50 firm" wyczerpuje się na nieudanych próbach. Symetrycznie: zamówienie
// po nieudanej sesji MUSI dostać `failed`, inaczej zostaje `pending` bez sesji
// i panel admina raportuje je jako wiszące.
//
// CO ATRAPUJEMY. Wyłącznie klienta operatora (`createStripeClient`) - reszta
// `@/lib/stripe.server` (rozstrzyganie środowiska, mapowanie komunikatu błędu)
// zostaje PRAWDZIWA, tak samo jak cały `@/lib/billing/adhocCheckout.server`,
// `checkoutSettings.server` i `markOrderSession.server`. Testujemy handler
// wobec swoich sąsiadów, nie wobec ich atrap.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Database, Tables } from "@/integrations/supabase/types";
import {
  fail,
  ok,
  supabaseFromStub,
  type SupabaseFromStub,
  type SupabaseResult,
} from "@/test/supabaseChain";

const PLAN_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const EVENT_ID = "bbbbbbbb-0000-4000-8000-000000000002";
const TICKET_ID = "cccccccc-0000-4000-8000-000000000003";
const REGISTRATION_ID = "dddddddd-0000-4000-8000-000000000004";
const POST_ID = "eeeeeeee-0000-4000-8000-000000000005";
const COUPON_ID = "ffffffff-0000-4000-8000-00000000000c";

/**
 * Atrapa operatora. Bazą jest wspólny `stripeStub()` z atomów monetyzacji;
 * dokładamy metody, których dotyka WYŁĄCZNIE ścieżka zakładania sesji
 * (katalog cen, klient, kupon jednorazowy, utworzenie sesji).
 */
const h = vi.hoisted(() => {
  const calls: { method: string; args: unknown[] }[] = [];
  const state = {
    /** Cena katalogowa zwracana przez operatora (pusto = brak ceny). */
    prices: [{ id: "price_1", lookup_key: "plus_monthly", type: "recurring" }] as unknown[],
    /** Wynik `checkout.sessions.create`; wyjątek symuluje odmowę operatora. */
    sessionError: null as Error | null,
    /** Wynik `coupons.create` - `{}` udaje odpowiedź bez identyfikatora. */
    coupon: { id: "coupon_1" } as Record<string, unknown>,
    couponError: null as Error | null,
  };
  const record = (method: string, result: () => unknown) => {
    return (...args: unknown[]) => {
      calls.push({ method, args });
      try {
        return Promise.resolve(result());
      } catch (e) {
        return Promise.reject(e);
      }
    };
  };
  return { calls, state, record };
});

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFnHarness")).serverFnStubModule(),
);

vi.mock("@tanstack/react-start/server", () => ({
  // `origin` i `host` są nagłówkami zabronionymi dla `Request`, więc origin
  // podajemy tak, jak robi to odwrotne proxy w produkcji.
  getRequest: () =>
    new Request("https://kasa.example.org/checkout", {
      headers: { "x-forwarded-proto": "https", "x-forwarded-host": "kasa.example.org" },
    }),
}));

vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: { name: "requireSupabaseAuth" },
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: () => Promise.resolve({ data: true, error: null }),
  },
}));

// TYLKO klient operatora jest podmieniony. `resolveEnvironment` i
// `getStripeErrorMessage` jadą prawdziwe - to one decydują o środowisku
// zamówienia i o tym, co zobaczy kupujący po odmowie.
vi.mock("@/lib/stripe.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/stripe.server")>();
  const { stripeStub: base } = await import("@/test/billing/fixtures");
  return {
    ...actual,
    createStripeClient: (env: string) => {
      h.calls.push({ method: "createStripeClient", args: [env] });
      const stub = base();
      return {
        ...stub,
        prices: { list: h.record("prices.list", () => ({ data: h.state.prices })) },
        customers: {
          search: h.record("customers.search", () => ({ data: [] })),
          list: h.record("customers.list", () => ({ data: [] })),
          update: h.record("customers.update", () => ({ id: "cus_1" })),
          create: h.record("customers.create", () => ({ id: "cus_1" })),
        },
        coupons: {
          create: h.record("coupons.create", () => {
            if (h.state.couponError) throw h.state.couponError;
            return h.state.coupon;
          }),
        },
        checkout: {
          sessions: {
            ...stub.checkout.sessions,
            create: h.record("checkout.sessions.create", () => {
              if (h.state.sessionError) throw h.state.sessionError;
              return { id: "cs_test_1", client_secret: "cs_test_1_secret" };
            }),
          },
        },
      };
    },
  };
});

const { callServerFn } = await import("@/test/serverFn");
const { createCheckoutOrder } = await import("@/lib/billing/checkout.functions");

// --- kształty ---------------------------------------------------------------

type CouponVerdict = Database["public"]["Functions"]["validate_b2b_coupon"]["Returns"][number];

type PlanQuote = Pick<
  Tables<"access_plans">,
  | "price_cents"
  | "currency"
  | "name_pl"
  | "name_en"
  | "active"
  | "interval"
  | "trial_days"
  | "tier_key"
  | "volume_threshold_seats"
  | "volume_price_cents"
>;

type CheckoutResult =
  | { ok: true; mode: "stripe"; clientSecret: string; orderId: string }
  | { ok: false; mode: string; error: string; orderId?: string };

/** Parametry sesji, o które pyta ten plik (podzbiór kontraktu operatora). */
interface SessionParams {
  mode: string;
  return_url: string;
  metadata: Record<string, string>;
  line_items: {
    quantity: number;
    price?: string;
    price_data?: { currency: string; unit_amount: number; product_data: { name: string } };
  }[];
  discounts?: { coupon?: string }[];
  subscription_data?: { trial_period_days?: number };
}

function planQuote(over: Partial<PlanQuote> = {}): PlanQuote {
  return {
    price_cents: 4900,
    currency: "PLN",
    name_pl: "Członek",
    name_en: "Member",
    active: true,
    interval: "month",
    trial_days: 0,
    tier_key: "member",
    volume_threshold_seats: null,
    volume_price_cents: null,
    ...over,
  };
}

function couponOk(over: Partial<CouponVerdict> = {}): CouponVerdict {
  return {
    ok: true,
    coupon_id: COUPON_ID,
    discount_cents: 1000,
    discount_kind: "amount",
    discount_percent: 0,
    error: "",
    final_cents: 3900,
    label: "Partner CEE",
    ...over,
  };
}

function ticketQuote(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ticket_type_id: TICKET_ID,
    event_id: EVENT_ID,
    amount_cents: 15000,
    list_price_cents: 15000,
    currency: "PLN",
    name_pl: "Bilet",
    name_en: "Ticket",
    event_title_pl: "Kongres CEE",
    event_title_en: "CEE Congress",
    phase: null,
    ...over,
  };
}

// --- atrapa klienta Supabase ------------------------------------------------

let chain: SupabaseFromStub;
let rpcCalls: { fn: string; args: Record<string, unknown> }[];
let rpcResponses: Map<string, SupabaseResult>;

function client() {
  return {
    from: (table: string) => chain.from(table),
    rpc: (fn: string, args: Record<string, unknown> = {}) => {
      rpcCalls.push({ fn, args });
      const planned = rpcResponses.get(fn);
      return Promise.resolve(planned ?? fail(`test: brak zaplanowanej odpowiedzi RPC "${fn}"`));
    },
  };
}

function context() {
  return { supabase: client(), userId: "user-kupujacy", claims: { email: "kupujacy@example.org" } };
}

function call(payload: Record<string, unknown>): Promise<CheckoutResult> {
  return callServerFn<CheckoutResult>(createCheckoutOrder, payload, context());
}

function stripeCall(method: string): { method: string; args: unknown[] } | undefined {
  return h.calls.find((c) => c.method === method);
}

function lastSession(): SessionParams | undefined {
  const args = h.calls.filter((c) => c.method === "checkout.sessions.create").at(-1)?.args;
  const params = args?.[0];
  return params !== null && typeof params === "object" ? (params as SessionParams) : undefined;
}

function rpcArgs(fn: string): Record<string, unknown> | undefined {
  return rpcCalls.find((c) => c.fn === fn)?.args;
}

function planPayload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "subscription",
    plan_id: PLAN_ID,
    success_path: "/checkout/sukces",
    cancel_path: "/cennik",
    environment: "sandbox",
    ...over,
  };
}

function ticketPayload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "one_time",
    event_id: EVENT_ID,
    ticket_type_id: TICKET_ID,
    success_path: "/events/kongres-cee",
    cancel_path: "/events/kongres-cee",
    environment: "sandbox",
    ...over,
  };
}

function entityPayload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "one_time",
    entity_type: "post",
    entity_id: POST_ID,
    success_path: "/analizy/tekst",
    cancel_path: "/analizy/tekst",
    environment: "sandbox",
    ...over,
  };
}

beforeEach(() => {
  h.calls.length = 0;
  h.state.prices = [{ id: "price_1", lookup_key: "plus_monthly", type: "recurring" }];
  h.state.sessionError = null;
  h.state.coupon = { id: "coupon_1" };
  h.state.couponError = null;

  chain = supabaseFromStub();
  rpcCalls = [];
  rpcResponses = new Map<string, SupabaseResult>();

  // Bramka SKONFIGUROWANA - wartości syntetyczne, nigdzie nie wychodzą:
  // klient operatora jest atrapą, więc żadne żądanie sieciowe nie powstaje.
  vi.stubEnv("LOVABLE_API_KEY", "klucz-testowy-bramki");
  vi.stubEnv("STRIPE_SANDBOX_API_KEY", "klucz-testowy-piaskownicy");

  chain.setResponse("access_plans", ok(planQuote()));
  chain.setResponse("payment_orders", ok({ id: "order-1", tenant_id: "tenant-alfa" }));
  chain.setResponse(
    "checkout_settings",
    ok({
      allow_promotion_codes: true,
      automatic_tax: false,
      tax_id_collection: true,
      billing_address_collection: "auto",
      invoice_creation: true,
    }),
  );
  chain.setResponse(
    "content_access_public",
    ok({ mode: "paid", one_time_price_cents: 1500, one_time_currency: "PLN" }),
  );
  chain.setResponse("posts", ok({ title_pl: "Analiza CEE", title_en: "CEE analysis" }));
  rpcResponses.set("my_ticket_allowance", ok(null));
  rpcResponses.set("event_ticket_checkout_quote", ok(ticketQuote()));
  rpcResponses.set(
    "event_registration_payment_context",
    ok({ ok: true, event_id: EVENT_ID, ticket_type_id: TICKET_ID }),
  );
  rpcResponses.set("validate_b2b_coupon", ok([couponOk()]));
  rpcResponses.set("redeem_b2b_coupon", ok(true));
  rpcResponses.set("release_b2b_coupon", ok(true));
  rpcResponses.set("payment_order_mark_session", ok(true));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createCheckoutOrder - subskrypcja idzie CENĄ KATALOGOWĄ", () => {
  it("sesja powstaje z ceny katalogowej, a zamówienie dostaje identyfikator sesji", async () => {
    // Tylko sesja z ceny katalogowej zakłada u operatora cykl rozliczeniowy.
    // Cena osadzona dałaby pojedyncze obciążenie bez odnowienia - klient
    // straciłby dostęp po miesiącu, mimo że „ma subskrypcję".
    const result = await call(planPayload());

    expect(result).toEqual({
      ok: true,
      mode: "stripe",
      clientSecret: "cs_test_1_secret",
      orderId: "order-1",
    });
    expect(lastSession()?.mode).toBe("subscription");
    expect(lastSession()?.line_items[0]?.price).toBe("price_1");
    expect(rpcArgs("payment_order_mark_session")).toEqual({
      _order_id: "order-1",
      _session_id: "cs_test_1",
      _status: "processing",
    });
  });

  it("adres powrotu jest przepisywany na WŁASNY origin - klient nie wybiera domeny", async () => {
    await call(planPayload({ success_path: "https://zlodziej.example.com/przejmij" }));

    expect(lastSession()?.return_url).toBe("https://kasa.example.org/przejmij");
  });

  it("okres próbny planu trafia do sesji - bez tego karta jest obciążana od razu", async () => {
    chain.setResponse("access_plans", ok(planQuote({ trial_days: 14 })));

    await call(planPayload());

    expect(lastSession()?.subscription_data?.trial_period_days).toBe(14);
  });

  it("plan bez okresu próbnego nie wysyła zerowego triala (operator uzna to za błąd)", async () => {
    await call(planPayload());

    expect(lastSession()?.subscription_data).not.toHaveProperty("trial_period_days");
  });

  it("wiersz planu BEZ kolumny okresu próbnego nie wysyła `NaN` dni", async () => {
    // Nieaktualny cache schematu PostgREST potrafi oddać wiersz bez kolumny.
    // `Number(undefined)` to NaN, a NaN dni operator odrzuca błędem walidacji -
    // czyli awaria całej kasy przez brakującą kolumnę pomocniczą.
    chain.setResponse("access_plans", ok(planQuote({ trial_days: undefined })));

    const result = await call(planPayload());

    expect(result.ok).toBe(true);
    expect(lastSession()?.subscription_data).not.toHaveProperty("trial_period_days");
  });

  it("ujemna liczba dni próbnych jest docinana do zera", async () => {
    chain.setResponse("access_plans", ok(planQuote({ trial_days: -5 })));

    await call(planPayload());

    expect(lastSession()?.subscription_data).not.toHaveProperty("trial_period_days");
  });

  it("liczba miejsc jedzie do pozycji sesji, a nie tylko do kwoty zamówienia", async () => {
    chain.setResponse("access_plans", ok(planQuote({ tier_key: "team", price_cents: 9900 })));
    h.state.prices = [{ id: "price_team", lookup_key: "team_monthly_seat", type: "recurring" }];

    await call(planPayload({ seats: 7 }));

    expect(lastSession()?.line_items[0]?.quantity).toBe(7);
  });

  it("ustawienia checkoutu są czytane dla TENANTU ZAMÓWIENIA, nie tenantu żądania", async () => {
    // Sesja ma jechać na konfiguracji podatkowej tego najemcy, który stempluje
    // zamówienie - inaczej faktura wychodzi z cudzymi ustawieniami VAT.
    chain.setResponse("payment_orders", ok({ id: "order-1", tenant_id: "tenant-beta" }));

    await call(planPayload());

    expect(chain.lastChain("checkout_settings")?.argsOf("eq")).toEqual([
      "tenant_id",
      "tenant-beta",
    ]);
  });
});

describe("createCheckoutOrder - kupon B2B w sesji subskrypcji", () => {
  it("rabat kuponu jedzie jako RABAT OPERATORA, a nie jako obniżona cena", async () => {
    // Cena zostaje katalogowa (inaczej znika cykl rozliczeniowy), a rabat
    // dokładamy osobno - kwota nadal nie pochodzi od klienta.
    await call(planPayload({ coupon_code: "PARTNER-CEE" }));

    expect(stripeCall("coupons.create")?.args[0]).toMatchObject({
      amount_off: 1000,
      currency: "pln",
      duration: "once",
    });
    expect(lastSession()?.discounts).toEqual([{ coupon: "coupon_1" }]);
  });

  it("kupon bez rabatu kwotowego nie zakłada rabatu u operatora", async () => {
    rpcResponses.set(
      "validate_b2b_coupon",
      ok([couponOk({ discount_cents: 0, final_cents: 4900 })]),
    );

    await call(planPayload({ coupon_code: "PARTNER-CEE" }));

    expect(stripeCall("coupons.create")).toBeUndefined();
    expect(lastSession()?.discounts).toBeUndefined();
  });

  it("odpowiedź operatora BEZ identyfikatora kuponu nie wywraca sesji", async () => {
    // Zamówienie i tak ma poprawną kwotę po kuponie; brak rabatu w nakładce
    // jest kosmetyką, a wywalona kasa nie.
    h.state.coupon = {};

    const result = await call(planPayload({ coupon_code: "PARTNER-CEE" }));

    expect(result.ok).toBe(true);
    expect(lastSession()?.discounts).toBeUndefined();
  });
});

describe("createCheckoutOrder - operator ODMAWIA sesji subskrypcyjnej", () => {
  it("brak ceny katalogowej u operatora: zamówienie dostaje `failed`, nie zostaje wiszące", async () => {
    h.state.prices = [];
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await call(planPayload());

    expect(result).toEqual({
      ok: false,
      mode: "stripe",
      error: "price_missing",
      orderId: "order-1",
    });
    expect(rpcArgs("payment_order_mark_session")).toEqual({
      _order_id: "order-1",
      _status: "failed",
    });
    logged.mockRestore();
  });

  it("zarezerwowane użycie kuponu WRACA DO PULI po odmowie operatora", async () => {
    // Bez tego limit „50 firm" wyczerpuje się na nieudanych próbach, a partner
    // dowiaduje się o tym dopiero wtedy, gdy kupon przestaje działać.
    h.state.prices = [];
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await call(planPayload({ coupon_code: "PARTNER-CEE" }));

    expect(rpcArgs("release_b2b_coupon")).toEqual({
      _coupon_id: COUPON_ID,
      _order_id: "order-1",
    });
    logged.mockRestore();
  });

  it("bez kuponu nie ma czego zwalniać", async () => {
    h.state.prices = [];
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await call(planPayload());

    expect(rpcCalls.map((c) => c.fn)).not.toContain("release_b2b_coupon");
    logged.mockRestore();
  });

  it("nieudane zwolnienie kuponu jest LOGOWANE, a nie przemilczane", async () => {
    // Zwolnienie jest operacją naprawczą - jej cicha porażka zostawia
    // zablokowane użycie bez żadnego śladu do diagnozy.
    h.state.prices = [];
    rpcResponses.set("release_b2b_coupon", fail("release failed"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await call(planPayload({ coupon_code: "PARTNER-CEE" }));

    expect(result.ok).toBe(false);
    expect(
      logged.mock.calls.some((args) => String(args[0]).includes("coupon release failed")),
    ).toBe(true);
    logged.mockRestore();
  });

  it("wyjątek operatora wraca jako czytelny komunikat, a nie `[object Object]`", async () => {
    h.state.sessionError = new Error("card_declined");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await call(planPayload());

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("card_declined");
    logged.mockRestore();
  });
});

describe("createCheckoutOrder - cena OSADZONA (treść, bilet)", () => {
  it("odblokowanie treści idzie ceną osadzoną z celem `content_unlock`", async () => {
    const result = await call(entityPayload());

    expect(result.ok).toBe(true);
    expect(lastSession()?.mode).toBe("payment");
    expect(lastSession()?.line_items[0]?.price_data).toMatchObject({
      currency: "pln",
      unit_amount: 1500,
    });
    expect(lastSession()?.metadata.purpose).toBe("content_unlock");
    expect(lastSession()?.metadata).not.toHaveProperty("event_id");
  });

  it("bilet dostaje cel `event_ticket` i identyfikatory potrzebne webhookowi", async () => {
    // Bez `registration_id` w metadanych sesji webhook dowiązuje wpłatę
    // PO OSOBIE - uczestnik z dwoma zgłoszeniami dostaje bilet przypięty do
    // najnowszego wiersza, niekoniecznie tego, za który zapłacił.
    await call(ticketPayload({ registration_id: REGISTRATION_ID }));

    expect(lastSession()?.metadata).toMatchObject({
      purpose: "event_ticket",
      event_id: EVENT_ID,
      ticket_type_id: TICKET_ID,
      registration_id: REGISTRATION_ID,
    });
  });

  it("bez wskazanego zgłoszenia klucza dowiązania w metadanych sesji NIE MA", async () => {
    await call(ticketPayload());

    expect(lastSession()?.metadata).not.toHaveProperty("registration_id");
  });

  it("pozycja bez tytułu dostaje nazwę zastępczą - kupujący nie widzi pustej linii", async () => {
    chain.setResponse("posts", ok(null));

    await call(entityPayload());

    expect(lastSession()?.line_items[0]?.price_data?.product_data.name).toBe("Zamówienie");
  });

  it("bilet z wiersza wydarzenia (bez cennika) nie wkłada rodzaju wejściówki do sesji", async () => {
    // Ta ścieżka nie zna rodzaju wejściówki, więc metadane sesji muszą być
    // WOLNE od tego klucza - pusty `ticket_type_id` webhook próbowałby
    // dopasować do nieistniejącej pozycji cennika.
    chain.setResponse("events", (query) =>
      query.argsOf("select")?.[0] === "capacity"
        ? ok({ capacity: null })
        : ok({
            id: EVENT_ID,
            title_pl: "Kongres CEE",
            title_en: "CEE Congress",
            ticket_price_cents: 15000,
            ticket_currency: "PLN",
            status: "published",
            starts_at: null,
          }),
    );
    chain.setResponse("event_rsvps", ok(null));
    rpcResponses.set("get_event_rsvp_counts", ok([{ event_id: EVENT_ID, going: 0, waitlist: 0 }]));

    await call(ticketPayload({ ticket_type_id: undefined }));

    expect(lastSession()?.metadata.event_id).toBe(EVENT_ID);
    expect(lastSession()?.metadata).not.toHaveProperty("ticket_type_id");
  });

  it("kwota poniżej minimum operatora kończy się odmową i zamówieniem `failed`", async () => {
    chain.setResponse(
      "content_access_public",
      ok({ mode: "paid", one_time_price_cents: 30, one_time_currency: "PLN" }),
    );

    const result = await call(entityPayload());

    expect(result).toEqual({
      ok: false,
      mode: "stripe",
      error: "amount_too_low",
      orderId: "order-1",
    });
    expect(rpcArgs("payment_order_mark_session")).toEqual({
      _order_id: "order-1",
      _status: "failed",
    });
  });

  it("kupon zwolniony także po odmowie sesji z ceną osadzoną", async () => {
    chain.setResponse(
      "content_access_public",
      ok({ mode: "paid", one_time_price_cents: 3000, one_time_currency: "PLN" }),
    );
    rpcResponses.set(
      "validate_b2b_coupon",
      ok([couponOk({ discount_cents: 1000, final_cents: 2000 })]),
    );
    h.state.sessionError = new Error("operator unavailable");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await call(entityPayload({ coupon_code: "PARTNER-CEE" }));

    expect(rpcArgs("release_b2b_coupon")).toMatchObject({ _coupon_id: COUPON_ID });
    logged.mockRestore();
  });

  it("nieudane zwolnienie kuponu na ścieżce ceny osadzonej też jest logowane", async () => {
    rpcResponses.set("release_b2b_coupon", fail("release failed"));
    h.state.sessionError = new Error("operator unavailable");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await call(entityPayload({ coupon_code: "PARTNER-CEE" }));

    expect(
      logged.mock.calls.some((args) => String(args[0]).includes("coupon release failed")),
    ).toBe(true);
    logged.mockRestore();
  });

  it("bez kuponu odmowa sesji nie woła zwolnienia", async () => {
    h.state.sessionError = new Error("operator unavailable");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await call(entityPayload());

    expect(rpcCalls.map((c) => c.fn)).not.toContain("release_b2b_coupon");
    logged.mockRestore();
  });
});

describe("createCheckoutOrder - rabat fazy sprzedaży widoczny w nakładce", () => {
  it("pozycja idzie ceną REGULARNĄ, a różnicę zdejmuje kupon jednorazowy", async () => {
    // Bez tego kupujący widzi samą kwotę końcową i nie ma jak sprawdzić, że
    // promocja („pierwsza fala") faktycznie zadziałała.
    rpcResponses.set(
      "event_ticket_checkout_quote",
      ok(ticketQuote({ amount_cents: 12000, list_price_cents: 15000 })),
    );

    await call(ticketPayload());

    expect(lastSession()?.line_items[0]?.price_data?.unit_amount).toBe(15000);
    expect(stripeCall("coupons.create")?.args[0]).toMatchObject({ amount_off: 3000 });
    expect(lastSession()?.discounts).toEqual([{ coupon: "coupon_1" }]);
  });

  it.each([
    ["early_bird", "Kupon Early bird"],
    ["last_minute", "Kupon Last minute"],
    ["phase", "Kupon Faza sprzedaży"],
    ["cokolwiek_nowego", "Kupon Rabat"],
  ])("faza `%s` dostaje etykietę `%s`", async (source, expected) => {
    rpcResponses.set(
      "event_ticket_checkout_quote",
      ok(ticketQuote({ amount_cents: 12000, list_price_cents: 15000, phase: { source } })),
    );

    await call(ticketPayload());

    expect(stripeCall("coupons.create")?.args[0]).toMatchObject({ name: expected });
  });

  it("własna etykieta fazy z bazy bije etykietę zastępczą", async () => {
    rpcResponses.set(
      "event_ticket_checkout_quote",
      ok(
        ticketQuote({
          amount_cents: 12000,
          list_price_cents: 15000,
          phase: { source: "early_bird", label_pl: "Pierwsza fala" },
        }),
      ),
    );

    await call(ticketPayload());

    expect(stripeCall("coupons.create")?.args[0]).toMatchObject({ name: "Kupon Pierwsza fala" });
  });

  it("etykieta fazy schodzi na angielską, gdy nie ma polskiej", async () => {
    rpcResponses.set(
      "event_ticket_checkout_quote",
      ok(
        ticketQuote({
          amount_cents: 12000,
          list_price_cents: 15000,
          phase: { source: "phase", label_pl: null, label_en: "First wave" },
        }),
      ),
    );

    await call(ticketPayload());

    expect(stripeCall("coupons.create")?.args[0]).toMatchObject({ name: "Kupon First wave" });
  });

  it("faza podana jako tablica jest ignorowana - etykietą zostaje `Rabat`", async () => {
    rpcResponses.set(
      "event_ticket_checkout_quote",
      ok(ticketQuote({ amount_cents: 12000, list_price_cents: 15000, phase: [] })),
    );

    await call(ticketPayload());

    expect(stripeCall("coupons.create")?.args[0]).toMatchObject({ name: "Kupon Rabat" });
  });

  it("nieliczbowa cena regularna nie tworzy rabatu fazy", async () => {
    rpcResponses.set(
      "event_ticket_checkout_quote",
      ok(ticketQuote({ amount_cents: 12000, list_price_cents: "15000" })),
    );

    await call(ticketPayload());

    expect(stripeCall("coupons.create")).toBeUndefined();
    expect(lastSession()?.line_items[0]?.price_data?.unit_amount).toBe(12000);
  });

  it("bez różnicy między ceną regularną a końcową nie ma rabatu do pokazania", async () => {
    await call(ticketPayload());

    expect(stripeCall("coupons.create")).toBeUndefined();
    expect(lastSession()?.line_items[0]?.price_data?.unit_amount).toBe(15000);
  });

  it("odmowa operatora przy rabacie fazy NIE wywraca sprzedaży biletu", async () => {
    // Rabat jest ozdobą podsumowania; kwota do zapłaty jest już policzona.
    // Awaria tworzenia kuponu nie może kosztować sprzedaży wejściówki.
    rpcResponses.set(
      "event_ticket_checkout_quote",
      ok(ticketQuote({ amount_cents: 12000, list_price_cents: 15000 })),
    );
    h.state.couponError = new Error("coupon api down");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await call(ticketPayload());

    expect(result.ok).toBe(true);
    expect(lastSession()?.line_items[0]?.price_data?.unit_amount).toBe(12000);
    expect(lastSession()?.discounts).toBeUndefined();
    expect(
      logged.mock.calls.some((args) => String(args[0]).includes("phase discount failed")),
    ).toBe(true);
    logged.mockRestore();
  });

  it("odpowiedź bez identyfikatora kuponu zostawia cenę końcową na pozycji", async () => {
    rpcResponses.set(
      "event_ticket_checkout_quote",
      ok(ticketQuote({ amount_cents: 12000, list_price_cents: 15000 })),
    );
    h.state.coupon = {};

    await call(ticketPayload());

    expect(lastSession()?.line_items[0]?.price_data?.unit_amount).toBe(12000);
    expect(lastSession()?.discounts).toBeUndefined();
  });

  it("rabat fazy NIE dotyczy zamówień spoza wydarzeń", async () => {
    await call(entityPayload());

    expect(stripeCall("coupons.create")).toBeUndefined();
  });
});

describe("createCheckoutOrder - stempel środowiska", () => {
  it("klient operatora jest zakładany dla środowiska ostemplowanego na zamówieniu", async () => {
    // Zamówienie i sesja MUSZĄ być z tego samego środowiska - inaczej webhook
    // z piaskownicy realizuje zamówienie produkcyjne (izolacja sandbox/live).
    await call(planPayload({ environment: "live" }));

    expect(stripeCall("createStripeClient")?.args[0]).toBe("live");
  });

  it("tryb mock nie jest już możliwy, gdy bramka jest skonfigurowana", async () => {
    const result = await call(planPayload());

    expect(result.ok).toBe(true);
    expect(result.ok && result.mode).toBe("stripe");
  });
});
