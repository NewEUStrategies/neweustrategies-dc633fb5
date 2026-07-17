// Bezpiecznik mock-mode billingu (P0 z audytu): produkcja bez Stripe musi
// odmawiać checkoutu zamiast rozdawać uprawnienia, dev zachowuje stare DX.
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockCheckoutAllowed } from "../mockMode.server";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("mockCheckoutAllowed", () => {
  it("never allows mock when Stripe is configured (webhook is authoritative)", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_123");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("BILLING_ALLOW_MOCK", "1");
    expect(mockCheckoutAllowed()).toBe(false);
  });

  it("refuses mock on production without an explicit opt-in (fail-closed)", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BILLING_ALLOW_MOCK", "");
    expect(mockCheckoutAllowed()).toBe(false);
  });

  it("allows mock on production only with BILLING_ALLOW_MOCK=1", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BILLING_ALLOW_MOCK", "1");
    expect(mockCheckoutAllowed()).toBe(true);
  });

  it("keeps the dev/test DX: mock allowed without Stripe outside production", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("BILLING_ALLOW_MOCK", "");
    expect(mockCheckoutAllowed()).toBe(true);
  });
});
