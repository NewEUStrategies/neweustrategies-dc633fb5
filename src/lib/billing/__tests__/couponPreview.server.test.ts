// Podgląd kuponu planu - warstwa serwerowa (`couponPreview.server.ts`)
// i jej obwódka (`couponPreview.functions.ts`).
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. WYROCZNIA BEZ LIMITU - odmowa limitu zapada PRZED bazą.
//   2. coupon_id W PRZEGLĄDARCE - podgląd nie oddaje go NAWET przy sukcesie
//      (ekran go nie czyta, a z nim da się wołać RPC rezerwacji wprost).
//   3. LIMIT ALBO AWARIA UDAJE PUDŁO - `rate_limited` i `technical_error` to
//      własne powody, kwota zostaje nietknięta.
//   4. BRAK PLANU - zerowy UUID składa serwer (zachowanie RPC bez zmian).
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  callServerFn,
  serverFnMiddlewareNames,
  validateServerFnInput,
} from "@/test/serverFnHarness";

const h = vi.hoisted(() => ({
  allowed: true,
  requestThrows: false,
  probeHeaders: [] as unknown[],
  probeUsers: [] as (string | null)[],
  rpc: vi.fn(),
  request: new Request("https://nes.example/_serverFn", {
    headers: { "cf-connecting-ip": "192.0.2.7" },
  }),
}));

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFnHarness")).serverFnStubModule(),
);
vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => {
    if (h.requestThrows) throw new Error("brak kontekstu żądania");
    return h.request;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: { name: "requireSupabaseAuth" },
}));
vi.mock("@/lib/events/codeProbeLimit.server", () => ({
  allowCodeProbe: async (headers: unknown, resolveUserId: () => Promise<string | null>) => {
    h.probeHeaders.push(headers);
    h.probeUsers.push(await resolveUserId());
    return h.allowed;
  },
}));

import { previewPlanCouponForUser } from "@/lib/billing/couponPreview.server";
import { previewPlanCoupon } from "@/lib/billing/couponPreview.functions";

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
const PLAN = "cccccccc-0000-4000-8000-00000000000c";
const USER = "dddddddd-0000-4000-8000-00000000000d";

type Client = Parameters<typeof previewPlanCouponForUser>[0];
// Atrapa ma tylko `rpc` - jedyna metoda, ktorej podglad uzywa.
const supabase: Client = { rpc: h.rpc } as never;

function input(planId: string | null = PLAN) {
  return { code: " rabat-10 ", planId, amountCents: 10_000, currency: "PLN" };
}

const refusal = (error: string) => ({
  ok: false,
  error,
  coupon_id: null,
  discount_cents: 0,
  final_cents: 10_000,
  label: null,
  discount_kind: null,
  discount_percent: null,
});

beforeEach(() => {
  h.allowed = true;
  h.requestThrows = false;
  h.probeHeaders = [];
  h.probeUsers = [];
  h.rpc.mockReset();
  h.rpc.mockResolvedValue({
    data: [
      {
        ok: true,
        error: null,
        coupon_id: "eeeeeeee-0000-4000-8000-00000000000e",
        discount_cents: 1_000,
        final_cents: 9_000,
        label: "Partner CEE",
        discount_kind: "percent",
        discount_percent: 10,
      },
    ],
    error: null,
  });
});

describe("previewPlanCouponForUser", () => {
  it("odmowa limitu zapada przed bazą i ma własny powód", async () => {
    h.allowed = false;
    expect(await previewPlanCouponForUser(supabase, USER, input())).toEqual(
      refusal("rate_limited"),
    );
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.probeUsers).toEqual([USER]);
  });

  it("woła RPC klientem kupującego z kodem po normalizacji", async () => {
    await previewPlanCouponForUser(supabase, USER, input());
    expect(h.rpc).toHaveBeenCalledWith("validate_b2b_coupon", {
      _code: "RABAT-10",
      _plan_id: PLAN,
      _amount_cents: 10_000,
      _currency: "PLN",
    });
  });

  it("brak planu idzie do RPC jako zerowy UUID, jak dotąd z przeglądarki", async () => {
    await previewPlanCouponForUser(supabase, USER, input(null));
    expect(h.rpc.mock.lastCall?.[1]).toMatchObject({ _plan_id: ZERO_UUID });
  });

  it("sukces NIE niesie coupon_id ani nazwy kodu do przeglądarki", async () => {
    expect(await previewPlanCouponForUser(supabase, USER, input())).toEqual({
      ok: true,
      error: null,
      coupon_id: null,
      discount_cents: 1_000,
      final_cents: 9_000,
      label: null,
      discount_kind: "percent",
      discount_percent: 10,
    });
  });

  it("odmowa wraca oczyszczona - bez danych kodu, z kwotą nietkniętą", async () => {
    h.rpc.mockResolvedValue({
      data: [{ ...refusal("expired"), coupon_id: "x", label: "Stary", discount_percent: 30 }],
      error: null,
    });
    expect(await previewPlanCouponForUser(supabase, USER, input())).toEqual(refusal("expired"));
  });

  it("powód nieznany ekranowi (np. event_not_eligible ze starej bazy) mówi to samo co pudło", async () => {
    h.rpc.mockResolvedValue({ data: [refusal("event_not_eligible")], error: null });
    expect(await previewPlanCouponForUser(supabase, USER, input())).toEqual(refusal("not_found"));
  });

  it("odmowa limitu z bazy (kubełek pudeł konta) to rate_limited, nie pudło", async () => {
    h.rpc.mockResolvedValue({
      data: null,
      error: { message: "rate_limited: too many code attempts, try again later", code: "P0001" },
    });
    expect(await previewPlanCouponForUser(supabase, USER, input())).toEqual(
      refusal("rate_limited"),
    );
  });

  it("każdy inny błąd bazy to technical_error", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "permission denied for function" } });
    expect(await previewPlanCouponForUser(supabase, USER, input())).toEqual(
      refusal("technical_error"),
    );
  });

  it("kod kwotowy zostaje kwotowy (bez coupon_id)", async () => {
    h.rpc.mockResolvedValue({
      data: [
        {
          ok: true,
          error: null,
          coupon_id: "x",
          discount_cents: 2_000,
          final_cents: 8_000,
          label: "Kwota",
          discount_kind: "fixed",
          discount_percent: null,
        },
      ],
      error: null,
    });
    expect(await previewPlanCouponForUser(supabase, USER, input())).toMatchObject({
      ok: true,
      coupon_id: null,
      label: null,
      discount_kind: "fixed",
      discount_cents: 2_000,
    });
  });

  it("brak kontekstu żądania nie znosi limitu - limiter dostaje null (wspólny kubełek)", async () => {
    h.requestThrows = true;
    await previewPlanCouponForUser(supabase, USER, input());
    expect(h.probeHeaders).toEqual([null]);
    expect(h.rpc).toHaveBeenCalledTimes(1);
  });

  it("odmowa bez powodu (error null) mówi to samo co pudło", async () => {
    h.rpc.mockResolvedValue({ data: [{ ...refusal("not_found"), error: null }], error: null });
    expect(await previewPlanCouponForUser(supabase, USER, input())).toEqual(refusal("not_found"));
  });

  it("pusta odpowiedź RPC to null, nie wynik-widmo", async () => {
    h.rpc.mockResolvedValue({ data: [], error: null });
    expect(await previewPlanCouponForUser(supabase, USER, input())).toBeNull();
  });
});

describe("previewPlanCoupon (deklaracja)", () => {
  it("handler woła warstwę serwerową klientem i kontem z middleware", async () => {
    expect(
      await callServerFn(previewPlanCoupon, {
        data: { code: "RABAT", planId: PLAN, amountCents: 10_000, currency: "PLN" },
        context: { supabase, userId: USER },
      }),
    ).toMatchObject({ ok: true, coupon_id: null });
    expect(h.probeUsers).toEqual([USER]);
  });

  it("wymaga sesji i jest POST", () => {
    expect(serverFnMiddlewareNames(previewPlanCoupon)).toEqual(["requireSupabaseAuth"]);
    expect(Reflect.get(previewPlanCoupon as object, "method")).toBe("POST");
  });

  it("walidator odrzuca zły kształt wejścia", () => {
    expect(
      validateServerFnInput(previewPlanCoupon, {
        code: " RABAT ",
        planId: null,
        amountCents: 100,
        currency: "PLN",
      }),
    ).toEqual({ code: "RABAT", planId: null, amountCents: 100, currency: "PLN" });
    for (const bad of [
      { code: "", planId: null, amountCents: 100, currency: "PLN" },
      { code: "A".repeat(65), planId: null, amountCents: 100, currency: "PLN" },
      { code: "RABAT", planId: "x", amountCents: 100, currency: "PLN" },
      { code: "RABAT", planId: null, amountCents: 0, currency: "PLN" },
      { code: "RABAT", planId: null, amountCents: 100, currency: "PL" },
    ]) {
      expect(() => validateServerFnInput(previewPlanCoupon, bad)).toThrow();
    }
  });
});
