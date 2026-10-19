// Kasa planu w lejku czytelnika (S3, P18): `checkout_view` raz na plan
// i `checkout_submit` przy wysłaniu formularza - zdarzenia klienta wyłącznie
// przy zgodzie analitycznej. Harness jak `checkoutPlanRoute.test.tsx`
// (atrapy na granicach sieci).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { AccessPlan, BillingProfile } from "@/lib/billing/types";
import type { ValidateCouponResult } from "@/lib/billing/coupons";
import { DEFAULT_CHECKOUT_SETTINGS, type CheckoutSettings } from "@/lib/billing/checkoutSettings";

const TENANT = "11111111-1111-1111-1111-111111111111";
const OTHER_TENANT = "22222222-2222-2222-2222-222222222222";

const h = vi.hoisted(() => ({
  session: null as { user: { id: string } } | null,
  authLoading: false,
  tenantId: null as string | null,
  plan: null as unknown,
  planError: null as Error | null,
  billing: null as unknown,
  settings: null as unknown,
  coupon: null as unknown,
  /** Subskrypcja kupującego z lustra `subscriptions` (`null` = brak historii). */
  mySubscription: null as unknown,
  planCheckout: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
  preloadStripeSdk: vi.fn(),
  track: vi.fn(),
  consent: true,
}));

vi.mock("sonner", () => ({ toast: h.toast }));
vi.mock("@/lib/analytics/track", () => ({ track: h.track, trackCta: vi.fn() }));
vi.mock("@/lib/ads/consent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ads/consent")>()),
  hasAnalyticsConsent: () => h.consent,
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    session: h.session,
    user: h.session?.user ?? null,
    tenantId: h.tenantId,
    loading: h.authLoading,
    roles: [],
    isStaff: false,
    isAdmin: false,
    isSuperAdmin: false,
    signOut: async () => {},
  }),
}));
// Granica sieci: dane planu i profilu rozliczeniowego.
vi.mock("@/lib/billing/queries", () => ({
  fetchPlanById: async () => {
    if (h.planError) throw h.planError;
    return h.plan;
  },
  fetchMyBillingProfile: async () => h.billing,
}));
// Granica sieci: subskrypcja kupującego (podpowiedź blokady i triala w nakładce).
vi.mock("@/lib/billing/subscriptionQueries", () => ({
  fetchMyStripeSubscription: async () => h.mySubscription,
}));
vi.mock("@/hooks/useCheckoutSettings", () => ({
  useCheckoutSettings: () => ({ data: h.settings }),
}));
// Kupon: prawdziwy widget, podstawiony wyłącznie wynik RPC.
vi.mock("@/hooks/useValidateCoupon", () => ({
  useValidateCoupon: () => ({
    result: null,
    loading: false,
    validate: async () => h.coupon,
    reset: () => {},
  }),
}));
// `useCheckout` biegnie PRAWDZIWY (locale + środowisko + kształt payloadu),
// podstawiona jest dopiero server function po drugiej stronie granicy.
vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start")>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});
vi.mock("@/lib/billing/stripeCheckout.functions", () => ({
  createPlanCheckoutSession: (args: unknown) => h.planCheckout(args),
}));
// Kurs NBP: moduł sam strzela do api.nbp.pl przy imporcie w przeglądarce, a test
// ma być deterministyczny i BEZ sieci - stały kurs 4,00 daje jawne przeliczenie
// 99,00 PLN -> 24,75 EUR.
vi.mock("@/lib/billing/fxRate", () => ({
  getEurPlnRate: () => 4,
  ensureFxRateLoaded: async () => 4,
  forceRefreshFxRate: async () => 4,
  getFxState: () => ({ eurPln: 4, source: "nbp" as const }),
  setEurPlnRateForTests: () => {},
}));
vi.mock("@/lib/stripe", () => ({
  isPaymentsConfigured: () => true,
  getStripeEnvironment: () => "sandbox" as const,
  getStripeEnvironmentSafe: () => "sandbox" as const,
  preloadStripeSdk: h.preloadStripeSdk,
}));
// Ramka operatora ma własny test granicy leniwego chunku - tutaj jest sondą,
// żeby nie ściągać SDK Stripe do testu trasy.
vi.mock("@/components/checkout/EmbeddedCheckoutFrame", () => ({
  EmbeddedCheckoutFrame: ({ clientSecret }: { clientSecret: string }) => (
    <div data-testid="checkout-frame" data-secret={clientSecret} />
  ),
}));
// Formularz danych do faktury ma własny test - tu liczy się tylko to, że lejek
// pokazuje go W MIEJSCU, zamiast wyrzucać kupującego na /profile/billing.
vi.mock("@/components/billing/molecules/BillingProfileForm", () => ({
  BillingProfileForm: ({ submitLabel }: { submitLabel?: string }) => (
    <form data-testid="billing-form">
      <button type="button">{submitLabel}</button>
    </form>
  ),
}));

import i18n from "@/lib/i18n";
import { formatMoney } from "@/lib/billing/types";
import { renderRoute } from "@/test/routeHarness";
import { Route as PlanRoute } from "@/routes/checkout.$planId";
import {
  PREMIUM_NEWSLETTER_CONSENT_TEXTS,
  PREMIUM_NEWSLETTER_CONSENT_VERSION,
} from "@/lib/billing/premiumNewsletter";

const PATH = "/checkout/$planId";
const PLAN_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function plan(over: Partial<AccessPlan> = {}): AccessPlan {
  return {
    id: PLAN_ID,
    tenant_id: TENANT,
    name_pl: "Plan Pro",
    name_en: "Pro plan",
    description_pl: "Pełny dostęp do analiz.",
    description_en: "Full access to the analyses.",
    price_cents: 9900,
    currency: "PLN",
    interval: "month",
    active: true,
    sort_order: 1,
    features_pl: [],
    features_en: [],
    badge_pl: null,
    badge_en: null,
    highlighted: false,
    trial_days: 0,
    tier_key: "pro",
    for_sale: true,
    ...over,
  };
}

function billingProfile(over: Partial<BillingProfile> = {}): BillingProfile {
  return {
    address_line1: "Krucza 1",
    address_line2: null,
    city: "Warszawa",
    postal_code: "00-001",
    country_code: "PL",
    full_name: "Anna Nowak",
    company: null,
    tax_id: null,
    is_company: false,
    ...over,
  } as BillingProfile;
}

function couponResult(over: Partial<ValidateCouponResult> = {}): ValidateCouponResult {
  return {
    ok: true,
    error: null,
    coupon_id: "c-1",
    discount_cents: 1900,
    final_cents: 8000,
    label: "-19 zł",
    discount_kind: "amount",
    discount_percent: null,
    ...over,
  } as ValidateCouponResult;
}

async function mount(planId = PLAN_ID) {
  return renderRoute({ route: PlanRoute, path: PATH, initialEntry: `/checkout/${planId}` });
}

/** Kupujący z kompletem danych - domyślny stan „gotowy do zapłaty". */
function signedInBuyer(): void {
  h.session = { user: { id: "u-1" } };
  h.tenantId = TENANT;
  h.billing = billingProfile();
}

const payButton = () => screen.getByRole("button", { name: /Zapłać/ });

/** Intl wstawia twardą spację - porównujemy tekst po normalizacji białych znaków. */
const flat = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ");
const money = (cents: number, currency = "PLN", lang = "pl") =>
  flat(formatMoney(cents, currency, lang));
const showsMoney = (el: Element | null, cents: number, currency = "PLN", lang = "pl") =>
  flat(el?.textContent).includes(money(cents, currency, lang));

beforeAll(async () => {
  await i18n.changeLanguage("pl");
  // FxRateNotice odpytuje własny endpoint kursu - w teście odpowiada kanon.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        status: "ok",
        eurPln: 4,
        effectiveDate: "2026-08-13",
        source: "nbp",
        fetchedAt: "2026-08-14T06:00:00.000Z",
        lastSuccessAt: "2026-08-14T06:00:00.000Z",
        lastError: null,
        lastAttempts: 1,
        stale: false,
      }),
    ),
  );
});

beforeEach(() => {
  h.session = null;
  h.authLoading = false;
  h.tenantId = null;
  h.plan = plan();
  h.planError = null;
  h.billing = null;
  h.settings = DEFAULT_CHECKOUT_SETTINGS satisfies CheckoutSettings;
  h.coupon = couponResult();
  h.mySubscription = null;
  h.planCheckout.mockReset().mockResolvedValue({
    ok: true,
    clientSecret: "cs_test_123",
    orderId: "ord_1",
  });
  h.toast.error.mockReset();
  h.preloadStripeSdk.mockReset();
  h.track.mockReset();
  h.consent = true;
});

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("pl");
});

describe("trasa /checkout/$planId - pomiar lejka (P18)", () => {
  it("checkout_view raz na plan, checkout_submit przy zapłacie", async () => {
    signedInBuyer();
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: /Zapłać/ }));
    await waitFor(() => expect(h.planCheckout).toHaveBeenCalledTimes(1));
    const types = h.track.mock.calls.map((call) => (call[0] as { type: string }).type);
    expect(types.filter((type) => type === "checkout_view")).toHaveLength(1);
    expect(types).toContain("checkout_submit");
    expect(h.track).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "checkout_submit",
        name: "checkout_submit",
        entityType: "plan",
        entityId: PLAN_ID,
      }),
    );
  });

  it("bez zgody analitycznej: kasa działa, zdarzeń klienta brak", async () => {
    h.consent = false;
    signedInBuyer();
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: /Zapłać/ }));
    await waitFor(() => expect(h.planCheckout).toHaveBeenCalledTimes(1));
    expect(h.track).not.toHaveBeenCalled();
  });
});
