// Zakładka „Społeczność" (S7) - podmiana zaślepki I0, role, sekcje
// `?sec=events|clubs`, kwoty per waluta tylko dla administratora, moduł
// klubów wyłączony i jeden odczyt na dziedzinę.
//
// CO TEN PLIK DOWODZI.
//   1. Zakładka zachowuje `data-testid="revenue-tab-community"` i nazwę
//      eksportu; zamiast stanu „w przygotowaniu" pokazuje sekcje (`h2`).
//   2. Przed hydratacją - wyłącznie „wczytywanie"; rola spoza huba (autor,
//      sam `super_admin`) dostaje `RoleGateNotice` bez jednego żądania.
//   3. Administrator: przychód z biletów per waluta (PLN i EUR osobno, nigdy
//      suma), tabela wydarzeń z zejściem do studia, pula biletów z udziałem.
//   4. Redaktor: te same liczby BEZ kwot - `LockedMetricTile` zamiast
//      przychodu, tabela bez kolumny kwot, kafel przychodu zablokowany.
//   5. `?sec=clubs`: lejek zgłoszeń bez ilorazu między kohortami, udział
//      przyjętych wśród decyzji, analityka klubu i skrzynka zgłoszeń.
//   6. `clubs_enabled = false`: tylko Wydarzenia + notka modułu, bez
//      przełącznika i kafli klubów - także przy `?sec=clubs`.
//   7. Karty wydarzeń i puli dzielą JEDEN odczyt; bez najemcy - zero żądań;
//      axe bez naruszeń.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AnchorHTMLAttributes } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  fetchSnapshot: vi.fn(),
  fetchEvents: vi.fn(),
  fetchClubs: vi.fn(),
  navigate: vi.fn(),
  hydrated: true,
  search: {} as Record<string, unknown>,
  auth: {
    roles: ["admin"] as string[],
    tenantId: "11111111-1111-4111-8111-111111111111" as string | undefined,
  },
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const { RouterLinkStub } = await import("@/test/routerLinkStub");
  return {
    ...(await importOriginal<typeof import("@tanstack/react-router")>()),
    // Parametry adresu (`?tab=`, `?status=`) widać w atrybucie - stub
    // routera rysuje sam `href`. Zapis jak w adresie (axe nie przyjmuje
    // cudzysłowów JSON w selektorach atrybutów).
    Link: ({
      search,
      ...props
    }: AnchorHTMLAttributes<HTMLAnchorElement> & { search?: Record<string, string> }) => (
      <RouterLinkStub
        {...props}
        data-search={search ? new URLSearchParams(search).toString() : undefined}
      />
    ),
    useHydrated: () => h.hydrated,
    useSearch: () => h.search,
    useNavigate: () => h.navigate,
  };
});
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => h.auth }));
vi.mock("@/lib/analytics/semantic/revenueSnapshot.functions", async (importOriginal) => {
  const orig =
    await importOriginal<typeof import("@/lib/analytics/semantic/revenueSnapshot.functions")>();
  return {
    ...orig,
    revenueSnapshotQueryOptions: (
      ...args: Parameters<typeof orig.revenueSnapshotQueryOptions>
    ) => ({
      ...orig.revenueSnapshotQueryOptions(...args),
      queryFn: () => h.fetchSnapshot(...args),
    }),
  };
});
vi.mock("@/lib/revenue/community/community.functions", () => ({
  getRevenueEventsSummary: (...args: unknown[]) => h.fetchEvents(...args),
  getRevenueClubsSummary: (...args: unknown[]) => h.fetchClubs(...args),
}));
vi.mock("@/components/admin/analytics/semantic/hooks/useBenchmark", async (importOriginal) => {
  const { noBenchmark } = await import("../../funnel/__tests__/funnelTestKit");
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
import { RevenueCommunityTab } from "@/components/admin/revenue/tabs/RevenueCommunityTab";
import {
  COMMUNITY_CLUB_TILES,
  COMMUNITY_EVENT_TILES,
} from "@/components/admin/revenue/community/communityTiles";
import { NOW_MS, TENANT, clone } from "../../overview/__tests__/hubFixtures";
import {
  CLUB_A,
  CLUBS_DISABLED,
  CLUBS_SUMMARY,
  EVENT_A,
  EVENT_B,
  EVENTS_SUMMARY,
  EVENTS_SUMMARY_EDITOR,
  communitySnapshot,
} from "./communityFixtures";

function renderTab() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <RevenueCommunityTab />
      </QueryClientProvider>,
    ),
    queryClient,
  };
}

function text(el: Element | null): string {
  return (el?.textContent ?? "").replace(/\s/g, " ");
}

const ALL_FETCHES = () => [h.fetchSnapshot, h.fetchEvents, h.fetchClubs];

function asEditor(): void {
  h.auth = { roles: ["editor"], tenantId: TENANT };
  h.fetchSnapshot.mockResolvedValue(communitySnapshot("editor"));
  h.fetchEvents.mockResolvedValue({ state: "ready", summary: clone(EVENTS_SUMMARY_EDITOR) });
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW_MS);
  h.fetchSnapshot.mockReset().mockResolvedValue(communitySnapshot("admin"));
  h.fetchEvents.mockReset().mockResolvedValue({ state: "ready", summary: clone(EVENTS_SUMMARY) });
  h.fetchClubs.mockReset().mockResolvedValue({ state: "ready", summary: clone(CLUBS_SUMMARY) });
  h.navigate.mockReset();
  h.hydrated = true;
  h.search = {};
  h.auth = { roles: ["admin"], tenantId: TENANT };
  await i18n.changeLanguage("pl");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("RevenueCommunityTab - zaślepka podmieniona, role i hydratacja", () => {
  it("zachowuje data-testid i pokazuje sekcje zamiast stanu „w przygotowaniu”", async () => {
    renderTab();
    const tab = screen.getByTestId("revenue-tab-community");
    expect(
      await within(tab).findByRole("heading", { level: 2, name: "Społeczność" }),
    ).toBeVisible();
    expect(
      within(tab).getByRole("heading", { level: 2, name: "Wskaźniki społeczności" }),
    ).toBeVisible();
    expect(text(tab)).not.toContain("w przygotowaniu");
  });

  it("przed hydratacją rysuje wyłącznie „wczytywanie” i nie pyta o nic", () => {
    h.hydrated = false;
    renderTab();
    expect(screen.queryByTestId("revenue-community-view")).toBeNull();
    for (const fetch of ALL_FETCHES()) expect(fetch).not.toHaveBeenCalled();
  });

  it.each([[["author"]], [["super_admin"]]])(
    "rola %j dostaje RoleGateNotice bez jednego żądania",
    async (roles) => {
      h.auth = { roles, tenantId: TENANT };
      renderTab();
      expect(await screen.findByTestId("revenue-role-gate")).toBeInTheDocument();
      for (const fetch of ALL_FETCHES()) expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("bez najemcy - zero żądań", async () => {
    h.auth = { roles: ["admin"], tenantId: undefined };
    renderTab();
    await screen.findByTestId("revenue-community-view");
    for (const fetch of ALL_FETCHES()) expect(fetch).not.toHaveBeenCalled();
  });
});

describe("Wydarzenia - administrator", () => {
  it("przychód per waluta (PLN i EUR osobno), tabela ze studiem i pula biletów", async () => {
    renderTab();
    const card = await screen.findByTestId("community-events");
    const revenue = await within(card).findByText("Przychód netto z biletów");
    const stat = revenue.closest("[data-stat]") as HTMLElement;
    expect(stat.querySelector('[data-money="primary"]')).toHaveAttribute("data-currency", "PLN");
    expect(text(stat)).toMatch(/4\s?500,00\s?zł/);
    // Druga waluta nie znika i nie dolicza się do pierwszej.
    expect(text(stat)).toContain("+1 inna waluta");
    expect(text(stat)).not.toMatch(/4\s?700/);

    const table = within(card).getByTestId("community-events-table");
    const studio = within(table).getByRole("link", {
      name: "Forum Bezpieczeństwa - otwórz w studiu wydarzenia",
    });
    expect(studio).toHaveAttribute("href", `/admin/events/${EVENT_A}/overview`);
    // Wersja angielska pusta - nazwa nie znika, bierzemy polską.
    expect(within(table).getByRole("link", { name: /^Seminarium energetyczne/ })).toHaveAttribute(
      "href",
      `/admin/events/${EVENT_B}/overview`,
    );
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((th) => th.textContent),
    ).toContain("Przychód netto");
    // Frekwencja = obecni ÷ dopuszczeni (30 / 40).
    expect(text(card.querySelector('[data-stat="attendance"]'))).toContain("75 %");

    const pool = screen.getByTestId("community-plan-pool");
    expect(within(pool).getByTestId("community-pool-total")).toHaveTextContent("6");
    expect(within(pool).getByTestId("community-pool-share")).toHaveTextContent("15 %");
    expect(within(pool).getByRole("link", { name: /Członkostwo/ })).toHaveAttribute(
      "href",
      "/admin/membership",
    );
  });

  it("karty wydarzeń i puli to JEDEN odczyt; kafle z rejestru dla wydarzeń i klubów", async () => {
    renderTab();
    await screen.findByTestId("community-pool-total");
    expect(h.fetchEvents).toHaveBeenCalledTimes(1);
    expect(h.fetchClubs).toHaveBeenCalledTimes(1);
    expect(h.fetchSnapshot).toHaveBeenCalledTimes(1);
    const tiles = [...screen.getByTestId("overview-kpi").querySelectorAll("[data-tile]")].map(
      (el) => el.getAttribute("data-tile"),
    );
    expect(tiles).toEqual(
      [...COMMUNITY_EVENT_TILES, ...COMMUNITY_CLUB_TILES].map((spec) => spec.metricId),
    );
  });

  it("odnośnik do ścieżek komunikacji prowadzi na zakładkę Ścieżek", async () => {
    renderTab();
    const link = await screen.findByRole("link", { name: "Otwórz ścieżki komunikacji" });
    expect(link).toHaveAttribute("href", "/admin/revenue/journeys");
  });

  it("segment wybrany w filtrze - zdanie, że przekroje go nie dzielą", async () => {
    h.search = { seg: "b2b_institution" };
    renderTab();
    expect(await screen.findByTestId("tab-scope-notes")).toHaveTextContent(
      "nie dzielą się na segmenty",
    );
  });
});

describe("Wydarzenia - redaktor bez kwot", () => {
  it("LockedMetricTile zamiast przychodu, tabela bez kolumny kwot, kafel zablokowany", async () => {
    asEditor();
    renderTab();
    const card = await screen.findByTestId("community-events");
    expect(await within(card).findByTestId("community-revenue-locked")).toBeInTheDocument();
    expect(card.querySelector('[data-stat="revenue"]')).toBeNull();
    expect(card.querySelector("[data-money]")).toBeNull();
    const headers = within(within(card).getByTestId("community-events-table"))
      .getAllByRole("columnheader")
      .map((th) => th.textContent);
    expect(headers).not.toContain("Przychód netto");
    const tile = screen
      .getByTestId("overview-kpi")
      .querySelector('[data-tile="event_ticket_revenue"]');
    expect(tile).toHaveAttribute("data-locked", "admin_only");
  });
});

describe("Kluby - ?sec=clubs", () => {
  it("lejek bez ilorazu między kohortami, udział przyjętych wśród decyzji, odnośniki", async () => {
    h.search = { sec: "clubs" };
    renderTab();
    const card = await screen.findByTestId("community-clubs");
    const funnel = await within(card).findByRole("list", { name: "Zgłoszenia do klubów" });
    const steps = within(funnel).getAllByRole("listitem");
    expect(steps.map((step) => step.querySelector(".tabular-nums")?.textContent)).toEqual([
      "8",
      "4",
      "3",
    ]);
    // Decyzje vs złożone - różne kohorty: kreska z powodem, nie 50 %.
    expect(text(steps[1])).toContain("Brak danych");
    expect(text(steps[2])).toContain("75 %");
    expect(text(card)).toContain("nie liczymy ich udziału w złożonych");
    expect(text(card.querySelector('[data-stat="decision-hours"]'))).toContain("20");

    const analytics = within(card).getByRole("link", { name: "Klub Energii - analityka klubu" });
    expect(analytics).toHaveAttribute("href", `/admin/community/clubs/${CLUB_A}`);
    expect(analytics).toHaveAttribute("data-search", "tab=analytics");
    expect(
      within(card).getByRole("link", { name: "Zgłoszenia czekające na decyzję" }),
    ).toHaveAttribute("data-search", "status=pending");
    expect(screen.queryByTestId("community-events")).toBeNull();
  });

  it("przełącznik sekcji pisze ?sec= do adresu (nowy wpis historii)", async () => {
    renderTab();
    const group = await screen.findByRole("group", { name: "Sekcja społeczności" });
    const clubs = within(group).getByRole("button", { name: "Kluby" });
    expect(clubs).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(clubs);
    expect(h.navigate).toHaveBeenCalledTimes(1);
    const { search } = h.navigate.mock.calls[0][0] as {
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
    };
    expect(search({ w: "quarter" })).toEqual({ w: "quarter", sec: "clubs" });
  });

  it("brak decyzji w okresie - zdanie, nie „0 godzin”", async () => {
    h.search = { sec: "clubs" };
    h.fetchClubs.mockResolvedValue({
      state: "ready",
      summary: { ...(clone(CLUBS_SUMMARY) as object), decisionHoursMedian: null },
    });
    renderTab();
    const card = await screen.findByTestId("community-clubs");
    expect(text(await within(card).findByText("Brak decyzji w okresie"))).toBe(
      "Brak decyzji w okresie",
    );
  });
});

describe("Moduł klubów wyłączony", () => {
  it("tylko Wydarzenia i notka - bez przełącznika i kafli klubów, także przy ?sec=clubs", async () => {
    h.search = { sec: "clubs" };
    h.fetchClubs.mockResolvedValue({ state: "ready", summary: clone(CLUBS_DISABLED) });
    renderTab();
    expect(await screen.findByTestId("community-clubs-disabled")).toHaveTextContent(
      "Moduł klubów jest wyłączony",
    );
    expect(await screen.findByTestId("community-events")).toBeInTheDocument();
    expect(screen.queryByTestId("community-clubs")).toBeNull();
    expect(screen.queryByRole("group", { name: "Sekcja społeczności" })).toBeNull();
    const tiles = [...screen.getByTestId("overview-kpi").querySelectorAll("[data-tile]")].map(
      (el) => el.getAttribute("data-tile"),
    );
    expect(tiles).toEqual(COMMUNITY_EVENT_TILES.map((spec) => spec.metricId));
  });
});

describe("stany kart i dostępność", () => {
  it("brak funkcji w bazie - zdanie słownika społeczności, nie toast", async () => {
    h.fetchEvents.mockResolvedValue({ state: "unavailable" });
    renderTab();
    const card = await screen.findByTestId("community-events");
    expect(
      await within(card).findByText("Dane społeczności pojawią się po zakończeniu wdrożenia."),
    ).toBeVisible();
  });

  it("axe bez naruszeń - Wydarzenia (admin), Kluby, redaktor", async () => {
    const first = renderTab();
    await screen.findByTestId("community-pool-total");
    await act(async () => undefined);
    expect(summarize(await axeViolations(first.container))).toBe("");
    cleanup();

    h.search = { sec: "clubs" };
    const clubs = renderTab();
    await screen.findByTestId("community-clubs-table");
    expect(summarize(await axeViolations(clubs.container))).toBe("");
    cleanup();

    h.search = {};
    asEditor();
    const editor = renderTab();
    await screen.findByTestId("community-revenue-locked");
    expect(summarize(await axeViolations(editor.container))).toBe("");
  });
});
