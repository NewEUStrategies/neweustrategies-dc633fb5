// Ponowna wysyłka powiadomień: odtwarza wynik ze stanu bazy i NIE zmienia
// niczego poza wysłaniem wiadomości.
import { beforeEach, describe, expect, it, vi } from "vitest";

const notify = vi.fn(async () => ({ emailed: true, smsSent: false, promotedNotified: 0 }));

const rows: Record<string, unknown> = {};

function table(name: string) {
  return {
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({ data: rows[name] ?? null, error: null }),
      }),
    }),
  };
}

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (name: string) => table(name) },
}));

vi.mock("@/lib/events/registrationOutcomeNotify.server", () => ({
  notifyTicketOutcome: (...args: unknown[]) => notify(...(args as [])),
}));

const REG = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  notify.mockClear();
  rows["event_registrations"] = {
    id: REG,
    tenant_id: "t1",
    event_id: "e1",
    person_id: "p1",
    payment_status: "paid",
    payment_order_id: "o1",
  };
  rows["event_people"] = { user_id: "u1", email: "a@b.pl", phone: null, first_name: "Ala" };
  rows["events"] = { slug: "kongres", title_pl: "Kongres", title_en: "Congress" };
  rows["payment_orders"] = { amount_cents: 10000, refunded_amount_cents: 0, currency: "PLN" };
});

describe("resendTicketOutcome", () => {
  it("odtwarza wynik 'paid' i wysyła powiadomienie z omięciem bramki duplikatów", async () => {
    const { resendTicketOutcome } = await import("@/lib/events/outcomeResend.server");
    const result = await resendTicketOutcome(REG);

    expect(result.outcome).toBe("paid");
    expect(result.emailed).toBe(true);
    const [payload, options] = notify.mock.calls[0] as unknown as [
      Record<string, unknown>,
      { idempotencySuffix?: string },
    ];
    expect(payload["registration_id"]).toBe(REG);
    expect(payload["waitlist"]).toBeNull();
    expect(options.idempotencySuffix).toMatch(/^resend:/);
  });

  it("rozpoznaje zwrot częściowy po kwocie, nie po statusie", async () => {
    rows["payment_orders"] = { amount_cents: 10000, refunded_amount_cents: 3000, currency: "PLN" };
    const { resendTicketOutcome } = await import("@/lib/events/outcomeResend.server");
    expect((await resendTicketOutcome(REG)).outcome).toBe("partial_refund");
  });

  it("pełny zwrot kwoty daje wynik 'refunded'", async () => {
    rows["payment_orders"] = { amount_cents: 10000, refunded_amount_cents: 10000, currency: "PLN" };
    const { resendTicketOutcome } = await import("@/lib/events/outcomeResend.server");
    expect((await resendTicketOutcome(REG)).outcome).toBe("refunded");
  });

  it("odmawia dla nieistniejącego zgłoszenia", async () => {
    rows["event_registrations"] = null;
    const { resendTicketOutcome } = await import("@/lib/events/outcomeResend.server");
    await expect(resendTicketOutcome(REG)).rejects.toThrow(/nie istnieje/i);
  });
});
