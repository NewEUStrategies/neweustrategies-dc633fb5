// `RevenueSignalChip` (S7, SPEC §2.7, §6.1) - sygnał Diagnostyki na ekranie
// modułu (montaż w modułach: I9).
//
// CO TEN PLIK DOWODZI (karta S7.1):
//   1. ZERO DODATKOWYCH ŻĄDAŃ przy ciepłym cache: chip czyta ten sam wpis
//      i `queryFn` co Diagnostyka (`revenueFactsQueryOptions` + `select` po
//      obszarach) - licznik wywołań `queryFn` (atrapa server fn) stoi w miejscu
//      po zamontowaniu kilku chipów; przy zimnym cache dwa chipy = jedno
//      żądanie.
//   2. Warianty `bar|chip`, liczby per waga, odnośnik do
//      `/admin/revenue/diagnostics?area=` (obszar najpoważniejszej diagnozy).
//   3. Nigdy cicha zieleń: obszar bez faktów = „brak danych"; „bez otwartych
//      problemów" tylko, gdy KAŻDĄ regułę obszaru da się ocenić.
//   4. Przed hydratacją, bez roli huba, bez najemcy i przy odmowie - nic
//      (i bez żądań tam, gdzie zapytanie jest wyłączone); axe bez naruszeń.
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  hydrated: true,
  auth: {
    roles: ["admin"] as string[],
    tenantId: "11111111-1111-4111-8111-111111111111" as string | null,
  },
  fetchFacts: vi.fn(),
  fetchSnoozes: vi.fn(),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const { RouterLinkStub } = await import("@/test/routerLinkStub");
  return {
    ...(await importOriginal<typeof import("@tanstack/react-router")>()),
    useHydrated: () => h.hydrated,
    // Parametry adresu w atrybucie - asercja widzi kontrakt deep linku.
    Link: (props: { search?: Record<string, string>; children?: ReactNode }) => (
      <RouterLinkStub {...props} data-search={new URLSearchParams(props.search).toString()} />
    ),
  };
});
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
import { RevenueSignalChip } from "@/components/admin/revenue/molecules/RevenueSignalChip";
import type { RevenueFacts } from "@/lib/revenue/diagnostics/facts";
import {
  revenueFactsQueryOptions,
  revenueSnoozesQueryOptions,
} from "@/lib/revenue/diagnostics/queries";
import { SIGNAL_SURFACES } from "@/lib/revenue/diagnostics/surfaces";
import {
  FACTS,
  TENANT,
  factsRead,
  snoozesRead,
} from "@/components/admin/revenue/diagnostics/__tests__/diagnosticsFixtures";

const t = realT("pl");

/** Obszar `sync` z KOMPLETEM faktów - każdą regułę da się ocenić, wszystkie „ok". */
const SYNC_OK = {
  ...FACTS,
  areas: {
    sync: {
      emitErrors24h: 0,
      emitErrors7d: 0,
      silentDaily: [],
      silentWeekly: [],
      deadTypes: [],
      unknownTypes: [],
    },
  },
} as const satisfies RevenueFacts;

/** Jedna runda pętli zdarzeń w `act` - zapytanie zdążyłoby wystartować i rozstrzygnąć się. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderWith(queryClient: QueryClient, ui: ReactNode) {
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  h.hydrated = true;
  h.auth = { roles: ["admin"], tenantId: TENANT };
  h.fetchFacts.mockReset().mockResolvedValue(factsRead(FACTS));
  h.fetchSnoozes.mockReset().mockResolvedValue(snoozesRead());
});

afterEach(() => cleanup());

describe("RevenueSignalChip - zero dodatkowych żądań", () => {
  it("ciepły cache (Diagnostyka już pobrała): trzy chipy, licznik `queryFn` bez zmian", async () => {
    const queryClient = newClient();
    await queryClient.fetchQuery(revenueFactsQueryOptions(TENANT));
    await queryClient.fetchQuery(revenueSnoozesQueryOptions(TENANT));
    expect(h.fetchFacts).toHaveBeenCalledTimes(1);
    expect(h.fetchSnoozes).toHaveBeenCalledTimes(1);

    renderWith(
      queryClient,
      <>
        <RevenueSignalChip areas={SIGNAL_SURFACES.paywall} variant="bar" />
        <RevenueSignalChip areas={SIGNAL_SURFACES.coupons} />
        <RevenueSignalChip areas={SIGNAL_SURFACES.billing} />
      </>,
    );

    expect(await screen.findAllByTestId("revenue-signal")).toHaveLength(3);
    expect(h.fetchFacts).toHaveBeenCalledTimes(1);
    expect(h.fetchSnoozes).toHaveBeenCalledTimes(1);
  });

  it("zimny cache: dwa chipy różnych obszarów = jedno żądanie faktów", async () => {
    renderWith(
      newClient(),
      <>
        <RevenueSignalChip areas={SIGNAL_SURFACES.paywall} />
        <RevenueSignalChip areas={SIGNAL_SURFACES.crm} />
      </>,
    );
    await waitFor(() => expect(screen.getAllByTestId("revenue-signal")).toHaveLength(2));
    expect(h.fetchFacts).toHaveBeenCalledTimes(1);
    expect(h.fetchSnoozes).toHaveBeenCalledTimes(1);
  });
});

describe("RevenueSignalChip - warianty i odnośnik", () => {
  it("pasek: liczby per waga i odnośnik do obszaru najpoważniejszej diagnozy", async () => {
    renderWith(newClient(), <RevenueSignalChip areas={SIGNAL_SURFACES.paywall} variant="bar" />);
    const bar = await screen.findByTestId("revenue-signal");
    expect(bar).toHaveAttribute("data-variant", "bar");
    expect(bar).toHaveAttribute("data-tone", "critical");
    expect(bar).toHaveTextContent(t("adminRevenue.signal.open", { count: 3 }));
    expect(bar).toHaveTextContent(
      t("adminRevenue.signal.details", { critical: 1, warning: 1, info: 1 }),
    );
    const link = screen.getByRole("link", { name: t("adminRevenue.signal.action") });
    expect(link).toHaveAttribute("href", "/admin/revenue/diagnostics");
    expect(link).toHaveAttribute("data-search", "area=metering");
  });

  it("pigułka: liczby per waga tylko dla czytnika, ten sam odnośnik", async () => {
    renderWith(newClient(), <RevenueSignalChip areas={SIGNAL_SURFACES.coupons} variant="chip" />);
    const chip = await screen.findByTestId("revenue-signal");
    expect(chip).toHaveAttribute("data-variant", "chip");
    expect(chip.tagName).toBe("SPAN");
    expect(screen.getByRole("link", { name: t("adminRevenue.signal.action") })).toHaveAttribute(
      "data-search",
      "area=coupons",
    );
  });
});

describe("RevenueSignalChip - nigdy cicha zieleń", () => {
  it("obszar bez faktów: „brak danych”", async () => {
    renderWith(newClient(), <RevenueSignalChip areas={SIGNAL_SURFACES.coupons} />);
    const chip = await screen.findByTestId("revenue-signal");
    expect(chip).toHaveAttribute("data-tone", "unknown");
    expect(chip).toHaveTextContent(t("adminRevenue.signal.unknown"));
  });

  it("fakty niedostępne (brak funkcji w bazie): „brak danych”", async () => {
    h.fetchFacts.mockResolvedValue({ state: "unavailable" });
    renderWith(newClient(), <RevenueSignalChip areas={SIGNAL_SURFACES.paywall} />);
    expect(await screen.findByTestId("revenue-signal")).toHaveTextContent(
      t("adminRevenue.signal.unknown"),
    );
  });

  it("„bez otwartych problemów” tylko przy komplecie ocen", async () => {
    h.fetchFacts.mockResolvedValue(factsRead(SYNC_OK));
    renderWith(newClient(), <RevenueSignalChip areas={["sync"]} variant="bar" />);
    const bar = await screen.findByTestId("revenue-signal");
    expect(bar).toHaveAttribute("data-tone", "ok");
    expect(bar).toHaveTextContent(t("adminRevenue.signal.ok"));
  });
});

describe("RevenueSignalChip - kiedy nic nie rysuje", () => {
  it("przed hydratacją: brak znacznika i żądań", () => {
    h.hydrated = false;
    const { container } = renderWith(newClient(), <RevenueSignalChip areas={["catalog"]} />);
    expect(container).toBeEmptyDOMElement();
    expect(h.fetchFacts).not.toHaveBeenCalled();
  });

  it.each([
    ["autor", { roles: ["author"], tenantId: TENANT }],
    ["sam super_admin", { roles: ["super_admin"], tenantId: TENANT }],
    ["bez najemcy", { roles: ["admin"], tenantId: null }],
  ])("%s: nic i zero żądań", async (_label, auth) => {
    h.auth = auth;
    const { container } = renderWith(newClient(), <RevenueSignalChip areas={["catalog"]} />);
    await settle();
    expect(container).toBeEmptyDOMElement();
    expect(h.fetchFacts).not.toHaveBeenCalled();
  });

  it("odmowa (MFA): ekran modułu nie dostaje powiadomienia o hubie", async () => {
    h.fetchFacts.mockResolvedValue({ state: "mfa_required" });
    const { container } = renderWith(newClient(), <RevenueSignalChip areas={["catalog"]} />);
    await waitFor(() => expect(h.fetchFacts).toHaveBeenCalled());
    await settle();
    expect(container).toBeEmptyDOMElement();
  });
});

describe("RevenueSignalChip - dostępność", () => {
  it("axe bez naruszeń dla obu wariantów", async () => {
    const { container } = renderWith(
      newClient(),
      <div>
        <RevenueSignalChip areas={SIGNAL_SURFACES.paywall} variant="bar" />
        <p>
          <RevenueSignalChip areas={SIGNAL_SURFACES.crm} variant="chip" />
        </p>
      </div>,
    );
    await waitFor(() => expect(screen.getAllByTestId("revenue-signal")).toHaveLength(2));
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
