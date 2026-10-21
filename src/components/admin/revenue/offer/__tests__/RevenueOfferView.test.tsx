// Zakładka „Oferta" (`RevenueOfferTab` + `RevenueOfferView`, S7).
//
// CO TEN PLIK DOWODZI.
//   1. Zakładka zachowuje `data-testid="revenue-tab-offer"`, zamiast stanu
//      „w przygotowaniu" pokazuje macierz oferty (`h2`) - po polsku
//      i po angielsku.
//   2. Redaktor widzi ofertę w trybie podglądu (notka nad sekcją).
//   3. `?sec=discounts` przenosi fokus na rabaty; odnośniki prowadzą do
//      modułu kuponów (kontrakt §2.6).
//   4. Kasa w jednym zdaniu z faktów S7-A: waluty, okno porzucenia przez
//      `Intl` (24 godziny), ścieżka porzuconego koszyka; brak faktu = „nie
//      udało się odczytać".
//   5. axe bez naruszeń.
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  fetchOffer: vi.fn(),
  fetchTiers: vi.fn(),
  fetchFacts: vi.fn(),
  search: {} as Record<string, unknown>,
  auth: { roles: ["admin"] as string[], tenantId: "11111111-1111-4111-8111-111111111111" },
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
  useHydrated: () => true,
  useSearch: () => h.search,
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => h.auth }));
vi.mock("@/lib/revenue/finance/finance.functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/revenue/finance/finance.functions")>()),
  getRevenueOfferMatrix: (...args: unknown[]) => h.fetchOffer(...args),
}));
vi.mock("@/components/admin/membership/membershipQueries", async () => {
  const { billingKeys } = await import("@/lib/billing/keys");
  return {
    adminMembershipTiersQueryOptions: () => ({
      queryKey: billingKeys.admin.membershipTiers(),
      queryFn: () => h.fetchTiers(),
    }),
  };
});
vi.mock("@/lib/revenue/diagnostics/diagnostics.functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/revenue/diagnostics/diagnostics.functions")>()),
  getRevenueFacts: () => h.fetchFacts(),
}));
vi.mock("@/components/admin/paywall/AccessPlanEditorDialog", () => ({
  AccessPlanEditorDialog: () => null,
}));

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { axeViolations, summarize } from "@/test/axe";
import { RevenueOfferTab } from "@/components/admin/revenue/tabs/RevenueOfferTab";
import { OFFER_MATRIX, TENANT, clone } from "../../overview/__tests__/hubFixtures";
import { TIER_ROWS } from "./offerTestKit";

const CHECKOUT_FACTS = {
  v: 1,
  computedAt: null,
  areas: {
    checkout: {
      settingsRow: true,
      abandonAfterMinutes: 1440,
      abandonedJourneyActive: false,
      chargeCurrencies: ["PLN", "EUR"],
    },
  },
};

function renderTab() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <RevenueOfferTab />
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  h.fetchOffer.mockReset().mockResolvedValue({ state: "ready", data: clone(OFFER_MATRIX) });
  h.fetchTiers.mockReset().mockResolvedValue(clone(TIER_ROWS));
  h.fetchFacts.mockReset().mockResolvedValue({ state: "ready", facts: clone(CHECKOUT_FACTS) });
  h.search = {};
  h.auth = { roles: ["admin"], tenantId: TENANT };
  await i18n.changeLanguage("pl");
});

afterEach(() => cleanup());

describe("RevenueOfferTab", () => {
  it("testid zakładki, macierz oferty w h2, bez stanu „w przygotowaniu”", async () => {
    renderTab();
    const tab = screen.getByTestId("revenue-tab-offer");
    expect(within(tab).getByRole("heading", { level: 2, name: "Macierz oferty" })).toBeVisible();
    expect(tab).not.toHaveTextContent("Ta sekcja huba jest w przygotowaniu.");
    await within(tab).findByTestId("matrix-conflicts");
    expect(screen.queryByTestId("offer-editor-preview")).toBeNull();
  });

  it("po angielsku", async () => {
    await i18n.changeLanguage("en");
    renderTab();
    const tab = screen.getByTestId("revenue-tab-offer");
    expect(within(tab).getByRole("heading", { level: 2, name: "Offer matrix" })).toBeVisible();
    expect(tab).not.toHaveTextContent("This hub section is being prepared.");
  });

  it("redaktor: notka trybu podglądu nad ofertą", async () => {
    h.auth = { roles: ["editor"], tenantId: TENANT };
    renderTab();
    expect(screen.getByTestId("offer-editor-preview")).toHaveTextContent(
      "Redaktor widzi tę sekcję w trybie podglądu",
    );
  });

  it("?sec=discounts: fokus na rabatach, odnośniki do modułu kuponów", async () => {
    h.search = { sec: "discounts" };
    renderTab();
    const discounts = screen.getByTestId("offer-discounts");
    const heading = within(discounts).getByRole("heading", { name: "Rabaty i kupony" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(
      within(discounts)
        .getAllByRole("link")
        .map((a) => a.getAttribute("href")),
    ).toEqual(["/admin/coupons", "/admin/coupons/campaigns", "/admin/coupons/analytics"]);
  });

  it("kasa w jednym zdaniu: waluty, okno porzucenia przez Intl, ścieżka koszyka", async () => {
    renderTab();
    const sentence = await screen.findByTestId("checkout-sentence");
    await waitFor(() =>
      expect(sentence).toHaveTextContent(
        "Kasa obciąża w walutach: PLN, EUR. Porzucenie liczymy po 24 godziny bez płatności, a porzuconego koszyka nie obsługuje żadna aktywna ścieżka.",
      ),
    );
  });

  it("brak faktu kasy = „nie udało się odczytać”, nie zgadnięta wartość", async () => {
    h.fetchFacts.mockResolvedValue({
      state: "ready",
      facts: { v: 1, computedAt: null, areas: {} },
    });
    renderTab();
    await waitFor(() =>
      expect(screen.getByTestId("checkout-sentence")).toHaveTextContent(
        "Ustawień kasy nie udało się teraz odczytać.",
      ),
    );
  });

  it("nie ma naruszeń dostępności", async () => {
    const { container } = renderTab();
    await screen.findByTestId("matrix-conflicts");
    await screen.findByRole("table", { name: "Plany w walucie PLN" });
    expect(summarize(await axeViolations(container))).toBe("");
  });
});
