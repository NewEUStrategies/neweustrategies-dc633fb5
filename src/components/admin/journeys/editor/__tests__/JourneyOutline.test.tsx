// Lista kroków ścieżki (S8.3b, SPEC §6.3 „widok Lista”) - RTL + axe.
//
// CO TEN PLIK DOWODZI.
//   1. Drzewo WAI-ARIA: `role="tree"`, `treeitem` z `aria-level`,
//      `aria-setsize`, `aria-posinset` i `aria-expanded`; gałęzie
//      rozgałęzienia to `role="group"` z nazwą, dalszy ciąg odcinka - grupa
//      bez nazwy; chip scalenia jest elementem drzewa.
//   2. „Lista = te same węzły i kolejność co kanwa”: obie powierzchnie na tym
//      samym grafie mają te same elementy fokusu w tej samej kolejności
//      (`focusItems`), te same numery i te same nazwy dla czytnika.
//   3. Parytet operacji kanwa ↔ lista ↔ klawiatura: Shift+F10 na kanwie,
//      Shift+F10 na liście i `⋯` na liście dają te same pozycje
//      (`availableOps`).
//   4. Jeden tab stop i klawisze `nav.ts` w trybie `outline`; Enter = panel,
//      Enter na chipie = przejście; Insert -> paleta przy wierszu, Delete
//      z potwierdzeniem przy poddrzewie; statystyki w wierszu i w nazwie;
//      tylko do odczytu bez menu. axe bez naruszeń.
import { useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

import { JourneyCanvas } from "../JourneyCanvas";
import {
  journeyOpLabel,
  journeyOpsContext,
  runJourneyEditRequest,
  type JourneyEditRequest,
} from "../JourneyInsertButton";
import { JourneyOutline, type JourneyOutlineProps } from "../JourneyOutline";
import { layoutJourney } from "@/lib/admin/journeys/layout";
import { focusItems, focusKey, moveFocus, type JourneyFocus } from "@/lib/admin/journeys/nav";
import { availableOps } from "@/lib/admin/journeys/ops";
import { buildJourneyView } from "@/lib/admin/journeys/viewModel";
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

const CONSENT = { match: "all", predicates: [{ kind: "consent", marketing: true }] };

// Wyzwalacz -> czekanie -> warunek (tak: mail -> cel; nie: mail -> chip do celu).
const GRAPH: JourneyGraph = {
  nodes: [
    { id: "t", type: "trigger", params: {} },
    { id: "w", type: "wait", params: { mode: "duration", minutes: 1440 } },
    { id: "c", type: "if_else", params: CONSENT },
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

// Test A/B, warunek zagnieżdżony w gałęzi A, scalenie B do warunku i drzewo
// poza przepływem (krok bez wejścia) - żaden z 14 szablonów tego nie ma.
const GRAPH_AB: JourneyGraph = {
  nodes: [
    { id: "t", type: "trigger", params: {} },
    { id: "ab", type: "ab_split", params: { weights: { A: 50, B: 50 }, winnerMetric: "click" } },
    { id: "m1", type: "send_email", params: {} },
    { id: "c", type: "if_else", params: CONSENT },
    { id: "g", type: "goal", params: {} },
    { id: "x", type: "exit", params: {} },
    { id: "m2", type: "send_email", params: {} },
    { id: "o", type: "add_tag", params: { tag: "sierota" } },
    { id: "x2", type: "exit", params: {} },
  ],
  edges: [
    { from: "t", to: "ab", branch: "next" },
    { from: "ab", to: "m1", branch: "A" },
    { from: "ab", to: "m2", branch: "B" },
    { from: "m1", to: "c", branch: "next" },
    { from: "c", to: "g", branch: "yes" },
    { from: "c", to: "x", branch: "no" },
    { from: "m2", to: "c", branch: "next" },
    { from: "o", to: "x2", branch: "next" },
  ],
};

const SETTINGS: Pick<JourneySettings, "triggerEventType" | "triggerCondition"> = {
  triggerEventType: "checkout.abandoned.v1",
};

function stats(): JourneyStatsDto {
  const raw = JSON.parse(JSON.stringify(RPC_SHAPES.statsEmail)) as {
    nodes: Record<string, unknown>[];
  };
  const [email] = raw.nodes as Record<string, unknown>[];
  raw.nodes = [
    {
      ...email,
      node_id: "m1",
      entered: 380,
      email: { ...(email.email as object), sent: 380, queued: 380 },
    },
  ];
  return parseJourneyStats(raw);
}

interface HarnessProps extends Partial<JourneyOutlineProps> {
  initial?: JourneyGraph;
  surfaces?: readonly ("canvas" | "outline")[];
  spy?: (request: JourneyEditRequest) => void;
  record?: (graph: JourneyGraph) => void;
}

function Harness({
  initial = GRAPH,
  surfaces = ["outline"],
  spy,
  record,
  settings = SETTINGS,
  ...rest
}: HarnessProps) {
  const [graph, setGraph] = useState(initial);
  const view = useMemo(() => buildJourneyView(graph), [graph]);
  const layout = useMemo(() => layoutJourney(view), [view]);
  record?.(graph);
  const onApplyOp = (request: JourneyEditRequest) => {
    spy?.(request);
    const result = runJourneyEditRequest(graph, request, journeyOpsContext(settings));
    if (result.ok) setGraph(result.graph);
    return result;
  };
  return (
    <>
      {surfaces.includes("canvas") ? (
        <JourneyCanvas
          graph={graph}
          view={view}
          layout={layout}
          settings={settings}
          onApplyOp={onApplyOp}
          showZoomControls={false}
          {...rest}
        />
      ) : null}
      {surfaces.includes("outline") ? (
        <JourneyOutline
          graph={graph}
          view={view}
          settings={settings}
          onApplyOp={onApplyOp}
          {...rest}
        />
      ) : null}
    </>
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

const outline = () => screen.getByTestId("journey-outline");
const item = (key: string) =>
  outline().querySelector<HTMLElement>(`[data-focus-key="${key}"]`) as HTMLElement;
const focusOn = (key: string) => act(() => item(key).focus());
const activeKey = () => (document.activeElement as HTMLElement | null)?.dataset.focusKey;
const press = (key: string, init: Record<string, boolean> = {}) =>
  fireEvent.keyDown(document.activeElement as Element, { key, ...init });
const menuLabels = (dialog: HTMLElement) =>
  within(dialog)
    .queryAllByRole("menuitem")
    .map((entry) => entry.textContent?.replace(/(Insert|Delete)$/, ""));

afterEach(cleanup);

// ── 1. Drzewo WAI-ARIA ───────────────────────────────────────────────────────

describe("role=tree / treeitem", () => {
  it("aria-level, aria-setsize, aria-posinset i aria-expanded wg drzewa widoku", () => {
    mount();
    const tree = screen.getByRole("tree", { name: t("adminJourneys.canvas.steps") });
    const expected: Record<string, [number, number, number, string | null]> = {
      "node:t": [1, 1, 1, "true"],
      "node:w": [2, 1, 1, "true"],
      "node:c": [3, 1, 1, "true"],
      "node:m1": [4, 2, 1, "true"],
      "node:g": [5, 1, 1, null],
      "node:m2": [4, 2, 2, "true"],
      "merge:m2:next": [5, 1, 1, null],
    };
    const items = within(tree).getAllByRole("treeitem");
    expect(items.map((entry) => entry.dataset.focusKey)).toEqual(Object.keys(expected));
    for (const entry of items) {
      const [level, setsize, posinset, expanded] = expected[entry.dataset.focusKey as string];
      expect(entry.getAttribute("aria-level"), entry.dataset.focusKey).toBe(String(level));
      expect(entry.getAttribute("aria-setsize")).toBe(String(setsize));
      expect(entry.getAttribute("aria-posinset")).toBe(String(posinset));
      expect(entry.getAttribute("aria-expanded")).toBe(expanded);
    }
    // Gałęzie warunku: grupy z nazwą; dalszy ciąg odcinka - grupa bez nazwy.
    const branches = within(item("node:c")).getAllByRole("group", { name: /Gałąź/ });
    expect(branches.map((group) => group.getAttribute("aria-label"))).toEqual([
      t("adminJourneys.outline.branch", { branch: t("adminJourneys.branch.yes") }),
      t("adminJourneys.outline.branch", { branch: t("adminJourneys.branch.no") }),
    ]);
    const continuation = item("node:w").querySelector(':scope > [role="group"]') as HTMLElement;
    expect(continuation.getAttribute("aria-label")).toBeNull();
    // Nazwa elementu = nazwa karty kanwy (numer, liczba kroków, gałąź, opis).
    expect(item("node:m1").getAttribute("aria-label")).toBe(
      t("adminJourneys.canvas.step.labelBranch", {
        number: "3.1.1",
        total: 6,
        branch: t("adminJourneys.branch.yes"),
        summary: t("adminJourneys.common.summary.sendEmailNoSubject"),
      }),
    );
    expect(item("merge:m2:next").getAttribute("aria-label")).toBe(
      t("adminJourneys.canvas.merge.label", {
        number: "3.1.2",
        summary: t("adminJourneys.common.summary.goalNoLabel"),
      }),
    );
  });

  it("pusta gałąź opisana w wierszu i w nazwie; krok poza przepływem na poziomie 1", () => {
    const graph: JourneyGraph = {
      nodes: [
        ...GRAPH_AB.nodes.filter((node) => node.id !== "x"),
        { id: "x", type: "exit", params: {} },
      ],
      edges: GRAPH_AB.edges.filter((edge) => !(edge.from === "c" && edge.branch === "no")),
    };
    mount({ initial: graph });
    // „x” bez wejścia jest teraz osobnym drzewem poza przepływem.
    const roots = [...outline().querySelectorAll<HTMLElement>('[role="treeitem"][aria-level="1"]')];
    expect(roots.map((entry) => entry.dataset.focusKey)).toEqual(["node:t", "node:o", "node:x"]);
    expect(roots.map((entry) => entry.getAttribute("aria-setsize"))).toEqual(["3", "3", "3"]);
    expect(item("node:o").getAttribute("aria-label")).toBe(
      t("adminJourneys.canvas.step.labelDetached", {
        summary: t("adminJourneys.common.summary.addTag", { tag: "sierota" }),
      }),
    );
    expect(item("node:o").textContent).toContain(t("adminJourneys.canvas.step.detached"));
    expect(item("node:c").getAttribute("aria-label")).toMatch(/Pusta gałąź: Nie$/);
    expect(item("node:c").textContent).toContain(
      t("adminJourneys.outline.openBranch", { branch: t("adminJourneys.branch.no") }),
    );
  });
});

// ── 2. Lista = kanwa ─────────────────────────────────────────────────────────

describe("Lista = te same węzły i kolejność co kanwa", () => {
  it("te same elementy fokusu, kolejność (`focusItems`), numery i nazwy", () => {
    mount({ initial: GRAPH_AB, surfaces: ["canvas", "outline"] });
    const view = buildJourneyView(GRAPH_AB);
    const expected = focusItems(view).map(focusKey);
    const canvas = screen.getByTestId("journey-canvas");
    const keysIn = (root: HTMLElement) =>
      [...root.querySelectorAll<HTMLElement>("[data-focus-key]")].map(
        (entry) => entry.dataset.focusKey as string,
      );
    expect(keysIn(canvas)).toEqual(expected);
    expect(keysIn(outline())).toEqual(expected);
    // Kolejność numerów to pre-order (A przed B, warunek pod pierwszym rodzicem).
    expect(view.order.map((id) => view.numbering.get(id) ?? "")).toEqual([
      "1",
      "2",
      "2.1.1",
      "2.1.2",
      "2.1.2.1.1",
      "2.1.2.2.1",
      "2.2.1",
      "",
      "",
    ]);
    for (const key of expected) {
      const onCanvas = canvas.querySelector(`[data-focus-key="${key}"]`) as HTMLElement;
      expect(item(key).getAttribute("aria-label"), key).toBe(onCanvas.getAttribute("aria-label"));
      if (!key.startsWith("node:")) continue;
      const number = (root: Element) =>
        root.querySelector(".tabular-nums.font-semibold")?.textContent;
      expect(number(item(key).querySelector("[data-outline-row]") as Element), key).toBe(
        number(onCanvas),
      );
    }
  });

  it("po operacji na liście kanwa pokazuje to samo (wspólny szkic)", async () => {
    let current: JourneyGraph = GRAPH;
    mount({ surfaces: ["canvas", "outline"], record: (graph) => (current = graph) });
    focusOn("node:w");
    press("Delete");
    await waitFor(() => expect(current.nodes.some((node) => node.id === "w")).toBe(false));
    const expected = focusItems(buildJourneyView(current)).map(focusKey);
    const canvasKeys = [
      ...screen.getByTestId("journey-canvas").querySelectorAll<HTMLElement>("[data-focus-key]"),
    ].map((entry) => entry.dataset.focusKey);
    const outlineKeys = [...outline().querySelectorAll<HTMLElement>("[data-focus-key]")].map(
      (entry) => entry.dataset.focusKey,
    );
    expect(canvasKeys).toEqual(expected);
    expect(outlineKeys).toEqual(expected);
  });
});

// ── 3. Parytet menu ──────────────────────────────────────────────────────────

describe("parytet operacji kanwa ↔ lista ↔ klawiatura", () => {
  it("Shift+F10 na kanwie = Shift+F10 na liście = `⋯` na liście = availableOps", async () => {
    mount({ surfaces: ["canvas", "outline"] });
    const context = journeyOpsContext(SETTINGS);
    const canvas = screen.getByTestId("journey-canvas");
    for (const node of GRAPH.nodes) {
      const expected = availableOps(GRAPH, node.id, context).map((op) => journeyOpLabel(t, op));
      const close = async (dialog: HTMLElement) => {
        fireEvent.keyDown(dialog, { key: "Escape" });
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      };

      act(() =>
        (canvas.querySelector(`[data-focus-key="node:${node.id}"]`) as HTMLElement).focus(),
      );
      press("F10", { shiftKey: true });
      const fromCanvas = await screen.findByRole("dialog");
      expect(menuLabels(fromCanvas), `kanwa ${node.id}`).toEqual(expected);
      await close(fromCanvas);

      focusOn(`node:${node.id}`);
      press("F10", { shiftKey: true });
      const fromOutline = await screen.findByRole("dialog");
      expect(menuLabels(fromOutline), `lista ${node.id}`).toEqual(expected);
      await close(fromOutline);

      fireEvent.click(
        item(`node:${node.id}`).querySelector(`[data-menu-for="${node.id}"]`) as Element,
      );
      const fromButton = await screen.findByRole("dialog");
      expect(menuLabels(fromButton), `⋯ ${node.id}`).toEqual(expected);
      await close(fromButton);
    }
  });
});

// ── 4. Klawiatura i operacje ─────────────────────────────────────────────────

describe("klawiatura (nav.ts, tryb outline) i operacje", () => {
  it("jeden tab stop; strzałki, Home i End jak `moveFocus` w trybie listy", () => {
    mount({ initial: GRAPH_AB });
    const tree = screen.getByRole("tree");
    expect(tree.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    for (const button of tree.querySelectorAll("[data-menu-for]")) {
      expect(button.getAttribute("tabindex")).toBe("-1");
    }
    const view = buildJourneyView(GRAPH_AB);
    focusOn("node:t");
    let expected: JourneyFocus | null = { kind: "node", id: "t" };
    const keys = [
      "ArrowDown",
      "ArrowRight",
      "ArrowRight",
      "ArrowDown",
      "ArrowDown",
      "ArrowLeft",
      "ArrowUp",
      "End",
      "ArrowUp",
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
    for (const key of keys) {
      press(key);
      expected = moveFocus(view, expected, direction[key], "outline");
      expect(activeKey(), key).toBe(focusKey(expected as JourneyFocus));
      expect(tree.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    }
  });

  it("Enter = panel kroku, Enter na chipie = przejście, klik wiersza = panel", () => {
    const onOpenStep = vi.fn();
    const onUndo = vi.fn();
    mount({ onOpenStep, onUndo, selectedNodeId: "c" });
    expect(item("node:c").getAttribute("aria-current")).toBe("true");
    focusOn("node:m1");
    press("Enter");
    expect(onOpenStep).toHaveBeenLastCalledWith("m1");
    focusOn("merge:m2:next");
    press("Enter");
    expect(activeKey()).toBe("node:g");
    fireEvent.click(item("node:w").querySelector("[data-outline-row]") as Element);
    expect(onOpenStep).toHaveBeenLastCalledWith("w");
    press("z", { ctrlKey: true });
    expect(onUndo).toHaveBeenCalledTimes(1);
    // Powiększenie dotyczy kanwy - na liście Ctrl+= zostaje przeglądarce.
    const event = fireEvent.keyDown(document.activeElement as Element, { key: "=", ctrlKey: true });
    expect(event).toBe(true);
  });

  it("Insert -> paleta przy wierszu; nowy krok dostaje fokus na liście", async () => {
    const spy = vi.fn();
    let current: JourneyGraph = GRAPH;
    mount({ spy, record: (graph) => (current = graph) });
    focusOn("node:c");
    press("Insert");
    const dialog = await screen.findByRole("dialog", {
      name: t("adminJourneys.canvas.insert.branch", {
        branch: t("adminJourneys.branch.yes"),
        step: t("adminJourneys.canvas.step.ref", { number: "3" }),
      }),
    });
    fireEvent.click(dialog.querySelector('[data-palette-item="wait_duration"]') as HTMLElement);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "insert", from: "c", branch: "yes", type: "wait" }),
    );
    expect(validateJourneyGraph(current).errors).toEqual([]);
    const created = current.edges.find((edge) => edge.from === "c" && edge.branch === "yes")?.to;
    await waitFor(() => expect(activeKey()).toBe(`node:${created}`));
  });

  it("Delete na rozgałęzieniu: ConfirmDialog, potwierdzenie usuwa poddrzewo", async () => {
    let current: JourneyGraph = GRAPH;
    mount({ record: (graph) => (current = graph) });
    focusOn("node:c");
    press("Delete");
    const alert = await screen.findByRole("alertdialog");
    fireEvent.click(
      within(alert).getByRole("button", { name: t("adminJourneys.common.ops.removeSubtree") }),
    );
    await waitFor(() => expect(current.nodes.some((node) => node.id === "c")).toBe(false));
    expect(screen.getByTestId("journey-live").textContent?.trim()).toBe(
      t("adminJourneys.canvas.live.applied", {
        label: t("adminJourneys.common.ops.removeSubtree"),
      }),
    );
  });

  it("statystyki: liczby kroku w wierszu i w nazwie elementu", () => {
    mount({ stats: stats() });
    const statsText = t("adminJourneys.statsOverlay.aria.sent", { count: 380, value: "380" });
    expect(item("node:m1").querySelector("[data-outline-row]")?.textContent).toContain(statsText);
    expect(item("node:m1").getAttribute("aria-label")).toMatch(new RegExp(`, ${statsText}$`));
    cleanup();
    mount({ stats: stats(), statsHidden: true });
    expect(item("node:m1").getAttribute("aria-label")).not.toContain(statsText);
  });

  it("tylko do odczytu: bez `⋯`, Delete nic nie zmienia", () => {
    const spy = vi.fn();
    mount({ readOnly: true, spy });
    expect(outline().querySelector("[data-menu-for]")).toBeNull();
    focusOn("node:w");
    press("Delete");
    expect(spy).not.toHaveBeenCalled();
    expect(screen.getByTestId("journey-live").textContent?.trim()).toBe(
      t("adminJourneys.canvas.live.readOnly"),
    );
  });
});

// ── 5. axe ───────────────────────────────────────────────────────────────────

describe("axe", () => {
  it("lista z gałęziami, chipem, krokiem poza przepływem i menu - bez naruszeń", async () => {
    mount({ initial: GRAPH_AB, stats: stats(), selectedNodeId: "c" });
    let violations = await axeViolations(outline());
    expect(violations, summarize(violations)).toEqual([]);
    focusOn("node:ab");
    press("F10", { shiftKey: true });
    await screen.findByRole("dialog");
    violations = await axeViolations(document.body);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("pusty szkic - komunikat, bez naruszeń", async () => {
    mount({ initial: { nodes: [], edges: [] } });
    expect(screen.queryByRole("tree")).toBeNull();
    expect(screen.getByText(t("adminJourneys.canvas.empty"))).toBeTruthy();
    const violations = await axeViolations(outline());
    expect(violations, summarize(violations)).toEqual([]);
  });
});
