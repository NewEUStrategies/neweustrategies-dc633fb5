// Aktywne ścieżki wydarzeń na Pulpicie studia (SPEC §2.7, montaż I9).
//
// CO TEN PLIK DOWODZI:
//   1. UCZCIWA SKALA: liczą się wyłącznie AKTYWNE ścieżki z wyzwalaczem
//      wydarzenia (`event.*`) - wstrzymana ścieżka zapisu i aktywna ścieżka
//      kasy nie podbijają liczby.
//   2. ZERO DODATKOWYCH ZAPYTAŃ: ten sam klucz co licznik Ścieżek w hubie
//      (`journeyKeys.list(tenant, null)`) - ciepły cache = brak żądania.
//   3. ODMOWA (brak MFA) i NIEWDROŻENIE nie są błędem modułu: sam odnośnik do
//      zakładki; pusto = zdanie + odnośnik do galerii z szablonem.
//   4. Nazwy (najwyżej trzy) prowadzą do edytora ścieżki; axe bez naruszeń.
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  listJourneys: vi.fn(),
  auth: { roles: ["admin"] as string[], tenantId: "tenant-1" as string | null },
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const { RouterLinkStub } = await import("@/test/routerLinkStub");
  return {
    ...(await importOriginal<typeof import("@tanstack/react-router")>()),
    Link: (props: { search?: Record<string, string>; children?: ReactNode }) => (
      <RouterLinkStub {...props} data-search={new URLSearchParams(props.search).toString()} />
    ),
  };
});
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => h.auth }));
// Granica sieci: jedyna server fn, którą woła lista ścieżek.
vi.mock("@/lib/journeys/journeys.functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/journeys/journeys.functions")>()),
  listJourneys: (input: unknown) => h.listJourneys(input),
}));

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { axeViolations, summarize } from "@/test/axe";
import EventJourneysSummary from "@/components/admin/journeys/event/EventJourneysSummary";
import { journeyKeys } from "@/lib/journeys/keys";
import { parseJourneyList } from "@/lib/journeys/parse";
import { RPC_SHAPES } from "@/lib/journeys/__tests__/rpcShapes.fixture";

const TENANT = "tenant-1";

/** Wiersze listy w kształcie RPC (parser jak w aplikacji). */
function list(...rows: Array<{ status: string; trigger: string; name: string }>) {
  return parseJourneyList(
    rows.map((row, i) => ({
      ...RPC_SHAPES.list[0],
      id: `aaaaaaaa-0000-4000-8000-00000000000${i}`,
      name: row.name,
      status: row.status,
      trigger_event_type: row.trigger,
    })),
  );
}

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function mount(queryClient = client()) {
  return render(
    <QueryClientProvider client={queryClient}>
      <EventJourneysSummary tenantId={TENANT} />
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  h.auth = { roles: ["admin"], tenantId: TENANT };
  h.listJourneys.mockReset().mockResolvedValue({ state: "ready", data: [] });
});

afterEach(() => cleanup());

describe("EventJourneysSummary - liczba i nazwy", () => {
  it("liczy WYŁĄCZNIE aktywne ścieżki z wyzwalaczem wydarzenia; nazwy prowadzą do edytora", async () => {
    h.listJourneys.mockResolvedValue({
      state: "ready",
      data: list(
        {
          status: "active",
          trigger: "event.registration.created.v1",
          name: "Opieka nad zapisanym",
        },
        { status: "paused", trigger: "event.registration.created.v1", name: "Wstrzymana" },
        { status: "active", trigger: "checkout.abandoned.v1", name: "Porzucona kasa" },
        { status: "active", trigger: "event.registration.attended.v1", name: "Po wydarzeniu" },
      ),
    });
    mount();

    expect(await screen.findByText("2 aktywne ścieżki")).toBeInTheDocument();
    const summary = screen.getByTestId("event-journeys-summary");
    expect(within(summary).getByRole("link", { name: "Opieka nad zapisanym" })).toHaveAttribute(
      "href",
      "/admin/revenue/journeys/aaaaaaaa-0000-4000-8000-000000000000",
    );
    expect(within(summary).queryByText("Wstrzymana")).toBeNull();
    expect(within(summary).queryByText("Porzucona kasa")).toBeNull();
    const open = within(summary).getByRole("link", { name: "Zobacz ścieżki" });
    expect(open).toHaveAttribute("href", "/admin/revenue/journeys");
    expect(open).toHaveAttribute("data-search", "status=active");
    expect(h.listJourneys).toHaveBeenCalledWith({ data: { status: null } });
  });

  it("najwyżej trzy nazwy - resztę pokazuje lista w hubie", async () => {
    h.listJourneys.mockResolvedValue({
      state: "ready",
      data: list(
        ...[1, 2, 3, 4, 5].map((n) => ({
          status: "active",
          trigger: "event.registration.created.v1",
          name: `Ścieżka ${n}`,
        })),
      ),
    });
    mount();

    expect(await screen.findByText("5 aktywnych ścieżek")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });
});

describe("EventJourneysSummary - stany", () => {
  it("pusto: zdanie i odnośnik do galerii z szablonem opieki nad zapisanym", async () => {
    mount();

    expect(
      await screen.findByText("Żadna aktywna ścieżka nie reaguje na zapisy na wydarzenia."),
    ).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Zautomatyzuj komunikację" });
    expect(link).toHaveAttribute("href", "/admin/revenue/journeys");
    expect(link).toHaveAttribute("data-search", "new=1&template=event_registration_nurture");
  });

  it.each([["forbidden"], ["unavailable"]] as const)(
    "%s (brak MFA, niewdrożone): sam odnośnik do zakładki, bez komunikatu o błędzie",
    async (state) => {
      h.listJourneys.mockResolvedValue({ state });
      mount();

      await waitFor(() => expect(h.listJourneys).toHaveBeenCalled());
      const open = await screen.findByRole("link", { name: "Zobacz ścieżki" });
      expect(open).toHaveAttribute("href", "/admin/revenue/journeys");
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.queryByText(/aktywn/)).toBeNull();
    },
  );

  it("ciepły cache huba (ten sam klucz) - bez nowego żądania", async () => {
    const queryClient = client();
    queryClient.setQueryData(journeyKeys.list(TENANT, null), {
      state: "ready",
      data: list({ status: "active", trigger: "event.registration.created.v1", name: "Opieka" }),
    });
    mount(queryClient);

    expect(await screen.findByText("1 aktywna ścieżka")).toBeInTheDocument();
    expect(h.listJourneys).not.toHaveBeenCalled();
  });
});

describe("EventJourneysSummary - dostępność", () => {
  it("axe bez naruszeń (PL i EN)", async () => {
    h.listJourneys.mockResolvedValue({
      state: "ready",
      data: list({ status: "active", trigger: "event.registration.created.v1", name: "Opieka" }),
    });
    for (const lang of ["pl", "en"] as const) {
      await i18n.changeLanguage(lang);
      const { container } = mount();
      await screen.findByRole("link", { name: "Opieka" });
      const violations = await axeViolations(container);
      expect(violations, summarize(violations)).toEqual([]);
      cleanup();
    }
  });
});
