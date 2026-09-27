// Wrapper serwerowy odbioru biletu z planu - walidacja wejścia, middleware
// i przekazanie identyfikatorów. Logikę sprawdza `eventTicketPlanRedeem.server`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import {
  callServerFn,
  serverFnMiddlewareNames,
  validateServerFnInput,
} from "@/test/serverFnHarness";

const EVENT_ID = "bbbbbbbb-0000-4000-8000-000000000002";
const TICKET_ID = "cccccccc-0000-4000-8000-000000000003";
const REGISTRATION_ID = "dddddddd-0000-4000-8000-000000000004";

const redeem = vi.hoisted(() => ({ calls: [] as unknown[][] }));

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFnHarness")).serverFnStubModule(),
);
vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: { name: "requireSupabaseAuth" },
}));
vi.mock("@/lib/billing/eventTicketPlanRedeem.server", () => ({
  redeemPlanTicket: async (...args: unknown[]) => {
    redeem.calls.push(args);
    return { ok: true, registrationId: REGISTRATION_ID, ticketsSent: 1 };
  },
}));

const { redeemEventTicketFromPlan } = await import("@/lib/billing/eventTicketPlanRedeem.functions");

beforeEach(() => {
  redeem.calls = [];
});

describe("redeemEventTicketFromPlan", () => {
  it("stoi za requireSupabaseAuth - pula liczy się po auth.uid()", () => {
    expect(serverFnMiddlewareNames(redeemEventTicketFromPlan)).toEqual(["requireSupabaseAuth"]);
  });

  it("przekazuje identyfikatory i kod dostępu klientem z sesją", async () => {
    const supabase = { tag: "session-client" };
    const result = await callServerFn(redeemEventTicketFromPlan, {
      data: {
        event_id: EVENT_ID,
        ticket_type_id: TICKET_ID,
        registration_id: REGISTRATION_ID,
        access_code: " VIP ",
      },
      context: { supabase } as never,
    });

    expect(result).toEqual({ ok: true, registrationId: REGISTRATION_ID, ticketsSent: 1 });
    expect(redeem.calls).toEqual([
      [
        supabase,
        {
          eventId: EVENT_ID,
          ticketTypeId: TICKET_ID,
          registrationId: REGISTRATION_ID,
          accessCode: "VIP",
        },
      ],
    ]);
  });

  it("bez zgłoszenia nie ma odbioru - walidator odrzuca", () => {
    expect(() =>
      validateServerFnInput(redeemEventTicketFromPlan, {
        event_id: EVENT_ID,
        ticket_type_id: TICKET_ID,
      }),
    ).toThrow(ZodError);
  });
});
