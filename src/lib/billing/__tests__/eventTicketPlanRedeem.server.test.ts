// Odbiór biletu z puli planu dla pojedynczego zgłoszenia - kolejność
// wywołań, odmowy i bilet z kodem QR.
//
// Wycena biegnie PRAWDZIWĄ funkcją (`priceEventTicket`) na atrapie klienta -
// dokładnie tak, jak w teście wyceny: odbiór z planu ma odmówić tym samym
// kodem, którym odmówiłaby kasa, i nie wołać bazy o zajęcie puli, gdy wycena
// już wie, że pula tego zgłoszenia nie pokryje.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fail, ok } from "@/test/supabaseChain";

const EVENT_ID = "bbbbbbbb-0000-4000-8000-000000000002";
const TICKET_ID = "cccccccc-0000-4000-8000-000000000003";
const REGISTRATION_ID = "dddddddd-0000-4000-8000-000000000004";

const plan = vi.hoisted(() => ({ allowance: {} as Record<string, unknown> }));
const issued = vi.hoisted(() => ({ ids: [] as string[], sent: 1 }));

vi.mock("@/lib/events/ticketAllowance.server", async () => {
  const { EMPTY_TICKET_ALLOWANCE, ticketAmountCents } =
    await import("@/lib/events/ticketAllowance");
  return {
    ticketPriceForCaller: async (_client: unknown, amountCents: number) => {
      const allowance = { ...EMPTY_TICKET_ALLOWANCE, ...plan.allowance };
      return { amountCents: ticketAmountCents(amountCents, allowance), allowance };
    },
  };
});

vi.mock("@/lib/events/ticketCodeNotify.server", () => ({
  issueAndSendTicketCodes: async (id: string) => {
    issued.ids.push(id);
    return issued.sent;
  },
}));

const { redeemPlanTicket, REDEEM_REFUSALS } =
  await import("@/lib/billing/eventTicketPlanRedeem.server");
const { ticketCheckoutRefusal } = await import("@/lib/events/admissionApi");

type Client = Parameters<typeof redeemPlanTicket>[0];

let rpcCalls: { fn: string; args: Record<string, unknown> }[];
let rpcResponses: Map<string, unknown>;

function client(): Client {
  return {
    rpc: (fn: string, args: Record<string, unknown> = {}) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve(rpcResponses.get(fn) ?? fail(`test: brak odpowiedzi RPC "${fn}"`));
    },
  } as never;
}

const input = (over: Record<string, unknown> = {}) => ({
  eventId: EVENT_ID,
  ticketTypeId: TICKET_ID,
  registrationId: REGISTRATION_ID,
  ...over,
});

beforeEach(() => {
  plan.allowance = { granted: 1, remaining: 1 };
  issued.ids = [];
  issued.sent = 1;
  rpcCalls = [];
  rpcResponses = new Map();
  rpcResponses.set(
    "event_registration_payment_context",
    ok({ ok: true, event_id: EVENT_ID, ticket_type_id: TICKET_ID, holder_is_caller: true }),
  );
  rpcResponses.set(
    "event_ticket_checkout_quote",
    ok({ event_id: EVENT_ID, amount_cents: 10000, currency: "EUR", name_pl: "Bilet" }),
  );
  rpcResponses.set("event_ticket_public_options", ok({ tax_mode: "inclusive" }));
  rpcResponses.set("event_registration_group_seats", ok(1));
  rpcResponses.set(
    "event_registration_claim_plan_seat",
    ok({ claimed: true, reused: false, dry_run: true }),
  );
  rpcResponses.set(
    "event_registration_redeem_plan_ticket",
    ok({ ok: true, registration_id: REGISTRATION_ID, status: "approved", reused: false }),
  );
});

describe("redeemPlanTicket - odbiór biletu z puli", () => {
  it("wycena na sucho, potem baza, potem bilet z kodem QR - w tej kolejności", async () => {
    const result = await redeemPlanTicket(client(), input({ accessCode: "VIP" }));

    expect(result).toEqual({ ok: true, registrationId: REGISTRATION_ID, ticketsSent: 1 });
    expect(rpcCalls.map((c) => c.fn)).toEqual([
      "event_registration_payment_context",
      "event_ticket_checkout_quote",
      "event_ticket_public_options",
      "event_registration_group_seats",
      "event_registration_claim_plan_seat",
      "event_registration_redeem_plan_ticket",
    ]);
    // Wycena NIGDY nie zajmuje puli - robi to baza razem z przyjęciem.
    expect(rpcCalls[4].args).toEqual({ p_registration_id: REGISTRATION_ID, p_dry_run: true });
    expect(rpcCalls[1].args).toMatchObject({ p_access_code: "VIP" });
    expect(rpcCalls[5].args).toEqual({ p_registration_id: REGISTRATION_ID });
    expect(issued.ids).toEqual([REGISTRATION_ID]);
  });

  it("nieudana wysyłka biletu nie cofa odbioru - cron domknie", async () => {
    issued.sent = 0;

    expect(await redeemPlanTicket(client(), input())).toEqual({
      ok: true,
      registrationId: REGISTRATION_ID,
      ticketsSent: 0,
    });
  });

  it("wycena z kwotą do zapłaty (pula nie pokrywa) - odmowa bez pytania bazy o odbiór", async () => {
    rpcResponses.set(
      "event_registration_claim_plan_seat",
      ok({ claimed: false, reason: "pool_empty" }),
    );

    expect(await redeemPlanTicket(client(), input())).toEqual({
      ok: false,
      error: "plan_ticket_unavailable",
    });
    expect(rpcCalls.map((c) => c.fn)).not.toContain("event_registration_redeem_plan_ticket");
    expect(issued.ids).toEqual([]);
  });

  it("odmowa wyceny rzuca kodem kasy - ekran mapuje ją tym samym słownikiem", async () => {
    rpcResponses.set(
      "event_registration_payment_context",
      ok({ ok: false, reason: "already_settled" }),
    );

    await expect(redeemPlanTicket(client(), input())).rejects.toThrow(
      "registration_not_payable:already_settled",
    );
    expect(issued.ids).toEqual([]);
  });

  it("błąd RPC odbioru rzuca komunikatem bazy", async () => {
    rpcResponses.set("event_registration_redeem_plan_ticket", fail("deadlock detected"));

    await expect(redeemPlanTicket(client(), input())).rejects.toThrow("deadlock detected");
    expect(issued.ids).toEqual([]);
  });

  it.each(Object.entries(REDEEM_REFUSALS))(
    "odmowa bazy `%s` wraca jako `%s`",
    async (reason, error) => {
      rpcResponses.set("event_registration_redeem_plan_ticket", ok({ ok: false, reason }));

      expect(await redeemPlanTicket(client(), input())).toEqual({ ok: false, error });
      expect(issued.ids).toEqual([]);
    },
  );

  it("każdy kod odmowy odbioru ma zdanie w słowniku kasy (nie `unknown`)", () => {
    for (const error of Object.values(REDEEM_REFUSALS)) {
      expect(ticketCheckoutRefusal(error), error).not.toBe("unknown");
    }
  });

  it.each([
    ["pusta odpowiedź", null],
    ["odmowa bez powodu", { ok: false }],
    ["nieznany powód", { ok: false, reason: "moon_phase" }],
  ])("%s to `unknown`, a nie zgadywanie", async (_label, payload) => {
    rpcResponses.set("event_registration_redeem_plan_ticket", ok(payload));

    expect(await redeemPlanTicket(client(), input())).toEqual({ ok: false, error: "unknown" });
  });
});
