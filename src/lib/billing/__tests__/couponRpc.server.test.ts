// Warstwa kodu rabatowego (`couponRpc.server.ts`): walidacja i rezerwacja
// użycia kodu rolą serwisową z JAWNĄ tożsamością.
//
// CO PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. NAJEMCA Z POWIETRZA - bez hosta funkcja serwerowa szukałaby kodu
//      w najemcy `null`; tu to awaria, nie orzeczenie o kodzie, i baza nie
//      jest w ogóle pytana.
//   2. SUROWY ADRES W BAZIE - do `rate_limits` trafia wyłącznie solony skrót.
//   3. ZŁE OKNO WDROŻENIA - stara ścieżka JWT kupującego wolno użyć tylko przy
//      braku funkcji (PGRST202/42883); odmowa uprawnień czy timeout to awaria.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  tenant: "aaaaaaaa-0000-4000-8000-00000000000a" as string | null,
  tenantThrows: false,
  admin: vi.fn(),
  user: vi.fn(),
}));

vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () =>
    new Request("https://kasa.example.org/checkout", {
      headers: { "cf-connecting-ip": "198.51.100.23", "x-forwarded-host": "kasa.example.org" },
    }),
}));
vi.mock("@/lib/server/tenant.server", () => ({
  resolveTenantIdForHost: async () => {
    if (h.tenantThrows) throw new Error("katalog najemców niedostępny");
    return h.tenant;
  },
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { rpc: (...args: unknown[]) => h.admin(...args) },
}));

const { redeemCouponForUser, validateEventTicketCouponForUser, validatePlanCouponForUser } =
  await import("@/lib/billing/couponRpc.server");

const USER = "dddddddd-0000-4000-8000-00000000000d";
const PLAN = "cccccccc-0000-4000-8000-00000000000c";
const userClient = { rpc: (...args: unknown[]) => h.user(...args) } as never;

const validation = {
  userId: USER,
  code: "PARTNER-CEE",
  planId: PLAN,
  amountCents: 4900,
  currency: "PLN",
};

const EVENT = "abababab-0000-4000-8000-0000000000ab";
const TICKET = "cdcdcdcd-0000-4000-8000-0000000000cd";

const eventValidation = {
  userId: USER,
  code: "PARTNER-EVENT",
  eventId: EVENT,
  ticketTypeId: TICKET,
  amountCents: 30000,
  currency: "PLN",
};

const redemption = {
  tenantId: "bbbbbbbb-0000-4000-8000-00000000000b",
  userId: USER,
  couponId: "eeeeeeee-0000-4000-8000-00000000000e",
  orderId: "ffffffff-0000-4000-8000-00000000000f",
  appliedCents: 1000,
  originalCents: 4900,
  currency: "PLN",
};

beforeEach(() => {
  h.tenant = "aaaaaaaa-0000-4000-8000-00000000000a";
  h.tenantThrows = false;
  h.admin.mockReset();
  h.user.mockReset();
  h.admin.mockResolvedValue({ data: { ok: true }, error: null });
  h.user.mockResolvedValue({ data: { ok: true }, error: null });
});

describe("validatePlanCouponForUser", () => {
  it("woła funkcję serwerową z najemcą hosta, kontem i solonym skrótem adresu", async () => {
    const result = await validatePlanCouponForUser(userClient, validation);

    expect(result).toEqual({ data: { ok: true }, error: null });
    expect(h.admin).toHaveBeenCalledWith("validate_b2b_coupon_for_user", {
      _tenant_id: "aaaaaaaa-0000-4000-8000-00000000000a",
      _user_id: USER,
      _probe_subject: expect.stringMatching(/^ip:[0-9a-f]{32}$/),
      _code: "PARTNER-CEE",
      _plan_id: PLAN,
      _amount_cents: 4900,
      _currency: "PLN",
    });
    expect(JSON.stringify(h.admin.mock.lastCall)).not.toContain("198.51.100.23");
    expect(h.user).not.toHaveBeenCalled();
  });

  it.each([
    ["host bez najemcy", () => (h.tenant = null)],
    ["awaria katalogu najemców", () => (h.tenantThrows = true)],
  ])("%s: awaria bez pytania bazy - to nie jest orzeczenie o kodzie", async (_label, arrange) => {
    arrange();
    const result = await validatePlanCouponForUser(userClient, validation);

    expect(result.data).toBeNull();
    expect(result.error?.message).toMatch(/^tenant_unresolved/);
    expect(h.admin).not.toHaveBeenCalled();
    expect(h.user).not.toHaveBeenCalled();
  });

  it.each(["PGRST202", "42883"])(
    "OKNO WDROŻENIA (%s): stara funkcja klientem kupującego, te same argumenty kodu",
    async (code) => {
      h.admin.mockResolvedValue({ data: null, error: { code, message: "no function" } });
      h.user.mockResolvedValue({ data: [{ ok: true }], error: null });

      const result = await validatePlanCouponForUser(userClient, validation);

      expect(result).toEqual({ data: [{ ok: true }], error: null });
      expect(h.user).toHaveBeenCalledWith("validate_b2b_coupon", {
        _code: "PARTNER-CEE",
        _plan_id: PLAN,
        _amount_cents: 4900,
        _currency: "PLN",
      });
    },
  );

  it("odmowa uprawnień i limit prób z bazy idą do wołającego bez starej ścieżki", async () => {
    for (const error of [
      { code: "42501", message: "permission denied for function" },
      { code: "P0001", message: "rate_limited: too many code attempts, try again later" },
    ]) {
      h.admin.mockResolvedValueOnce({ data: null, error });
      expect(await validatePlanCouponForUser(userClient, validation)).toEqual({
        data: null,
        error,
      });
    }
    expect(h.user).not.toHaveBeenCalled();
  });
});

describe("validateEventTicketCouponForUser (kod na bilet, 20261007120600)", () => {
  it("woła funkcję serwerową z najemcą hosta, kontem i solonym skrótem adresu", async () => {
    const result = await validateEventTicketCouponForUser(userClient, eventValidation);

    expect(result).toEqual({ data: { ok: true }, error: null });
    expect(h.admin).toHaveBeenCalledWith("validate_event_ticket_coupon_for_user", {
      _tenant_id: "aaaaaaaa-0000-4000-8000-00000000000a",
      _user_id: USER,
      _probe_subject: expect.stringMatching(/^ip:[0-9a-f]{32}$/),
      _code: "PARTNER-EVENT",
      _event_id: EVENT,
      _ticket_type_id: TICKET,
      _amount_cents: 30000,
      _currency: "PLN",
    });
    expect(JSON.stringify(h.admin.mock.lastCall)).not.toContain("198.51.100.23");
    expect(h.user).not.toHaveBeenCalled();
  });

  it("ten sam adres = ten sam podmiot co kod planu (jeden kubełek adresu dla obu ścieżek)", async () => {
    await validatePlanCouponForUser(userClient, validation);
    await validateEventTicketCouponForUser(userClient, eventValidation);

    const [plan, event] = h.admin.mock.calls.map(
      (call) => (call[1] as { _probe_subject: string })._probe_subject,
    );
    expect(event).toBe(plan);
  });

  it("host bez najemcy: awaria bez pytania bazy", async () => {
    h.tenant = null;
    const result = await validateEventTicketCouponForUser(userClient, eventValidation);

    expect(result.error?.message).toMatch(/^tenant_unresolved/);
    expect(h.admin).not.toHaveBeenCalled();
    expect(h.user).not.toHaveBeenCalled();
  });

  it.each(["PGRST202", "42883"])(
    "OKNO WDROŻENIA (%s): stara funkcja klientem kupującego, te same argumenty kodu",
    async (code) => {
      h.admin.mockResolvedValue({ data: null, error: { code, message: "no function" } });
      h.user.mockResolvedValue({ data: { ok: false, error: "not_found" }, error: null });

      const result = await validateEventTicketCouponForUser(userClient, eventValidation);

      expect(result).toEqual({ data: { ok: false, error: "not_found" }, error: null });
      expect(h.user).toHaveBeenCalledWith("validate_event_ticket_coupon", {
        _code: "PARTNER-EVENT",
        _event_id: EVENT,
        _ticket_type_id: TICKET,
        _amount_cents: 30000,
        _currency: "PLN",
      });
    },
  );

  it("limit prób z bazy idzie do wołającego bez starej ścieżki", async () => {
    const error = {
      code: "P0001",
      message: "rate_limited: too many code attempts, try again later",
    };
    h.admin.mockResolvedValue({ data: null, error });

    expect(await validateEventTicketCouponForUser(userClient, eventValidation)).toEqual({
      data: null,
      error,
    });
    expect(h.user).not.toHaveBeenCalled();
  });
});

describe("redeemCouponForUser", () => {
  it("rezerwuje rolą serwisową w najemcy ZAMÓWIENIA, nie hosta", async () => {
    h.admin.mockResolvedValue({ data: true, error: null });

    expect(await redeemCouponForUser(userClient, redemption)).toEqual({ data: true, error: null });
    expect(h.admin).toHaveBeenCalledWith("redeem_b2b_coupon_for_user", {
      _tenant_id: "bbbbbbbb-0000-4000-8000-00000000000b",
      _user_id: USER,
      _coupon_id: "eeeeeeee-0000-4000-8000-00000000000e",
      _order_id: "ffffffff-0000-4000-8000-00000000000f",
      _applied_cents: 1000,
      _original_cents: 4900,
      _currency: "PLN",
    });
    expect(h.user).not.toHaveBeenCalled();
  });

  it("OKNO WDROŻENIA: stara rezerwacja klientem kupującego", async () => {
    h.admin.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "no function" } });
    h.user.mockResolvedValue({ data: true, error: null });

    expect(await redeemCouponForUser(userClient, redemption)).toEqual({ data: true, error: null });
    expect(h.user).toHaveBeenCalledWith("redeem_b2b_coupon", {
      _coupon_id: "eeeeeeee-0000-4000-8000-00000000000e",
      _order_id: "ffffffff-0000-4000-8000-00000000000f",
      _applied_cents: 1000,
      _original_cents: 4900,
      _currency: "PLN",
    });
  });

  it("odmowa bazy (false) wraca jak jest - kasa unieważnia zamówienie", async () => {
    h.admin.mockResolvedValue({ data: false, error: null });

    expect(await redeemCouponForUser(userClient, redemption)).toEqual({ data: false, error: null });
    expect(h.user).not.toHaveBeenCalled();
  });
});
