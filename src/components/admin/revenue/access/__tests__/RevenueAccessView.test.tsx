// Zakładka „Dostęp" (`RevenueAccessTab` + `RevenueAccessView`, S7).
//
// CO TEN PLIK DOWODZI.
//   1. Zakładka zachowuje `data-testid="revenue-tab-access"`, zamiast stanu
//      „w przygotowaniu" pokazuje politykę (`h2`), role dokładne.
//   2. Zdanie polityki z inwentarza i ustawień licznika, ślepe zaułki S3.
//   3. Lista kontrolna z reguł S7-A obszarów ściany, licznika i kasy (stan
//      słowem, „Napraw" do Diagnostyki z `?fix=`), pomiar paywalla z 30 dni.
//   4. Karta licznika S1 montowana jako organizm modułu: redaktor - `readOnly`.
//   5. Bez najemcy: zero zapytań i bez karty licznika; axe bez naruszeń.
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  fetchInventory: vi.fn(),
  fetchMetering: vi.fn(),
  fetchFacts: vi.fn(),
  fetchFunnel: vi.fn(),
  meteringCard: vi.fn(),
  auth: {
    roles: ["admin"] as string[],
    tenantId: "11111111-1111-4111-8111-111111111111" as string | undefined,
  },
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
  useHydrated: () => true,
  useSearch: () => ({}),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => h.auth }));
vi.mock("@/lib/revenue/access/access.functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/revenue/access/access.functions")>()),
  getRevenueAccessInventory: () => h.fetchInventory(),
}));
vi.mock("@/lib/access/meteringQueries", async () => {
  const { meteringKeys } = await import("@/lib/access/keys");
  return {
    meteringSettingsQueryOptions: () => ({
      queryKey: meteringKeys.settings(),
      queryFn: () => h.fetchMetering(),
    }),
  };
});
vi.mock("@/lib/revenue/diagnostics/diagnostics.functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/revenue/diagnostics/diagnostics.functions")>()),
  getRevenueFacts: () => h.fetchFacts(),
  getRevenueSnoozes: async () => ({ state: "ready", snoozes: [] }),
}));
vi.mock("@/lib/revenue/funnel/funnel.functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/revenue/funnel/funnel.functions")>()),
  getRevenueFunnel: (...args: unknown[]) => h.fetchFunnel(...args),
}));
// Karta licznika to organizm modułu S1 z własnymi testami - tu liczy się,
// czy hub ją montuje i w jakim trybie.
vi.mock("@/components/admin/paywall/MeteringSettingsCard", () => ({
  MeteringSettingsCard: (props: { readOnly?: boolean }) => {
    h.meteringCard(props);
    return <div data-testid="metering-card" data-readonly={String(Boolean(props.readOnly))} />;
  },
}));
vi.mock("@/components/Paywall", () => ({ Paywall: () => <p>ściana</p> }));

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { axeViolations, summarize } from "@/test/axe";
import { RevenueAccessTab } from "@/components/admin/revenue/tabs/RevenueAccessTab";
import { ACCESS_INVENTORY, FUNNEL_DTO, TENANT, clone } from "../../overview/__tests__/hubFixtures";

const METER = {
  enabled: true,
  member_monthly_limit: 5,
  anon_monthly_limit: 0,
  meter_paid: true,
  meter_members: true,
  show_counter: true,
  updated_at: "2026-10-01T00:00:00+00:00",
};

function renderTab() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <RevenueAccessTab />
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  h.fetchInventory.mockReset().mockResolvedValue({
    state: "ready",
    inventory: clone(ACCESS_INVENTORY),
  });
  h.fetchMetering.mockReset().mockResolvedValue(METER);
  h.fetchFacts.mockReset().mockResolvedValue({
    state: "ready",
    facts: { v: 1, computedAt: null, areas: { metering: { settingsRow: false, meteredRules: 3 } } },
  });
  h.fetchFunnel.mockReset().mockResolvedValue({ state: "ready", funnel: clone(FUNNEL_DTO) });
  h.meteringCard.mockReset();
  h.auth = { roles: ["admin"], tenantId: TENANT };
  await i18n.changeLanguage("pl");
});

afterEach(() => cleanup());

describe("RevenueAccessTab", () => {
  it("testid zakładki, polityka w h2, bez stanu „w przygotowaniu”", async () => {
    renderTab();
    const tab = screen.getByTestId("revenue-tab-access");
    expect(
      await within(tab).findByRole("heading", { level: 2, name: "Polityka dostępu" }),
    ).toBeVisible();
    expect(tab).not.toHaveTextContent("Ta sekcja huba jest w przygotowaniu.");
    expect(await screen.findByTestId("policy-sentence")).toHaveTextContent(
      "12 treści ma regułę dostępu",
    );
    expect(screen.getByTestId("policy-sentence")).toHaveTextContent(
      "Licznik daje zalogowanym 5 darmowych artykułów w miesiącu, a goście nie dostają żadnego.",
    );
  });

  it("ślepe zaułki z inwentarza S3", async () => {
    renderTab();
    const section = await screen.findByRole("region", { name: "Ślepe zaułki i ryzyka" });
    expect(section.querySelector('[data-dead-end="tierWithoutOffer"]')).toHaveTextContent(
      "Próg bez oferty: 1",
    );
  });

  it("lista kontrolna: reguły ściany, licznika i kasy; brak licznika = do zrobienia", async () => {
    renderTab();
    const list = await screen.findByRole("list", { name: "Pozycje listy kontrolnej" });
    const metering = list.querySelector('[data-check="metering.settings_row_missing"]');
    expect(metering).toHaveAttribute("data-status", "todo");
    expect(within(metering as HTMLElement).getByRole("link", { name: "Napraw" })).toHaveAttribute(
      "href",
      "/admin/revenue/diagnostics",
    );
    const unknown = list.querySelector('[data-check="paywall.measurement_silent"]');
    expect(unknown).toHaveAttribute("data-status", "unknown");
    expect(unknown).toHaveTextContent("Nie wiadomo");
  });

  it("pomiar paywalla: data początku i uderzenia z 30 dni", async () => {
    renderTab();
    const card = await screen.findByTestId("paywall-measurement");
    expect(await within(card).findByTestId("measurement-since")).toHaveTextContent(
      "Pomiar paywalla od 1 września 2026",
    );
    const row = within(card).getByRole("rowheader", { name: "Treść płatna" }).parentElement;
    expect(row?.textContent).toBe("Treść płatna124070");
  });

  it("karta licznika S1: administrator edytuje, redaktor w trybie readOnly", async () => {
    renderTab();
    expect(await screen.findByTestId("metering-card")).toHaveAttribute("data-readonly", "false");
    cleanup();
    h.auth = { roles: ["editor"], tenantId: TENANT };
    renderTab();
    expect(await screen.findByTestId("metering-card")).toHaveAttribute("data-readonly", "true");
  });

  it("sam super_admin: RoleGateNotice, bez zapytań", async () => {
    h.auth = { roles: ["super_admin"], tenantId: TENANT };
    renderTab();
    expect(screen.getByTestId("revenue-role-gate")).toBeInTheDocument();
    await act(async () => undefined);
    expect(h.fetchInventory).not.toHaveBeenCalled();
  });

  it("bez najemcy: zero zapytań i bez karty licznika", async () => {
    h.auth = { roles: ["admin"], tenantId: undefined };
    renderTab();
    await act(async () => undefined);
    expect(screen.queryByTestId("metering-card")).toBeNull();
    for (const fn of [h.fetchInventory, h.fetchMetering, h.fetchFacts, h.fetchFunnel]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it("nie ma naruszeń dostępności", async () => {
    const { container } = renderTab();
    await screen.findByTestId("policy-sentence");
    await screen.findByRole("list", { name: "Pozycje listy kontrolnej" });
    await waitFor(() => expect(screen.getByTestId("reader-preview")).toBeInTheDocument());
    expect(summarize(await axeViolations(container))).toBe("");
  });
});
