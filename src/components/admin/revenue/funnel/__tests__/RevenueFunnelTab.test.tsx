// Zakładka „Lejek" (S7) - podmiana zaślepki I0, tor i krok w adresie, role.
//
// CO TEN PLIK DOWODZI.
//   1. Zakładka zachowuje `data-testid="revenue-tab-funnel"` i nazwę
//      eksportu, a zamiast stanu „w przygotowaniu" pokazuje lejek (`h2`).
//   2. Przed hydratacją - wyłącznie „wczytywanie" (SSR = klient).
//   3. Role DOKŁADNE: autor i sam `super_admin` dostają `RoleGateNotice`.
//   4. Tor `?track=` jest przełącznikiem z `aria-pressed`, który pisze do
//      adresu; tor Sprzedaż pokazuje etapy CRM i zadania, samoobsługa - nie.
//   5. `?stage=` otwiera arkusz kroku; wartość spoza listy - nic.
//   6. Bez najemcy karty nie wysyłają zapytań; axe bez naruszeń.
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RevenueHubSearch } from "@/lib/revenue/search";

const h = vi.hoisted(() => ({
  fetchFunnel: vi.fn(),
  navigate: vi.fn(),
  hydrated: true,
  search: {} as Record<string, unknown>,
  auth: {
    roles: ["admin"] as string[],
    tenantId: "11111111-1111-4111-8111-111111111111" as string | undefined,
  },
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
  useHydrated: () => h.hydrated,
  useSearch: () => h.search,
  useNavigate: () => h.navigate,
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => h.auth }));
vi.mock("@/lib/revenue/funnel/funnel.functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/revenue/funnel/funnel.functions")>()),
  getRevenueFunnel: (...args: unknown[]) => h.fetchFunnel(...args),
}));
vi.mock("@/components/admin/analytics/semantic/hooks/useBenchmark", async (importOriginal) => {
  const { noBenchmark } = await import("./funnelTestKit");
  return {
    ...(await importOriginal<
      typeof import("@/components/admin/analytics/semantic/hooks/useBenchmark")
    >()),
    useBenchmark: noBenchmark,
  };
});

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { axeViolations, summarize } from "@/test/axe";
import { RevenueFunnelTab } from "@/components/admin/revenue/tabs/RevenueFunnelTab";
import { FUNNEL_DTO, TENANT, clone } from "../../overview/__tests__/hubFixtures";
import { renderWithClient } from "./funnelTestKit";

beforeEach(async () => {
  h.fetchFunnel.mockReset();
  h.fetchFunnel.mockResolvedValue({ state: "ready", funnel: clone(FUNNEL_DTO) });
  h.navigate.mockReset();
  h.hydrated = true;
  h.search = {};
  h.auth = { roles: ["admin"], tenantId: TENANT };
  await i18n.changeLanguage("pl");
});

afterEach(() => cleanup());

/** Wynik funkcji `search` przekazanej do `navigate` na danym adresie. */
function nextSearch(prev: RevenueHubSearch = {}): RevenueHubSearch {
  const call = h.navigate.mock.calls.at(-1)?.[0] as {
    search: (p: RevenueHubSearch) => RevenueHubSearch;
  };
  return call.search(prev);
}

describe("RevenueFunnelTab - podmiana zaślepki i role", () => {
  it("zachowuje testid, pokazuje lejek (h2), nie stan „w przygotowaniu”", async () => {
    renderWithClient(<RevenueFunnelTab />);
    const tab = screen.getByTestId("revenue-tab-funnel");
    expect(
      await within(tab).findByRole("heading", { level: 2, name: "Lejek czytelnika" }),
    ).toBeVisible();
    expect(tab).not.toHaveTextContent("Ta sekcja huba jest w przygotowaniu.");
    await within(tab).findByRole("list", { name: "Kroki lejka samoobsługowego" });
  });

  it("przed hydratacją: wyłącznie „wczytywanie”", () => {
    h.hydrated = false;
    renderWithClient(<RevenueFunnelTab />);
    expect(screen.getByTestId("revenue-tab-funnel")).toHaveTextContent("Wczytywanie sekcji…");
    expect(h.fetchFunnel).not.toHaveBeenCalled();
  });

  it.each([[["author"]], [["super_admin"]]])(
    "role %o: RoleGateNotice, bez zapytań",
    async (roles) => {
      h.auth = { roles, tenantId: TENANT };
      renderWithClient(<RevenueFunnelTab />);
      expect(screen.getByTestId("revenue-role-gate")).toBeInTheDocument();
      await act(async () => undefined);
      expect(h.fetchFunnel).not.toHaveBeenCalled();
    },
  );

  it("redaktor widzi lejek bez kwot", async () => {
    h.auth = { roles: ["editor"], tenantId: TENANT };
    h.fetchFunnel.mockResolvedValue({
      state: "ready",
      funnel: { ...(clone(FUNNEL_DTO) as object), amountsVisible: false },
    });
    renderWithClient(<RevenueFunnelTab />);
    expect(await screen.findByTestId("funnel-paid-amount")).toHaveTextContent(
      "Kwoty widzą administratorzy.",
    );
  });

  it("bez najemcy: stan karty, żadnego zapytania", async () => {
    h.auth = { roles: ["admin"], tenantId: undefined };
    renderWithClient(<RevenueFunnelTab />);
    expect(
      (await screen.findAllByText("Wybierz obszar roboczy, żeby zobaczyć dane huba.")).length,
    ).toBeGreaterThan(0);
    expect(h.fetchFunnel).not.toHaveBeenCalled();
  });
});

describe("RevenueFunnelTab - tor i krok w adresie", () => {
  it("tor: aria-pressed na bieżącym, wybór pisze ?track= do adresu", async () => {
    renderWithClient(<RevenueFunnelTab />);
    const group = await screen.findByRole("group", { name: "Tor lejka" });
    expect(within(group).getByRole("button", { name: "Oba tory" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(within(group).getByRole("button", { name: "Sprzedaż (CRM)" }));
    expect(nextSearch({ w: "quarter" })).toEqual({ w: "quarter", track: "sales" });
  });

  it("tor Sprzedaż: etapy CRM i zadania; samoobsługa - bez karty sprzedaży", async () => {
    h.search = { track: "sales" };
    renderWithClient(<RevenueFunnelTab />);
    const sales = await screen.findByTestId("sales-track");
    expect(await within(sales).findByRole("list", { name: "Etapy toru sprzedaży" })).toBeVisible();
    expect(within(sales).getByText("Zaległe zadania")).toBeVisible();
    expect(screen.queryByTestId("funnel-stage-map")).toBeNull();
    cleanup();

    h.search = { track: "self_serve" };
    renderWithClient(<RevenueFunnelTab />);
    await screen.findByTestId("funnel-stage-map");
    expect(screen.queryByTestId("sales-track")).toBeNull();
  });

  it("?stage=paywall otwiera arkusz kroku; zamknięcie czyści adres", async () => {
    h.search = { stage: "paywall" };
    renderWithClient(<RevenueFunnelTab />);
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("Krok lejka: Trafili na paywall")).toBeVisible();
    await waitFor(() => expect(within(sheet).getByText(/^15\s?%$/)).toBeVisible());
    expect(within(sheet).getByRole("link", { name: "Otwórz moduł" })).toHaveAttribute(
      "href",
      "/admin/paywall",
    );
    fireEvent.keyDown(sheet, { key: "Escape" });
    expect(nextSearch({ stage: "paywall", w: "month" })).toEqual({ stage: undefined, w: "month" });
  });

  it("?stage= spoza listy kroków nie otwiera niczego", async () => {
    h.search = { stage: "nope" };
    renderWithClient(<RevenueFunnelTab />);
    await screen.findByTestId("funnel-stage-map");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("nie ma naruszeń dostępności", async () => {
    const { container } = renderWithClient(<RevenueFunnelTab />);
    await screen.findByRole("list", { name: "Kroki lejka samoobsługowego" });
    await screen.findByRole("group", { name: "Paywall: zasięg i konwersja razem" });
    expect(summarize(await axeViolations(container))).toBe("");
  });
});
