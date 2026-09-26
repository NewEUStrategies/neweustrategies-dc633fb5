// PODGLĄD KASY WEJŚCIÓWKI - ta sama liczba co kasa, bez żadnego skutku.
//
// PO CO TEN PLIK. Ekran potwierdzenia pokazywał dotąd „Do zapłaty: <jedno
// miejsce, bez kodu>", a prawdziwą kwotę grupy widać było dopiero w nakładce
// Stripe - więc „kod schodzi raz" wyglądało na fakt. Podgląd ma pokazać TO
// SAMO, co policzy `createCheckoutOrder`. Dwie rzeczy tu pilnujemy:
//   1. ZGODNOŚĆ. Dla identycznych odpowiedzi bazy podgląd i kasa dają tę samą
//      liczbę miejsc, ten sam rabat i tę samą kwotę.
//   2. BEZ SKUTKU. Podgląd NIGDY nie woła `redeem_b2b_coupon` i nie zakłada
//      zamówienia - sprawdzenie kodu nie może zjadać jego limitu.
//
// CZEGO NIE DOWODZI: autoryzacji (harness nie uruchamia middleware; deklarację
// `requireSupabaseAuth` przybijamy strukturalnie).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import {
  asServerFn,
  callServerFn,
  serverFnMiddlewareNames,
  validateServerFnInput,
} from "@/test/serverFnHarness";
import { fail, ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabaseChain";

const EVENT_ID = "bbbbbbbb-0000-4000-8000-000000000002";
const TICKET_ID = "cccccccc-0000-4000-8000-000000000003";
const REGISTRATION_ID = "dddddddd-0000-4000-8000-000000000004";
const COUPON_ID = "ffffffff-0000-4000-8000-00000000000c";

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

// Tryb mock (brak dostawcy) kończy kasę tuż po wstawieniu zamówienia - tyle
// wystarczy, żeby porównać jej liczby z podglądem.
vi.mock("@/lib/billing/mockMode.server", () => ({
  mockCheckoutAllowed: () => true,
  paymentsConfiguredServer: () => false,
}));

vi.mock("@/lib/stripe.server", () => ({ resolveEnvironment: () => "sandbox" }));

const { quoteEventTicketCheckout } = await import("@/lib/billing/eventTicketQuote.functions");
const { createCheckoutOrder } = await import("@/lib/billing/checkout.functions");

let chain: SupabaseFromStub;
let rpcCalls: { fn: string; args: Record<string, unknown> }[];
let rpcResponses: Map<string, unknown>;

function client() {
  return {
    from: (table: string) => chain.from(table),
    rpc: (fn: string, args: Record<string, unknown> = {}) => {
      rpcCalls.push({ fn, args });
      const planned = rpcResponses.get(fn);
      const result = typeof planned === "function" ? planned(args) : planned;
      return Promise.resolve(result ?? fail(`test: brak odpowiedzi RPC "${fn}"`));
    },
  };
}

function context() {
  return { supabase: client(), userId: "user-lead", claims: { email: "lead@example.org" } };
}

function fixedCode(cents: number) {
  return (args: Record<string, unknown>) => {
    const amount = Number(args._amount_cents);
    const discount = Math.min(cents, amount);
    return ok([
      {
        ok: true,
        error: null,
        coupon_id: COUPON_ID,
        discount_cents: discount,
        final_cents: amount - discount,
        label: "Kod",
        discount_kind: "fixed",
        discount_percent: null,
      },
    ]);
  };
}

function quoteInput(over: Record<string, unknown> = {}) {
  return {
    event_id: EVENT_ID,
    ticket_type_id: TICKET_ID,
    registration_id: REGISTRATION_ID,
    ...over,
  };
}

beforeEach(() => {
  chain = supabaseFromStub();
  rpcCalls = [];
  rpcResponses = new Map();
  chain.setResponse("payment_orders", ok({ id: "order-1", tenant_id: "tenant-alfa" }));
  rpcResponses.set(
    "event_registration_payment_context",
    ok({ ok: true, event_id: EVENT_ID, ticket_type_id: TICKET_ID }),
  );
  rpcResponses.set(
    "event_ticket_checkout_quote",
    ok({
      event_id: EVENT_ID,
      amount_cents: 10000,
      list_price_cents: 10000,
      currency: "PLN",
      name_pl: "Bilet",
      event_title_pl: "Kongres CEE",
      phase: null,
    }),
  );
  rpcResponses.set("my_ticket_allowance", ok(null));
  rpcResponses.set("event_ticket_public_options", ok({ tax_mode: "inclusive" }));
  rpcResponses.set("event_registration_group_seats", ok(3));
  rpcResponses.set("validate_event_ticket_coupon", fixedCode(2000));
  rpcResponses.set("redeem_b2b_coupon", ok(true));
});

describe("quoteEventTicketCheckout - obudowa", () => {
  it("stoi za `requireSupabaseAuth`, jak kasa - wycena czyta pulę i zgłoszenie wołającego", () => {
    expect(serverFnMiddlewareNames(quoteEventTicketCheckout)).toEqual(["requireSupabaseAuth"]);
  });

  it("jest ODCZYTEM (GET) - niczego nie zapisuje", () => {
    expect(asServerFn(quoteEventTicketCheckout).method).toBe("GET");
  });

  it("walidator odrzuca identyfikatory spoza UUID i za długi kod", () => {
    expect(() =>
      validateServerFnInput(quoteEventTicketCheckout, quoteInput({ event_id: "nie-uuid" })),
    ).toThrow(ZodError);
    expect(() =>
      validateServerFnInput(quoteEventTicketCheckout, quoteInput({ coupon_code: "X".repeat(65) })),
    ).toThrow(ZodError);
    expect(() => validateServerFnInput(quoteEventTicketCheckout, undefined)).toThrow(ZodError);
  });

  it("zgłoszenie jest opcjonalne - bez niego jedno miejsce i żadnego pytania o grupę", async () => {
    const quote = await callServerFn<{ seats: number; totalCents: number }>(
      quoteEventTicketCheckout,
      { data: quoteInput({ registration_id: undefined }), context: context() },
    );

    expect(quote).toMatchObject({ seats: 1, totalCents: 10000 });
    expect(rpcCalls.map((c) => c.fn)).not.toContain("event_registration_group_seats");
    expect(rpcCalls.map((c) => c.fn)).not.toContain("event_registration_payment_context");
  });

  it("kod dostępu i kod rabatowy jadą do tej samej wyceny, co w kasie", async () => {
    await callServerFn(quoteEventTicketCheckout, {
      data: quoteInput({ access_code: "ZAPROSZENIE-1", coupon_code: " minus20 " }),
      context: context(),
    });

    expect(rpcCalls.find((c) => c.fn === "event_ticket_checkout_quote")?.args).toMatchObject({
      p_access_code: "ZAPROSZENIE-1",
    });
    expect(rpcCalls.find((c) => c.fn === "validate_event_ticket_coupon")?.args).toMatchObject({
      _code: "MINUS20",
    });
  });
});

describe("quoteEventTicketCheckout - ta sama liczba co kasa, bez skutku", () => {
  it("3 miejsca × 100 zł, kod -20 zł: podgląd = kasa, a podgląd niczego nie rezerwuje", async () => {
    const quote = await callServerFn<{
      seats: number;
      unitCents: number;
      discountCents: number;
      totalCents: number;
      coupon: { perSeatCents: number | null } | null;
    }>(quoteEventTicketCheckout, {
      data: quoteInput({ coupon_code: "MINUS20" }),
      context: context(),
    });

    expect(quote).toMatchObject({
      seats: 3,
      unitCents: 10000,
      subtotalCents: 30000,
      discountCents: 6000,
      totalCents: 24000,
      currency: "PLN",
      couponError: null,
      coupon: { code: "MINUS20", kind: "fixed", percent: null, perSeatCents: 2000 },
    });
    expect(rpcCalls.map((c) => c.fn)).not.toContain("redeem_b2b_coupon");
    expect(chain.chainsFor("payment_orders")).toHaveLength(0);

    // Ta sama baza, ta sama prośba - teraz przez kasę.
    const { callServerFn: callSpec } = await import("@/test/serverFn");
    await callSpec(
      createCheckoutOrder,
      {
        kind: "one_time",
        event_id: EVENT_ID,
        ticket_type_id: TICKET_ID,
        registration_id: REGISTRATION_ID,
        coupon_code: "MINUS20",
        success_path: "/events/kongres-cee",
        cancel_path: "/events/kongres-cee",
      },
      context(),
    );
    const order = chain.lastChain("payment_orders")?.argsOf("insert")?.[0] as {
      amount_cents: number;
      metadata: { quantity: number; coupon_discount_cents: number };
    };
    expect(order.amount_cents).toBe(quote.totalCents);
    expect(order.metadata.quantity).toBe(quote.seats);
    expect(order.metadata.coupon_discount_cents).toBe(quote.discountCents);
    // Rezerwacja użycia należy do KASY - dopiero ona ją robi.
    expect(rpcCalls.filter((c) => c.fn === "redeem_b2b_coupon")).toHaveLength(1);
  });

  it("odmowa kodu nie jest błędem podglądu: suma bez kodu i powód odmowy", async () => {
    rpcResponses.set(
      "validate_event_ticket_coupon",
      ok([{ ok: false, error: "no_discount", coupon_id: COUPON_ID }]),
    );

    const quote = await callServerFn(quoteEventTicketCheckout, {
      data: quoteInput({ coupon_code: "ODSLON" }),
      context: context(),
    });

    expect(quote).toMatchObject({
      seats: 3,
      coupon: null,
      discountCents: 0,
      totalCents: 30000,
      couponError: "no_discount",
    });
  });

  it("odmowa zgłoszenia RZUCA - tak samo jak rzuciłaby kasa", async () => {
    rpcResponses.set("event_registration_group_seats", fail("timeout"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      callServerFn(quoteEventTicketCheckout, { data: quoteInput(), context: context() }),
    ).rejects.toThrow("registration_not_payable:seats_unavailable");
    logged.mockRestore();
  });
});
