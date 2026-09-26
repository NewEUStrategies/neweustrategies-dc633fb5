// ZAMÓWIENIE GRUPOWE Z KODEM KWOTOWYM - od wyceny do sesji operatora.
//
// ZGŁOSZENIE WŁAŚCICIELA: „kod na stałą kwotę odejmuje się raz od całego
// zamówienia, a nie od każdego biletu". Reguła „od każdego miejsca" żyła
// dotąd w czystej funkcji (`groupOrderPricing.test.ts`), a ŻADEN test nie
// przeprowadzał przez nią prawdziwego handlera - regresja w okablowaniu
// (liczba miejsc, metadane, pozycja w Stripe, rezerwacja użycia) byłaby
// zielona. Ten plik idzie całą drogą: `event_registration_group_seats` ->
// `validate_event_ticket_coupon` -> zamówienie -> `redeem_b2b_coupon` ->
// kupon i pozycja w sesji Stripe.
//
// CO DOWODZI (każdy punkt to pieniądze):
//   1. 3 miejsca × 100 zł z kodem -20 zł to 240 zł, a nie 280 zł - w kwocie
//      zamówienia, w audycie kuponu, w rezerwacji użycia i w nakładce.
//   2. Pozycja w Stripe to „3 × 100 zł", a nie jedna linia za 300 zł -
//      i tylko wtedy, gdy suma dzieli się bez reszty (inaczej nakładka
//      policzyłaby inną kwotę niż zamówienie).
//   3. Bilet NIGDY nie dostaje pola kodu promocyjnego Stripe - kod wpisany
//      w nakładce schodził raz z całej sesji i omijał bazę.
//   4. Awaria liczby miejsc to ODMOWA, a nie ciche jedno miejsce.
//
// CO ATRAPUJEMY: klienta Supabase (RPC i łańcuch tabel) i klienta operatora.
// `adhocCheckout.server`, `checkoutSettings.server`, `eventTicketPricing.server`
// i `groupOrderPricing` jadą PRAWDZIWE.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fail,
  ok,
  supabaseFromStub,
  type SupabaseFromStub,
  type SupabaseResult,
} from "@/test/supabaseChain";

const EVENT_ID = "bbbbbbbb-0000-4000-8000-000000000002";
const TICKET_ID = "cccccccc-0000-4000-8000-000000000003";
const REGISTRATION_ID = "dddddddd-0000-4000-8000-000000000004";
const COUPON_ID = "ffffffff-0000-4000-8000-00000000000c";

const h = vi.hoisted(() => {
  const calls: { method: string; args: unknown[] }[] = [];
  const state = { couponError: null as Error | null, couponSeq: 0 };
  return { calls, state };
});

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFnHarness")).serverFnStubModule(),
);

vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () =>
    new Request("https://kasa.example.org/checkout", {
      headers: { "x-forwarded-proto": "https", "x-forwarded-host": "kasa.example.org" },
    }),
}));

vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: { name: "requireSupabaseAuth" },
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { rpc: () => Promise.resolve({ data: true, error: null }) },
}));

vi.mock("@/lib/stripe.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/stripe.server")>();
  const record =
    (method: string, result: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) => {
      h.calls.push({ method, args });
      try {
        return Promise.resolve(result(...args));
      } catch (e) {
        return Promise.reject(e);
      }
    };
  return {
    ...actual,
    getStripeClient: async () => ({
      customers: {
        search: record("customers.search", () => ({ data: [{ id: "cus_1" }] })),
        list: record("customers.list", () => ({ data: [] })),
        update: record("customers.update", () => ({})),
        create: record("customers.create", () => ({ id: "cus_1" })),
      },
      coupons: {
        create: record("coupons.create", () => {
          if (h.state.couponError) throw h.state.couponError;
          h.state.couponSeq += 1;
          return { id: `coupon_${h.state.couponSeq}` };
        }),
      },
      checkout: {
        sessions: {
          create: record("checkout.sessions.create", () => ({
            id: "cs_grupa",
            client_secret: "cs_grupa_secret",
          })),
        },
      },
    }),
  };
});

const { callServerFn } = await import("@/test/serverFn");
const { createCheckoutOrder } = await import("@/lib/billing/checkout.functions");

type CheckoutResult =
  | { ok: true; mode: "stripe"; clientSecret: string; orderId: string }
  | { ok: false; mode: string; error: string; orderId?: string };

interface SessionParams {
  line_items: {
    quantity: number;
    price_data: { unit_amount: number; product_data: { name: string } };
  }[];
  discounts?: { coupon: string }[];
  allow_promotion_codes?: boolean;
}

let chain: SupabaseFromStub;
let rpcCalls: { fn: string; args: Record<string, unknown> }[];
let rpcResponses: Map<string, SupabaseResult | ((args: Record<string, unknown>) => SupabaseResult)>;

function client() {
  return {
    from: (table: string) => chain.from(table),
    rpc: (fn: string, args: Record<string, unknown> = {}) => {
      rpcCalls.push({ fn, args });
      const planned = rpcResponses.get(fn);
      const result = typeof planned === "function" ? planned(args) : planned;
      return Promise.resolve(result ?? fail(`test: brak zaplanowanej odpowiedzi RPC "${fn}"`));
    },
  };
}

function call(over: Record<string, unknown> = {}): Promise<CheckoutResult> {
  return callServerFn<CheckoutResult>(
    createCheckoutOrder,
    {
      kind: "one_time",
      event_id: EVENT_ID,
      ticket_type_id: TICKET_ID,
      registration_id: REGISTRATION_ID,
      success_path: "/events/kongres-cee",
      cancel_path: "/events/kongres-cee",
      environment: "sandbox",
      ...over,
    },
    { supabase: client(), userId: "user-lead", claims: { email: "lead@example.org" } },
  );
}

function quote(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ticket_type_id: TICKET_ID,
    event_id: EVENT_ID,
    amount_cents: 10000,
    list_price_cents: 10000,
    currency: "PLN",
    name_pl: "Bilet",
    event_title_pl: "Kongres CEE",
    phase: null,
    ...over,
  };
}

/**
 * Werdykt bazy w kształcie `_b2b_coupon_evaluate`: rabat liczony RAZ od kwoty,
 * którą baza dostała - czyli od sumy za wszystkie miejsca.
 */
function fixedCode(cents: number) {
  return (args: Record<string, unknown>): SupabaseResult => {
    const amount = Number(args._amount_cents);
    const discount = Math.min(cents, amount);
    return ok([
      {
        ok: true,
        error: null,
        coupon_id: COUPON_ID,
        discount_cents: discount,
        final_cents: amount - discount,
        label: "Kod organizatora",
        discount_kind: "fixed",
        discount_percent: null,
      },
    ]);
  };
}

function percentCode(percent: number) {
  return (args: Record<string, unknown>): SupabaseResult => {
    const amount = Number(args._amount_cents);
    const discount = Math.floor((amount * percent) / 100);
    return ok([
      {
        ok: true,
        error: null,
        coupon_id: COUPON_ID,
        discount_cents: discount,
        final_cents: amount - discount,
        label: "Kod procentowy",
        discount_kind: "percent",
        discount_percent: percent,
      },
    ]);
  };
}

function orderInsert(): Record<string, unknown> {
  return (chain.lastChain("payment_orders")?.argsOf("insert")?.[0] ?? {}) as Record<
    string,
    unknown
  >;
}

function metadata(): Record<string, unknown> {
  return (orderInsert().metadata ?? {}) as Record<string, unknown>;
}

function session(): SessionParams {
  return h.calls.filter((c) => c.method === "checkout.sessions.create").at(-1)
    ?.args[0] as SessionParams;
}

function stripeCoupons(): Record<string, unknown>[] {
  return h.calls
    .filter((c) => c.method === "coupons.create")
    .map((c) => c.args[0] as Record<string, unknown>);
}

function rpcArgs(fn: string): Record<string, unknown> | undefined {
  return rpcCalls.find((c) => c.fn === fn)?.args;
}

beforeEach(() => {
  h.calls.length = 0;
  h.state.couponError = null;
  h.state.couponSeq = 0;
  chain = supabaseFromStub();
  rpcCalls = [];
  rpcResponses = new Map();

  vi.stubEnv("BILLING_RETURN_HOSTS", "kasa.example.org");
  vi.stubEnv("LOVABLE_API_KEY", "klucz-testowy-bramki");
  vi.stubEnv("STRIPE_SANDBOX_API_KEY", "klucz-testowy-piaskownicy");

  chain.setResponse("payment_orders", ok({ id: "order-grupa", tenant_id: "tenant-alfa" }));
  // Tenant POZWALA na pole kodu Stripe - i właśnie dlatego bilet musi je
  // wyłączyć sam, niezależnie od ustawień.
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
  rpcResponses.set(
    "event_registration_payment_context",
    ok({ ok: true, event_id: EVENT_ID, ticket_type_id: TICKET_ID }),
  );
  rpcResponses.set("event_ticket_checkout_quote", ok(quote()));
  rpcResponses.set("my_ticket_allowance", ok(null));
  rpcResponses.set("event_ticket_public_options", ok({ tax_mode: "inclusive" }));
  rpcResponses.set("event_registration_group_seats", ok(3));
  rpcResponses.set("validate_event_ticket_coupon", fixedCode(2000));
  rpcResponses.set("redeem_b2b_coupon", ok(true));
  rpcResponses.set("payment_order_mark_session", ok(true));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createCheckoutOrder - kod kwotowy na zamówieniu grupowym", () => {
  it("3 × 100 zł z kodem -20 zł: 240 zł, audyt 60 zł (3 × 20 zł), rezerwacja 60 zł", async () => {
    const result = await call({ coupon_code: "minus20" });

    expect(result).toMatchObject({ ok: true, mode: "stripe", clientSecret: "cs_grupa_secret" });
    // Baza dostaje SUMĘ za miejsca - rozbicie na miejsca robi kasa.
    expect(rpcArgs("validate_event_ticket_coupon")).toMatchObject({
      _code: "MINUS20",
      _amount_cents: 30000,
      _ticket_type_id: TICKET_ID,
    });
    expect(orderInsert().amount_cents).toBe(24000);
    expect(metadata()).toMatchObject({
      label: "Kongres CEE - Bilet × 3",
      quantity: 3,
      coupon_code: "MINUS20",
      coupon_id: COUPON_ID,
      coupon_discount_cents: 6000,
      coupon_discount_per_seat_cents: 2000,
      original_amount_cents: 30000,
    });
    expect(rpcArgs("redeem_b2b_coupon")).toMatchObject({
      _coupon_id: COUPON_ID,
      _order_id: "order-grupa",
      _applied_cents: 6000,
      _original_cents: 30000,
    });
  });

  it("nakładka: pozycja „3 × 100 zł” i jeden kupon na 60 zł, bez pola kodu Stripe", async () => {
    await call({ coupon_code: "MINUS20" });

    expect(stripeCoupons()).toEqual([
      expect.objectContaining({ amount_off: 6000, currency: "pln", name: "Kupon MINUS20" }),
    ]);
    expect(session().line_items).toEqual([
      expect.objectContaining({
        quantity: 3,
        price_data: expect.objectContaining({
          unit_amount: 10000,
          product_data: expect.objectContaining({ name: "Kongres CEE - Bilet" }),
        }),
      }),
    ]);
    expect(session().discounts).toEqual([{ coupon: "coupon_1" }]);
    expect(session().allow_promotion_codes).toBeUndefined();
  });

  it("early bird 80 zł (regularna 100 zł) i kod -20 zł na 3 miejscach: 180 zł, jeden kupon 120 zł", async () => {
    rpcResponses.set(
      "event_ticket_checkout_quote",
      ok(quote({ amount_cents: 8000, list_price_cents: 10000, phase: { source: "early_bird" } })),
    );

    await call({ coupon_code: "MINUS20" });

    expect(orderInsert().amount_cents).toBe(18000);
    expect(metadata()).toMatchObject({ coupon_discount_cents: 6000, original_amount_cents: 24000 });
    expect(stripeCoupons()).toEqual([
      expect.objectContaining({ amount_off: 12000, name: "Kupon Early bird + MINUS20" }),
    ]);
    expect(session().line_items[0]).toMatchObject({
      quantity: 3,
      price_data: { unit_amount: 10000 },
    });
  });

  it("kod procentowy 10% na 3 × 100 zł: 270 zł, bez kwoty na miejsce w metadanych", async () => {
    rpcResponses.set("validate_event_ticket_coupon", percentCode(10));

    await call({ coupon_code: "PROC10" });

    expect(orderInsert().amount_cents).toBe(27000);
    expect(metadata()).toMatchObject({ coupon_discount_cents: 3000, quantity: 3 });
    expect(metadata()).not.toHaveProperty("coupon_discount_per_seat_cents");
    // Pozycja idzie ceną regularną (300 zł dzieli się przez 3), a różnicę
    // zdejmuje kupon - więc linia i tak ma ilość 3.
    expect(stripeCoupons()[0]).toMatchObject({ amount_off: 3000 });
    expect(session().line_items[0]).toMatchObject({
      quantity: 3,
      price_data: { unit_amount: 10000 },
    });
  });

  it("kod 150 zł przy cenie miejsca 100 zł schodzi najwyżej do ceny: 0 zł to odmowa, bez zamówienia", async () => {
    rpcResponses.set("validate_event_ticket_coupon", fixedCode(15000));

    const result = await call({ coupon_code: "WIELKI" });

    expect(result).toEqual({ ok: false, mode: "coupon", error: "final_amount_too_low" });
    expect(chain.chainsFor("payment_orders")).toHaveLength(0);
    expect(rpcCalls.map((c) => c.fn)).not.toContain("redeem_b2b_coupon");
  });

  it("odmowa kodu przez bazę wraca z POWODEM bazy i nie zakłada zamówienia", async () => {
    rpcResponses.set(
      "validate_event_ticket_coupon",
      ok([{ ok: false, error: "ticket_not_eligible", coupon_id: COUPON_ID }]),
    );

    const result = await call({ coupon_code: "INNYBILET" });

    expect(result).toEqual({ ok: false, mode: "coupon", error: "ticket_not_eligible" });
    expect(chain.chainsFor("payment_orders")).toHaveLength(0);
  });
});

describe("createCheckoutOrder - liczba miejsc jest fail-closed", () => {
  it("BŁĄD `event_registration_group_seats` to odmowa `seats_unavailable`, a nie jedno miejsce", async () => {
    rpcResponses.set("event_registration_group_seats", fail("function does not exist"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(call({ coupon_code: "MINUS20" })).rejects.toThrow(
      "registration_not_payable:seats_unavailable",
    );
    expect(chain.chainsFor("payment_orders")).toHaveLength(0);
    expect(rpcCalls.map((c) => c.fn)).not.toContain("validate_event_ticket_coupon");
    expect(rpcCalls.map((c) => c.fn)).not.toContain("redeem_b2b_coupon");
    expect(logged.mock.calls.some((args) => String(args[0]).includes("group seats failed"))).toBe(
      true,
    );
    logged.mockRestore();
  });

  it.each([
    ["null", null],
    ["napis", "3"],
    ["zero", 0],
    ["ułamek", 2.5],
  ])("nieczytelna liczba miejsc (%s) jest odmową", async (_label, value) => {
    rpcResponses.set("event_registration_group_seats", ok(value));

    await expect(call()).rejects.toThrow("registration_not_payable:seats_unavailable");
    expect(chain.chainsFor("payment_orders")).toHaveLength(0);
  });
});

describe("createCheckoutOrder - pozycja w Stripe i pole kodu operatora", () => {
  it("bez kodu i bez fazy: linia „3 × 100 zł”, bez rabatu i BEZ pola kodu Stripe", async () => {
    await call();

    expect(orderInsert().amount_cents).toBe(30000);
    expect(metadata()).toMatchObject({ quantity: 3, label: "Kongres CEE - Bilet × 3" });
    expect(session().line_items[0]).toMatchObject({
      quantity: 3,
      price_data: { unit_amount: 10000 },
    });
    expect(session().discounts).toBeUndefined();
    expect(session().allow_promotion_codes).toBeUndefined();
  });

  it("pojedynczy bilet też nie dostaje pola kodu Stripe - `quantity: 1` w metadanych", async () => {
    rpcResponses.set("event_registration_group_seats", ok(1));

    await call();

    expect(metadata()).toMatchObject({ quantity: 1, label: "Kongres CEE - Bilet" });
    expect(session().line_items[0]).toMatchObject({
      quantity: 1,
      price_data: { unit_amount: 10000, product_data: { name: "Kongres CEE - Bilet" } },
    });
    expect(session().allow_promotion_codes).toBeUndefined();
  });

  it("odblokowanie treści ZACHOWUJE pole kodu Stripe z ustawień tenantu", async () => {
    await call({
      event_id: undefined,
      ticket_type_id: undefined,
      registration_id: undefined,
      entity_type: "post",
      entity_id: "eeeeeeee-0000-4000-8000-000000000005",
    });

    expect(session().allow_promotion_codes).toBe(true);
    expect(metadata()).not.toHaveProperty("quantity");
  });

  it("suma NIEPODZIELNA przez miejsca zostaje jedną linią za całość (Stripe liczyłby inaczej)", async () => {
    // 2 × 10,03 zł, kod 25%: baza liczy 5,01 zł rabatu, do zapłaty 15,05 zł.
    // Kupon operatora pada, więc linia idzie kwotą końcową - a 1505 nie dzieli
    // się przez 2.
    rpcResponses.set("event_registration_group_seats", ok(2));
    rpcResponses.set(
      "event_ticket_checkout_quote",
      ok(quote({ amount_cents: 1003, list_price_cents: 1003 })),
    );
    rpcResponses.set("validate_event_ticket_coupon", percentCode(25));
    h.state.couponError = new Error("coupon api down");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await call({ coupon_code: "PROC25" });

    expect(orderInsert().amount_cents).toBe(1505);
    expect(session().line_items[0]).toMatchObject({
      quantity: 1,
      price_data: { unit_amount: 1505, product_data: { name: "Kongres CEE - Bilet × 2" } },
    });
    logged.mockRestore();
  });

  it("ponad limit ilości pozycji (101 miejsc) zostaje jedna linia za całość", async () => {
    rpcResponses.set("event_registration_group_seats", ok(101));

    await call();

    expect(session().line_items[0]).toMatchObject({
      quantity: 1,
      price_data: { unit_amount: 1010000 },
    });
  });

  it("cena miejsca poniżej minimum operatora zostaje jedną linią za całość", async () => {
    rpcResponses.set(
      "event_ticket_checkout_quote",
      ok(quote({ amount_cents: 40, list_price_cents: 40 })),
    );

    await call();

    expect(orderInsert().amount_cents).toBe(120);
    expect(session().line_items[0]).toMatchObject({
      quantity: 1,
      price_data: { unit_amount: 120 },
    });
  });

  it("pozycja bez żadnego tytułu dostaje nazwę zastępczą także jako „N × cena”", async () => {
    rpcResponses.set(
      "event_ticket_checkout_quote",
      ok(quote({ name_pl: null, event_title_pl: null })),
    );

    await call();

    expect(session().line_items[0]).toMatchObject({
      quantity: 3,
      price_data: { product_data: { name: "Zamówienie" } },
    });
  });

  it("nazwa kuponu z długą fazą i kodem mieści się w limicie Stripe", async () => {
    rpcResponses.set(
      "event_ticket_checkout_quote",
      ok(
        quote({
          amount_cents: 8000,
          list_price_cents: 10000,
          phase: { source: "phase", label_pl: "Pierwsza fala sprzedaży jesiennej" },
        }),
      ),
    );

    await call({ coupon_code: "PARTNER-STRATEGICZNY" });

    const name = String(stripeCoupons()[0]?.name);
    expect(name.length).toBeLessThanOrEqual(40);
    expect(name.startsWith("Kupon Pierwsza fala")).toBe(true);
  });
});

describe("createCheckoutOrder - kod na bilet z wiersza wydarzenia (bez cennika)", () => {
  it("kod kwotowy idzie przez tę samą walidację z zerowym rodzajem biletu i jednym miejscem", async () => {
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

    await call({ ticket_type_id: undefined, registration_id: undefined, coupon_code: "MINUS20" });

    expect(rpcArgs("validate_event_ticket_coupon")).toMatchObject({
      _ticket_type_id: "00000000-0000-0000-0000-000000000000",
      _amount_cents: 15000,
    });
    expect(orderInsert().amount_cents).toBe(13000);
    expect(metadata()).toMatchObject({
      quantity: 1,
      coupon_discount_cents: 2000,
      coupon_discount_per_seat_cents: 2000,
    });
  });
});
