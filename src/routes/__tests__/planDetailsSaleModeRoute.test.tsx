// Trasa /plans/$planId dla planu POZA SPRZEDAŻĄ (cennik v6.2): Zespół
// sprzedawany przez rozmowę i Partner Biznesowy wycofany ze sprzedaży.
//
// RYZYKO. Oba plany mają `for_sale = false`; różni je wyłącznie PRÓG
// (`cta_mode = 'contact'` i widoczna karta = rozmowa, w innym razie
// „wycofany"). Strona, która rozstrzyga to bez czystego odczytu progów,
// mówi abonentowi Zespołu przy blipie backendu, że jego plan zdjęto ze
// sprzedaży - zdanie o KATALOGU wypowiedziane bez katalogu. Ta sama zasada
// co „nie znaleziono" w `planDetailsRouteCacheDrop.test.tsx`.
//
// ATRAPOWANE SĄ WYŁĄCZNIE GRANICE: klient Supabase, sesja, telemetria i adres
// żądania. Router, loader (z prawdziwym `loadResilient`), zapytania
// i słowniki biegną PRAWDZIWE.
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

describe("trasa /plans/$planId - plan poza sprzedażą", () => {
  it("Zespół (rozmowa): formularz rozmowy, bez kasy, bez „wycofany” i bez okresu próbnego", async () => {
    await mount();

    expect(await screen.findByRole("button", { name: "Porozmawiajmy" })).toBeInTheDocument();
    expect(screen.queryByText(RETIRED)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Wybieram|Wybierz/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/7 dni/)).not.toBeInTheDocument();
  });

  it("Partner Biznesowy (próg ukryty) po CZYSTYM odczycie: „wycofany” z drogą do oferty", async () => {
    h.plans = [{ ...teamPlan, tier_key: "business", name_pl: "Partner Biznesowy" }];
    h.tiers = [
      membershipTier({
        id: "t-biz",
        key: "business",
        audience_key: "business",
        pricing_visible: false,
      }),
    ];
    await renderRoute({
      route: PlanRoute,
      path: "/plans/$planId",
      initialEntry: `/plans/${PLAN_ID}`,
    });

    expect(await screen.findByText(RETIRED)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Zobacz aktualną ofertę" })).toHaveAttribute(
      "href",
      "/pricing",
    );
    expect(screen.queryByRole("button", { name: "Porozmawiajmy" })).not.toBeInTheDocument();
  });

  it("odczyt progów PADŁ: ani „wycofany”, ani kasa - „nie wiemy” z ponowieniem", async () => {
    h.tiersBroken = true;
    await mount();

    expect(await screen.findByText("Ta sekcja chwilowo nie ma danych")).toBeInTheDocument();
    expect(screen.queryByText(RETIRED)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Zobacz aktualną ofertę" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Wybieram|Wybierz/ })).not.toBeInTheDocument();

    // Ponowienie dotyczy DOKŁADNIE progów - po powrocie backendu wraca rozmowa.
    const readsBeforeRetry = h.tierReads;
    h.tiersBroken = false;
    fireEvent.click(screen.getByRole("button", { name: "Spróbuj ponownie" }));

    expect(await screen.findByRole("button", { name: "Porozmawiajmy" })).toBeInTheDocument();
    expect(h.tierReads).toBeGreaterThan(readsBeforeRetry);
    expect(screen.queryByText(RETIRED)).not.toBeInTheDocument();
  });
});
