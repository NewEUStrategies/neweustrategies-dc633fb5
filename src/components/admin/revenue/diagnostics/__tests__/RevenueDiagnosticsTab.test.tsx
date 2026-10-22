// `RevenueDiagnosticsTab` (S7, SPEC §2.2 `diagnostics`) - treść zakładki
// zamiast zaślepki I0.
//
// CO TEN PLIK DOWODZI (karta S7.1):
//   1. Kontrakt montażu: eksport `RevenueDiagnosticsTab` i opakowanie
//      `data-testid="revenue-tab-diagnostics"` (mapa `RevenueTabOutlet`
//      i testy tras I0), bez `RevenueTabPreparing`.
//   2. `useHydrated()`: do hydratacji stan „wczytywanie" i ZERO zapytań -
//      znacznik serwera = pierwszy render klienta.
//   3. Role DOKŁADNE: autor i sam `super_admin` dostają `RoleGateNotice`
//      bez wywołania RPC; admin i redaktor - tablicę.
//   4. Adres: parametry `?area/view/finding/fix` idą z walidatora układu,
//      a zmiana to nowy wpis historii (`navigate` scala łatkę z adresem).
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  hydrated: true,
  search: {} as Record<string, unknown>,
  navigate: vi.fn(),
  auth: { roles: ["admin"] as string[], tenantId: "11111111-1111-4111-8111-111111111111" },
  fetchFacts: vi.fn(),
  fetchSnoozes: vi.fn(),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
  useHydrated: () => h.hydrated,
  useSearch: () => h.search,
  useNavigate: () => h.navigate,
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => h.auth }));
vi.mock("@/lib/revenue/diagnostics/diagnostics.functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/revenue/diagnostics/diagnostics.functions")>()),
  getRevenueFacts: () => h.fetchFacts(),
  getRevenueSnoozes: () => h.fetchSnoozes(),
}));

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { realT } from "@/test/i18nReal";
import { axeViolations, summarize } from "@/test/axe";
import * as tabModule from "@/components/admin/revenue/tabs/RevenueDiagnosticsTab";
import { RevenueDiagnosticsTab } from "@/components/admin/revenue/tabs/RevenueDiagnosticsTab";
import { FACTS, factsRead, snoozesRead } from "./diagnosticsFixtures";

const t = realT("pl");

function renderTab() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <RevenueDiagnosticsTab />
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  h.hydrated = true;
  h.search = {};
  h.navigate.mockReset();
  h.auth = { roles: ["admin"], tenantId: "11111111-1111-4111-8111-111111111111" };
  h.fetchFacts.mockReset().mockResolvedValue(factsRead(FACTS));
  h.fetchSnoozes.mockReset().mockResolvedValue(snoozesRead());
});

afterEach(() => cleanup());

describe("RevenueDiagnosticsTab - kontrakt montażu", () => {
  it("eksport nazwany i opakowanie z data-testid; bez zaślepki „w przygotowaniu”", async () => {
    expect(tabModule.RevenueDiagnosticsTab).toBe(RevenueDiagnosticsTab);
    const { container } = renderTab();
    const tab = screen.getByTestId("revenue-tab-diagnostics");
    expect(await screen.findByTestId("diagnostics-board")).toBeInTheDocument();
    expect(tab).toContainElement(screen.getByTestId("diagnostics-board"));
    expect(container.querySelector("[data-tab-state]")).toBe(null);
    expect(screen.queryByText(t("adminRevenue.common.loading"))).toBe(null);
  });
});

describe("RevenueDiagnosticsTab - przed hydratacją", () => {
  it("stan „wczytywanie” i zero zapytań", () => {
    h.hydrated = false;
    renderTab();
    const tab = screen.getByTestId("revenue-tab-diagnostics");
    expect(tab).toHaveTextContent(t("adminRevenue.common.loading"));
    expect(h.fetchFacts).not.toHaveBeenCalled();
    expect(h.fetchSnoozes).not.toHaveBeenCalled();
  });
});

describe("RevenueDiagnosticsTab - role dokładne", () => {
  it.each([[["author"]], [["super_admin"]], [[]]])(
    "role %j: RoleGateNotice bez wywołania RPC",
    async (roles) => {
      h.auth = { roles, tenantId: "11111111-1111-4111-8111-111111111111" };
      renderTab();
      const gate = await screen.findByTestId("revenue-role-gate");
      expect(gate).toHaveAttribute("data-required-role", "admin_or_editor");
      expect(h.fetchFacts).not.toHaveBeenCalled();
    },
  );

  it("redaktor widzi tablicę (wyciszanie wyłączone w kartach)", async () => {
    h.auth = { roles: ["editor"], tenantId: "11111111-1111-4111-8111-111111111111" };
    renderTab();
    expect(await screen.findByTestId("diagnostics-board")).toBeInTheDocument();
  });
});

describe("RevenueDiagnosticsTab - adres", () => {
  it("parametry z walidatora układu trafiają do tablicy, zmiana scala łatkę z adresem", async () => {
    h.search = { area: "metering", w: "month" };
    renderTab();
    await screen.findByTestId("diagnostics-board");
    const select = screen.getByLabelText(t("adminRevenue.diagnostics.areaFilter"));
    expect(select).toHaveValue("metering");

    screen.getByRole("button", { name: t("adminRevenue.diagnostics.view.map") }).click();
    expect(h.navigate).toHaveBeenCalledTimes(1);
    const options = h.navigate.mock.calls[0]?.[0] as {
      to: string;
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
    };
    expect(options.to).toBe(".");
    expect(options.search({ area: "metering", w: "month" })).toEqual({
      area: "metering",
      w: "month",
      view: "map",
    });
  });

  it("axe bez naruszeń", async () => {
    const { container } = renderTab();
    await screen.findByTestId("diagnostics-board");
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
