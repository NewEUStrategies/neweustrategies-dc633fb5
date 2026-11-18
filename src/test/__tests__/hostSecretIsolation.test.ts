import { describe, expect, it } from "vitest";

import {
  isHostSecretName,
  isolateHostSecrets,
  KEEP_HOST_SECRETS_FLAG,
} from "@/test/hostSecretIsolation";

describe("izolacja testów od sekretów hosta", () => {
  it("zdejmuje połączenie z bazą i klucz serwisowy, które psuły zapis stron w pamięci podręcznej", () => {
    const env: Record<string, string | undefined> = {
      SUPABASE_URL: "https://example.invalid",
      SUPABASE_SERVICE_ROLE_KEY: "x",
      SUPABASE_PUBLISHABLE_KEY: "x",
    };
    expect(isolateHostSecrets(env)).toEqual([
      "SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "SUPABASE_URL",
    ]);
    expect(env).toEqual({});
  });

  it("zdejmuje klucze płatności, bramki AI, poczty i powiadomień push", () => {
    for (const name of [
      "STRIPE_LIVE_API_KEY",
      "STRIPE_SANDBOX_API_KEY",
      "LOVABLE_API_KEY",
      "RESEND_API_KEY",
      "VAPID_PRIVATE_KEY",
      "VAPID_SUBJECT",
      "BILLING_CRON_SECRET",
      "LOVABLE_BROWSER_SUPABASE_SESSION_JSON",
    ]) {
      expect(isHostSecretName(name)).toBe(true);
    }
  });

  it("zostawia publiczną konfigurację VITE_* i zmienne środowiska uruchomieniowego", () => {
    const env: Record<string, string | undefined> = {
      VITE_SUPABASE_URL: "https://example.invalid",
      VITE_SUPABASE_PUBLISHABLE_KEY: "x",
      NODE_ENV: "test",
      PATH: "/usr/bin",
      TZ: "UTC",
    };
    expect(isolateHostSecrets(env)).toEqual([]);
    expect(Object.keys(env)).toHaveLength(5);
  });

  it("flaga opt-out zostawia sekrety dla świadomego przebiegu na żywych usługach", () => {
    const env: Record<string, string | undefined> = {
      [KEEP_HOST_SECRETS_FLAG]: "1",
      STRIPE_LIVE_API_KEY: "x",
    };
    expect(isolateHostSecrets(env)).toEqual([]);
    expect(env.STRIPE_LIVE_API_KEY).toBe("x");
  });
});
