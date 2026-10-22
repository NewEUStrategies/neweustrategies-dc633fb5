// „Zacznij tutaj" (`GettingStartedCard` + `gettingStarted.ts`, S7).
//
// CO TEN PLIK DOWODZI.
//   1. Kroki z faktów S7-A: brak planu w sprzedaży, brak wiersza licznika,
//      retencja wyłączona, silnik ścieżek wyłączony = „do zrobienia"; fakt
//      nieobecny = „nie wiadomo" (NIGDY „gotowe").
//   2. Każdy krok do zrobienia prowadzi do EKRANU-WŁAŚCICIELA z parametrem
//      z kontraktu deep linków (paywall `?tab=plans|metering`, cennik
//      `?tab=retention`, Ścieżki).
//   3. Karta znika, gdy nic nie jest do zrobienia, i bez faktów (brak odczytu
//      nie jest powodem do „Zacznij tutaj").
//   4. axe bez naruszeń.
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ fetchFacts: vi.fn() }));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  const { RouterLinkStub } = await import("@/test/routerLinkStub");
  return {
    ...actual,
    // Atrapa z adresem RAZEM z parametrami - asercje czytają `?tab=`.
    Link: ({ search, ...rest }: Parameters<typeof RouterLinkStub>[0]) => {
      const query = new URLSearchParams((search as Record<string, string>) ?? {}).toString();
      return <RouterLinkStub {...rest} to={query ? `${String(rest.to)}?${query}` : rest.to} />;
    },
  };
});
vi.mock("@/lib/revenue/diagnostics/diagnostics.functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/revenue/diagnostics/diagnostics.functions")>()),
  getRevenueFacts: () => h.fetchFacts(),
}));

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { axeViolations, summarize } from "@/test/axe";
import { GettingStartedCard } from "@/components/admin/revenue/overview/GettingStartedCard";
import {
  GETTING_STARTED_LINKS,
  gettingStartedSteps,
  needsGettingStarted,
} from "@/components/admin/revenue/overview/gettingStarted";
import { EMPTY_REVENUE_FACTS, type RevenueFacts } from "@/lib/revenue/diagnostics/facts";
import { TENANT, clone } from "./hubFixtures";
import { FACTS } from "./overviewMocks";

const READY_FACTS: RevenueFacts = {
  v: 1,
  computedAt: null,
  areas: {
    catalog: {
      plans: [
        {
          id: "p",
          tierKey: "plus",
          tierFound: true,
          tierRank: 1,
          active: true,
          forSale: true,
          interval: "month",
          currency: "PLN",
          priceCents: 4900,
          catalogPair: true,
        },
      ],
    },
    metering: { settingsRow: true },
    retention: { settingsRow: true, enabled: true },
    journeys: { engineEnabled: true },
  },
};

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <GettingStartedCard tenantId={TENANT} roles={["admin"]} />
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  h.fetchFacts.mockReset().mockResolvedValue({ state: "ready", facts: clone(FACTS) });
  await i18n.changeLanguage("pl");
});

afterEach(() => cleanup());

describe("gettingStartedSteps - kroki z faktów", () => {
  it("brak wiersza licznika i retencja wyłączona = do zrobienia; plan i silnik = gotowe", () => {
    expect(gettingStartedSteps(FACTS).map((s) => [s.id, s.status])).toEqual([
      ["plans", "done"],
      ["metering", "todo"],
      ["retention", "todo"],
      ["journeys", "done"],
    ]);
  });

  it("bez faktów każdy krok to „nie wiadomo”, a karta się nie pokazuje", () => {
    const steps = gettingStartedSteps(EMPTY_REVENUE_FACTS);
    expect(steps.every((step) => step.status === "unknown")).toBe(true);
    expect(needsGettingStarted(steps)).toBe(false);
  });

  it("plan tylko nieaktywny albo poza sprzedażą = do zrobienia", () => {
    const plans = READY_FACTS.areas.catalog?.plans ?? [];
    const offSale: RevenueFacts = {
      ...READY_FACTS,
      areas: {
        ...READY_FACTS.areas,
        catalog: { plans: plans.map((p) => ({ ...p, forSale: false })) },
      },
    };
    expect(gettingStartedSteps(offSale)[0]?.status).toBe("todo");
  });

  it("odnośniki do ekranów-właścicieli z parametrami z kontraktu §2.6", () => {
    expect(GETTING_STARTED_LINKS).toEqual({
      plans: { to: "/admin/paywall", search: { tab: "plans" } },
      metering: { to: "/admin/paywall", search: { tab: "metering" } },
      retention: { to: "/admin/pricing", search: { tab: "retention" } },
      journeys: { to: "/admin/revenue/journeys" },
    });
  });
});

describe("GettingStartedCard", () => {
  it("kroki do zrobienia z odnośnikiem, gotowe bez odnośnika, postęp", async () => {
    renderCard();
    const card = await screen.findByTestId("revenue-getting-started");
    expect(within(card).getByText("Gotowe: 2 z 4")).toBeVisible();
    const metering = card.querySelector('[data-step="metering"]') as HTMLElement;
    expect(metering).toHaveAttribute("data-status", "todo");
    expect(within(metering).getByRole("link", { name: "Ustaw licznik" })).toHaveAttribute(
      "href",
      "/admin/paywall?tab=metering",
    );
    expect(
      within(card.querySelector('[data-step="retention"]') as HTMLElement).getByRole("link", {
        name: "Włącz retencję w Cenniku",
      }),
    ).toHaveAttribute("href", "/admin/pricing?tab=retention");
    const plans = card.querySelector('[data-step="plans"]') as HTMLElement;
    expect(plans).toHaveTextContent("Gotowe");
    expect(within(plans).queryByRole("link")).toBeNull();
  });

  it("serwis skonfigurowany: karty nie ma", async () => {
    h.fetchFacts.mockResolvedValue({ state: "ready", facts: READY_FACTS });
    renderCard();
    await waitFor(() => expect(h.fetchFacts).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByTestId("revenue-getting-started")).toBeNull();
  });

  it("odmowa odczytu faktów: karty nie ma (to nie powód do „Zacznij tutaj”)", async () => {
    h.fetchFacts.mockResolvedValue({ state: "forbidden" });
    renderCard();
    await waitFor(() => expect(h.fetchFacts).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByTestId("revenue-getting-started")).toBeNull();
  });

  it("po angielsku i bez naruszeń dostępności", async () => {
    await i18n.changeLanguage("en");
    const { container } = renderCard();
    const card = await screen.findByTestId("revenue-getting-started");
    expect(within(card).getByRole("heading", { level: 2, name: "Start here" })).toBeVisible();
    expect(summarize(await axeViolations(container))).toBe("");
  });
});
