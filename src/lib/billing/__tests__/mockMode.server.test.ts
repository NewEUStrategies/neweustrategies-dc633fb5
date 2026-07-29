// Bezpiecznik mock-mode billingu (P0 z audytu): produkcja bez dostawcy musi
// odmawiać checkoutu zamiast rozdawać uprawnienia, dev zachowuje stare DX.
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockCheckoutAllowed } from "../mockMode.server";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("mockCheckoutAllowed", () => {
  it("never allows mock when the provider is configured (webhook is authoritative)", () => {
    vi.stubEnv("LOVABLE_API_KEY", "lov_test");
    vi.stubEnv("PADDLE_SANDBOX_API_KEY", "pdl_test");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("BILLING_ALLOW_MOCK", "1");
    expect(mockCheckoutAllowed()).toBe(false);
  });

  it("refuses mock on production without an explicit opt-in (fail-closed)", () => {
    vi.stubEnv("LOVABLE_API_KEY", "");
    vi.stubEnv("PADDLE_SANDBOX_API_KEY", "");
    vi.stubEnv("PADDLE_LIVE_API_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BILLING_ALLOW_MOCK", "");
    expect(mockCheckoutAllowed()).toBe(false);
  });

  it("allows mock on production only with BILLING_ALLOW_MOCK=1", () => {
    vi.stubEnv("LOVABLE_API_KEY", "");
    vi.stubEnv("PADDLE_SANDBOX_API_KEY", "");
    vi.stubEnv("PADDLE_LIVE_API_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BILLING_ALLOW_MOCK", "1");
    expect(mockCheckoutAllowed()).toBe(true);
  });

  it("keeps the dev/test DX: mock allowed without a provider outside production", () => {
    vi.stubEnv("LOVABLE_API_KEY", "");
    vi.stubEnv("PADDLE_SANDBOX_API_KEY", "");
    vi.stubEnv("PADDLE_LIVE_API_KEY", "");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("BILLING_ALLOW_MOCK", "");
    expect(mockCheckoutAllowed()).toBe(true);
  });
});
