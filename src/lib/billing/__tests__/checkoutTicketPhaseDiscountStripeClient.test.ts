// Kasa biletu z rabatem fazy sprzedaży, gdy KLIENT OPERATORA się nie buduje.
//
// DEFEKT (2026-10-18). Rabat fazy sprzedaży (early bird, benefit planu) jest
// w kasie biletu dodatkiem: kupon operatora pokazuje różnicę w nakładce,
// a jego porażka ma kończyć się sesją po kwocie końcowej bez widocznego rabatu
// (`.catch(() => null)` przy `createAdhocDiscountForCoupon`). Klient operatora
// był jednak budowany jako ARGUMENT tego wywołania -
// `createAdhocDiscountForCoupon(await getStripeClient(env), ...).catch(...)` -
// więc jego odrzucenie (chwilowo nieudany import SDK, brak klucza środowiska)
// wylatywało z handlera PRZED `.catch` i przed `failOrder`. Zamówienie
// zostawało `pending` bez sesji (na takie nie przyjdzie
// `checkout.session.expired`), z zarezerwowanym użyciem kodu - limitowany kod
// tracił użycie za zamówienie, którego nikt nie opłaci.
//
// CO ATRAPUJEMY: klienta Supabase (RPC i tabele) i `getStripeClient` - granicę
// operatora. `adhocCheckout.server`, `eventTicketPricing.server` i reszta kasy
// jadą PRAWDZIWE.
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

const h = vi.hoisted(() => ({
  calls: [] as { method: string; args: unknown[] }[],
  /** Ile kolejnych wywołań `getStripeClient` ma się nie udać (`Infinity` = każde). */
  clientFailures: { remaining: 0 },
}));

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

const couponAdmin = vi.hoisted(() => ({
  forward: null as null | ((fn: string, args: Record<string, unknown>) => Promise<unknown>),
}));

vi.mock("@/lib/server/tenant.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/tenant.server")>()),
  resolveTenantIdForHost: async () => "tenant-alfa",
}));

vi.mock("@/integrations/supabase/client.server", async () => {
  const { couponPolicyAdminFrom } = await import("@/test/billing/fixtures");
  return {
    supabaseAdmin: {
      rpc: (fn: string, args: Record<string, unknown>) =>
        couponAdmin.forward !== null && fn.endsWith("_for_user")
          ? couponAdmin.forward(fn, args)
          : Promise.resolve({ data: true, error: null }),
      from: couponPolicyAdminFrom(() => null),
    },
  };
});

vi.mock("@/lib/stripe.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/stripe.server")>();
  const record =
    (method: string, result: () => unknown) =>
    (...args: unknown[]) => {
      h.calls.push({ method, args });
      return Promise.resolve(result());
    };
  return {
    ...actual,
    getStripeClient: async () => {
      if (h.clientFailures.remaining > 0) {
        h.clientFailures.remaining -= 1;
        throw new Error("STRIPE_LIVE_API_KEY is not configured");
      }
      return {
        customers: {
          search: record("customers.search", () => ({ data: [{ id: "cus_1" }] })),
          list: record("customers.list", () => ({ data: [] })),
          update: record("customers.update", () => ({})),
          create: record("customers.create", () => ({ id: "cus_1" })),
        },
        coupons: { create: record("coupons.create", () => ({ id: "coupon_faza" })) },
        checkout: {
          sessions: {
            create: record("checkout.sessions.create", () => ({
              id: "cs_bilet",
              client_secret: "cs_bilet_secret",
            })),
          },
        },
      };
    },
  };
});

vi.mock("@/lib/billing/oneTimeFulfilment.server", () => ({
  settleFreeTicketOrder: async () => ({ outcome: "order", seated: true }),
}));

const { callServerFn } = await import("@/test/serverFn");
const { createCheckoutOrder } = await import("@/lib/billing/checkout.functions");

type CheckoutResult =
  | { ok: true; mode: "stripe"; clientSecret: string; orderId: string }
  | { ok: false; mode: string; error: string; orderId?: string };

interface SessionParams {
  line_items: { quantity: number; price_data: { unit_amount: number } }[];
  discounts?: { coupon: string }[];
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

/** Statusy, którymi kasa oznaczyła zamówienie (`payment_order_mark_session`). */
const markedStatuses = () =>
  rpcCalls.filter((c) => c.fn === "payment_order_mark_session").map((c) => c.args._status);

const session = () =>
  h.calls.filter((c) => c.method === "checkout.sessions.create").at(-1)?.args[0] as
    SessionParams | undefined;

beforeEach(() => {
  h.calls.length = 0;
  h.clientFailures.remaining = 0;
  chain = supabaseFromStub();
  rpcCalls = [];
  rpcResponses = new Map();
  couponAdmin.forward = (fn, args) => client().rpc(fn, args);

  vi.stubEnv("BILLING_RETURN_HOSTS", "kasa.example.org");
  vi.stubEnv("LOVABLE_API_KEY", "klucz-testowy-bramki");
  vi.stubEnv("STRIPE_SANDBOX_API_KEY", "klucz-testowy-piaskownicy");
  vi.spyOn(console, "error").mockImplementation(() => {});

  chain.setResponse("payment_orders", ok({ id: "order-faza", tenant_id: "tenant-alfa" }));
  chain.setResponse("checkout_settings", ok(null));
  rpcResponses.set(
    "event_registration_payment_context",
    ok({ ok: true, event_id: EVENT_ID, ticket_type_id: TICKET_ID }),
  );
  // Early bird: 80 zł zamiast regularnych 100 zł za miejsce, trzy miejsca.
  rpcResponses.set(
    "event_ticket_checkout_quote_for_user",
    ok({
      ticket_type_id: TICKET_ID,
      event_id: EVENT_ID,
      amount_cents: 8000,
      list_price_cents: 10000,
      currency: "PLN",
      name_pl: "Bilet",
      event_title_pl: "Kongres CEE",
      phase: { source: "early_bird" },
    }),
  );
  rpcResponses.set("my_ticket_allowance", ok(null));
  rpcResponses.set("event_ticket_public_options", ok({ tax_mode: "inclusive" }));
  rpcResponses.set("event_registration_group_seats", ok(3));
  rpcResponses.set("validate_event_ticket_coupon_for_user", (args) => {
    const amount = Number(args._amount_cents);
    return ok([
      {
        ok: true,
        error: null,
        coupon_id: COUPON_ID,
        discount_cents: 3000,
        final_cents: amount - 3000,
        label: "Kod organizatora",
        discount_kind: "fixed",
        discount_percent: null,
      },
    ]);
  });
  rpcResponses.set("redeem_b2b_coupon_for_user", ok(true));
  rpcResponses.set("release_b2b_coupon_for_user", ok(true));
  rpcResponses.set("payment_order_mark_session", ok(true));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("createCheckoutOrder - rabat fazy sprzedaży przy niedziałającym kliencie operatora", () => {
  it("chwilowa porażka klienta przy rabacie fazy: sesja po kwocie końcowej, bez zawieszonego zamówienia", async () => {
    h.clientFailures.remaining = 1;

    const result = await call();

    expect(result).toMatchObject({ ok: true, mode: "stripe", clientSecret: "cs_bilet_secret" });
    // Rabat fazy nie powstał - pozycja idzie po kwocie KOŃCOWEJ (3 × 80 zł),
    // a nie po regularnej bez kuponu, który by ją pomniejszył.
    expect(h.calls.filter((c) => c.method === "coupons.create")).toHaveLength(0);
    expect(session()?.discounts).toBeUndefined();
    expect(session()?.line_items).toEqual([
      expect.objectContaining({
        quantity: 3,
        price_data: expect.objectContaining({ unit_amount: 8000 }),
      }),
    ]);
    expect(markedStatuses()).toEqual(["processing"]);
  });

  it("trwała porażka klienta: zamówienie `failed`, użycie kodu wraca do puli, odmowa zamiast wyjątku", async () => {
    h.clientFailures.remaining = Number.POSITIVE_INFINITY;

    const result = await call({ coupon_code: "minus10" });

    expect(result).toMatchObject({ ok: false, mode: "stripe", orderId: "order-faza" });
    expect(markedStatuses()).toEqual(["failed"]);
    expect(rpcCalls.find((c) => c.fn === "release_b2b_coupon_for_user")?.args).toMatchObject({
      _coupon_id: COUPON_ID,
      _order_id: "order-faza",
    });
    expect(session()).toBeUndefined();
  });
});
