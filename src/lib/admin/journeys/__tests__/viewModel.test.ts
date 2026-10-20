// Model widoku ścieżki (S8): DAG -> drzewo z chipami scaleń i numeracją.
//
// CO TEN PLIK DOWODZI.
//   1. Krok z kilkoma rodzicami stoi pod PIERWSZYM (kolejność krawędzi),
//      reszta wejść to chipy „→ dalej jak w kroku …” z numerem celu.
//   2. Dzieci w kolejności gałęzi typu (tak przed nie, A przed B), niezależnie
//      od kolejności krawędzi w tablicy.
//   3. Numeracja hierarchiczna: ciąg główny 1, 2, 3…, gałąź i kroku k ->
//      „k.i.1”, dalej „k.i.2”… Stabilna przy zmianie kolejności niezwiązanych
//      krawędzi, po wstawieniu kroku w innej gałęzi i po dopisaniu brakującej
//      gałęzi „tak” (gałąź „nie” zostaje „k.2.*”).
//   4. Graf niepoprawny (cykl, sieroty, brak wyzwalacza, pusty szkic, krawędź
//      wisząca, zdublowany identyfikator) daje widok, nie wyjątek.
//   5. Każdy z 14 szablonów S5 ma pełną, unikalną numerację.
import { describe, expect, it } from "vitest";

import { insertAfter } from "../ops";
import { buildJourneyView, compareStepNumbers, type JourneyGraphLike } from "../viewModel";
import { emptyJourneyGraph, type JourneyGraph } from "@/lib/journeys/graph";
import type { JourneyEdgeBranch, JourneyNodeType } from "@/lib/journeys/nodeTypes";
import { JOURNEY_TEMPLATES } from "@/lib/journeys/templates";

const node = (id: string, type: JourneyNodeType, params: unknown = {}) => ({ id, type, params });
const edge = (from: string, to: string, branch: JourneyEdgeBranch = "next") => ({ from, to, branch });

const IF_PARAMS = { match: "all", predicates: [{ kind: "consent", marketing: true }] };
const AB_PARAMS = { weights: { A: 50, B: 50 }, winnerMetric: "click" };
const WAIT = { mode: "duration", minutes: 60 };

/** Wyzwalacz -> mail -> warunek; tak -> cel; nie -> czekanie -> mail -> koniec. */
function branchy(): JourneyGraph {
  return {
    nodes: [
      node("t", "trigger"),
      node("m1", "send_email"),
      node("if", "if_else", IF_PARAMS),
      node("g", "goal"),
      node("w", "wait", WAIT),
      node("m2", "send_email"),
      node("x", "exit"),
    ],
    // Gałąź „nie” CELOWO przed „tak” - kolejność dzieci ma iść z typu kroku.
    edges: [
      edge("t", "m1"),
      edge("m1", "if"),
      edge("if", "w", "no"),
      edge("if", "g", "yes"),
      edge("w", "m2"),
      edge("m2", "x"),
    ],
  };
}

/** Test A/B, oba ramiona zbiegają się w jednym czekaniu (scalenie). */
function merged(): JourneyGraph {
  return {
    nodes: [
      node("t", "trigger"),
      node("split", "ab_split", AB_PARAMS),
      node("ma", "send_email"),
      node("mb", "send_email"),
      node("join", "wait", WAIT),
      node("x", "exit"),
    ],
    edges: [
      edge("t", "split"),
      edge("split", "ma", "A"),
      edge("split", "mb", "B"),
      edge("ma", "join"),
      edge("mb", "join"),
      edge("join", "x"),
    ],
  };
}

function numbers(graph: JourneyGraphLike | null): Record<string, string> {
  return Object.fromEntries(buildJourneyView(graph).numbering);
}

describe("drzewo z DAG", () => {
  it("dzieci w kolejności gałęzi typu: tak przed nie, mimo odwrotnej kolejności krawędzi", () => {
    const view = buildJourneyView(branchy());
    expect(view.nodes.get("if")?.children).toEqual(["g", "w"]);
    expect(view.nodes.get("g")).toMatchObject({ parentId: "if", branch: "yes", depth: 3, branchLevel: 1 });
    expect(view.nodes.get("w")).toMatchObject({ parentId: "if", branch: "no", depth: 3, branchLevel: 1 });
    expect(view.order).toEqual(["t", "m1", "if", "g", "w", "m2", "x"]);
    expect(view.root?.id).toBe("t");
    expect(view.merges).toEqual([]);
    expect(view.unreachable).toEqual([]);
  });

  it("krok z dwoma rodzicami stoi pod PIERWSZYM, drugie wejście to chip z numerem celu", () => {
    const view = buildJourneyView(merged());
    expect(view.nodes.get("join")?.parentId).toBe("ma");
    expect(view.nodes.get("mb")?.children).toEqual([]);
    expect(view.nodes.get("mb")?.slots).toEqual([{ kind: "merge", branch: "next", to: "join" }]);
    expect(view.merges).toEqual([{ from: "mb", to: "join", branch: "next", targetNumber: "2.1.2" }]);
    // Krok scalenia nie dubluje się w kolejności widoku.
    expect(view.order.filter((id) => id === "join")).toHaveLength(1);
  });

  it("brakująca gałąź to wyjście „open” w swojej pozycji", () => {
    const graph = branchy();
    graph.edges = graph.edges.filter((e) => e.branch !== "yes");
    graph.nodes = graph.nodes.filter((n) => n.id !== "g");
    const view = buildJourneyView(graph);
    expect(view.nodes.get("if")?.slots).toEqual([
      { kind: "open", branch: "yes" },
      { kind: "child", branch: "no", id: "w" },
    ]);
  });
});

describe("numeracja hierarchiczna", () => {
  it("ciąg główny 1, 2, 3…, gałąź i kroku k: k.i.1, k.i.2…", () => {
    expect(numbers(branchy())).toEqual({
      t: "1",
      m1: "2",
      if: "3",
      g: "3.1.1",
      w: "3.2.1",
      m2: "3.2.2",
      x: "3.2.3",
    });
    expect(numbers(merged())).toEqual({
      t: "1",
      split: "2",
      ma: "2.1.1",
      join: "2.1.2",
      x: "2.1.3",
      mb: "2.2.1",
    });
    expect(numbers(emptyJourneyGraph())).toEqual({ trigger: "1", exit: "2" });
  });

  it("jest stabilna przy zmianie kolejności NIEZWIĄZANYCH krawędzi", () => {
    const base = numbers(merged());
    const graph = merged();
    // Odwrócona tablica z zachowaną kolejnością dwóch wejść do `join`.
    const shuffled = [...graph.edges].reverse();
    const intoJoin = shuffled.filter((e) => e.to === "join").reverse();
    let k = 0;
    graph.edges = shuffled.map((e) => (e.to === "join" ? intoJoin[k++] : e));
    expect(numbers(graph)).toEqual(base);
  });

  it("kolejność krawędzi WCHODZĄCYCH do scalenia decyduje o rodzicu (reguła udokumentowana)", () => {
    const graph = merged();
    const [a, b] = [graph.edges[3], graph.edges[4]];
    graph.edges[3] = b;
    graph.edges[4] = a;
    const view = buildJourneyView(graph);
    expect(view.nodes.get("join")?.parentId).toBe("mb");
    expect(view.numbering.get("join")).toBe("2.2.2");
    expect(view.merges).toEqual([{ from: "ma", to: "join", branch: "next", targetNumber: "2.2.2" }]);
  });

  it("wstawienie kroku w jednej gałęzi nie zmienia numerów drugiej ani kroków przed nią", () => {
    const before = numbers(merged());
    const result = insertAfter(merged(), "mb", "next", "wait");
    if (!result.ok) throw new Error(result.error);
    const after = numbers(result.graph);
    for (const id of ["t", "split", "ma", "join", "x", "mb"]) expect(after[id]).toBe(before[id]);
    expect(after[result.created[0]]).toBe("2.2.2");
  });

  it("dopisanie brakującej gałęzi „tak” nie przenumerowuje gałęzi „nie”", () => {
    const graph = branchy();
    graph.edges = graph.edges.filter((e) => e.branch !== "yes");
    graph.nodes = graph.nodes.filter((n) => n.id !== "g");
    const incomplete = numbers(graph);
    expect(incomplete.w).toBe("3.2.1");
    expect(numbers(branchy()).w).toBe("3.2.1");
  });

  it("compareStepNumbers porządkuje składowa po składowej, pusty numer na końcu", () => {
    const sorted = ["10", "3.2.1", "", "2", "3.1.1", "3", "3.1.10", "3.1.2"].sort(compareStepNumbers);
    expect(sorted).toEqual(["2", "3", "3.1.1", "3.1.2", "3.1.10", "3.2.1", "10", ""]);
  });
});

describe("graf niepoprawny - widok bez wyjątku", () => {
  it("pusty szkic i brak grafu: brak korzenia, pusta kolejność", () => {
    for (const graph of [{ nodes: [], edges: [] }, null, undefined]) {
      const view = buildJourneyView(graph);
      expect(view.root).toBeNull();
      expect(view.order).toEqual([]);
      expect(view.unreachable).toEqual([]);
    }
  });

  it("cykl kończy się chipem scalenia, a nie pętlą", () => {
    const graph = {
      nodes: [node("t", "trigger"), node("a", "wait", WAIT), node("b", "wait", WAIT)],
      edges: [edge("t", "a"), edge("a", "b"), edge("b", "a")],
    };
    const view = buildJourneyView(graph);
    expect(view.order).toEqual(["t", "a", "b"]);
    expect(view.merges).toEqual([{ from: "b", to: "a", branch: "next", targetNumber: "2" }]);
  });

  it("cykl odcinający „pierwszego” rodzica: krok i tak trafia do drzewa", () => {
    const graph = {
      nodes: [node("t", "trigger"), node("a", "wait", WAIT), node("b", "wait", WAIT)],
      // Pierwsza krawędź do `a` wychodzi z `b`, które jest osiągalne tylko przez `a`.
      edges: [edge("b", "a"), edge("t", "a"), edge("a", "b")],
    };
    const view = buildJourneyView(graph);
    expect(new Set(view.order)).toEqual(new Set(["t", "a", "b"]));
    expect(view.nodes.get("a")?.parentId).toBe("t");
    expect(view.merges.map((m) => `${m.from}->${m.to}`)).toEqual(["b->a"]);
  });

  it("sieroty: lista nieosiągalnych, osobne drzewo bez numerów", () => {
    const graph = {
      nodes: [node("t", "trigger"), node("e", "exit"), node("o", "wait", WAIT), node("oe", "exit")],
      edges: [edge("t", "e"), edge("o", "oe")],
    };
    const view = buildJourneyView(graph);
    expect(view.unreachable).toEqual(["o", "oe"]);
    expect(view.detachedRoots).toEqual(["o"]);
    expect(view.nodes.get("oe")).toMatchObject({ parentId: "o", number: "", reachable: false });
    expect(view.order).toEqual(["t", "e", "o", "oe"]);
    expect(view.numbering.has("o")).toBe(false);
  });

  it("brak wyzwalacza: korzenia brak, wszystko poza przepływem", () => {
    const graph = { nodes: [node("w", "wait", WAIT), node("e", "exit")], edges: [edge("w", "e")] };
    const view = buildJourneyView(graph);
    expect(view.root).toBeNull();
    expect(view.unreachable).toEqual(["w", "e"]);
    expect(view.detachedRoots).toEqual(["w"]);
  });

  it("krawędź wisząca znika, zdublowany identyfikator - wygrywa pierwszy wpis", () => {
    const graph = {
      nodes: [node("t", "trigger"), node("e", "exit"), node("e", "goal")],
      edges: [edge("t", "e"), edge("t", "ghost", "yes")],
    };
    const view = buildJourneyView(graph);
    expect(view.nodes.get("e")?.type).toBe("exit");
    expect(view.order).toEqual(["t", "e"]);
    expect(view.nodes.get("t")?.slots).toEqual([{ kind: "child", branch: "next", id: "e" }]);
  });
});

describe("szablony S5", () => {
  it.each(Object.values(JOURNEY_TEMPLATES).map((template) => [template.key, template.graph] as const))(
    "%s: każdy krok ma unikalny numer, kolejność obejmuje wszystkie kroki",
    (_key, graph) => {
      const view = buildJourneyView(graph);
      expect(view.root?.type).toBe("trigger");
      expect(view.root?.number).toBe("1");
      expect(view.order).toHaveLength(graph.nodes.length);
      expect(new Set(view.order)).toEqual(new Set(graph.nodes.map((n) => n.id)));
      const all = [...view.numbering.values()];
      expect(new Set(all).size).toBe(graph.nodes.length);
      expect(view.unreachable).toEqual([]);
    },
  );
});
