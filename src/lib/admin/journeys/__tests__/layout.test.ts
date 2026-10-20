// Układ kanwy ścieżki (S8) - test geometrii jak `seatingGeometry.ts`.
//
// CO TEN PLIK DOWODZI.
//   1. Stałe SPEC §6.3: karta 280 × 88, odstępy 48/40, etykieta gałęzi 20.
//   2. Żadne dwie karty ani chipy się nie nakładają - na 14 szablonach S5
//      i na grafach ze scaleniem, zagnieżdżeniem i krokami poza przepływem.
//   3. Dziecko leży dokładnie rząd niżej (+20 px na każdą gałąź), krawędź jest
//      ortogonalna `M x1 y1 V ym H x2 V y2` od dołu rodzica do góry dziecka.
//   4. Chip scalenia stoi w pasie swojej gałęzi, rząd pod krokiem źródłowym.
//   5. Deterministyczność (ten sam wynik za każdym razem) i O(n): liczba
//      odczytów węzłów rośnie liniowo z rozmiarem grafu.
import { describe, expect, it } from "vitest";

import {
  BRANCH_LABEL_H,
  CHIP_H,
  CHIP_W,
  GAP_X,
  GAP_Y,
  INSERT_SIZE,
  NODE_H,
  NODE_W,
  ROW_H,
  fitScale,
  layoutJourney,
  type JourneyLayout,
} from "../layout";
import { buildJourneyView, type JourneyView, type JourneyViewNode } from "../viewModel";
import type { JourneyGraph } from "@/lib/journeys/graph";
import type { JourneyEdgeBranch, JourneyNodeType } from "@/lib/journeys/nodeTypes";
import { JOURNEY_TEMPLATES } from "@/lib/journeys/templates";

const node = (id: string, type: JourneyNodeType, params: unknown = {}) => ({ id, type, params });
const edge = (from: string, to: string, branch: JourneyEdgeBranch = "next") => ({
  from,
  to,
  branch,
});
const IF = { match: "all", predicates: [{ kind: "consent", marketing: true }] };
const AB = { weights: { A: 50, B: 50 }, winnerMetric: "click" };
const WAIT = { mode: "duration", minutes: 60 };

/** Rozgałęzienie zagnieżdżone, scalenie i sierota w jednym grafie. */
function complex(): JourneyGraph {
  return {
    nodes: [
      node("t", "trigger"),
      node("ab", "ab_split", AB),
      node("ma", "send_email"),
      node("if", "if_else", IF),
      node("yes", "goal"),
      node("no", "wait", WAIT),
      node("mb", "send_email"),
      node("join", "wait", WAIT),
      node("x", "exit"),
      node("orphan", "wait", WAIT),
      node("ox", "exit"),
    ],
    edges: [
      edge("t", "ab"),
      edge("ab", "ma", "A"),
      edge("ab", "mb", "B"),
      edge("ma", "if"),
      edge("if", "yes", "yes"),
      edge("if", "no", "no"),
      edge("no", "join"),
      edge("mb", "join"),
      edge("join", "x"),
      edge("orphan", "ox"),
    ],
  };
}

type Box = { id: string; x: number; y: number; width: number; height: number };

function boxes(layout: JourneyLayout): Box[] {
  return [
    ...layout.nodes,
    ...layout.chips.map((chip) => ({ ...chip, id: `chip:${chip.from}:${chip.branch}` })),
  ];
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function expectNoOverlap(layout: JourneyLayout) {
  const all = boxes(layout);
  for (let i = 0; i < all.length; i += 1) {
    for (let j = i + 1; j < all.length; j += 1) {
      expect(overlaps(all[i], all[j]), `${all[i].id} × ${all[j].id}`).toBe(false);
    }
  }
}

const CASES: readonly (readonly [string, JourneyGraph])[] = [
  ...Object.values(JOURNEY_TEMPLATES).map((template) => [template.key, template.graph] as const),
  ["complex", complex()],
];

describe("stałe i wymiary", () => {
  it("stałe SPEC §6.3", () => {
    expect([NODE_W, NODE_H, GAP_Y, GAP_X, BRANCH_LABEL_H, INSERT_SIZE]).toEqual([
      280, 88, 48, 40, 20, 28,
    ]);
    expect(ROW_H).toBe(NODE_H + GAP_Y);
  });

  it.each(CASES)("%s: każda karta ma stały rozmiar 280 × 88", (_key, graph) => {
    const layout = layoutJourney(buildJourneyView(graph));
    for (const box of layout.nodes) expect([box.width, box.height]).toEqual([NODE_W, NODE_H]);
    for (const chip of layout.chips) expect([chip.width, chip.height]).toEqual([CHIP_W, CHIP_H]);
    expect(layout.nodes).toHaveLength(graph.nodes.length);
  });
});

describe("brak nakładania i rzędy", () => {
  it.each(CASES)("%s: żadne dwie karty ani chipy się nie nakładają", (_key, graph) => {
    expectNoOverlap(layoutJourney(buildJourneyView(graph)));
  });

  it.each(CASES)("%s: dziecko rząd niżej (+20 px na gałąź), krawędź ortogonalna", (_key, graph) => {
    const view = buildJourneyView(graph);
    const layout = layoutJourney(view);
    const at = new Map(layout.nodes.map((box) => [box.id, box]));
    for (const e of layout.edges.filter((entry) => entry.kind === "tree")) {
      const parent = at.get(e.from) as Box;
      const child = at.get(e.to as string) as Box;
      const extra = e.branch === "next" ? 0 : BRANCH_LABEL_H;
      expect(child.y - parent.y).toBe(ROW_H + extra);
      const match = /^M (\S+) (\S+) V (\S+) H (\S+) V (\S+)$/.exec(e.path);
      expect(match, e.path).not.toBeNull();
      const [x1, y1, ym, x2, y2] = (match as RegExpExecArray).slice(1).map(Number);
      expect([x1, y1]).toEqual([parent.x + NODE_W / 2, parent.y + NODE_H]);
      expect([x2, y2]).toEqual([child.x + NODE_W / 2, child.y]);
      expect(ym).toBeGreaterThan(y1);
      expect(ym).toBeLessThan(y2);
      if (e.branch === "next") expect(e.label).toBeNull();
      else expect(e.label).toEqual({ x: x2, y: expect.any(Number) });
    }
    // Całość mieści się w zgłoszonych wymiarach.
    for (const box of boxes(layout)) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(layout.width);
      expect(box.y + box.height).toBeLessThanOrEqual(layout.height);
    }
  });

  it("rodzic wyśrodkowany nad pasem dzieci, rodzeństwo z odstępem GAP_X", () => {
    const layout = layoutJourney(buildJourneyView(complex()));
    const at = new Map(layout.nodes.map((box) => [box.id, box]));
    const ab = at.get("ab") as Box;
    const ma = at.get("ma") as Box;
    const mb = at.get("mb") as Box;
    expect(mb.x).toBeGreaterThanOrEqual(ma.x + NODE_W + GAP_X);
    // Środek „ab” leży w połowie pasa obu poddrzew.
    expect(ab.x + NODE_W / 2).toBeGreaterThan(ma.x + NODE_W / 2);
    expect(ab.x + NODE_W / 2).toBeLessThan(mb.x + NODE_W / 2);
  });
});

describe("chip scalenia, przyciski „+” i drzewa poza przepływem", () => {
  it("chip stoi rząd pod krokiem źródłowym, w osi jego wyjścia", () => {
    const view = buildJourneyView(complex());
    const layout = layoutJourney(view);
    expect(view.merges).toEqual([
      { from: "mb", to: "join", branch: "next", targetNumber: "2.1.2.2.2" },
    ]);
    const chip = layout.chips[0];
    const source = layout.nodes.find((box) => box.id === "mb") as Box;
    expect(chip).toMatchObject({ from: "mb", to: "join", targetNumber: "2.1.2.2.2" });
    expect(chip.y).toBe(source.y + ROW_H);
    expect(chip.x + CHIP_W / 2).toBe(source.x + NODE_W / 2);
    const mergeEdge = layout.edges.find((e) => e.kind === "merge");
    expect(mergeEdge?.path.endsWith(`V ${chip.y}`)).toBe(true);
  });

  it("jeden „+” na każde wyjście kroku (dziecko, chip, brak), 28 px", () => {
    const view = buildJourneyView(complex());
    const layout = layoutJourney(view);
    const slots = [...view.nodes.values()].reduce((sum, n) => sum + n.slots.length, 0);
    expect(layout.inserts).toHaveLength(slots);
    for (const insert of layout.inserts) expect(insert.size).toBe(INSERT_SIZE);
    // „+” na krawędzi `next` leży w odstępie między kartami, nie na karcie.
    const insert = layout.inserts.find((i) => i.from === "t") as JourneyLayout["inserts"][number];
    const t = layout.nodes.find((box) => box.id === "t") as Box;
    expect(insert.y).toBeGreaterThanOrEqual(t.y + NODE_H);
    expect(insert.y + INSERT_SIZE).toBeLessThanOrEqual(t.y + ROW_H);
  });

  it("brakująca gałąź dostaje „+” w swoim miejscu (`to: null`)", () => {
    const graph: JourneyGraph = {
      nodes: [node("t", "trigger"), node("if", "if_else", IF), node("x", "exit")],
      edges: [edge("t", "if"), edge("if", "x", "no")],
    };
    const layout = layoutJourney(buildJourneyView(graph));
    const open = layout.inserts.find((i) => i.from === "if" && i.branch === "yes");
    expect(open).toMatchObject({ to: null, size: INSERT_SIZE });
    expect(layout.edges.find((e) => e.kind === "open")).toMatchObject({
      from: "if",
      branch: "yes",
      to: null,
    });
    expectNoOverlap(layout);
  });

  it("drzewo poza przepływem stoi na prawo od przepływu", () => {
    const layout = layoutJourney(buildJourneyView(complex()));
    const flow = layout.nodes.filter((box) => !["orphan", "ox"].includes(box.id));
    const orphan = layout.nodes.find((box) => box.id === "orphan") as Box;
    expect(orphan.y).toBe(0);
    for (const box of flow) expect(orphan.x).toBeGreaterThan(box.x + NODE_W);
  });
});

describe("deterministyczność i złożoność", () => {
  it("ten sam graf - ten sam układ", () => {
    const a = layoutJourney(buildJourneyView(complex()));
    const b = layoutJourney(buildJourneyView(complex()));
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(layoutJourney(buildJourneyView(complex()))));
  });

  it("pusty widok: zero wymiarów, brak elementów", () => {
    expect(layoutJourney(buildJourneyView({ nodes: [], edges: [] }))).toEqual({
      nodes: [],
      edges: [],
      chips: [],
      inserts: [],
      width: 0,
      height: 0,
    });
  });

  /** Widok z licznikiem odczytów węzłów - miara pracy algorytmu. */
  function counted(view: JourneyView): { view: JourneyView; reads: () => number } {
    let reads = 0;
    const nodes = new Map(view.nodes);
    const original = nodes.get.bind(nodes);
    nodes.get = (id: string): JourneyViewNode | undefined => {
      reads += 1;
      return original(id);
    };
    return { view: { ...view, nodes }, reads: () => reads };
  }

  function chain(length: number): JourneyGraph {
    const nodes = [node("t", "trigger")];
    const edges = [];
    for (let i = 0; i < length; i += 1) {
      nodes.push(node(`w${i}`, "wait", WAIT));
      edges.push(edge(i === 0 ? "t" : `w${i - 1}`, `w${i}`));
    }
    return { nodes, edges };
  }

  function wide(levels: number): JourneyGraph {
    const nodes = [node("t", "trigger"), node("n0", "if_else", IF)];
    const edges = [edge("t", "n0")];
    let frontier = ["n0"];
    let id = 1;
    for (let level = 0; level < levels; level += 1) {
      const next: string[] = [];
      for (const parent of frontier) {
        for (const branch of ["yes", "no"] as const) {
          const child = `n${id++}`;
          nodes.push(
            node(child, level === levels - 1 ? "exit" : "if_else", level === levels - 1 ? {} : IF),
          );
          edges.push(edge(parent, child, branch));
          next.push(child);
        }
      }
      frontier = next;
    }
    return { nodes, edges };
  }

  it.each([
    ["łańcuch", chain(400), chain(4000)],
    ["drzewo binarne", wide(6), wide(9)],
  ] as const)("%s: odczyty węzłów rosną liniowo (O(n))", (_label, small, large) => {
    const a = counted(buildJourneyView(small));
    layoutJourney(a.view);
    const b = counted(buildJourneyView(large));
    layoutJourney(b.view);
    const perNodeSmall = a.reads() / small.nodes.length;
    const perNodeLarge = b.reads() / large.nodes.length;
    expect(perNodeLarge).toBeLessThanOrEqual(perNodeSmall * 1.1 + 0.5);
    expect(perNodeLarge).toBeLessThan(4);
  });
});

describe("skala miniatury", () => {
  it("mieści układ w ramce i nigdy nie powiększa", () => {
    expect(fitScale({ width: 1200, height: 600 }, 240, 120)).toBeCloseTo(0.2);
    expect(fitScale({ width: 100, height: 50 }, 240, 120)).toBe(1);
    expect(fitScale({ width: 0, height: 0 }, 240, 120)).toBe(1);
  });
});
