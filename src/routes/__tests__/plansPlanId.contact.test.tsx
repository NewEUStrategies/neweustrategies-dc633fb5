// P21 (S3): o rozmowie zamiast kasy decyduje PRÓG (`cta_mode = contact`),
// nie flaga sprzedaży planu. Plan W SPRZEDAŻY pod progiem „rozmowa" dostawał
// dotąd na /plans/$planId przycisk kasy, choć karta /pricing tego progu
// prowadziła do formularza. Harness jak `planDetailsSaleModeRoute.test.tsx`
// (atrapy wyłącznie na granicach).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";

const PLAN_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";

const h = vi.hoisted(() => ({
  plans: [] as unknown[],
  tiers: [] as unknown[],
  /** Odczyt progów pada (awaria backendu albo przekroczony budżet SSR). */
  tiersBroken: false,
  tierReads: 0,
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub, ok, fail } = await import("@/test/supabase/chain");
  const stub = supabaseFromStub();
  stub.setResponse("access_plans", () => ok(h.plans));
  stub.setResponse("membership_tiers", () => {
    h.tierReads += 1;
    return h.tiersBroken ? fail("test: tabela membership_tiers niedostępna") : ok(h.tiers);
  });
  return {
    supabase: {
      from: stub.from,
      auth: { getSession: async () => ({ data: { session: null } }) },
      rpc: async () => ({ data: [], error: null }),
    },
  };
});
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    session: null,
    user: null,
    roles: [],
    tenantId: null,
    loading: false,
    isStaff: false,
    isAdmin: false,
    isSuperAdmin: false,
    signOut: async () => {},
  }),
}));
vi.mock("@/lib/analytics/track", () => ({ trackCta: vi.fn() }));
vi.mock("@/lib/seo/request", () => ({
  getRequestUrl: () => `https://example.com/plans/${PLAN_ID}`,
  getOrigin: () => "https://example.com",
}));
vi.mock("@/lib/contact.functions", () => ({ submitContactMessage: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { renderRoute } from "@/test/routeHarness";
import { accessPlan } from "@/test/billing/fixtures";
import { membershipTier } from "@/test/admin/pricingFixtures";
import { Route as PlanRoute } from "@/routes/plans.$planId";

const RETIRED =
  "Ten plan został wycofany ze sprzedaży. Obecni członkowie zachowują go na dotychczasowych warunkach do końca subskrypcji.";

const teamPlan = accessPlan({
  id: PLAN_ID,
  tier_key: "team",
  name_pl: "Zespół",
  interval: "month",
  price_cents: 8900,
  trial_days: 7,
  for_sale: false,
});
const teamTier = membershipTier({
  id: "t-team",
  key: "team",
  name_pl: "Zespół",
  audience_key: "team",
  cta_mode: "contact",
  pricing_visible: true,
});

async function mount() {
  await renderRoute({
    route: PlanRoute,
    path: "/plans/$planId",
    initialEntry: `/plans/${PLAN_ID}`,
  });
  expect(await screen.findByRole("heading", { level: 1, name: "Zespół" })).toBeInTheDocument();
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  h.plans = [teamPlan];
  h.tiers = [teamTier];
  h.tiersBroken = false;
  h.tierReads = 0;
});

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("pl");
});

describe("trasa /plans/$planId - próg sprzedawany przez rozmowę (P21)", () => {
  it("plan w sprzedaży pod progiem cta_mode=contact: formularz rozmowy, bez kasy", async () => {
    h.plans = [{ ...teamPlan, for_sale: true }];
    await mount();
    expect(await screen.findByRole("button", { name: "Porozmawiajmy" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Wybieram|Wybierz/ })).not.toBeInTheDocument();
    expect(screen.queryByText(RETIRED)).not.toBeInTheDocument();
  });

  it("plan w sprzedaży pod progiem z kasą (cta_mode=auto): kasa jak dotąd", async () => {
    h.plans = [{ ...teamPlan, for_sale: true }];
    h.tiers = [{ ...teamTier, cta_mode: "auto" }];
    await mount();
    expect(await screen.findByRole("link", { name: /Wybieram|Wybierz/ })).toHaveAttribute(
      "href",
      `/checkout/${PLAN_ID}`,
    );
    expect(screen.queryByRole("button", { name: "Porozmawiajmy" })).not.toBeInTheDocument();
  });

  it("formularz rozmowy otwiera się z planem jako tematem", async () => {
    h.plans = [{ ...teamPlan, for_sale: true }];
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: "Porozmawiajmy" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});
