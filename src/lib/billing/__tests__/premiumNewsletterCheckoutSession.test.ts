// ZGODA NA NEWSLETTER W SESJI CHECKOUTU (SUB-15) - odcinek server function ->
// sesja operatora.
//
// Pole zgody w `/checkout/$planId` jest jedynym źródłem zgody na newsletter
// przy zakupie. Ten plik przybija, co z nim robi `createPlanCheckoutSession`:
//   * zaznaczone pole -> wersja, język i chwila (zegar SERWERA) w metadanych
//     sesji ORAZ `subscription_data.metadata`, z której czyta webhook;
//   * brak pola -> ani jednego klucza zgody (brak = niezaznaczone);
//   * nieznana wersja treści albo chwila podana przez klienta -> odmowa
//     walidacji, bo dowodem ma być tekst z rejestru i czas przyjęcia przez nas;
//   * cena jednorazowa (bez subskrypcji) -> zgoda nie jedzie, bo nie ma
//     skutku zakupu, który by ją zapisał.
//
// ATRAPUJEMY: klienta operatora, klienta Supabase kupującego, rolę serwisową
// i żądanie frameworka. `adhocCheckout.server`, `checkoutSettings.server`,
// `markOrderSession.server` i `premiumNewsletter` jadą PRAWDZIWE.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PREMIUM_NEWSLETTER_CONSENT_VERSION,
  readPremiumNewsletterConsentMetadata,
} from "@/lib/billing/premiumNewsletter";
import { fail, ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabaseChain";
import { FIXED_NOW_ISO, freezeClock } from "@/test/time";

const PLAN_ID = "aaaaaaaa-2222-4000-8000-0000000000aa";
const RETURN_URL = "https://kasa.example.org/checkout/sukces";

const h = vi.hoisted(() => ({
  sessions: [] as Record<string, unknown>[],
  prices: [{ id: "price_1", lookup_key: "plus_monthly", type: "recurring" }] as unknown[],
}));

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFnHarness")).serverFnStubModule(),
);

vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () =>
    new Request("https://kasa.example.org/checkout", {
      headers: { "x-forwarded-proto": "https", "x-forwarded-host": "kasa.example.org" },
    }),
}));

vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: { name: "requireSupabaseAuth" },
}));

vi.mock("@/lib/server/tenant.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/tenant.server")>()),
  resolveTenantIdForHost: async () => "tenant-alfa",
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { rpc: () => Promise.resolve({ data: true, error: null }) },
}));

vi.mock("@/lib/stripe.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/stripe.server")>();
  const { stripeStub } = await import("@/test/billing/fixtures");
  return {
    ...actual,
    getStripeClient: () => {
      const base = stripeStub();
      return {
        ...base,
        prices: { list: () => Promise.resolve({ data: h.prices }) },
        customers: {
          search: () => Promise.resolve({ data: [] }),
          list: () => Promise.resolve({ data: [] }),
          update: () => Promise.resolve({ id: "cus_1" }),
          create: () => Promise.resolve({ id: "cus_1" }),
        },
        checkout: {
          sessions: {
            ...base.checkout.sessions,
            create: (params: Record<string, unknown>) => {
              h.sessions.push(params);
              return Promise.resolve({ id: "cs_test_1", client_secret: "cs_test_1_secret" });
            },
          },
        },
      };
    },
  };
});

const { callServerFn } = await import("@/test/serverFn");
const { createPlanCheckoutSession } = await import("@/lib/billing/stripeCheckout.functions");

freezeClock();

interface SessionParams {
  mode?: string;
  metadata?: Record<string, string>;
  subscription_data?: { metadata?: Record<string, string> };
  payment_intent_data?: { metadata?: Record<string, string> };
}

let chain: SupabaseFromStub;

function context() {
  return {
    supabase: {
      from: (table: string) => chain.from(table),
      rpc: (fn: string) =>
        Promise.resolve(
          fn === "payment_order_mark_session" ? ok(true) : fail(`test: nieoczekiwane RPC ${fn}`),
        ),
    },
    userId: "user-kupujacy",
    claims: { email: "kupujacy@example.org" },
  };
}

function planCall(over: Record<string, unknown> = {}) {
  return callServerFn<{ ok: boolean }>(
    createPlanCheckoutSession,
    { priceId: "plus_monthly", planId: PLAN_ID, returnUrl: RETURN_URL, ...over },
    context(),
  );
}

const lastSession = () => h.sessions.at(-1) as SessionParams | undefined;
const consentKeys = (metadata: Record<string, string> | undefined) =>
  Object.keys(metadata ?? {}).filter((key) => key.startsWith("newsletterConsent"));

beforeEach(() => {
  h.sessions.length = 0;
  h.prices = [{ id: "price_1", lookup_key: "plus_monthly", type: "recurring" }];
  vi.stubEnv("BILLING_RETURN_HOSTS", "kasa.example.org");
  vi.stubEnv("LOVABLE_API_KEY", "klucz-testowy-bramki");
  vi.stubEnv("STRIPE_SANDBOX_API_KEY", "klucz-testowy-piaskownicy");

  chain = supabaseFromStub();
  chain.setResponse(
    "access_plans",
    ok({ id: PLAN_ID, price_cents: 4900, currency: "PLN", active: true, trial_days: 0 }),
  );
  chain.setResponse("payment_orders", ok({ id: "order-1", tenant_id: "tenant-alfa" }));
  chain.setResponse(
    "checkout_settings",
    ok({
      allow_promotion_codes: true,
      automatic_tax: false,
      tax_id_collection: true,
      billing_address_collection: "auto",
      invoice_creation: true,
    }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createPlanCheckoutSession - zgoda na newsletter (SUB-15)", () => {
  it("pole niezaznaczone: w sesji i subskrypcji nie ma ani jednego klucza zgody", async () => {
    await expect(planCall()).resolves.toMatchObject({ ok: true });

    expect(consentKeys(lastSession()?.metadata)).toEqual([]);
    expect(consentKeys(lastSession()?.subscription_data?.metadata)).toEqual([]);
    expect(readPremiumNewsletterConsentMetadata(lastSession()?.subscription_data?.metadata)).toBe(
      null,
    );
  });

  it("zaznaczone pole: wersja, język i chwila serwera w metadanych sesji i subskrypcji", async () => {
    await planCall({
      newsletterConsent: { version: PREMIUM_NEWSLETTER_CONSENT_VERSION, lang: "en" },
    });

    const expected = {
      version: PREMIUM_NEWSLETTER_CONSENT_VERSION,
      lang: "en",
      at: FIXED_NOW_ISO,
      orderId: "order-1",
    };
    // Webhook subskrypcji czyta `subscription_data.metadata` - to jest ścieżka
    // krytyczna. Identyfikatory konta i zamówienia zostają obok zgody.
    expect(
      readPremiumNewsletterConsentMetadata(lastSession()?.subscription_data?.metadata),
    ).toEqual(expected);
    expect(lastSession()?.subscription_data?.metadata).toMatchObject({
      userId: "user-kupujacy",
      planId: PLAN_ID,
      orderId: "order-1",
    });
    expect(readPremiumNewsletterConsentMetadata(lastSession()?.metadata)).toEqual(expected);
  });

  it.each([
    ["nieznana wersja treści", { version: "1999-01-01", lang: "pl" }],
    ["język spoza pl/en", { version: PREMIUM_NEWSLETTER_CONSENT_VERSION, lang: "de" }],
    // Chwilę zgody stempluje serwer - klient nie może jej ustawić ani cofnąć.
    [
      "chwila podana przez klienta",
      { version: PREMIUM_NEWSLETTER_CONSENT_VERSION, lang: "pl", at: "2001-01-01T00:00:00.000Z" },
    ],
  ])("%s: odmowa walidacji, sesja nie powstaje", async (_, newsletterConsent) => {
    await expect(planCall({ newsletterConsent })).rejects.toThrow();

    expect(h.sessions).toHaveLength(0);
    expect(chain.chainsFor("payment_orders")).toHaveLength(0);
  });

  it("cena jednorazowa: zgoda nie jedzie do operatora (nie ma skutku zakupu, który by ją zapisał)", async () => {
    h.prices = [{ id: "price_1", lookup_key: "plus_monthly", type: "one_time" }];

    await planCall({
      newsletterConsent: { version: PREMIUM_NEWSLETTER_CONSENT_VERSION, lang: "pl" },
    });

    expect(lastSession()?.mode).toBe("payment");
    expect(consentKeys(lastSession()?.metadata)).toEqual([]);
    expect(consentKeys(lastSession()?.payment_intent_data?.metadata)).toEqual([]);
  });
});
