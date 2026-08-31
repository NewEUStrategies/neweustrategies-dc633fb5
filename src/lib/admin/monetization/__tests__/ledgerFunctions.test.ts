// Obudowa server fn rejestru: walidacja wejścia, bramka roli admin i przekazanie
// parametrów do warstwy danych.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { callServerFn, asSpec } from "@/test/serverFn";

vi.mock("@tanstack/react-start", async () => (await import("@/test/serverFn")).reactStartStub());
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

const assertAdmin = vi.fn(async () => undefined);
const loadMonetizationLedger = vi.fn(async (input: { environment: string; limit: number }) => ({
  donations: [],
  grants: [],
  giftLinks: [],
  environment: input.environment,
  summary: {
    paidTotals: [],
    donationCount: 0,
    pendingCount: 0,
    activeGrants: 0,
    activeGiftLinks: 0,
  },
  tenantResolved: true,
}));

vi.mock("@/lib/billing/diagnostics.server", () => ({ assertAdmin }));
vi.mock("@/lib/admin/monetization/ledger.server", () => ({ loadMonetizationLedger }));

import { listMonetizationLedger } from "@/lib/admin/monetization/ledger.functions";

const USER = "55555555-5555-4555-8555-555555555555";
const ctx = () => ({ supabase: { from: vi.fn() }, userId: USER });

beforeEach(() => {
  assertAdmin.mockClear();
  loadMonetizationLedger.mockClear();
});

describe("listMonetizationLedger", () => {
  it("weryfikuje rolę admina przed odczytem", async () => {
    await callServerFn(asSpec(listMonetizationLedger), { environment: "all", limit: 20 }, ctx());
    expect(assertAdmin).toHaveBeenCalledTimes(1);
    expect(loadMonetizationLedger).toHaveBeenCalledWith({ environment: "all", limit: 20 });
  });

  it("stosuje wartości domyślne", async () => {
    await callServerFn(asSpec(listMonetizationLedger), {}, ctx());
    expect(loadMonetizationLedger).toHaveBeenCalledWith({ environment: "all", limit: 50 });
  });

  it("odrzuca nieznane środowisko i limit poza zakresem", async () => {
    await expect(
      callServerFn(asSpec(listMonetizationLedger), { environment: "staging" }, ctx()),
    ).rejects.toThrow();
    await expect(
      callServerFn(asSpec(listMonetizationLedger), { limit: 5000 }, ctx()),
    ).rejects.toThrow();
    expect(loadMonetizationLedger).not.toHaveBeenCalled();
  });

  it("brak uprawnień blokuje odczyt rejestru", async () => {
    assertAdmin.mockRejectedValueOnce(new Error("Forbidden"));
    await expect(
      callServerFn(asSpec(listMonetizationLedger), { environment: "live" }, ctx()),
    ).rejects.toThrow("Forbidden");
    expect(loadMonetizationLedger).not.toHaveBeenCalled();
  });
});
