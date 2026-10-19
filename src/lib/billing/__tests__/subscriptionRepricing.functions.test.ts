// Obudowa server fn przeniesienia subskrypcji na cenę katalogu v6.2
// (`subscriptionRepricing.functions.ts`).
//
// CZEGO PILNUJE:
//   1. BRAMKA NAJEMCY - `requireAdmin` (z wbudowanym MFA), nie bramka
//      platformy: skutek dotyczy wyłącznie subskrypcji najemcy wołającego.
//   2. NAJEMCA Z SESJI - `assertCallerTenantMatchesHost`; `tenantId`
//      w ładunku nie jest ignorowany, tylko ODRZUCANY (`.strict()`).
//   3. PODGLĄD DOMYŚLNIE - wykonanie wymaga trybu `execute` ORAZ frazy.
//   4. ŚRODOWISKO Z SERWERA - w produkcji `live`, piaskownica odcięta.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import {
  asServerFn,
  callServerFn,
  serverFnMiddlewareNames,
  validateServerFnInput,
} from "@/test/serverFnHarness";

const h = vi.hoisted(() => ({
  runPage: vi.fn(),
  listLog: vi.fn(),
  tenantOf: vi.fn(),
}));

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFnHarness")).serverFnStubModule(),
);
vi.mock("@/integrations/supabase/require-staff", () => ({
  requireAdmin: { name: "requireAdmin" },
  requirePlatformAdmin: { name: "requirePlatformAdmin" },
}));
vi.mock("@/lib/server/callerTenant.server", () => ({
  assertCallerTenantMatchesHost: h.tenantOf,
}));
vi.mock("@/lib/billing/subscriptionRepricing.server", () => ({ runRepricingPage: h.runPage }));
vi.mock("@/lib/server/subscriptionRepricingStore.server", () => ({
  listRepricingLog: h.listLog,
}));

import {
  listSubscriptionRepricingLog,
  runSubscriptionRepricing,
} from "@/lib/billing/subscriptionRepricing.functions";
import { REPRICING_CONFIRM } from "@/lib/billing/subscriptionRepricing";

const CURSOR = "00000000-0000-4000-8000-000000000002";
const PAGE = { ok: true, marker: "strona" };

function kontekst() {
  return { supabase: { marker: "klient-sesji" }, userId: "admin-1" };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  h.tenantOf.mockResolvedValue("tenant-a");
  h.runPage.mockResolvedValue(PAGE);
  h.listLog.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("obudowa - bramka i metoda", () => {
  it("obie funkcje wymagają admina NAJEMCY i idą POST-em", () => {
    expect(serverFnMiddlewareNames(runSubscriptionRepricing)).toEqual(["requireAdmin"]);
    expect(serverFnMiddlewareNames(listSubscriptionRepricingLog)).toEqual(["requireAdmin"]);
    expect(asServerFn(runSubscriptionRepricing).method).toBe("POST");
    expect(asServerFn(listSubscriptionRepricingLog).method).toBe("POST");
  });
});

describe("walidator", () => {
  it("brak ładunku albo brak `mode` to PODGLĄD", () => {
    for (const input of [undefined, null, {}]) {
      expect(validateServerFnInput(runSubscriptionRepricing, input)).toEqual({ mode: "preview" });
    }
  });

  it("`tenantId` (i każde inne obce pole) w ładunku jest ODRZUCANY", () => {
    for (const extra of [{ tenantId: "tenant-b" }, { tenant_id: "tenant-b" }, { force: true }]) {
      expect(() => validateServerFnInput(runSubscriptionRepricing, extra)).toThrow(ZodError);
    }
    expect(() =>
      validateServerFnInput(listSubscriptionRepricingLog, { tenantId: "tenant-b" }),
    ).toThrow(ZodError);
  });

  it("tryb spoza listy, kursor nie-UUID i partia spoza 1..50 są odrzucane", () => {
    for (const bad of [
      { mode: "apply" },
      { mode: "EXECUTE" },
      { cursor: "sub_123" },
      { batchSize: 0 },
      { batchSize: 51 },
    ]) {
      expect(
        () => validateServerFnInput(runSubscriptionRepricing, bad),
        JSON.stringify(bad),
      ).toThrow(ZodError);
    }
  });
});

describe("handler", () => {
  it("podgląd: najemca z sesji, piaskownica poza produkcją, partia 50", async () => {
    const wynik = await callServerFn(runSubscriptionRepricing, {
      data: { mode: "preview", cursor: CURSOR },
      context: kontekst(),
    });

    expect(wynik).toBe(PAGE);
    expect(h.tenantOf).toHaveBeenCalledWith({ marker: "klient-sesji" }, "admin-1");
    expect(h.runPage).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      environment: "sandbox",
      mode: "preview",
      cursor: CURSOR,
      batchSize: 50,
      actorUserId: "admin-1",
    });
    expect(console.info).not.toHaveBeenCalled();
  });

  it("wykonanie BEZ frazy potwierdzenia: odmowa, zanim cokolwiek się wydarzy", async () => {
    for (const confirm of [undefined, "obniz-ceny-v62", "TAK"]) {
      const wynik = await callServerFn(runSubscriptionRepricing, {
        data: { mode: "execute", confirm },
        context: kontekst(),
      });
      expect(wynik).toEqual({ ok: false, error: "confirmation_required" });
    }
    expect(h.tenantOf).not.toHaveBeenCalled();
    expect(h.runPage).not.toHaveBeenCalled();
  });

  it("wykonanie z frazą: partia 20 i ślad w logu serwera", async () => {
    await callServerFn(runSubscriptionRepricing, {
      data: { mode: "execute", confirm: REPRICING_CONFIRM },
      context: kontekst(),
    });

    expect(h.runPage).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "execute", batchSize: 20, tenantId: "tenant-a" }),
    );
    expect(console.info).toHaveBeenCalledWith(
      "[billing] subscription repricing execute",
      expect.objectContaining({ tenantId: "tenant-a", userId: "admin-1" }),
    );
  });

  it("w PRODUKCJI środowisko rozstrzyga serwer - `sandbox` z ładunku nie wybiera konta", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await callServerFn(runSubscriptionRepricing, {
      data: { mode: "preview", environment: "sandbox" },
      context: kontekst(),
    });
    expect(h.runPage).toHaveBeenCalledWith(expect.objectContaining({ environment: "live" }));
  });

  it("najemca niezgodny z hostem: błąd bramki, bez przebiegu", async () => {
    h.tenantOf.mockRejectedValue(new Error("TENANT/HOST_MISMATCH"));
    await expect(
      callServerFn(runSubscriptionRepricing, { data: { mode: "preview" }, context: kontekst() }),
    ).rejects.toThrow("TENANT/HOST_MISMATCH");
    expect(h.runPage).not.toHaveBeenCalled();
  });

  it("dziennik: najemca z sesji, kampania v6.2, domyślny limit 100", async () => {
    await callServerFn(listSubscriptionRepricingLog, {
      data: { status: "failed" },
      context: kontekst(),
    });
    expect(h.listLog).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      campaign: "pricing_v62",
      status: "failed",
      limit: 100,
    });
  });
});
