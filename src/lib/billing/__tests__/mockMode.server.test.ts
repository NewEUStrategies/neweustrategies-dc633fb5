// Bezpiecznik mock-mode billingu (P0 z audytu): produkcja bez dostawcy musi
// odmawiać checkoutu zamiast rozdawać uprawnienia, dev zachowuje stare DX.
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockCheckoutAllowed, paymentsConfiguredServer } from "../mockMode.server";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("mockCheckoutAllowed", () => {
  it("never allows mock when the provider is configured (webhook is authoritative)", () => {
    vi.stubEnv("LOVABLE_API_KEY", "lov_test");
    vi.stubEnv("STRIPE_SANDBOX_API_KEY", "pdl_test");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("BILLING_ALLOW_MOCK", "1");
    expect(mockCheckoutAllowed()).toBe(false);
  });

  it("refuses mock on production without an explicit opt-in (fail-closed)", () => {
    vi.stubEnv("LOVABLE_API_KEY", "");
    vi.stubEnv("STRIPE_SANDBOX_API_KEY", "");
    vi.stubEnv("STRIPE_LIVE_API_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BILLING_ALLOW_MOCK", "");
    expect(mockCheckoutAllowed()).toBe(false);
  });

  it("allows mock on production only with BILLING_ALLOW_MOCK=1", () => {
    vi.stubEnv("LOVABLE_API_KEY", "");
    vi.stubEnv("STRIPE_SANDBOX_API_KEY", "");
    vi.stubEnv("STRIPE_LIVE_API_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BILLING_ALLOW_MOCK", "1");
    expect(mockCheckoutAllowed()).toBe(true);
  });

  it("keeps the dev/test DX: mock allowed without a provider outside production", () => {
    vi.stubEnv("LOVABLE_API_KEY", "");
    vi.stubEnv("STRIPE_SANDBOX_API_KEY", "");
    vi.stubEnv("STRIPE_LIVE_API_KEY", "");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("BILLING_ALLOW_MOCK", "");
    expect(mockCheckoutAllowed()).toBe(true);
  });
});

describe("paymentsConfiguredServer - komplet kluczy bramki", () => {
  it("sam klucz PRODUKCYJNY (bez piaskownicy) to skonfigurowana bramka - produkcja nie wpada w mock", () => {
    vi.stubEnv("LOVABLE_API_KEY", "lov_test");
    vi.stubEnv("STRIPE_SANDBOX_API_KEY", "");
    vi.stubEnv("STRIPE_LIVE_API_KEY", "rk_live_syntetyczny");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BILLING_ALLOW_MOCK", "1");

    expect(paymentsConfiguredServer()).toBe(true);
    expect(mockCheckoutAllowed()).toBe(false);
  });

  it("klucz operatora BEZ klucza bramki konektorów nie jest konfiguracją", () => {
    // Ruch do operatora idzie przez bramkę konektorów (`stripe.server`) - bez
    // jej klucza checkout i tak by nie powstał, więc to nie jest „dostawca".
    vi.stubEnv("LOVABLE_API_KEY", "");
    vi.stubEnv("STRIPE_SANDBOX_API_KEY", "sk_test_syntetyczny");
    vi.stubEnv("STRIPE_LIVE_API_KEY", "rk_live_syntetyczny");

    expect(paymentsConfiguredServer()).toBe(false);
  });
});
