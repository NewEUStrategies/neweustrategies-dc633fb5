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
// CO ATRAPUJEMY. Wyłącznie klienta operatora (`getStripeClient`) - reszta
// `@/lib/stripe.server` (rozstrzyganie środowiska, mapowanie komunikatu błędu)
// zostaje PRAWDZIWA, tak samo jak cały `@/lib/billing/adhocCheckout.server`,
// `checkoutSettings.server` i `markOrderSession.server`. Testujemy handler
// wobec swoich sąsiadów, nie wobec ich atrap.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Tables } from "@/integrations/supabase/types";
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
  /**
   * Cena katalogowa w kształcie operatora: `plus_monthly` - 49 zł za sztukę,
   * co miesiąc, rozliczana za ilość. Bramka spójności (PAY-01) porównuje typ,
   * walutę, cykl i kwotę z wyceną planu, więc atrapa niesie wszystkie cztery.
   */
  const catalogPrice = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: "price_1",
    lookup_key: "plus_monthly",
    type: "recurring",
    currency: "pln",
    billing_scheme: "per_unit",
    unit_amount: 4900,
    recurring: { interval: "month", interval_count: 1, usage_type: "licensed" },
    ...over,
  });
  const state = {
    /** Cena katalogowa zwracana przez operatora (pusto = brak ceny). */
    prices: [] as unknown[],
    /** Subskrypcje klienta u operatora (`subscriptions.list`). */
    remoteSubscriptions: [] as unknown[],
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
  return { calls, state, record, catalogPrice };
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

// Kod rabatowy i rezerwacja jego użycia idą rolą serwisową z jawnym najemcą
// i kontem (`couponRpc.server.ts`, migracja 20261007120200). Atrapa kieruje
// wywołania `*_for_user` do TEJ SAMEJ tabeli odpowiedzi co klient kupującego.
const couponAdmin = vi.hoisted(() => ({
  forward: null as null | ((fn: string, args: Record<string, unknown>) => Promise<unknown>),
}));

vi.mock("@/lib/server/tenant.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/tenant.server")>()),
  resolveTenantIdForHost: async () => "tenant-alfa",
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: (fn: string, args: Record<string, unknown>) =>
      couponAdmin.forward !== null && fn.endsWith("_for_user")
        ? couponAdmin.forward(fn, args)
        : Promise.resolve({ data: true, error: null }),
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
    getStripeClient: (env: string) => {
      h.calls.push({ method: "getStripeClient", args: [env] });
      const stub = base();
      return {
        ...stub,
        prices: { list: h.record("prices.list", () => ({ data: h.state.prices })) },
        subscriptions: {
          ...stub.subscriptions,
          list: h.record("subscriptions.list", () => ({ data: h.state.remoteSubscriptions })),
        },
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

/**
 * Werdykt `validate_b2b_coupon` w kształcie, który zwraca baza. Od migracji
 * 20261001210000 typy generowane mówią `Json` (wynik skalarny), więc kształt
 * pól trzymamy tu jawnie - te same klucze czyta `parseCouponVerdict`.
 */
interface CouponVerdict {
  ok: boolean;
  coupon_id: string | null;
  discount_cents: number | null;
  discount_kind: string | null;
  discount_percent: number | null;
  error: string | null;
  final_cents: number | null;
  label: string | null;
}

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

/** Cena katalogowa u operatora - domyślnie zgodna z `planQuote()` (49 zł / mies.). */
function stripePrice(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "price_1",
    lookup_key: "plus_monthly",
    type: "recurring",
    billing_scheme: "per_unit",
    unit_amount: 4900,
    currency: "pln",
    recurring: { interval: "month", interval_count: 1 },
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
  h.state.prices = [stripePrice()];
  h.state.remoteSubscriptions = [];
  h.state.sessionError = null;
  h.state.coupon = { id: "coupon_1" };
  h.state.couponError = null;

  chain = supabaseFromStub();
  rpcCalls = [];
  rpcResponses = new Map<string, SupabaseResult>();
  couponAdmin.forward = (fn, args) => client().rpc(fn, args);

  // Bramka SKONFIGUROWANA - wartości syntetyczne, nigdzie nie wychodzą:
  // klient operatora jest atrapą, więc żadne żądanie sieciowe nie powstaje.
  // Host wdrożenia testowego MUSI być zadeklarowany, odkąd `resolveReturnUrl`
  // przechodzi przez bramkę dozwolonych hostów (`lib/billing/returnUrl.server`).
  // Bez tej linii przypadki o adresie powrotu dowodziłyby tylko tego, że
  // `kasa.example.org` NIE jest naszą domeną - a mają dowodzić, że klient nie
  // wybiera domeny powrotu.
  vi.stubEnv("BILLING_RETURN_HOSTS", "kasa.example.org");
  vi.stubEnv("LOVABLE_API_KEY", "klucz-testowy-bramki");
  vi.stubEnv("STRIPE_SANDBOX_API_KEY", "klucz-testowy-piaskownicy");

  chain.setResponse("access_plans", ok(planQuote()));
  // Kupujący bez historii subskrypcji planu (lustro `subscriptions` pod RLS) -
  // kasa subskrypcji sprawdza ją przed zamówieniem (audyt SUB-13).
  chain.setResponse("subscriptions", ok([]));
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
  rpcResponses.set("event_ticket_checkout_quote_for_user", ok(ticketQuote()));
  rpcResponses.set(
    "event_registration_payment_context",
    ok({ ok: true, event_id: EVENT_ID, ticket_type_id: TICKET_ID }),
  );
  // Zgłoszenie bez gości to w bazie jedno miejsce. Brak odpowiedzi byłby
  // odmową `seats_unavailable` - liczba miejsc jest fail-closed.
  rpcResponses.set("event_registration_group_seats", ok(1));
  rpcResponses.set("validate_b2b_coupon_for_user", ok([couponOk()]));
  rpcResponses.set("redeem_b2b_coupon_for_user", ok(true));
  rpcResponses.set("release_b2b_coupon_for_user", ok(true));
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

  it("KONTRPRZYKŁAD: host żądania SPOZA listy nie zostaje originem powrotu", async () => {
    // Sam fakt, że ścieżka pochodzi z hosta żądania, nie wystarcza - host też
    // podaje klient. Bez deklaracji wdrożenia wracamy na origin kanoniczny.
    vi.stubEnv("BILLING_RETURN_HOSTS", "");

    await call(planPayload({ success_path: "https://zlodziej.example.com/przejmij" }));

    expect(lastSession()?.return_url).toBe("https://neweuropeanstrategies.com/przejmij");
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
    h.state.prices = [
      stripePrice({ id: "price_team", lookup_key: "team_monthly_seat", unit_amount: 9900 }),
    ];

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

// ---------------------------------------------------------------------------
// AUDYT SUB-05: kwota zamówienia (plan najemcy ZAMÓWIENIA) musi zgadzać się
// z ceną wspólnego katalogu operatora - inaczej klient płaci inną kwotę niż ta
// zapisana na zamówieniu.
// ---------------------------------------------------------------------------

describe("createCheckoutOrder - zgodność ceny operatora z zamówieniem (audyt SUB-05)", () => {
  it("plan najemcy z ceną INNĄ niż cena wspólna: sesja NIE powstaje, zamówienie `failed`, kupon wraca", async () => {
    // Najemca B przestawił „member/month" na 19 zł; cena `plus_monthly`
    // u operatora (najemca domyślny) to 49 zł.
    chain.setResponse("access_plans", ok(planQuote({ price_cents: 1900 })));
    rpcResponses.set(
      "validate_b2b_coupon_for_user",
      ok([couponOk({ discount_cents: 500, final_cents: 1400 })]),
    );
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await call(planPayload({ coupon_code: "PARTNER-CEE" }));

    expect(result).toEqual({
      ok: false,
      mode: "stripe",
      error: "price_mismatch",
      orderId: "order-1",
    });
    expect(stripeCall("checkout.sessions.create")).toBeUndefined();
    expect(rpcArgs("payment_order_mark_session")).toEqual({
      _order_id: "order-1",
      _status: "failed",
    });
    expect(rpcArgs("release_b2b_coupon_for_user")).toMatchObject({ _order_id: "order-1" });
    logged.mockRestore();
  });

  it("porównanie idzie kwotą PRZED kuponem - rabat jedzie osobno jako rabat operatora", async () => {
    // Zamówienie zapisuje 39 zł (po kuponie), cena operatora to 49 zł, a różnicę
    // zdejmuje kupon operatora. Porównanie kwoty po kuponie odrzucałoby każdy
    // zakup z kodem rabatowym.
    const result = await call(planPayload({ coupon_code: "PARTNER-CEE" }));

    expect(result.ok).toBe(true);
    expect(lastSession()?.discounts).toEqual([{ coupon: "coupon_1" }]);
  });

  it("próg wolumenowy Zespołu: 12 miejsc po stawce progu zgadza się z ceną schodkową operatora", async () => {
    chain.setResponse(
      "access_plans",
      ok(
        planQuote({
          tier_key: "team",
          price_cents: 9900,
          volume_threshold_seats: 11,
          volume_price_cents: 7900,
        }),
      ),
    );
    h.state.prices = [
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
    ];

    const result = await call(planPayload({ seats: 12 }));

    expect(result.ok).toBe(true);
    expect(lastSession()?.line_items[0]?.quantity).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// AUDYT SUB-13: druga subskrypcja i trial raz na konto (pierwszy silnik kasy).
// ---------------------------------------------------------------------------

describe("createCheckoutOrder - druga subskrypcja i ponowny trial (audyt SUB-13)", () => {
  it("ŻYWA subskrypcja planu: odmowa `subscription_exists` (UI kieruje do zmiany planu), bez zamówienia", async () => {
    chain.setResponse("subscriptions", ok([{ status: "past_due" }]));

    const result = await call(planPayload());

    expect(result).toEqual({ ok: false, mode: "subscription", error: "subscription_exists" });
    expect(chain.chainsFor("payment_orders")).toHaveLength(0);
    expect(stripeCall("checkout.sessions.create")).toBeUndefined();
  });

  it("drugi trial NIE przysługuje: po anulowanej subskrypcji sesja idzie bez okresu próbnego", async () => {
    chain.setResponse("access_plans", ok(planQuote({ trial_days: 14 })));
    chain.setResponse("subscriptions", ok([{ status: "canceled" }]));

    const result = await call(planPayload());

    expect(result.ok).toBe(true);
    expect(lastSession()?.subscription_data).not.toHaveProperty("trial_period_days");
  });

  it("żywa subskrypcja widoczna tylko u operatora (przed webhookiem): odmowa i zamówienie `failed`", async () => {
    h.state.remoteSubscriptions = [{ id: "sub_1", status: "active", metadata: {} }];
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await call(planPayload());

    expect(result).toEqual({
      ok: false,
      mode: "stripe",
      error: "subscription_exists",
      orderId: "order-1",
    });
    expect(rpcArgs("payment_order_mark_session")).toMatchObject({ _status: "failed" });
    logged.mockRestore();
  });

  it("subskrypcja DAROWIZNY u operatora nie blokuje planu i nie zużywa triala", async () => {
    chain.setResponse("access_plans", ok(planQuote({ trial_days: 14 })));
    h.state.remoteSubscriptions = [
      { id: "sub_don", status: "active", metadata: { purpose: "donation" } },
    ];

    const result = await call(planPayload());

    expect(result.ok).toBe(true);
    expect(lastSession()?.subscription_data?.trial_period_days).toBe(14);
  });

  it("zakupy jednorazowe (treść) w ogóle nie czytają historii subskrypcji", async () => {
    chain.setResponse("subscriptions", ok([{ status: "active" }]));

    const result = await call(entityPayload());

    expect(result.ok).toBe(true);
    expect(chain.chainsFor("subscriptions")).toHaveLength(0);
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
      "validate_b2b_coupon_for_user",
      ok([couponOk({ discount_cents: 0, final_cents: 4900 })]),
    );

    await call(planPayload({ coupon_code: "PARTNER-CEE" }));

    expect(stripeCall("coupons.create")).toBeUndefined();
    expect(lastSession()?.discounts).toBeUndefined();
  });

  it("odpowiedź operatora BEZ identyfikatora kuponu to ODMOWA, nie sesja bez zniżki (przegląd 0.2)", async () => {
    // Zamówienie zapisało kwotę PO kuponie. Sesja bez rabatu pobrałaby cenę
    // katalogową - więcej, niż pokazała kasa - a realizacja oflagowałaby rozjazd
    // dopiero po pobraniu pieniędzy. Ten sam wynik co w drugim silniku.
    h.state.coupon = {};

    const result = await call(planPayload({ coupon_code: "PARTNER-CEE" }));

    expect(result).toEqual({
      ok: false,
      mode: "stripe",
      error: "discount_unavailable",
      orderId: "order-1",
    });
    expect(stripeCall("checkout.sessions.create")).toBeUndefined();
    expect(rpcArgs("payment_order_mark_session")).toEqual({
      _order_id: "order-1",
      _status: "failed",
    });
    expect(rpcArgs("release_b2b_coupon_for_user")).toMatchObject({ _coupon_id: COUPON_ID });
  });

  it("AWARIA operatora przy zakładaniu rabatu zamyka zamówienie i ZWALNIA kupon (przegląd 0.2)", async () => {
    // CO BYŁO ZŁE. Wyjątek z `coupons.create` (limit zapytań, timeout po
    // ponowieniu) wylatywał z handlera: zamówienie zostawało `pending` bez
    // sesji - więc bez `checkout.session.expired` i bez sprzątania - a jedyne
    // użycie kodu partnerskiego przepadało za zamówienie, którego nikt nie
    // opłaci. Drugi silnik zamykał to już wcześniej (`failOrder`).
    h.state.couponError = new Error("rate_limit: too many requests");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await call(planPayload({ coupon_code: "PARTNER-CEE" }));

    expect(result).toMatchObject({ ok: false, mode: "stripe", orderId: "order-1" });
    expect(result.ok === false && result.error).toContain("rate_limit");
    expect(stripeCall("checkout.sessions.create")).toBeUndefined();
    expect(rpcCalls.map((c) => c.fn)).toEqual([
      "validate_b2b_coupon_for_user",
      "redeem_b2b_coupon_for_user",
      "payment_order_mark_session",
      "release_b2b_coupon_for_user",
    ]);
    expect(rpcArgs("payment_order_mark_session")).toEqual({
      _order_id: "order-1",
      _status: "failed",
    });
    expect(rpcArgs("release_b2b_coupon_for_user")).toEqual({
      _tenant_id: "tenant-alfa",
      _user_id: "user-kupujacy",
      _coupon_id: COUPON_ID,
      _order_id: "order-1",
    });
    expect(
      logged.mock.calls.some((args) => String(args[0]).includes("provider coupon failed")),
    ).toBe(true);
    logged.mockRestore();
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

    // Zwolnienie idzie rolą serwisową w najemcy ZAMÓWIENIA i dla konta z sesji
    // (20261007140200) - baza oddaje użycie tylko nieopłaconemu zamówieniu.
    expect(rpcArgs("release_b2b_coupon_for_user")).toEqual({
      _tenant_id: "tenant-alfa",
      _user_id: "user-kupujacy",
      _coupon_id: COUPON_ID,
      _order_id: "order-1",
    });
    logged.mockRestore();
  });

  it("bez kuponu nie ma czego zwalniać", async () => {
    h.state.prices = [];
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await call(planPayload());

    expect(rpcCalls.map((c) => c.fn)).not.toContain("release_b2b_coupon_for_user");
    logged.mockRestore();
  });

  it("nieudane zwolnienie kuponu jest LOGOWANE, a nie przemilczane", async () => {
    // Zwolnienie jest operacją naprawczą - jej cicha porażka zostawia
    // zablokowane użycie bez żadnego śladu do diagnozy.
    h.state.prices = [];
    rpcResponses.set("release_b2b_coupon_for_user", fail("release failed"));
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

describe("createCheckoutOrder - wspólna wycena planu i bramka ceny (audyt PAY-01)", () => {
  // Ten silnik liczy cenę planu tą samą funkcją co drugi (`planPricing.ts`)
  // i tak samo przekazuje operatorowi oczekiwany tryb i walutę. Cena pod
  // `lookup_key` innego typu albo w innej walucie niż zamówienie to odmowa,
  // a nie sesja za coś innego.
  it("cena JEDNORAZOWA pod kluczem planu cyklicznego: `price_mismatch`, zamówienie `failed`, kupon zwolniony", async () => {
    h.state.prices = [h.catalogPrice({ type: "one_time", recurring: null })];
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await call(planPayload({ coupon_code: "PARTNER-CEE" }));

    expect(result).toEqual({
      ok: false,
      mode: "stripe",
      error: "price_mismatch",
      orderId: "order-1",
    });
    expect(stripeCall("checkout.sessions.create")).toBeUndefined();
    expect(rpcArgs("payment_order_mark_session")).toEqual({
      _order_id: "order-1",
      _status: "failed",
    });
    expect(rpcArgs("release_b2b_coupon_for_user")).toMatchObject({ _order_id: "order-1" });
    logged.mockRestore();
  });

  it("cena w INNEJ WALUCIE niż plan: `price_mismatch`", async () => {
    h.state.prices = [h.catalogPrice({ currency: "eur" })];
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await call(planPayload());

    expect(result).toMatchObject({ ok: false, error: "price_mismatch" });
    expect(stripeCall("checkout.sessions.create")).toBeUndefined();
    logged.mockRestore();
  });
});

describe("createCheckoutOrder - RODZAJ zamówienia planu wynika z PLANU (przegląd PAY-01, 0.0/7.0)", () => {
  // CO BYŁO ZŁE. Ten silnik brał `kind` z żądania. `kind=one_time` z planem
  // MIESIĘCZNYM omijał wycenę, otwierał sesję `payment` z ceną osadzoną za
  // jeden okres i zakładał zamówienie `one_time` z `plan_id` - a takie
  // zamówienie realizacja zamienia w dostęp DOŻYWOTNI (`entitlementForOrder`:
  // `lifetime: true`, `current_period_end` NULL). Kwota sesji była równa
  // kwocie zamówienia, więc nic nie flagowało rozjazdu. W drugą stronę
  // `kind=subscription` z planem jednorazowym dawało miesięczny dostęp za
  // produkt jednorazowy. Żaden ekran nie składa takiego żądania - to czysta
  // powierzchnia ataku ręcznie złożonym POST-em.
  //
  // JAK NAPRAWIONE. Zakup planu ZAWSZE przechodzi przez `planCheckoutPricing`,
  // a rozbieżność deklaracji z wyceną to odmowa PRZED kuponem i zamówieniem:
  // plan cykliczny kupowany „jednorazowo" - `plan_not_one_time` (ten sam kod
  // co strażnik bazy, TIX-02), kierunek odwrotny - `kind_mismatch`.
  it("`kind=one_time` z planem MIESIĘCZNYM: `plan_not_one_time`, bez zamówienia, kuponu i operatora", async () => {
    await expect(
      call(planPayload({ kind: "one_time", coupon_code: "PARTNER-CEE" })),
    ).rejects.toThrow("plan_not_one_time");

    expect(chain.chainsFor("payment_orders")).toHaveLength(0);
    expect(rpcCalls).toHaveLength(0);
    expect(h.calls).toHaveLength(0);
  });

  it("`kind=one_time` z planem ROCZNYM Pro też jest odmową - jeden rok nie kupuje dożywocia", async () => {
    chain.setResponse(
      "access_plans",
      ok(planQuote({ tier_key: "pro", interval: "year", price_cents: 49000 })),
    );

    await expect(call(planPayload({ kind: "one_time" }))).rejects.toThrow("plan_not_one_time");
    expect(chain.chainsFor("payment_orders")).toHaveLength(0);
  });

  it("`kind=subscription` z planem JEDNORAZOWYM (Decision Lab): `kind_mismatch`, bez zamówienia i kuponu", async () => {
    chain.setResponse(
      "access_plans",
      ok(planQuote({ tier_key: "decision_lab", interval: "one_time", price_cents: 1600000 })),
    );

    await expect(
      call(planPayload({ kind: "subscription", coupon_code: "PARTNER-CEE" })),
    ).rejects.toThrow("kind_mismatch");
    expect(chain.chainsFor("payment_orders")).toHaveLength(0);
    expect(rpcCalls).toHaveLength(0);
    expect(h.calls).toHaveLength(0);
  });

  it("plan jednorazowy z `kind=one_time` idzie CENĄ KATALOGOWĄ w trybie `payment` (jak drugi silnik)", async () => {
    chain.setResponse(
      "access_plans",
      ok(
        planQuote({
          tier_key: "decision_lab",
          interval: "one_time",
          price_cents: 1600000,
          trial_days: 14,
        }),
      ),
    );
    h.state.prices = [
      h.catalogPrice({
        id: "price_lab",
        lookup_key: "decision_lab_seat",
        type: "one_time",
        recurring: null,
        unit_amount: 1600000,
      }),
    ];

    const result = await call(planPayload({ kind: "one_time" }));

    expect(result.ok).toBe(true);
    expect(lastSession()?.mode).toBe("payment");
    expect(lastSession()?.line_items[0]).toMatchObject({ price: "price_lab", quantity: 1 });
    expect(lastSession()?.line_items[0]?.price_data).toBeUndefined();
    expect(lastSession()?.subscription_data).toBeUndefined();
    const order = chain.lastChain("payment_orders")?.argsOf("insert")?.[0] as
      Record<string, unknown> | undefined;
    expect(order).toMatchObject({ kind: "one_time", amount_cents: 1600000, plan_id: PLAN_ID });
  });

  it("plan cykliczny z `kind=subscription` zakłada zamówienie `subscription`", async () => {
    await call(planPayload());

    const order = chain.lastChain("payment_orders")?.argsOf("insert")?.[0] as
      Record<string, unknown> | undefined;
    expect(order?.kind).toBe("subscription");
  });
});

describe("createCheckoutOrder - jedno zamówienie, jeden przedmiot", () => {
  // Plan, treść i bilet wykluczają się: zamówienie wycenione jednym
  // przedmiotem i zrealizowane drugim to płatność za tanie, dostęp do drogiego.
  // Odmowę daje walidator ładunku (`checkoutPayloadIssue`, TIX-01) - jeden kod
  // na każdą mieszankę, zanim handler przeczyta cokolwiek z bazy.
  it.each([
    [
      "plan + wydarzenie",
      { kind: "one_time", plan_id: PLAN_ID, event_id: EVENT_ID },
      "ticket_payload_conflict",
    ],
    [
      "plan + treść",
      { kind: "one_time", plan_id: PLAN_ID, entity_type: "post", entity_id: POST_ID },
      "entity_payload_conflict",
    ],
    [
      "plan + sam rodzaj treści (bez identyfikatora)",
      { kind: "one_time", plan_id: PLAN_ID, entity_type: "post" },
      "entity_payload_conflict",
    ],
    [
      "subskrypcja + wydarzenie",
      { kind: "subscription", plan_id: PLAN_ID, event_id: EVENT_ID },
      "subscription_payload_conflict",
    ],
    [
      "treść + wydarzenie (bilet po cenie wpisu)",
      { kind: "one_time", entity_type: "post", entity_id: POST_ID, event_id: EVENT_ID },
      "ticket_payload_conflict",
    ],
    [
      "treść + zgłoszenie etapu 4",
      {
        kind: "one_time",
        entity_type: "post",
        entity_id: POST_ID,
        registration_id: REGISTRATION_ID,
      },
      "registration_requires_ticket",
    ],
  ])("%s: odmowa przed jakimkolwiek odczytem", async (_label, over, reason) => {
    await expect(
      call({ success_path: "/x", cancel_path: "/x", environment: "sandbox", ...over }),
    ).rejects.toThrow(reason);
    expect(chain.chains).toHaveLength(0);
    expect(rpcCalls).toHaveLength(0);
    expect(h.calls).toHaveLength(0);
  });
});

describe("createCheckoutOrder - cena u operatora zgodna z planem (przegląd PAY-01, 0.1)", () => {
  it("plan Pro KWARTALNY bez wpisu katalogu: `plan_price_missing`, bez schodzenia na `pro_monthly`", async () => {
    chain.setResponse(
      "access_plans",
      ok(planQuote({ tier_key: "pro", interval: "quarter", price_cents: 12900 })),
    );

    await expect(call(planPayload())).rejects.toThrow("plan_price_missing");
    expect(chain.chainsFor("payment_orders")).toHaveLength(0);
    expect(h.calls).toHaveLength(0);
  });

  it("DRYF KWOTY u operatora (99 zł za plan 49 zł): `price_mismatch`, zamówienie `failed`, kupon zwolniony", async () => {
    h.state.prices = [h.catalogPrice({ unit_amount: 9900 })];
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await call(planPayload({ coupon_code: "PARTNER-CEE" }));

    expect(result).toEqual({
      ok: false,
      mode: "stripe",
      error: "price_mismatch",
      orderId: "order-1",
    });
    expect(stripeCall("checkout.sessions.create")).toBeUndefined();
    expect(rpcArgs("payment_order_mark_session")).toEqual({
      _order_id: "order-1",
      _status: "failed",
    });
    expect(rpcArgs("release_b2b_coupon_for_user")).toMatchObject({ _order_id: "order-1" });
    logged.mockRestore();
  });

  it("cena w INNYM CYKLU niż plan (kwartał zamiast miesiąca): `price_mismatch`", async () => {
    h.state.prices = [
      h.catalogPrice({
        recurring: { interval: "month", interval_count: 3, usage_type: "licensed" },
      }),
    ];
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await call(planPayload());

    expect(result).toMatchObject({ ok: false, error: "price_mismatch" });
    expect(stripeCall("checkout.sessions.create")).toBeUndefined();
    logged.mockRestore();
  });

  it("kwota ceny liczona za WSZYSTKIE miejsca: 7 × 99 zł zgodne z zamówieniem", async () => {
    chain.setResponse("access_plans", ok(planQuote({ tier_key: "team", price_cents: 9900 })));
    h.state.prices = [
      h.catalogPrice({ id: "price_team", lookup_key: "team_monthly_seat", unit_amount: 9900 }),
    ];

    const result = await call(planPayload({ seats: 7 }));

    expect(result.ok).toBe(true);
    expect(lastSession()?.line_items[0]).toMatchObject({ price: "price_team", quantity: 7 });
  });
});

describe("createCheckoutOrder - idempotencja u operatora (audyt PAY-16a)", () => {
  // Klucz pochodzi z zamówienia i z celu wywołania: ponowienie nie zakłada
  // drugiej sesji ani drugiego kuponu, a sesja i kupon tego samego zamówienia
  // nie dzielą klucza (Stripe odrzuca klucz z innymi parametrami).
  const optionsOf = (method: string): unknown =>
    h.calls.filter((c) => c.method === method).at(-1)?.args[1];

  it("sesja subskrypcji i jej kupon dostają klucze z zamówienia", async () => {
    await call(planPayload({ coupon_code: "PARTNER-CEE" }));

    expect(optionsOf("coupons.create")).toEqual({ idempotencyKey: "checkout_coupon:order-1" });
    expect(optionsOf("checkout.sessions.create")).toEqual({
      idempotencyKey: "checkout_session:order-1",
    });
  });

  it("sesja z ceną osadzoną (treść) dostaje klucz z zamówienia", async () => {
    await call(entityPayload());

    expect(optionsOf("checkout.sessions.create")).toEqual({
      idempotencyKey: "checkout_session:order-1",
    });
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
    rpcResponses.set(
      "event_seat_state",
      ok([{ event_id: EVENT_ID, capacity: null, seats_left: null, going: 0, waitlist: 0 }]),
    );

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
      "validate_b2b_coupon_for_user",
      ok([couponOk({ discount_cents: 1000, final_cents: 2000 })]),
    );
    h.state.sessionError = new Error("operator unavailable");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await call(entityPayload({ coupon_code: "PARTNER-CEE" }));

    expect(rpcArgs("release_b2b_coupon_for_user")).toMatchObject({ _coupon_id: COUPON_ID });
    logged.mockRestore();
  });

  it("nieudane zwolnienie kuponu na ścieżce ceny osadzonej też jest logowane", async () => {
    rpcResponses.set("release_b2b_coupon_for_user", fail("release failed"));
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

    expect(rpcCalls.map((c) => c.fn)).not.toContain("release_b2b_coupon_for_user");
    logged.mockRestore();
  });
});

describe("createCheckoutOrder - rabat fazy sprzedaży widoczny w nakładce", () => {
  it("pozycja idzie ceną REGULARNĄ, a różnicę zdejmuje kupon jednorazowy", async () => {
    // Bez tego kupujący widzi samą kwotę końcową i nie ma jak sprawdzić, że
    // promocja („pierwsza fala") faktycznie zadziałała.
    rpcResponses.set(
      "event_ticket_checkout_quote_for_user",
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
      "event_ticket_checkout_quote_for_user",
      ok(ticketQuote({ amount_cents: 12000, list_price_cents: 15000, phase: { source } })),
    );

    await call(ticketPayload());

    expect(stripeCall("coupons.create")?.args[0]).toMatchObject({ name: expected });
  });

  it("własna etykieta fazy z bazy bije etykietę zastępczą", async () => {
    rpcResponses.set(
      "event_ticket_checkout_quote_for_user",
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
      "event_ticket_checkout_quote_for_user",
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
      "event_ticket_checkout_quote_for_user",
      ok(ticketQuote({ amount_cents: 12000, list_price_cents: 15000, phase: [] })),
    );

    await call(ticketPayload());

    expect(stripeCall("coupons.create")?.args[0]).toMatchObject({ name: "Kupon Rabat" });
  });

  it("nieliczbowa cena regularna nie tworzy rabatu fazy", async () => {
    rpcResponses.set(
      "event_ticket_checkout_quote_for_user",
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
      "event_ticket_checkout_quote_for_user",
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
      "event_ticket_checkout_quote_for_user",
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

    expect(stripeCall("getStripeClient")?.args[0]).toBe("live");
  });

  it("tryb mock nie jest już możliwy, gdy bramka jest skonfigurowana", async () => {
    const result = await call(planPayload());

    expect(result.ok).toBe(true);
    expect(result.ok && result.mode).toBe("stripe");
  });
});
