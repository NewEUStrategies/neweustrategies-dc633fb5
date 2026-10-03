// Efekty kuponu B2B po ZAPŁACONYM zamówieniu - `couponEffects.server.ts`.
//
// RYZYKO, KTÓRE TEN PLIK PINUJE. Funkcja stoi w ścieżce, która zamienia
// potwierdzoną płatność w dostęp (webhook Stripe i finalizacja trybu mock).
// Dwie rzeczy nie mogą się tu stać:
//   1. awaria efektów kuponu (błąd RPC, wyjątek, śmieciowa odpowiedź bazy)
//      NIE MOŻE wywrócić księgowania płatności - funkcja ma ODDAĆ wynik,
//      a nie rzucić, bo rzut przerwałby webhook PO zapisaniu `paid`;
//   2. kupon obiecujący warstwę, której tenant nie ma (`tier_key_not_found`),
//      NIE MOŻE przejść po cichu - klient zapłacił za obiecany plan, więc
//      redakcja musi dostać ostrzeżenie z identyfikatorem zamówienia.
//
// Idempotencja jest po stronie bazy (zatrzask `effects_applied_at`): powtórna
// dostawa webhooka dostaje `already_applied` i nie może być raportowana jako
// nadanie efektów.
//
// GRANICA ATRAP: wyłącznie klient roli serwisowej (`supabaseAdmin.rpc`).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BILLING_IDS } from "@/test/billing/fixtures";
import { supabaseRpcStub } from "@/test/supabase/rpc";

const h = vi.hoisted(() => ({
  stub: null as ReturnType<typeof import("@/test/supabase/rpc").supabaseRpcStub> | null,
  /** Klient roli serwisowej nie daje się nawet zbudować (np. brak sekretu). */
  clientThrows: null as Error | null,
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (h.clientThrows) throw h.clientThrows;
      if (!h.stub) throw new Error("test: atrapa RPC nieustawiona (beforeEach)");
      return h.stub.rpc(name, args);
    },
  },
}));

import { applyCouponEffectsForOrder } from "@/lib/billing/couponEffects.server";

const RPC = "apply_b2b_coupon_effects";
const ORDER = BILLING_IDS.order;

let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  h.stub = supabaseRpcStub();
  h.clientThrows = null;
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("applyCouponEffectsForOrder - zapłacone zamówienie", () => {
  it("woła RPC efektów rolą serwisową z identyfikatorem zamówienia i oddaje nadaną warstwę", async () => {
    h.stub?.setData(RPC, {
      applied: true,
      crm: true,
      tier_granted: true,
      tier_key: "pro",
      coupon_code: "NES-B2B-10",
    });

    const outcome = await applyCouponEffectsForOrder(ORDER);

    expect(outcome).toEqual({ applied: true, tierGranted: true, tierKey: "pro" });
    expect(h.stub?.names()).toEqual([RPC]);
    expect(h.stub?.lastCall(RPC)?.args).toEqual({ _order_id: ORDER });
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("kupon bez warstwy (sam CRM) zachowuje `tierKey: null` i nie ostrzega", async () => {
    h.stub?.setData(RPC, { applied: true, crm: false, tier_granted: false, tier_key: null });

    const outcome = await applyCouponEffectsForOrder(ORDER);

    // Brak `reason` = kupon nic nie obiecywał, więc nie ma czego zgłaszać.
    expect(outcome).toEqual({ applied: true, tierGranted: false, tierKey: null });
    expect(warn).not.toHaveBeenCalled();
  });

  it("obiecana warstwa, której tenant nie ma, kończy się ostrzeżeniem z zamówieniem i kluczem", async () => {
    h.stub?.setData(RPC, {
      applied: true,
      crm: false,
      tier_granted: false,
      reason: "tier_key_not_found",
      tier_key: "platinum",
    });

    const outcome = await applyCouponEffectsForOrder(ORDER);

    expect(outcome).toEqual({
      applied: true,
      reason: "tier_key_not_found",
      tierGranted: false,
      tierKey: "platinum",
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "[billing] coupon tier grant skipped",
      ORDER,
      "tier_key_not_found",
      "platinum",
    );
  });

  it("ostrzeżenie nie wypisuje `undefined`, gdy baza nie podała klucza warstwy", async () => {
    h.stub?.setData(RPC, { applied: true, tier_granted: false, reason: "tier_key_not_found" });

    await applyCouponEffectsForOrder(ORDER);

    expect(warn).toHaveBeenCalledWith(
      "[billing] coupon tier grant skipped",
      ORDER,
      "tier_key_not_found",
      "",
    );
  });
});

describe("applyCouponEffectsForOrder - idempotencja i odmowy bazy", () => {
  it("powtórna dostawa webhooka to `already_applied`, a nie drugie nadanie", async () => {
    h.stub?.setData(RPC, { applied: false, reason: "already_applied" });

    const outcome = await applyCouponEffectsForOrder(ORDER);

    expect(outcome).toEqual({ applied: false, reason: "already_applied" });
    expect(warn).not.toHaveBeenCalled();
  });

  it("zamówienie jeszcze niezapłacone zostaje odrzucone przez bazę i nic nie jest zgłaszane jako nadane", async () => {
    h.stub?.setData(RPC, { applied: false, reason: "order_not_paid" });

    await expect(applyCouponEffectsForOrder(ORDER)).resolves.toEqual({
      applied: false,
      reason: "order_not_paid",
    });
  });
});

describe("applyCouponEffectsForOrder - awaria nie wywraca księgowania płatności", () => {
  it("błąd RPC oddaje `rpc_error` i loguje zamówienie zamiast rzucać", async () => {
    h.stub?.setError(RPC, "permission denied for function apply_b2b_coupon_effects", "42501");

    const outcome = await applyCouponEffectsForOrder(ORDER);

    expect(outcome).toEqual({ applied: false, reason: "rpc_error" });
    expect(error).toHaveBeenCalledWith(
      "[billing] coupon effects failed",
      ORDER,
      "permission denied for function apply_b2b_coupon_effects",
    );
  });

  it("wyjątek klienta bazy oddaje `exception` zamiast przerywać webhook", async () => {
    const boom = new Error("fetch failed");
    h.clientThrows = boom;

    const outcome = await applyCouponEffectsForOrder(ORDER);

    expect(outcome).toEqual({ applied: false, reason: "exception" });
    expect(error).toHaveBeenCalledWith("[billing] coupon effects threw", ORDER, boom);
  });

  it.each([
    ["null", null],
    ["napis", "applied"],
    ["liczba", 1],
  ])(
    "odpowiedź bazy, która nie jest obiektem (%s), to brak wyniku - nie nadanie",
    async (_l, raw) => {
      h.stub?.setData(RPC, raw);

      await expect(applyCouponEffectsForOrder(ORDER)).resolves.toEqual({
        applied: false,
        reason: "no_result",
      });
    },
  );

  it("pola o złych typach są odrzucane: `applied` musi być dosłownie true", async () => {
    // `"true"` jako napis albo `1` to nie zatrzask zabrany przez ten przebieg -
    // inaczej zniekształcona odpowiedź raportowałaby nadanie efektów.
    h.stub?.setData(RPC, { applied: "true", reason: 7, tier_granted: "yes", tier_key: 42 });

    const outcome = await applyCouponEffectsForOrder(ORDER);

    expect(outcome).toEqual({ applied: false });
    expect(warn).not.toHaveBeenCalled();
  });
});
