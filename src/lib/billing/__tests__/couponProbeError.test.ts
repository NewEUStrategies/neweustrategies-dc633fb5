// Odmowa limitu prób kodów (`rate_limited: ...`) czytana jednym słownikiem
// po obu stronach (`isCodeProbeRateLimited`, `codeProbeRpcError` w coupons.ts).
//
// CO PSUJE SIĘ BEZ TYCH TESTÓW: odmowa limitu z bazy wraca jako zwykła awaria
// albo - gorzej - jako odmowa KODU, po której kasa zdejmuje kod z pamięci
// i płaci pełną cenę.
import { describe, expect, it } from "vitest";
import { codeProbeRpcError, isCodeProbeRateLimited } from "@/lib/billing/coupons";

const DB_MESSAGE = "rate_limited: too many code attempts, try again later";

describe("isCodeProbeRateLimited", () => {
  it("rozpoznaje błąd PostgREST (obiekt z message), Error i napis", () => {
    expect(isCodeProbeRateLimited({ message: DB_MESSAGE, code: "P0001" })).toBe(true);
    expect(isCodeProbeRateLimited(new Error(DB_MESSAGE))).toBe(true);
    expect(isCodeProbeRateLimited(DB_MESSAGE)).toBe(true);
    expect(isCodeProbeRateLimited("  RATE_LIMITED: x")).toBe(true);
  });

  it("nie myli innych awarii z limitem", () => {
    expect(isCodeProbeRateLimited(new Error("permission denied for function"))).toBe(false);
    expect(isCodeProbeRateLimited({ message: 42 })).toBe(false);
    expect(isCodeProbeRateLimited(null)).toBe(false);
    expect(isCodeProbeRateLimited(undefined)).toBe(false);
    expect(isCodeProbeRateLimited(7)).toBe(false);
  });
});

describe("codeProbeRpcError", () => {
  it("odmowę limitu zamienia na Error ze stałą treścią, bez pól PostgREST", () => {
    const out = codeProbeRpcError({ message: DB_MESSAGE, hint: "wewnętrzny", details: "x" });

    expect(out).toBeInstanceOf(Error);
    expect(out).toMatchObject({ message: DB_MESSAGE });
    expect(out).not.toHaveProperty("hint");
  });

  it("każdy inny błąd wraca BEZ ZMIAN", () => {
    const other = { message: "deadlock detected", code: "40P01" };
    expect(codeProbeRpcError(other)).toBe(other);
  });
});
