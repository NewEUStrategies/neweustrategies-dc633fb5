// Wycena wejściówki - gałęzie, których nie widać z poziomu kasy.
//
// Kasa (`checkoutGroupCoupon`, `checkoutOrderPricing`, `checkoutStripeSession`,
// `checkoutRegistrationBinding`) przeprowadza przez ten moduł szczęśliwe
// ścieżki i odmowy wejściowe. Tu zostają kształty odpowiedzi bazy, które kasa
// oglądałaby tylko jako „coś poszło nie tak": pusta lista werdyktów kodu,
// werdykt bez powodu, kod procentowy bez procentu, błąd RPC kodu, kod z samych
// spacji w podglądzie. Każdy z nich to pytanie „czy zła odpowiedź bazy nie
// staje się rabatem".
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fail, ok } from "@/test/supabaseChain";

const EVENT_ID = "bbbbbbbb-0000-4000-8000-000000000002";
const TICKET_ID = "cccccccc-0000-4000-8000-000000000003";
const COUPON_ID = "ffffffff-0000-4000-8000-00000000000c";

vi.mock("@/lib/events/ticketAllowance.server", () => ({
  ticketPriceForCaller: async (_client: unknown, amountCents: number) => ({
    amountCents,
    allowance: null,
  }),
}));

const { applyEventTicketCoupon, quoteEventTicketOrder, MIN_TICKET_TOTAL_CENTS, SEATS_UNAVAILABLE } =
  await import("@/lib/billing/eventTicketPricing.server");

type Client = Parameters<typeof applyEventTicketCoupon>[0];

let rpcCalls: { fn: string; args: Record<string, unknown> }[];
let rpcResponses: Map<string, unknown>;

function client(): Client {
  const stub = {
    rpc: (fn: string, args: Record<string, unknown> = {}) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve(rpcResponses.get(fn) ?? fail(`test: brak odpowiedzi RPC "${fn}"`));
    },
  };
  return stub as never;
}

function couponInput(over: Record<string, unknown> = {}) {
  return {
    code: "KOD",
    eventId: EVENT_ID,
    ticketTypeId: TICKET_ID,
    amountCents: 30000,
    currency: "PLN",
    seats: 3,
    ...over,
  };
}

beforeEach(() => {
  rpcCalls = [];
  rpcResponses = new Map();
  rpcResponses.set(
    "event_ticket_checkout_quote",
    ok({
      event_id: EVENT_ID,
      amount_cents: 10000,
      list_price_cents: 12000,
      currency: "EUR",
      name_en: "Ticket",
      event_title_en: "CEE Congress",
      phase: { source: "last_minute" },
    }),
  );
  rpcResponses.set("event_ticket_public_options", ok({ tax_mode: "exclusive" }));
});

describe("applyEventTicketCoupon - zła odpowiedź bazy NIE jest rabatem", () => {
  it("pusta odpowiedź (`null`) to odmowa `not_found`", async () => {
    rpcResponses.set("validate_event_ticket_coupon", ok(null));

    expect(await applyEventTicketCoupon(client(), couponInput())).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("odmowa bez powodu schodzi na `not_found`, a nie na pusty napis", async () => {
    rpcResponses.set("validate_event_ticket_coupon", ok([{ ok: false, error: null }]));

    expect(await applyEventTicketCoupon(client(), couponInput())).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("BŁĄD walidacji kodu jest zgłaszany, a nie zamieniany na „kod nieważny”", async () => {
    rpcResponses.set("validate_event_ticket_coupon", fail("permission denied"));

    await expect(applyEventTicketCoupon(client(), couponInput())).rejects.toMatchObject({
      message: "permission denied",
    });
  });

  it("kod procentowy bez procentu w odpowiedzi nie udaje procentu", async () => {
    rpcResponses.set(
      "validate_event_ticket_coupon",
      ok([
        {
          ok: true,
          coupon_id: COUPON_ID,
          discount_cents: 3000,
          final_cents: 27000,
          discount_kind: "percent",
          discount_percent: null,
        },
      ]),
    );

    expect(await applyEventTicketCoupon(client(), couponInput())).toEqual({
      ok: true,
      couponId: COUPON_ID,
      kind: "percent",
      percent: null,
      discountCents: 3000,
      finalCents: 27000,
      perSeatCents: null,
    });
  });

  it("nieznany rodzaj kodu jest liczony jak procent - bez rozbicia na miejsca", async () => {
    rpcResponses.set(
      "validate_event_ticket_coupon",
      ok([
        {
          ok: true,
          coupon_id: COUPON_ID,
          discount_cents: 2000,
          final_cents: 28000,
          discount_kind: "amount",
          discount_percent: 7,
        },
      ]),
    );

    expect(await applyEventTicketCoupon(client(), couponInput())).toMatchObject({
      kind: "percent",
      percent: 7,
      discountCents: 2000,
      finalCents: 28000,
    });
  });

  it("kwota końcowa równa minimum przechodzi, o grosz niżej - odmowa", async () => {
    rpcResponses.set(
      "validate_event_ticket_coupon",
      ok([
        {
          ok: true,
          coupon_id: COUPON_ID,
          discount_cents: 30000 - MIN_TICKET_TOTAL_CENTS,
          final_cents: MIN_TICKET_TOTAL_CENTS,
          discount_kind: "percent",
          discount_percent: 99,
        },
      ]),
    );
    expect((await applyEventTicketCoupon(client(), couponInput())).ok).toBe(true);

    rpcResponses.set(
      "validate_event_ticket_coupon",
      ok([
        {
          ok: true,
          coupon_id: COUPON_ID,
          discount_cents: 30000 - MIN_TICKET_TOTAL_CENTS + 1,
          final_cents: MIN_TICKET_TOTAL_CENTS - 1,
          discount_kind: "percent",
          discount_percent: 99,
        },
      ]),
    );
    expect(await applyEventTicketCoupon(client(), couponInput())).toEqual({
      ok: false,
      error: "final_amount_too_low",
    });
  });
});

describe("quoteEventTicketOrder - podgląd bez zgłoszenia", () => {
  it("bez kodu: suma, waluta i brak kodu - bez pytania o kod i o grupę", async () => {
    const quote = await quoteEventTicketOrder(client(), {
      eventId: EVENT_ID,
      ticketTypeId: TICKET_ID,
      registrationId: null,
    });

    expect(quote).toEqual({
      seats: 1,
      unitCents: 10000,
      subtotalCents: 10000,
      currency: "EUR",
      coupon: null,
      discountCents: 0,
      totalCents: 10000,
      couponError: null,
      // Bilet z podatkiem DOLICZANYM - ekran dopisuje „+ podatek" do sumy.
      taxMode: "exclusive",
    });
    expect(rpcCalls.map((c) => c.fn)).toEqual([
      "event_ticket_checkout_quote",
      "event_ticket_public_options",
    ]);
  });

  it("bilet bez trybu podatku: `taxMode` null, a nie zgadywany tryb", async () => {
    rpcResponses.set("event_ticket_public_options", ok(null));

    const quote = await quoteEventTicketOrder(client(), {
      eventId: EVENT_ID,
      ticketTypeId: TICKET_ID,
      registrationId: null,
    });

    expect(quote.taxMode).toBeNull();
  });

  it("kod z samych spacji jest brakiem kodu, a nie kodem `not_found`", async () => {
    const quote = await quoteEventTicketOrder(client(), {
      eventId: EVENT_ID,
      ticketTypeId: TICKET_ID,
      registrationId: null,
      couponCode: "   ",
    });

    expect(quote.couponError).toBeNull();
    expect(rpcCalls.map((c) => c.fn)).not.toContain("validate_event_ticket_coupon");
  });

  it("kod procentowy: rabat od sumy, procent w odpowiedzi, bez kwoty na miejsce", async () => {
    rpcResponses.set(
      "validate_event_ticket_coupon",
      ok([
        {
          ok: true,
          coupon_id: COUPON_ID,
          discount_cents: 1000,
          final_cents: 9000,
          discount_kind: "percent",
          discount_percent: 10,
        },
      ]),
    );

    const quote = await quoteEventTicketOrder(client(), {
      eventId: EVENT_ID,
      ticketTypeId: TICKET_ID,
      registrationId: null,
      couponCode: "proc10",
    });

    expect(quote).toMatchObject({
      coupon: { code: "PROC10", kind: "percent", percent: 10, perSeatCents: null },
      discountCents: 1000,
      totalCents: 9000,
    });
  });

  it("stała odmowy liczby miejsc to nazwa, którą ekran mapuje na zdanie", () => {
    expect(SEATS_UNAVAILABLE).toBe("registration_not_payable:seats_unavailable");
  });
});
