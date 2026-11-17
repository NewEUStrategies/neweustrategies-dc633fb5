// Wycena i zakup pakietu z serwera (`admissionRpc.server.ts`, migracja
// 20261007120600): rola serwisowa z JAWNĄ tożsamością zamiast RPC z przeglądarki.
//
// CO PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. SONDA BEZ ADRESU - wycena i zakup z kodem muszą nieść solony skrót
//      adresu (ten sam podmiot co kody planu), inaczej farma kont za jednym
//      adresem wraca do zgadywania bez sufitu.
//   2. SUROWY ADRES I SZCZEGÓŁY BŁĘDU - do bazy idzie wyłącznie skrót, a do
//      przeglądarki wyłącznie treść i kod błędu (bez `details`/`hint`).
//   3. CICHA STARA ŚCIEŻKA - nie ma już powrotu do starego RPC z JWT
//      kupującego: brak funkcji (PGRST202/42883) to awaria wdrożenia i idzie
//      do wołającego jako błąd; odmowa zakupu czy limit prób to wynik.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  tenant: "aaaaaaaa-0000-4000-8000-00000000000a" as string | null,
  admin: vi.fn(),
}));

vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () =>
    new Request("https://wydarzenia.example.org/pakiety", {
      headers: { "cf-connecting-ip": "203.0.113.41", "x-forwarded-host": "wydarzenia.example.org" },
    }),
}));
vi.mock("@/lib/server/tenant.server", () => ({
  resolveTenantIdForHost: async () => h.tenant,
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { rpc: (...args: unknown[]) => h.admin(...args) },
}));

const { purchasePackageForUser, quoteAdmissionForUser, quoteTicketCheckoutForUser } =
  await import("@/lib/events/admissionRpc.server");
const { validatePlanCouponForUser } = await import("@/lib/billing/couponRpc.server");

const USER = "dddddddd-0000-4000-8000-00000000000d";
const PACKAGE = "9a1b0000-0000-4000-8000-000000000101";

const quotePayload = { package_id: PACKAGE, coupon_code: "PARTNER2026" };
const purchasePayload = { package_id: PACKAGE, buyer_name: "Zofia W.", coupon_code: "PARTNER2026" };

beforeEach(() => {
  h.tenant = "aaaaaaaa-0000-4000-8000-00000000000a";
  h.admin.mockReset();
  h.admin.mockResolvedValue({ data: { ok: true }, error: null });
});

describe.each([
  ["wycena", quoteAdmissionForUser, "event_admission_quote", quotePayload],
  ["zakup pakietu", purchasePackageForUser, "event_package_purchase", purchasePayload],
] as const)("%s", (_label, call, rpcName, payload) => {
  it("woła wersję serwerową z najemcą hosta, kontem i solonym skrótem adresu", async () => {
    expect(await call(USER, payload)).toEqual({ data: { ok: true }, error: null });

    expect(h.admin).toHaveBeenCalledWith(`${rpcName}_for_user`, {
      _tenant_id: "aaaaaaaa-0000-4000-8000-00000000000a",
      _user_id: USER,
      _probe_subject: expect.stringMatching(/^ip:[0-9a-f]{32}$/),
      p_payload: payload,
    });
    expect(JSON.stringify(h.admin.mock.lastCall)).not.toContain("203.0.113.41");
  });

  it("ten sam podmiot adresu co walidacja kodu planu - jeden kubełek adresu", async () => {
    await call(USER, payload);
    await validatePlanCouponForUser({
      userId: USER,
      code: "PARTNER2026",
      planId: "cccccccc-0000-4000-8000-00000000000c",
      amountCents: 4900,
      currency: "PLN",
    });

    const [admission, plan] = h.admin.mock.calls.map(
      (args) => (args[1] as { _probe_subject: string })._probe_subject,
    );
    expect(admission).toBe(plan);
  });

  it("host bez najemcy: awaria bez pytania bazy", async () => {
    h.tenant = null;
    const result = await call(USER, payload);

    expect(result.data).toBeNull();
    expect(result.error?.message).toMatch(/^tenant_unresolved/);
    expect(h.admin).not.toHaveBeenCalled();
  });

  it.each(["PGRST202", "42883"])(
    "brak funkcji serwerowej (%s) to błąd dla wołającego - bez starej funkcji",
    async (code) => {
      h.admin.mockResolvedValue({
        data: null,
        error: { code, message: "Could not find the function", hint: "wewnętrzna podpowiedź" },
      });

      expect(await call(USER, payload)).toEqual({
        data: null,
        error: { code, message: "Could not find the function" },
      });
      expect(h.admin).toHaveBeenCalledTimes(1);
      expect(h.admin).not.toHaveBeenCalledWith(rpcName, expect.anything());
    },
  );

  it("błąd bazy idzie do wołającego jako treść i kod - bez details/hint i bez starej ścieżki", async () => {
    h.admin.mockResolvedValue({
      data: null,
      error: {
        code: "P0001",
        message: "rate_limited: too many code attempts, try again later",
        details: "kubełek coupon_probe_miss.ip",
        hint: "wewnętrzna podpowiedź",
      },
    });

    expect(await call(USER, payload)).toEqual({
      data: null,
      error: { code: "P0001", message: "rate_limited: too many code attempts, try again later" },
    });
    expect(h.admin).toHaveBeenCalledTimes(1);
  });
});

// Wycena wejściówki z kodem dostępu (migracja 20261007140400): kod dostępu to
// też sonda, więc idzie tą samą drogą - najemca hosta, konto z sesji, skrót
// adresu - a pusty kod nie jedzie do bazy jako pusty napis.
describe("wycena wejściówki (kod dostępu)", () => {
  const TICKET = "cccccccc-0000-4000-8000-000000000003";

  it("woła wersję serwerową z najemcą hosta, kontem i solonym skrótem adresu", async () => {
    await quoteTicketCheckoutForUser(USER, {
      ticketTypeId: TICKET,
      accessCode: "PRESS",
    });

    expect(h.admin).toHaveBeenCalledWith("event_ticket_checkout_quote_for_user", {
      _tenant_id: "aaaaaaaa-0000-4000-8000-00000000000a",
      _user_id: USER,
      _probe_subject: expect.stringMatching(/^ip:[0-9a-f]{32}$/),
      p_ticket_type_id: TICKET,
      p_access_code: "PRESS",
    });
    expect(JSON.stringify(h.admin.mock.lastCall)).not.toContain("203.0.113.41");
  });

  it("pusty kod nie jedzie do bazy jako pusty napis", async () => {
    await quoteTicketCheckoutForUser(USER, { ticketTypeId: TICKET, accessCode: "" });

    expect(h.admin.mock.lastCall?.[1]).toMatchObject({ p_access_code: undefined });
  });

  it.each(["PGRST202", "42883"])(
    "brak funkcji serwerowej (%s) to błąd dla wołającego - bez starej funkcji",
    async (code) => {
      h.admin.mockResolvedValue({ data: null, error: { code, message: "no function" } });

      expect(
        await quoteTicketCheckoutForUser(USER, {
          ticketTypeId: TICKET,
          accessCode: "PRESS",
        }),
      ).toEqual({ data: null, error: { code, message: "no function" } });
      expect(h.admin).toHaveBeenCalledTimes(1);
      expect(h.admin).not.toHaveBeenCalledWith("event_ticket_checkout_quote", expect.anything());
    },
  );

  it("limit prób to wynik, nie powód do starej ścieżki", async () => {
    h.admin.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "rate_limited: too many code attempts, try again later" },
    });

    const result = await quoteTicketCheckoutForUser(USER, { ticketTypeId: TICKET });
    expect(result.error?.message).toMatch(/^rate_limited/);
    expect(h.admin).toHaveBeenCalledTimes(1);
  });
});
