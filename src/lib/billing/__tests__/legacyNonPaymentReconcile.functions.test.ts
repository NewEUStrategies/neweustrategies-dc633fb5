// Obudowa server fn uzgodnienia dawnych anulowań za brak płatności
// (`legacyNonPaymentReconcile.functions.ts`).
//
// CZEGO PILNUJE:
//   1. BRAMKA PLATFORMY. Przebieg czyta i skraca uprawnienia WSZYSTKICH
//      najemców środowiska, więc deklaruje `requirePlatformAdmin`
//      (super_admin najemcy domyślnego + MFA), nie `requireAdmin`.
//   2. SYMULACJA DOMYŚLNIE. Brak `mode` = `dry_run`; zapis tylko na jawne
//      `apply`.
//   3. ŚRODOWISKO Z SERWERA. W produkcji zawsze `live` (`resolveEnvironment`).
//   4. KSZTAŁT WEJŚCIA. Kursor to UUID wiersza, partia 1..100, nadmiarowe
//      pola (np. najemca) są odcinane - najemca nie przychodzi z ładunku.
//
// Autoryzacji samej w sobie (odmowy) dowodzi `requireStaff.test.ts`; harness
// nie uruchamia middleware, więc deklarację przybijamy strukturalnie.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import {
  asServerFn,
  callServerFn,
  serverFnMiddlewareNames,
  validateServerFnInput,
} from "@/test/serverFnHarness";

const h = vi.hoisted(() => ({ reconcile: vi.fn() }));

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFnHarness")).serverFnStubModule(),
);
vi.mock("@/integrations/supabase/require-staff", () => ({
  requireAdmin: { name: "requireAdmin" },
  requirePlatformAdmin: { name: "requirePlatformAdmin" },
}));
vi.mock("@/lib/billing/legacyNonPaymentReconcile.server", () => ({
  reconcileLegacyNonPaymentCancellations: h.reconcile,
}));

import { runLegacyNonPaymentReconcile } from "@/lib/billing/legacyNonPaymentReconcile.functions";

const RAPORT = { marker: "raport-partii" };
const CURSOR = "00000000-0000-4000-8000-000000000002";

function kontekst() {
  return { supabase: { marker: "klient-z-kontekstu" }, userId: "user-operator" };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  h.reconcile.mockResolvedValue(RAPORT);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("obudowa - bramka i metoda", () => {
  it("wymaga operatora PLATFORMY i idzie POST-em", () => {
    expect(serverFnMiddlewareNames(runLegacyNonPaymentReconcile)).toEqual(["requirePlatformAdmin"]);
    expect(asServerFn(runLegacyNonPaymentReconcile).method).toBe("POST");
  });
});

describe("walidator", () => {
  it("brak ładunku albo brak `mode` to SYMULACJA", () => {
    for (const input of [undefined, null, {}]) {
      expect(validateServerFnInput(runLegacyNonPaymentReconcile, input)).toEqual({
        mode: "dry_run",
      });
    }
  });

  it("tryb spoza listy jest odrzucany", () => {
    for (const mode of ["APPLY", "force", "", "dry-run", true]) {
      expect(() => validateServerFnInput(runLegacyNonPaymentReconcile, { mode })).toThrow(ZodError);
    }
  });

  it("kursor musi być UUID wiersza, a partia mieścić się w 1..100", () => {
    expect(() =>
      validateServerFnInput(runLegacyNonPaymentReconcile, { cursor: "sub_123" }),
    ).toThrow(ZodError);
    for (const batchSize of [0, 101, 2.5]) {
      expect(() => validateServerFnInput(runLegacyNonPaymentReconcile, { batchSize })).toThrow(
        ZodError,
      );
    }
    expect(
      validateServerFnInput(runLegacyNonPaymentReconcile, { cursor: CURSOR, batchSize: 100 }),
    ).toEqual({ mode: "dry_run", cursor: CURSOR, batchSize: 100 });
  });

  it("najemca i inne nadmiarowe pola są odcinane", () => {
    expect(
      validateServerFnInput(runLegacyNonPaymentReconcile, {
        mode: "apply",
        tenantId: "tenant-beta",
        force: true,
      }),
    ).toEqual({ mode: "apply" });
  });
});

describe("handler", () => {
  it("przekazuje tryb, kursor i partię; poza produkcją bez środowiska - piaskownica", async () => {
    const wynik = await callServerFn(runLegacyNonPaymentReconcile, {
      data: { cursor: CURSOR, batchSize: 25 },
      context: kontekst(),
    });

    expect(wynik).toBe(RAPORT);
    expect(h.reconcile).toHaveBeenCalledWith({
      environment: "sandbox",
      mode: "dry_run",
      cursor: CURSOR,
      batchSize: 25,
    });
    expect(console.info).not.toHaveBeenCalled();
  });

  it("w PRODUKCJI środowisko rozstrzyga serwer - `sandbox` z ładunku nie wybiera konta", async () => {
    vi.stubEnv("NODE_ENV", "production");

    await callServerFn(runLegacyNonPaymentReconcile, {
      data: { environment: "sandbox", mode: "apply" },
      context: kontekst(),
    });

    expect(h.reconcile).toHaveBeenCalledWith(
      expect.objectContaining({ environment: "live", mode: "apply", cursor: null }),
    );
    // Zastosowanie zostawia ślad: kto i na którym koncie.
    expect(console.info).toHaveBeenCalledWith(
      "[billing] legacy non-payment reconcile apply",
      expect.objectContaining({ environment: "live", userId: "user-operator" }),
    );
  });
});
