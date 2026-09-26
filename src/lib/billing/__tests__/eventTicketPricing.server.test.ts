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

/**
 * Pula planu wołającego (kształt `my_ticket_allowance`); domyślnie brak planu.
 * Cenę liczy PRAWDZIWA reguła `ticketAmountCents` - atrapa podmienia tylko RPC.
 */
const plan = vi.hoisted(() => ({
  allowance: {} as Record<string, unknown>,
  calls: 0,
}));

vi.mock("@/lib/events/ticketAllowance.server", async () => {
  const { EMPTY_TICKET_ALLOWANCE, ticketAmountCents } =
    await import("@/lib/events/ticketAllowance");
  return {
    ticketPriceForCaller: async (_client: unknown, amountCents: number) => {
      plan.calls += 1;
      const allowance = { ...EMPTY_TICKET_ALLOWANCE, ...plan.allowance };
      return { amountCents: ticketAmountCents(amountCents, allowance), allowance };
    },
  };
});

const {
  applyEventTicketCoupon,
  priceEventTicket,
  quoteEventTicketOrder,
  MIN_TICKET_TOTAL_CENTS,
  SEATS_UNAVAILABLE,
} = await import("@/lib/billing/eventTicketPricing.server");

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
  plan.allowance = {};
  plan.calls = 0;
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
      leadUnitCents: 10000,
      planBenefit: null,
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

// ---------------------------------------------------------------------------
// BENEFIT PLANU MA JEDNO MIEJSCE: CZŁONKA (20260926140000). Do tej naprawy
// cena członka (zniżka albo bilet z puli) mnożyła się przez wszystkie miejsca
// zamówienia grupowego.
// ---------------------------------------------------------------------------
describe("benefit planu - tylko na miejscu wołającego", () => {
  const REGISTRATION_ID = "dddddddd-0000-4000-8000-000000000004";
  /** Stawka ulgowa: -50%, bez puli biletów. */
  const HALF = { discountPct: 50 };
  /** Członek z jednym wolnym biletem w puli. */
  const POOL = { granted: 1, remaining: 1 };

  function group(seats: number, context: Record<string, unknown> = {}): void {
    rpcResponses.set(
      "event_registration_payment_context",
      ok({
        ok: true,
        event_id: EVENT_ID,
        ticket_type_id: TICKET_ID,
        holder_is_caller: true,
        ...context,
      }),
    );
    rpcResponses.set("event_registration_group_seats", ok(seats));
  }

  const input = (over: Record<string, unknown> = {}) => ({
    eventId: EVENT_ID,
    ticketTypeId: TICKET_ID,
    registrationId: REGISTRATION_ID,
    ...over,
  });

  const claimArgs = () =>
    rpcCalls.filter((c) => c.fn === "event_registration_claim_plan_seat").map((c) => c.args);

  it("zniżka stawki ulgowej schodzi z miejsca członka, goście płacą cennik", async () => {
    plan.allowance = HALF;
    group(3);

    const quote = await quoteEventTicketOrder(client(), input());

    expect(quote).toMatchObject({
      seats: 3,
      unitCents: 10000,
      leadUnitCents: 5000,
      planBenefit: "discount",
      subtotalCents: 25000,
      totalCents: 25000,
    });
    expect(claimArgs()).toEqual([]);
  });

  it("bilet z puli: podgląd pyta bazę NA SUCHO i liczy samych gości", async () => {
    plan.allowance = POOL;
    group(3);
    rpcResponses.set(
      "event_registration_claim_plan_seat",
      ok({ claimed: true, reused: false, dry_run: true }),
    );

    const quote = await quoteEventTicketOrder(client(), input());

    expect(quote).toMatchObject({ leadUnitCents: 0, planBenefit: "included", totalCents: 20000 });
    expect(claimArgs()).toEqual([{ p_registration_id: REGISTRATION_ID, p_dry_run: true }]);
  });

  it("ponowna kasa: bilet ZUŻYTY dla tego wydarzenia (pula pusta) nadal pokrywa miejsce prowadzącego", async () => {
    plan.allowance = { granted: 1, remaining: 0 };
    group(3);
    rpcResponses.set("event_registration_claim_plan_seat", ok({ claimed: true, reused: true }));

    const price = await priceEventTicket(client(), input({ claimPlanSeat: true }));

    expect(price).toMatchObject({ leadUnitCents: 0, planBenefit: "included", amountCents: 20000 });
    expect(claimArgs()).toEqual([{ p_registration_id: REGISTRATION_ID, p_dry_run: false }]);
  });

  it("zgłoszenie GOŚCIA opłacane przez prowadzącego nie dostaje jego benefitu", async () => {
    plan.allowance = HALF;
    group(1, { holder_is_caller: false });

    const price = await priceEventTicket(client(), input());

    expect(price).toMatchObject({ leadUnitCents: 10000, planBenefit: null, amountCents: 10000 });
    expect(plan.calls).toBe(0);
  });

  it("baza bez pola `holder_is_caller` (sprzed migracji) nie odbiera benefitu członkowi", async () => {
    plan.allowance = HALF;
    group(2, { holder_is_caller: undefined });

    const price = await priceEventTicket(client(), input());

    expect(price).toMatchObject({
      leadUnitCents: 5000,
      planBenefit: "discount",
      amountCents: 15000,
    });
  });

  it("pojedyncze miejsce z puli - nie ma czego obciążyć, także ze zgłoszeniem", async () => {
    plan.allowance = POOL;
    await expect(priceEventTicket(client(), input({ registrationId: null }))).rejects.toThrow(
      "ticket_included_in_plan",
    );

    group(1);
    await expect(priceEventTicket(client(), input({ claimPlanSeat: true }))).rejects.toThrow(
      "ticket_included_in_plan",
    );
    expect(claimArgs()).toEqual([]);
  });

  it("zniżka 100% bez puli to zniżka, a nie bilet z puli - kasa nie sięga do puli", async () => {
    plan.allowance = { discountPct: 100 };
    group(3);

    const price = await priceEventTicket(client(), input({ claimPlanSeat: true }));

    expect(price).toMatchObject({ leadUnitCents: 0, planBenefit: "discount", amountCents: 20000 });
    expect(claimArgs()).toEqual([]);
  });

  it("bilet za zero złotych z gośćmi to nadal odmowa, a nie benefit", async () => {
    plan.allowance = POOL;
    rpcResponses.set(
      "event_ticket_checkout_quote",
      ok({ event_id: EVENT_ID, amount_cents: 0, currency: "PLN" }),
    );
    group(3);

    await expect(priceEventTicket(client(), input())).rejects.toThrow("ticket_included_in_plan");
    expect(claimArgs()).toEqual([]);
  });

  it("kasa zajmuje bilet z puli dla miejsca prowadzącego - zamówienie obejmuje samych gości", async () => {
    plan.allowance = POOL;
    group(3);
    rpcResponses.set("event_registration_claim_plan_seat", ok({ claimed: true, reused: false }));

    const price = await priceEventTicket(client(), input({ claimPlanSeat: true }));

    expect(price).toMatchObject({ leadUnitCents: 0, planBenefit: "included", amountCents: 20000 });
    expect(rpcCalls.map((c) => c.fn)).toEqual([
      "event_registration_payment_context",
      "event_ticket_checkout_quote",
      "event_ticket_public_options",
      "event_registration_group_seats",
      "event_registration_claim_plan_seat",
    ]);
    expect(claimArgs()).toEqual([{ p_registration_id: REGISTRATION_ID, p_dry_run: false }]);
  });

  it.each([
    ["pula pusta", ok({ claimed: false, reason: "pool_empty" })],
    ["pusta odpowiedź", ok(null)],
    ["awaria RPC", fail("deadlock detected")],
  ])("%s: prowadzący płaci jak gość, zakup gości idzie dalej", async (_label, response) => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    plan.allowance = POOL;
    group(3);
    rpcResponses.set("event_registration_claim_plan_seat", response);

    const price = await priceEventTicket(client(), input({ claimPlanSeat: true }));

    expect(price).toMatchObject({ leadUnitCents: 10000, planBenefit: null, amountCents: 30000 });
    logged.mockRestore();
  });

  it("pula odmawia członkowi, który ma TEŻ zniżkę - prowadzący płaci cenę ze zniżką, nie pełną", async () => {
    plan.allowance = { granted: 1, remaining: 1, discountPct: 50 };
    group(2);
    rpcResponses.set(
      "event_registration_claim_plan_seat",
      ok({ claimed: false, reason: "pool_empty" }),
    );

    const price = await priceEventTicket(client(), input({ claimPlanSeat: true }));

    expect(price).toMatchObject({
      leadUnitCents: 5000,
      planBenefit: "discount",
      amountCents: 15000,
    });
  });

  it("kod kwotowy przy bilecie z puli schodzi z samych gości - bez kwoty „na miejsce”", async () => {
    plan.allowance = POOL;
    group(3);
    rpcResponses.set(
      "event_registration_claim_plan_seat",
      ok({ claimed: true, reused: false, dry_run: true }),
    );
    rpcResponses.set(
      "validate_event_ticket_coupon",
      ok([
        {
          ok: true,
          coupon_id: COUPON_ID,
          discount_cents: 3000,
          final_cents: 17000,
          discount_kind: "fixed",
          discount_percent: null,
        },
      ]),
    );

    const quote = await quoteEventTicketOrder(client(), input({ couponCode: "minus30" }));

    expect(quote).toMatchObject({
      subtotalCents: 20000,
      discountCents: 6000,
      totalCents: 14000,
      coupon: { code: "MINUS30", kind: "fixed", perSeatCents: null },
    });
  });
});
