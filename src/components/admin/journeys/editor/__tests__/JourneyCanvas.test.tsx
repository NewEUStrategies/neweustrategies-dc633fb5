// Kanwa ścieżki (S8.3b, SPEC §6.3) - RTL + axe.
//
// CO TEN PLIK DOWODZI.
//   1. Render wg §6.3: karty 280 × 88 w pozycjach `layoutJourney` (S8.1),
//      JEDEN `<svg aria-hidden>` z krawędziami `vector-effect=non-scaling-stroke`
//      w `currentColor` klasy `text-border`, etykiety gałęzi i chipy scalenia
//      w HTML, „+” 28 px; nazwa karty „Krok 3.1.1 z 6, gałąź „Tak”: Wyślij
//      e-mail „…”, 380 wysłanych” (liczby z okna statystyk, nakładka S8.2).
//   2. Powiększenie 50-150 %: `transform: scale(z)`, Ctrl/Cmd+= / - / 0,
//      przyciski i „dopasuj” do okna; siatka 10 %.
//   3. Jeden tab stop (roving tabindex), ruch wg `moveFocus` z `nav.ts`,
//      Enter na karcie = panel, Enter na chipie = przejście do celu,
//      Ctrl/Cmd+Z i Shift+Z oddane edytorowi, Esc - `onEscape`.
//   4. Operacje przez `runJourneyEditRequest` (= `applyOp`/`mergeInto`):
//      Insert -> paleta przy „+” tej gałęzi (grupy SPEC, wyszukiwanie, opis
//      skutku, pozycja niedostępna z powodem), „Połącz z krokiem…” na końcu
//      gałęzi, Delete (poddrzewo z `ConfirmDialog` i liczbą dalszych kroków),
//      menu `⋯`/Shift+F10 = `availableOps`; nowy krok dostaje fokus,
//      `aria-live="polite"` ogłasza wynik albo powód odmowy.
//   5. Tylko do odczytu: bez „+”, „⋯” i skrótów edycji. axe bez naruszeń.
//   6. Słownik `i18n-admin-journeys-canvas`: parytet PL/EN, liczebniki, zero
//      kolizji z pozostałymi słownikami ścieżek, czytelnik każdego klucza.
import { useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  lang: "pl" as "pl" | "en",
  fixedT: null as null | ((lang: "pl" | "en") => unknown),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.fixedT?.(h.lang), i18n: { language: h.lang }, ready: true }),
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
  clampJourneyZoom,
  fitJourneyZoom,
  JourneyCanvas,
  JOURNEY_CANVAS_PADDING,
  stepJourneyZoom,
  type JourneyCanvasProps,
} from "../JourneyCanvas";
import {
  journeyOpLabel,
  journeyOpsContext,
  runJourneyEditRequest,
  type JourneyEditRequest,
} from "../JourneyInsertButton";
import { layoutJourney, NODE_H, NODE_W, INSERT_SIZE } from "@/lib/admin/journeys/layout";
import { focusKey, moveFocus, type JourneyFocus } from "@/lib/admin/journeys/nav";
import { availableOps, type JourneyOpResult } from "@/lib/admin/journeys/ops";
import { buildJourneyView } from "@/lib/admin/journeys/viewModel";
import { journeysCanvasDictionaries } from "@/lib/i18n-admin-journeys-canvas";
import { RPC_SHAPES } from "@/lib/journeys/__tests__/rpcShapes.fixture";
import type { JourneyStatsDto } from "@/lib/journeys/dto";
import {
  validateJourneyGraph,
  type JourneyGraph,
  type JourneySettings,
} from "@/lib/journeys/graph";
import { parseJourneyStats } from "@/lib/journeys/parse";
import { axeViolations, summarize } from "@/test/axe";
import { realT } from "@/test/i18nReal";
import "@/lib/i18n-admin-journeys";
import "@/lib/i18n-admin-journeys-list";
import "@/lib/i18n-admin-journeys-results";

h.fixedT = realT;
const t = realT("pl");

function clone(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

// Wyzwalacz -> czekanie -> warunek (tak: mail -> cel; nie: mail -> scalenie
// do celu). Cel stoi pod PIERWSZYM rodzicem (m1), z m2 prowadzi chip.
const GRAPH: JourneyGraph = {
  nodes: [
    { id: "t", type: "trigger", params: {} },
    { id: "w", type: "wait", params: { mode: "duration", minutes: 1440 } },
    {
      id: "c",
      type: "if_else",
      params: { match: "all", predicates: [{ kind: "consent", marketing: true }] },
    },
    { id: "m1", type: "send_email", params: {} },
    { id: "g", type: "goal", params: {} },
    { id: "m2", type: "send_email", params: {} },
  ],
  edges: [
    { from: "t", to: "w", branch: "next" },
    { from: "w", to: "c", branch: "next" },
    { from: "c", to: "m1", branch: "yes" },
    { from: "c", to: "m2", branch: "no" },
    { from: "m1", to: "g", branch: "next" },
    { from: "m2", to: "g", branch: "next" },
  ],
};

// Gałąź „Nie” kończy się zwykłym „Koniec” - pusty koniec gałęzi (scalenie).
const GRAPH_END: JourneyGraph = {
  nodes: [
    { id: "t", type: "trigger", params: {} },
    {
      id: "c",
      type: "if_else",
      params: { match: "all", predicates: [{ kind: "consent", marketing: true }] },
    },
    { id: "m1", type: "send_email", params: {} },
    { id: "g", type: "goal", params: {} },
    { id: "x", type: "exit", params: {} },
  ],
  edges: [
    { from: "t", to: "c", branch: "next" },
    { from: "c", to: "m1", branch: "yes" },
    { from: "c", to: "x", branch: "no" },
    { from: "m1", to: "g", branch: "next" },
  ],
};

const SETTINGS: Pick<JourneySettings, "triggerEventType" | "triggerCondition"> = {
  triggerEventType: "checkout.abandoned.v1",
};
const SUBJECTS = new Map([["m1", "Dokończ zamówienie"]]);

function stats(): JourneyStatsDto {
  const raw = clone(RPC_SHAPES.statsEmail) as { nodes: Record<string, unknown>[] };
  const [email, trigger] = raw.nodes as Record<string, unknown>[];
  raw.nodes = [
    { ...trigger, node_id: "t", entered: 1200 },
    {
      ...email,
      node_id: "m1",
      entered: 380,
      email: {
        ...(email.email as object),
        sent: 380,
        queued: 380,
        unique_human_opens: 190,
        unique_clicks: 38,
        ctor: 0.2,
      },
    },
  ];
  return parseJourneyStats(raw);
}

interface HarnessProps extends Partial<JourneyCanvasProps> {
  initial?: JourneyGraph;
  spy?: (request: JourneyEditRequest) => void;
  record?: (graph: JourneyGraph) => void;
  forced?: JourneyOpResult;
}

function Harness({
  initial = GRAPH,
  spy,
  record,
  forced,
  settings = SETTINGS,
  ...rest
}: HarnessProps) {
  const [graph, setGraph] = useState(initial);
  const view = useMemo(() => buildJourneyView(graph), [graph]);
  const layout = useMemo(() => layoutJourney(view), [view]);
  record?.(graph);
  return (
    <JourneyCanvas
      graph={graph}
      view={view}
      layout={layout}
      settings={settings}
      subjects={SUBJECTS}
      onApplyOp={(request) => {
        spy?.(request);
        if (forced) return forced;
        const result = runJourneyEditRequest(graph, request, journeyOpsContext(settings));
        if (result.ok) setGraph(result.graph);
        return result;
      }}
      {...rest}
    />
  );
}

function mount(props: HarnessProps = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Harness {...props} />
    </QueryClientProvider>,
  );
}

const card = (id: string) =>
  document.querySelector<HTMLButtonElement>(`[data-focus-key="node:${id}"]`) as HTMLButtonElement;
/** Fokus przeglądarki na karcie (jak klik albo Tab) - w `act`, bo karta synchronizuje stan. */
const focusOn = (id: string) => act(() => card(id).focus());
const activeKey = () => (document.activeElement as HTMLElement | null)?.dataset.focusKey;
const live = () => screen.getByTestId("journey-live").textContent;
const press = (key: string, init: Record<string, boolean> = {}) =>
  fireEvent.keyDown(document.activeElement as Element, { key, ...init });

afterEach(() => {
  cleanup();
  h.lang = "pl";
});

// ── 1. Render ────────────────────────────────────────────────────────────────

describe("render (SPEC §6.3)", () => {
  it("karty 280 × 88 w pozycjach układu, jedno svg z krawędziami, etykiety i chipy w HTML", () => {
    mount();
    const layout = layoutJourney(buildJourneyView(GRAPH));
    for (const node of layout.nodes) {
      const box = card(node.id).parentElement as HTMLElement;
      expect(box.style.left).toBe(`${node.x}px`);
      expect(box.style.top).toBe(`${node.y}px`);
      expect(box.style.width).toBe(`${NODE_W}px`);
      expect(box.style.height).toBe(`${NODE_H}px`);
      expect(card(node.id).className).toContain("rounded-[6px]");
    }

    // Jedno svg na całą kanwę (ikony kart to osobne `svg.lucide` w przyciskach).
    const svgs = screen.getByTestId("journey-canvas-content").querySelectorAll("svg:not(.lucide)");
    expect(svgs).toHaveLength(1);
    const svg = svgs[0] as SVGSVGElement;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("class")).toContain("text-border");
    const paths = svg.querySelectorAll("path");
    expect(paths).toHaveLength(layout.edges.length);
    paths.forEach((path, index) => {
      expect(path.getAttribute("d")).toBe(layout.edges[index].path);
      expect(path.getAttribute("vector-effect")).toBe("non-scaling-stroke");
      expect(path.getAttribute("stroke")).toBe("currentColor");
    });
    // Scalenie (m2 -> g) kreskowane - to odnośnik, nie dalszy ciąg drzewa.
    expect(svg.querySelector('[data-edge-kind="merge"]')?.getAttribute("stroke-dasharray")).toBe(
      "4 4",
    );

    const yes = document.querySelector('[data-branch-label="yes"]') as HTMLElement;
    expect(yes.textContent).toBe(t("adminJourneys.branch.yes"));
    expect(yes.getAttribute("aria-hidden")).toBe("true");
    expect(document.querySelector('[data-branch-label="next"]')).toBeNull();

    const chip = document.querySelector('[data-merge-from="m2"]') as HTMLElement;
    expect(chip.textContent).toBe(t("adminJourneys.canvas.merge.chip", { number: "3.1.2" }));
    expect(chip.getAttribute("aria-label")).toBe(
      t("adminJourneys.canvas.merge.label", {
        number: "3.1.2",
        summary: t("adminJourneys.common.summary.goalNoLabel"),
      }),
    );

    const inserts = document.querySelectorAll<HTMLElement>("[data-insert-key]");
    expect(inserts).toHaveLength(layout.inserts.length);
    for (const insert of inserts) {
      expect(insert.style.width).toBe(`${INSERT_SIZE}px`);
      expect(insert.style.height).toBe(`${INSERT_SIZE}px`);
    }
  });

  it("nazwa karty: numer z liczbą kroków, gałąź, opis kroku i liczby z okna statystyk", async () => {
    mount({ stats: stats() });
    // Ocena CTOR w nakładce dochodzi asynchronicznie (rejestr S6).
    await waitFor(() => expect(document.querySelector("[data-tier]")).not.toBeNull());
    const summary = t("adminJourneys.common.summary.sendEmail", { subject: "Dokończ zamówienie" });
    const base = t("adminJourneys.canvas.step.labelBranch", {
      number: "3.1.1",
      total: 6,
      branch: t("adminJourneys.branch.yes"),
      summary,
    });
    const statsText = t("adminJourneys.statsOverlay.aria.sent", { count: 380, value: "380" });
    expect(card("m1").getAttribute("aria-label")).toBe(
      t("adminJourneys.canvas.step.labelStats", { label: base, stats: statsText }),
    );
    expect(card("m1").getAttribute("aria-label")).toMatch(/^Krok 3\.1\.1 z 6, gałąź „Tak”: .*380/);
    // Nakładka S8.2 w tym samym układzie; karta zostawia jej dolny pas.
    expect(screen.getByTestId("journey-stats-overlay")).toBeTruthy();
    expect(card("m1").querySelector(".line-clamp-1")).not.toBeNull();

    cleanup();
    mount({ stats: stats(), statsHidden: true });
    expect(screen.queryByTestId("journey-stats-overlay")).toBeNull();
    expect(card("m1").getAttribute("aria-label")).toBe(base);
    expect(card("m1").querySelector(".line-clamp-2")).not.toBeNull();
  });

  it("pusta gałąź i krok bez dalszego ciągu - słyszalne w nazwie kroku", () => {
    const graph: JourneyGraph = {
      nodes: [
        { id: "t", type: "trigger", params: {} },
        {
          id: "c",
          type: "if_else",
          params: { match: "all", predicates: [{ kind: "consent", marketing: true }] },
        },
        { id: "x", type: "exit", params: {} },
      ],
      edges: [
        { from: "t", to: "c", branch: "next" },
        { from: "c", to: "x", branch: "yes" },
      ],
    };
    mount({ initial: graph });
    const label = card("c").getAttribute("aria-label") ?? "";
    expect(label).toBe(
      t("adminJourneys.canvas.step.labelOpenBranches", {
        label: t("adminJourneys.canvas.step.label", {
          number: "2",
          total: 3,
          summary: t("adminJourneys.common.summary.ifElseAll", { count: 1 }),
        }),
        count: 1,
        branches: t("adminJourneys.branch.no"),
      }),
    );
    // „+” brakującej gałęzi istnieje (dodanie kroku myszą i klawiaturą).
    expect(document.querySelector('[data-insert-key="c:no"]')).not.toBeNull();
  });

  it("ścieżka symulacji podświetla karty i krawędzie między nimi", () => {
    mount({ highlightedPath: ["t", "w", "c", "m2"] });
    expect(card("m2").dataset.highlighted).toBe("true");
    expect(card("m1").dataset.highlighted).toBeUndefined();
    const edge = document.querySelector('path[data-from="c"][data-to="m2"]') as SVGPathElement;
    expect(edge.getAttribute("class")).toBe("text-primary");
    expect(
      document.querySelector('path[data-from="c"][data-to="m1"]')?.getAttribute("class"),
    ).toBeNull();
  });
});

// ── 2. Powiększenie ──────────────────────────────────────────────────────────

describe("powiększenie 50-150 %", () => {
  it("siatka 10 %, granice i dopasowanie (czyste funkcje)", () => {
    expect(stepJourneyZoom(1, 1)).toBe(1.1);
    expect(stepJourneyZoom(0.73, 1)).toBe(0.8);
    expect(stepJourneyZoom(0.73, -1)).toBe(0.7);
    expect(stepJourneyZoom(1.5, 1)).toBe(1.5);
    expect(stepJourneyZoom(0.5, -1)).toBe(0.5);
    expect(clampJourneyZoom(3)).toBe(1.5);
    expect(clampJourneyZoom(Number.NaN)).toBe(1);
    const pad = JOURNEY_CANVAS_PADDING * 2;
    expect(
      fitJourneyZoom({ width: 1000 - pad, height: 400 - pad }, { width: 800, height: 800 }),
    ).toBe(0.8);
    expect(fitJourneyZoom({ width: 100, height: 100 }, { width: 2000, height: 2000 })).toBe(1.5);
    expect(fitJourneyZoom({ width: 100, height: 100 }, { width: 0, height: 0 })).toBe(1);
  });

  it("Ctrl/Cmd+= / - / 0 na kanwie, przyciski, „dopasuj” i komunikat", async () => {
    const onZoomChange = vi.fn();
    mount({ onZoomChange });
    const content = screen.getByTestId("journey-canvas-content");
    expect(content.style.transform).toBe("scale(1)");

    focusOn("t");
    press("=", { ctrlKey: true });
    expect(content.style.transform).toBe("scale(1.1)");
    press("-", { metaKey: true });
    press("-", { metaKey: true });
    expect(content.style.transform).toBe("scale(0.9)");
    for (let i = 0; i < 8; i += 1) press("-", { ctrlKey: true });
    expect(content.style.transform).toBe("scale(0.5)");
    press("0", { ctrlKey: true });
    expect(content.style.transform).toBe("scale(1)");
    expect(onZoomChange).toHaveBeenLastCalledWith(1);
    expect(live()).toBe(t("adminJourneys.canvas.live.zoom", { value: "100" }));

    const toolbar = screen.getByRole("toolbar", { name: t("adminJourneys.canvas.zoom.toolbar") });
    for (let i = 0; i < 6; i += 1) {
      fireEvent.click(
        within(toolbar).getByRole("button", { name: t("adminJourneys.canvas.zoom.in") }),
      );
    }
    expect(content.style.transform).toBe("scale(1.5)");
    expect(
      (
        within(toolbar).getByRole("button", {
          name: t("adminJourneys.canvas.zoom.in"),
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    // „Dopasuj” liczy z rozmiaru ramki (happy-dom nie ma układu - podajemy go).
    const viewport = screen.getByTestId("journey-canvas-viewport");
    Object.defineProperty(viewport, "clientWidth", { configurable: true, value: 600 });
    Object.defineProperty(viewport, "clientHeight", { configurable: true, value: 300 });
    const layout = layoutJourney(buildJourneyView(GRAPH));
    fireEvent.click(
      within(toolbar).getByRole("button", { name: t("adminJourneys.canvas.zoom.fit") }),
    );
    const expected = fitJourneyZoom(layout, { width: 600, height: 300 });
    expect(content.style.transform).toBe(`scale(${expected})`);
    // Rozpórka przewijania = rozmiar treści × z (transform nie zmienia przepływu).
    const sizer = content.parentElement as HTMLElement;
    expect(sizer.style.width).toBe(`${(layout.width + JOURNEY_CANVAS_PADDING * 2) * expected}px`);
  });
});

// ── 3. Klawiatura i jeden tab stop ───────────────────────────────────────────

describe("jeden tab stop i klawisze z nav.ts", () => {
  it("w kolejności Tab jest tylko bieżący element; „+” i „⋯” poza nią", () => {
    mount();
    const group = screen.getByRole("group", { name: t("adminJourneys.canvas.steps") });
    const stops = group.querySelectorAll('[tabindex="0"]');
    expect(stops).toHaveLength(1);
    expect((stops[0] as HTMLElement).dataset.focusKey).toBe("node:t");
    for (const element of document.querySelectorAll("[data-insert-key], [data-menu-for]")) {
      expect(element.getAttribute("tabindex")).toBe("-1");
    }
    // Instrukcja sr-only podpięta pod grupę kroków.
    const help = document.getElementById(group.getAttribute("aria-describedby") ?? "");
    expect(help?.textContent).toBe(t("adminJourneys.canvas.instructions"));
    expect(help?.className).toContain("sr-only");
  });

  it("strzałki, Home i End przenoszą fokus jak `moveFocus` (tryb kanwy)", () => {
    mount();
    const view = buildJourneyView(GRAPH);
    focusOn("t");
    let expected: JourneyFocus | null = { kind: "node", id: "t" };
    const steps = [
      "ArrowDown",
      "ArrowDown",
      "ArrowDown",
      "ArrowRight",
      "ArrowDown",
      "ArrowLeft",
      "ArrowUp",
      "End",
      "Home",
    ] as const;
    const direction = {
      ArrowDown: "down",
      ArrowUp: "up",
      ArrowLeft: "left",
      ArrowRight: "right",
      Home: "home",
      End: "end",
    } as const;
    for (const key of steps) {
      press(key);
      expected = moveFocus(view, expected, direction[key], "canvas");
      expect(activeKey(), key).toBe(focusKey(expected as JourneyFocus));
      // Roving: tab stop idzie za fokusem.
      expect((document.activeElement as HTMLElement).getAttribute("tabindex")).toBe("0");
    }
  });

  it("chip scalenia: Enter przenosi fokus do kroku docelowego i ogłasza przejście", () => {
    mount();
    const chip = document.querySelector<HTMLElement>('[data-merge-from="m2"]') as HTMLElement;
    act(() => chip.focus());
    press("Enter");
    expect(activeKey()).toBe("node:g");
    expect(live()).toBe(
      t("adminJourneys.canvas.live.jump", {
        step: t("adminJourneys.canvas.step.ref", { number: "3.1.2" }),
      }),
    );
  });

  it("Enter i klik otwierają panel kroku; Esc, Ctrl/Cmd+Z i Shift+Z idą do edytora", () => {
    const onOpenStep = vi.fn();
    const onEscape = vi.fn();
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    mount({ onOpenStep, onEscape, onUndo, onRedo, selectedNodeId: "w" });
    expect(card("w").getAttribute("aria-current")).toBe("true");
    focusOn("c");
    press("Enter");
    expect(onOpenStep).toHaveBeenLastCalledWith("c");
    fireEvent.click(card("m1"));
    expect(onOpenStep).toHaveBeenLastCalledWith("m1");
    press("Escape");
    expect(onEscape).toHaveBeenCalledTimes(1);
    press("z", { ctrlKey: true });
    press("Z", { metaKey: true, shiftKey: true });
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onRedo).toHaveBeenCalledTimes(1);
  });
});

// ── 4. Operacje ──────────────────────────────────────────────────────────────

describe("operacje (jedno źródło: availableOps / applyOp)", () => {
  it("Insert -> paleta przy „+” gałęzi; wybór dodaje krok, który dostaje fokus", async () => {
    const spy = vi.fn();
    let current: JourneyGraph = GRAPH;
    mount({ spy, record: (graph) => (current = graph) });
    focusOn("w");
    press("Insert");

    const dialog = await screen.findByRole("dialog", {
      name: t("adminJourneys.canvas.insert.next", {
        step: t("adminJourneys.canvas.step.ref", { number: "2" }),
      }),
    });
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(dialog).getByLabelText(t("adminJourneys.canvas.palette.search")),
      ),
    );
    const anchor = document.querySelector('[data-insert-key="w:next"]') as HTMLElement;
    expect(anchor.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(dialog.querySelector('[data-palette-item="send_email"]') as HTMLElement);
    const label = t("adminJourneys.canvas.request.insert", {
      name: t("adminJourneys.nodeType.send_email"),
    });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "insert",
        from: "w",
        branch: "next",
        type: "send_email",
        label,
      }),
    );
    expect(validateJourneyGraph(current).errors).toEqual([]);
    const created = current.edges.find((edge) => edge.from === "w")?.to as string;
    expect(current.nodes.find((node) => node.id === created)?.type).toBe("send_email");
    await waitFor(() => expect(activeKey()).toBe(`node:${created}`));
    expect(live()).toBe(t("adminJourneys.canvas.live.applied", { label }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("paleta: grupy SPEC w kolejności, wyszukiwanie bez polskich znaków, powód niedostępności", async () => {
    mount();
    fireEvent.click(document.querySelector('[data-insert-key="w:next"]') as HTMLElement);
    const dialog = await screen.findByRole("dialog");
    const groups = within(dialog).getAllByRole("group");
    expect(
      groups.map(
        (group) =>
          document.getElementById(group.getAttribute("aria-labelledby") ?? "")?.textContent,
      ),
    ).toEqual(
      ["time", "communication", "logic", "crm", "newsletter", "end"].map((group) =>
        t(`adminJourneys.common.palette.${group}`),
      ),
    );

    // Opis skutku jako opis pozycji.
    const email = dialog.querySelector('[data-palette-item="send_email"]') as HTMLElement;
    expect(
      within(dialog).getByRole("button", { name: t("adminJourneys.nodeType.send_email") }),
    ).toBe(email);
    expect(document.getElementById(email.getAttribute("aria-describedby") ?? "")?.textContent).toBe(
      t("adminJourneys.common.effect.send_email"),
    );

    // Krok końcowy w środku przepływu odciąłby resztę - wyłączony z powodem.
    const goal = dialog.querySelector('[data-palette-item="goal"]') as HTMLElement;
    expect(goal.getAttribute("aria-disabled")).toBe("true");
    expect(goal.textContent).toContain(t("adminJourneys.canvas.opError.slot_occupied"));

    fireEvent.change(within(dialog).getByLabelText(t("adminJourneys.canvas.palette.search")), {
      target: { value: "ZADANIE" },
    });
    expect(
      [...dialog.querySelectorAll<HTMLElement>("[data-palette-item]")].map(
        (item) => item.dataset.paletteItem,
      ),
    ).toEqual(["create_crm_task"]);
    fireEvent.change(within(dialog).getByLabelText(t("adminJourneys.canvas.palette.search")), {
      target: { value: "nic takiego" },
    });
    expect(dialog.textContent).toContain(
      t("adminJourneys.canvas.palette.empty", { query: "nic takiego" }),
    );
  });

  it("windykacja: mail widoczny w palecie, wyłączony z powodem z S8.1", async () => {
    mount({ settings: { triggerEventType: "billing_subscription.payment_failed.v1" } });
    fireEvent.click(document.querySelector('[data-insert-key="w:next"]') as HTMLElement);
    const dialog = await screen.findByRole("dialog");
    const email = dialog.querySelector('[data-palette-item="send_email"]') as HTMLElement;
    expect(email.getAttribute("aria-disabled")).toBe("true");
    expect(email.textContent).toContain(t("adminJourneys.common.palette.emailForbidden"));
    fireEvent.click(email);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("nowe kroki dostają domyślne teksty w języku panelu", async () => {
    h.lang = "en";
    let current: JourneyGraph = GRAPH;
    mount({ record: (graph) => (current = graph) });
    fireEvent.click(document.querySelector('[data-insert-key="w:next"]') as HTMLElement);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(dialog.querySelector('[data-palette-item="create_crm_task"]') as HTMLElement);
    const task = current.nodes.find((node) => node.type === "create_crm_task");
    expect((task?.params as { title: string }).title).toBe(
      realT("en")("adminJourneys.canvas.defaults.taskTitle"),
    );
  });

  it("„Połącz z krokiem…” na końcu gałęzi: lista kroków i scalenie z chipem", async () => {
    const spy = vi.fn();
    let current: JourneyGraph = GRAPH_END;
    mount({ initial: GRAPH_END, spy, record: (graph) => (current = graph) });
    fireEvent.click(document.querySelector('[data-insert-key="c:no"]') as HTMLElement);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(dialog.querySelector("[data-merge-into]") as HTMLElement);
    const menu = await within(dialog).findByRole("menu", {
      name: t("adminJourneys.common.ops.mergeInto"),
    });
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((item) => item.dataset.mergeTarget)).toEqual(["m1", "g"]);
    fireEvent.click(items[0]);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "merge", from: "c", branch: "no", targetId: "m1" }),
    );
    expect(current.edges).toContainEqual({ from: "c", to: "m1", branch: "no" });
    expect(current.nodes.some((node) => node.id === "x")).toBe(false);
    const chip = await waitFor(
      () => document.querySelector('[data-merge-from="c"]') as HTMLElement,
    );
    expect(chip.textContent).toBe(t("adminJourneys.canvas.merge.chip", { number: "2.1.1" }));
  });

  it("Delete: krok liniowy od razu, poddrzewo przez ConfirmDialog z liczbą dalszych kroków", async () => {
    let current: JourneyGraph = GRAPH;
    mount({ record: (graph) => (current = graph) });
    focusOn("w");
    press("Delete");
    expect(current.nodes.some((node) => node.id === "w")).toBe(false);
    expect(live()).toBe(
      t("adminJourneys.canvas.live.applied", { label: t("adminJourneys.common.ops.remove") }),
    );
    // Fokus wraca na rodzica usuniętego kroku (`focusId` z wyniku).
    await waitFor(() => expect(activeKey()).toBe("node:t"));

    focusOn("c");
    press("Delete");
    const alert = await screen.findByRole("alertdialog");
    expect(
      within(alert).getByText(t("adminJourneys.canvas.confirm.title", { number: "2" })),
    ).toBeTruthy();
    expect(
      within(alert).getByText(t("adminJourneys.canvas.confirm.description", { count: 3 })),
    ).toBeTruthy();
    expect(t("adminJourneys.canvas.confirm.description", { count: 3 })).toMatch(/^Znikną też 3/);
    expect(current.nodes.some((node) => node.id === "c")).toBe(true);
    fireEvent.click(
      within(alert).getByRole("button", { name: t("adminJourneys.common.ops.removeSubtree") }),
    );
    await waitFor(() => expect(current.nodes.some((node) => node.id === "c")).toBe(false));
    expect(current.nodes.map((node) => node.type).sort()).toEqual(["exit", "trigger"]);
    expect(validateJourneyGraph(current).errors).toEqual([]);
  });

  it("menu `⋯` i Shift+F10 = pozycje `availableOps` (te same napisy, ta sama kolejność)", async () => {
    mount();
    const context = journeyOpsContext(SETTINGS);
    for (const node of GRAPH.nodes) {
      const expected = availableOps(GRAPH, node.id, context).map((op) => journeyOpLabel(t, op));
      focusOn(node.id);
      press("F10", { shiftKey: true });
      const keyboard = await screen.findByRole("dialog");
      const viaKeyboard = within(keyboard)
        .queryAllByRole("menuitem")
        .map((item) => item.textContent?.replace(/(Insert|Delete)$/, ""));
      expect(viaKeyboard, node.id).toEqual(expected);
      fireEvent.keyDown(keyboard, { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

      fireEvent.click(document.querySelector(`[data-menu-for="${node.id}"]`) as HTMLElement);
      const mouse = await screen.findByRole("dialog", {
        name: t("adminJourneys.canvas.step.menu", {
          step: t("adminJourneys.canvas.step.ref", {
            number: buildJourneyView(GRAPH).numbering.get(node.id),
          }),
        }),
      });
      const viaMouse = within(mouse)
        .queryAllByRole("menuitem")
        .map((item) => item.textContent?.replace(/(Insert|Delete)$/, ""));
      expect(viaMouse, node.id).toEqual(expected);
      fireEvent.keyDown(mouse, { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    }
  });

  it("menu: „Dodaj krok w gałęzi „Nie”” prowadzi do palety tej gałęzi; strzałki po pozycjach", async () => {
    const spy = vi.fn();
    mount({ spy });
    focusOn("c");
    press("F10", { shiftKey: true });
    const dialog = await screen.findByRole("dialog");
    const items = within(dialog).getAllByRole("menuitem");
    await waitFor(() => expect(document.activeElement).toBe(items[0]));
    fireEvent.keyDown(items[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    expect(items[1].textContent).toBe(
      t("adminJourneys.common.ops.insertBranch", { branch: t("adminJourneys.branch.no") }),
    );
    fireEvent.click(items[1]);
    await within(dialog).findByLabelText(t("adminJourneys.canvas.palette.search"));
    fireEvent.click(dialog.querySelector('[data-palette-item="add_tag"]') as HTMLElement);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "insert", from: "c", branch: "no", type: "add_tag" }),
    );
  });

  it("odmowa operacji: komunikat z powodem w regionie aria-live", async () => {
    mount({ forced: { ok: false, error: "limit_nodes" } });
    focusOn("w");
    press("Delete");
    expect(live()).toBe(
      t("adminJourneys.canvas.live.refused", {
        label: t("adminJourneys.common.ops.remove"),
        reason: t("adminJourneys.canvas.opError.limit_nodes", { max: 60 }),
      }),
    );
    expect(screen.getByTestId("journey-live").getAttribute("aria-live")).toBe("polite");
  });

  it("komunikat edytora (cofnij/ponów) trafia do tego samego regionu", () => {
    mount({ announcement: "Cofnięto: Usuń krok" });
    expect(live()).toBe("Cofnięto: Usuń krok");
  });

  it("tylko do odczytu: bez „+” i „⋯”, skróty edycji nic nie zmieniają", () => {
    const spy = vi.fn();
    const onOpenStep = vi.fn();
    mount({ readOnly: true, spy, onOpenStep });
    expect(document.querySelector("[data-insert-key]")).toBeNull();
    expect(document.querySelector("[data-menu-for]")).toBeNull();
    focusOn("w");
    press("Delete");
    press("Insert");
    press("F10", { shiftKey: true });
    expect(spy).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(live()).toBe(t("adminJourneys.canvas.live.readOnly"));
    press("Enter");
    expect(onOpenStep).toHaveBeenCalledWith("w");
  });
});

// ── 5. Dostępność ────────────────────────────────────────────────────────────

describe("axe", () => {
  it("kanwa ze statystykami, paleta i menu - bez naruszeń", async () => {
    mount({ stats: stats(), selectedNodeId: "m1" });
    await waitFor(() => expect(document.querySelector("[data-tier]")).not.toBeNull());
    const canvas = screen.getByTestId("journey-canvas");
    let violations = await axeViolations(canvas);
    expect(violations, summarize(violations)).toEqual([]);

    fireEvent.click(document.querySelector('[data-insert-key="c:no"]') as HTMLElement);
    await screen.findByRole("dialog");
    violations = await axeViolations(document.body);
    expect(violations, summarize(violations)).toEqual([]);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    focusOn("c");
    press("F10", { shiftKey: true });
    await screen.findByRole("dialog");
    violations = await axeViolations(document.body);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("pusty szkic: komunikat zamiast kanwy, bez naruszeń", async () => {
    mount({ initial: { nodes: [], edges: [] } });
    expect(screen.getByText(t("adminJourneys.canvas.empty"))).toBeTruthy();
    const violations = await axeViolations(screen.getByTestId("journey-canvas"));
    expect(violations, summarize(violations)).toEqual([]);
  });
});

// ── 6. Słownik ───────────────────────────────────────────────────────────────

type Tree = { [key: string]: string | Tree };

function leaves(tree: Tree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === "string" ? [`${prefix}${key}`] : leaves(value, `${prefix}${key}.`),
  );
}

const PLURAL = /_(zero|one|two|few|many|other)$/;

describe("słownik `i18n-admin-journeys-canvas`", () => {
  const plKeys = leaves(journeysCanvasDictionaries.pl as unknown as Tree);

  it("parytet PL/EN i liczebniki _one/_few/_many/_other", () => {
    expect(leaves(journeysCanvasDictionaries.en as unknown as Tree)).toEqual(plKeys);
    const bases = new Set(plKeys.filter((k) => PLURAL.test(k)).map((k) => k.replace(PLURAL, "")));
    for (const base of bases) {
      for (const form of ["one", "few", "many", "other"]) {
        expect(plKeys, base).toContain(`${base}_${form}`);
      }
    }
  });

  it("wyłącznie gałęzie canvas i outline; zero kolizji z innymi słownikami ścieżek", () => {
    const branches = new Set(plKeys.map((key) => key.split(".").slice(0, 2).join(".")));
    expect([...branches].sort()).toEqual(["adminJourneys.canvas", "adminJourneys.outline"]);
    const others = import.meta.glob<Record<string, unknown>>("/src/lib/i18n-admin-journeys*.ts", {
      eager: true,
    });
    for (const [file, module] of Object.entries(others)) {
      if (file.endsWith("i18n-admin-journeys-canvas.ts")) continue;
      for (const value of Object.values(module)) {
        const pl = (value as { pl?: unknown } | null)?.pl;
        if (typeof pl !== "object" || pl === null) continue;
        const theirs = leaves(pl as Tree);
        const theirBranches = new Set(theirs.map((key) => key.split(".").slice(0, 2).join(".")));
        expect(
          [...branches].filter((branch) => theirBranches.has(branch)),
          file,
        ).toEqual([]);
      }
    }
  });

  it("każdy klucz ma czytelnika w kodzie produkcyjnym kanwy i listy", () => {
    const sources = [
      "JourneyCanvas",
      "JourneyNodeCard",
      "JourneyEdge",
      "JourneyInsertButton",
      "JourneyOutline",
    ]
      .map((name) => readFileSync(`src/components/admin/journeys/editor/${name}.tsx`, "utf8"))
      .join("\n");
    const unread = plKeys
      .map((key) => key.replace(PLURAL, ""))
      .filter((key, index, all) => all.indexOf(key) === index)
      .filter((key) => !sources.includes(`"${key}"`));
    expect(unread).toEqual([]);
  });
});
