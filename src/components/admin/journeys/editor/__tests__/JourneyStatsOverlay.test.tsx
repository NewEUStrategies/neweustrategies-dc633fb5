// Statystyki na kanwie (S8-B, SPEC §6.3) - chipy przy kartach kroków; RTL + axe.
//
// CO TEN PLIK DOWODZI.
//   1. Chipy stoją w pasie przy dolnej krawędzi karty, w współrzędnych
//      układu S8.1 (`layoutJourney`) - pozycja liczona z karty, nie z DOM.
//   2. Mail: wysłane, otwarcia ludzkie z dymkiem o MPP (górna granica),
//      kliknięcia, CTOR z oceną `BenchmarkTierBadge` z rejestru S6.
//      Podział A/B: werdykt jak w §6.3 („A lepsze o … pp (99 %)”, „za mało
//      danych (n < 100)”). Czekanie: czekający.
//   3. `?stats=off` (`hidden`) i brak statystyk - nakładka nie rysuje nic.
//   4. Nakładka jest `aria-hidden` i bez elementów fokusowalnych (liczby
//      czyta nazwa karty S8.3); klik w pasek z `onSelectNode` wybiera krok,
//      bez niego nakładka nie przechwytuje myszy. Legenda MPP widoczna. axe.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  fixedT: null as null | ((lang: "pl" | "en") => unknown),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.fixedT?.("pl"), i18n: { language: "pl" }, ready: true }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));
vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFn")).serverFnModuleMock(),
);
vi.mock("@/lib/analytics/semantic/benchmarks/benchmarks.functions", async () => {
  const { payloadFor } =
    await import("@/components/admin/analytics/semantic/__tests__/benchmarkFixtures");
  return {
    getBenchmarkGroup: ({ data }: { data: { group: "email"; lang: "pl" | "en" } }) =>
      Promise.resolve(payloadFor(data.group, data.lang)),
  };
});

import {
  JOURNEY_STATS_STRIP,
  JourneyStatsLegend,
  JourneyStatsOverlay,
} from "../JourneyStatsOverlay";
import { layoutJourney, NODE_H, NODE_W } from "@/lib/admin/journeys/layout";
import { buildJourneyView } from "@/lib/admin/journeys/viewModel";
import { axeViolations, summarize } from "@/test/axe";
import { realT } from "@/test/i18nReal";
import { RPC_SHAPES } from "@/lib/journeys/__tests__/rpcShapes.fixture";
import type { JourneyStatsDto } from "@/lib/journeys/dto";
import { parseJourneyStats } from "@/lib/journeys/parse";
import "@/lib/i18n-admin-revenue-shell";
import "@/lib/i18n-admin-journeys";
import "@/lib/i18n-admin-journeys-results";

h.fixedT = realT;
const t = realT("pl");

function clone(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

const GRAPH = {
  nodes: [
    { id: "t", type: "trigger" as const, params: {} },
    { id: "w", type: "wait" as const, params: { mode: "duration", minutes: 60 } },
    { id: "m", type: "send_email" as const, params: {} },
    {
      id: "ab",
      type: "ab_split" as const,
      params: { weights: { A: 50, B: 50 }, winnerMetric: "goal" },
    },
    { id: "g", type: "goal" as const, params: {} },
    { id: "x", type: "exit" as const, params: {} },
  ],
  edges: [
    { from: "t", to: "w", branch: "next" as const },
    { from: "w", to: "m", branch: "next" as const },
    { from: "m", to: "ab", branch: "next" as const },
    { from: "ab", to: "g", branch: "A" as const },
    { from: "ab", to: "x", branch: "B" as const },
  ],
};
const LAYOUT = layoutJourney(buildJourneyView(GRAPH));

function stats(abEnteredB = 120): JourneyStatsDto {
  const raw = clone(RPC_SHAPES.statsAb) as {
    nodes: Record<string, unknown>[];
    variants: Record<string, unknown>[];
  };
  const email = clone(RPC_SHAPES.statsEmail.nodes[0]) as Record<string, unknown>;
  const wait = clone(RPC_SHAPES.statsEmail.nodes[2]) as Record<string, unknown>;
  const trigger = clone(RPC_SHAPES.statsEmail.nodes[1]) as Record<string, unknown>;
  raw.variants[1].entered = abEnteredB;
  raw.nodes = [
    ...raw.nodes,
    { ...trigger, entered: 1200 },
    { ...wait, entered: 1200, waiting_now: 45 },
    {
      ...email,
      entered: 380,
      email: {
        ...(email.email as object),
        sent: 380,
        queued: 380,
        bounced: 0,
        unique_human_opens: 190,
        unique_clicks: 38,
        ctor: 0.2,
      },
    },
  ];
  return parseJourneyStats(raw);
}

function mount(props: Partial<Parameters<typeof JourneyStatsOverlay>[0]> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <div className="relative">
        <JourneyStatsOverlay stats={stats()} layout={LAYOUT} {...props} />
      </div>
    </QueryClientProvider>,
  );
}

const strip = (nodeId: string) =>
  document.querySelector(
    `[data-testid="journey-stats-overlay"] [data-node-id="${nodeId}"]`,
  ) as HTMLElement | null;

afterEach(cleanup);

describe("pozycje i widoczność", () => {
  it("pas chipów przy dolnej krawędzi karty, we współrzędnych układu", () => {
    mount();
    const overlay = screen.getByTestId("journey-stats-overlay");
    expect(overlay.style.width).toBe(`${LAYOUT.width}px`);
    expect(overlay.style.height).toBe(`${LAYOUT.height}px`);
    for (const node of LAYOUT.nodes.filter((entry) => ["t", "w", "m", "ab"].includes(entry.id))) {
      const element = strip(node.id) as HTMLElement;
      expect(element.style.left).toBe(`${node.x + JOURNEY_STATS_STRIP.inset}px`);
      expect(element.style.top).toBe(
        `${node.y + NODE_H - JOURNEY_STATS_STRIP.height - JOURNEY_STATS_STRIP.inset}px`,
      );
      expect(element.style.width).toBe(`${NODE_W - 2 * JOURNEY_STATS_STRIP.inset}px`);
    }
    // Kroki bez wiersza statystyk - bez chipów (nie „0”).
    expect(strip("g")).toBeNull();
    expect(strip("x")).toBeNull();
  });

  it("`?stats=off` i brak statystyk - nakładka nie rysuje nic", () => {
    mount({ hidden: true });
    expect(screen.queryByTestId("journey-stats-overlay")).toBeNull();
    cleanup();
    mount({ stats: null });
    expect(screen.queryByTestId("journey-stats-overlay")).toBeNull();
  });

  it("aria-hidden, bez elementów fokusowalnych; bez wyboru kroku - przezroczysta dla myszy", () => {
    mount();
    const overlay = screen.getByTestId("journey-stats-overlay");
    expect(overlay).toHaveAttribute("aria-hidden", "true");
    expect(overlay).toHaveClass("pointer-events-none");
    expect(overlay.querySelectorAll("button, a, input, [tabindex]")).toHaveLength(0);
    expect(strip("m")).not.toHaveClass("pointer-events-auto");
  });

  it("klik w pas z `onSelectNode` wybiera krok", () => {
    const onSelectNode = vi.fn();
    mount({ onSelectNode });
    const element = strip("m") as HTMLElement;
    expect(element).toHaveClass("pointer-events-auto");
    fireEvent.click(element);
    expect(onSelectNode).toHaveBeenCalledWith("m");
  });
});

describe("chipy", () => {
  it("mail: wysłane, otwarcia ludzkie z dymkiem MPP, kliknięcia, CTOR z oceną S6", async () => {
    mount();
    const element = strip("m") as HTMLElement;
    expect(element.querySelector('[data-chip="sent"]')).toHaveTextContent("380");
    const opens = element.querySelector('[data-chip="opens"]');
    expect(opens).toHaveTextContent("50%");
    expect(opens).toHaveAttribute(
      "title",
      t("adminJourneys.statsOverlay.chip.opens", { value: "50%" }),
    );
    expect(element.querySelector('[data-chip="clicks"]')).toHaveTextContent("10%");
    const ctor = element.querySelector('[data-chip="ctor"]');
    expect(ctor).toHaveTextContent("CTOR 20%");
    expect(ctor?.getAttribute("title")).toContain("MPP");
    await waitFor(() => expect(element.querySelector("[data-tier]")).not.toBeNull());
    expect(element.querySelector("[data-tier]")?.getAttribute("data-tier")).not.toBe("none");
  });

  it("podział A/B: werdykt z `z`; poniżej 100 na ramię - za mało danych", () => {
    mount();
    expect(strip("ab")?.querySelector('[data-chip="ab"]')).toHaveTextContent(
      "A lepsze o 42,5 pp (99 %)",
    );
    cleanup();
    mount({ stats: stats(99) });
    expect(strip("ab")?.querySelector('[data-chip="ab"]')).toHaveTextContent(
      "Za mało danych (n < 100)",
    );
  });

  it("czekanie: wejścia i czekający", () => {
    mount();
    const element = strip("w") as HTMLElement;
    expect(element.querySelector('[data-chip="entered"]')).toHaveTextContent("1200");
    expect(element.querySelector('[data-chip="waiting"]')).toHaveTextContent("45");
    expect(strip("t")?.querySelector('[data-chip="waiting"]')).toBeNull();
  });

  it("legenda MPP - widoczny tekst poza nakładką; axe bez naruszeń", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <div className="relative">
          <JourneyStatsLegend />
          <JourneyStatsOverlay stats={stats()} layout={LAYOUT} />
        </div>
      </QueryClientProvider>,
    );
    expect(screen.getByText(t("adminJourneys.statsOverlay.legend"))).toBeTruthy();
    await waitFor(() => expect(container.querySelector("[data-tier]")).not.toBeNull());
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
