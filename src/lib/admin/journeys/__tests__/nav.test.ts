// Nawigacja klawiaturą po ścieżce (S8) - kanwa (przestrzennie) i lista
// (wzorzec drzewa WAI-ARIA), jedna definicja dla obu widoków.
//
// CO TEN PLIK DOWODZI.
//   1. ↑/↓ przepływ (rodzic / pierwsze wyjście), ←/→ sąsiednia gałąź z każdej
//      głębokości gałęzi, Home/End - początek i koniec.
//   2. Chip scalenia jest elementem fokusu: Enter na nim przenosi fokus na
//      krok docelowy, Enter na kroku otwiera panel.
//   3. Tryb listy: poprzedni/następny w kolejności czytania, → dziecko, ← rodzic.
//   4. Fokus, który zniknął po operacji, wraca na początek - nie znika z kanwy.
//   5. Mapa klawiszy na polecenia (Ctrl i Cmd to samo, Shift+F10 = menu).
import { describe, expect, it } from "vitest";

import {
  activateFocus,
  focusExists,
  focusItems,
  focusKey,
  initialFocus,
  journeyKeyCommand,
  moveFocus,
  type JourneyFocus,
} from "../nav";
import { buildJourneyView } from "../viewModel";
import type { JourneyGraph } from "@/lib/journeys/graph";
import type { JourneyEdgeBranch, JourneyNodeType } from "@/lib/journeys/nodeTypes";

const node = (id: string, type: JourneyNodeType, params: unknown = {}) => ({ id, type, params });
const edge = (from: string, to: string, branch: JourneyEdgeBranch = "next") => ({
  from,
  to,
  branch,
});
const WAIT = { mode: "duration", minutes: 60 };

/** t -> ab; A: ma -> join -> x; B: mb -> (scalenie do join). */
const GRAPH: JourneyGraph = {
  nodes: [
    node("t", "trigger"),
    node("ab", "ab_split", { weights: { A: 50, B: 50 }, winnerMetric: "click" }),
    node("ma", "send_email"),
    node("mb", "send_email"),
    node("join", "wait", WAIT),
    node("x", "exit"),
  ],
  edges: [
    edge("t", "ab"),
    edge("ab", "ma", "A"),
    edge("ab", "mb", "B"),
    edge("ma", "join"),
    edge("mb", "join"),
    edge("join", "x"),
  ],
};

const view = buildJourneyView(GRAPH);
const N = (id: string): JourneyFocus => ({ kind: "node", id });
const CHIP: JourneyFocus = { kind: "merge", from: "mb", branch: "next", to: "join" };

describe("elementy fokusu", () => {
  it("kolejność czytania: pre-order, chip w miejscu swojej gałęzi", () => {
    expect(focusItems(view).map(focusKey)).toEqual([
      "node:t",
      "node:ab",
      "node:ma",
      "node:join",
      "node:x",
      "node:mb",
      "merge:mb:next",
    ]);
    // Kroki w tej samej kolejności co `order` widoku (kanwa = lista).
    expect(
      focusItems(view)
        .filter((f) => f.kind === "node")
        .map((f) => (f as { id: string }).id),
    ).toEqual([...view.order]);
    expect(initialFocus(view)).toEqual(N("t"));
  });

  it("focusExists rozpoznaje kroki i chipy, także po ich zniknięciu", () => {
    expect(focusExists(view, N("ma"))).toBe(true);
    expect(focusExists(view, CHIP)).toBe(true);
    expect(focusExists(view, N("ghost"))).toBe(false);
    expect(focusExists(view, { ...CHIP, branch: "A" })).toBe(false);
    expect(focusExists(view, null)).toBe(false);
  });
});

describe("tryb kanwy", () => {
  it("↓ do pierwszego wyjścia, ↑ do rodzica; koniec przepływu zostaje na miejscu", () => {
    expect(moveFocus(view, N("t"), "down")).toEqual(N("ab"));
    expect(moveFocus(view, N("ab"), "down")).toEqual(N("ma"));
    expect(moveFocus(view, N("x"), "down")).toEqual(N("x"));
    expect(moveFocus(view, N("mb"), "down")).toEqual(CHIP);
    expect(moveFocus(view, N("ma"), "up")).toEqual(N("ab"));
    expect(moveFocus(view, N("t"), "up")).toEqual(N("t"));
    expect(moveFocus(view, CHIP, "up")).toEqual(N("mb"));
    expect(moveFocus(view, CHIP, "down")).toEqual(CHIP);
  });

  it("←/→ do sąsiedniej gałęzi - także z głębi gałęzi", () => {
    expect(moveFocus(view, N("ma"), "right")).toEqual(N("mb"));
    expect(moveFocus(view, N("join"), "right")).toEqual(N("mb"));
    expect(moveFocus(view, N("x"), "right")).toEqual(N("mb"));
    expect(moveFocus(view, N("mb"), "left")).toEqual(N("ma"));
    expect(moveFocus(view, CHIP, "left")).toEqual(N("ma"));
    expect(moveFocus(view, N("mb"), "right")).toEqual(N("mb"));
    expect(moveFocus(view, N("t"), "left")).toEqual(N("t"));
  });

  it("Home/End - pierwszy i ostatni element", () => {
    expect(moveFocus(view, N("join"), "home")).toEqual(N("t"));
    expect(moveFocus(view, N("join"), "end")).toEqual(CHIP);
  });

  it("brak bieżącego albo zniknięty fokus -> pierwszy element; pusty widok -> null", () => {
    expect(moveFocus(view, null, "down")).toEqual(N("t"));
    expect(moveFocus(view, N("removed"), "right")).toEqual(N("t"));
    expect(moveFocus(buildJourneyView({ nodes: [], edges: [] }), null, "down")).toBeNull();
  });
});

describe("tryb listy (drzewo WAI-ARIA)", () => {
  it("↑/↓ poprzedni i następny w kolejności czytania", () => {
    expect(moveFocus(view, N("ma"), "down", "outline")).toEqual(N("join"));
    expect(moveFocus(view, N("mb"), "up", "outline")).toEqual(N("x"));
    expect(moveFocus(view, CHIP, "down", "outline")).toEqual(CHIP);
    expect(moveFocus(view, N("t"), "up", "outline")).toEqual(N("t"));
  });

  it("→ pierwsze dziecko, ← rodzic", () => {
    expect(moveFocus(view, N("ab"), "right", "outline")).toEqual(N("ma"));
    expect(moveFocus(view, N("x"), "right", "outline")).toEqual(N("x"));
    expect(moveFocus(view, N("join"), "left", "outline")).toEqual(N("ma"));
    expect(moveFocus(view, CHIP, "left", "outline")).toEqual(N("mb"));
  });
});

describe("Enter: panel kroku albo przejście przez chip", () => {
  it("chip -> Enter -> krok docelowy; krok -> Enter -> panel", () => {
    expect(activateFocus(CHIP)).toEqual({ type: "focus", focus: N("join") });
    expect(activateFocus(N("ma"))).toEqual({ type: "openPanel", nodeId: "ma" });
    // Po przejściu fokus jest na kroku, którego numer pokazywał chip.
    expect(view.merges[0].targetNumber).toBe(view.numbering.get("join"));
  });
});

describe("mapa klawiszy", () => {
  it.each([
    [{ key: "ArrowUp" }, { type: "move", direction: "up" }],
    [{ key: "ArrowDown" }, { type: "move", direction: "down" }],
    [{ key: "ArrowLeft" }, { type: "move", direction: "left" }],
    [{ key: "ArrowRight" }, { type: "move", direction: "right" }],
    [{ key: "Home" }, { type: "move", direction: "home" }],
    [{ key: "End" }, { type: "move", direction: "end" }],
    [{ key: "Enter" }, { type: "activate" }],
    [{ key: "Insert" }, { type: "palette" }],
    [{ key: "+" }, { type: "palette" }],
    [{ key: "Delete" }, { type: "delete" }],
    [{ key: "Backspace" }, { type: "delete" }],
    [{ key: "z", ctrlKey: true }, { type: "undo" }],
    [{ key: "z", metaKey: true }, { type: "undo" }],
    [{ key: "Z", ctrlKey: true, shiftKey: true }, { type: "redo" }],
    [{ key: "z", metaKey: true, shiftKey: true }, { type: "redo" }],
    [{ key: "=", ctrlKey: true }, { type: "zoomIn" }],
    [{ key: "+", metaKey: true }, { type: "zoomIn" }],
    [{ key: "-", ctrlKey: true }, { type: "zoomOut" }],
    [{ key: "0", metaKey: true }, { type: "zoomReset" }],
    [{ key: "Escape" }, { type: "escape" }],
    [{ key: "F10", shiftKey: true }, { type: "menu" }],
    [{ key: "ContextMenu" }, { type: "menu" }],
  ])("%j -> %j", (input, command) => {
    expect(journeyKeyCommand(input)).toEqual(command);
  });

  it.each([
    [{ key: "Tab" }],
    [{ key: "a" }],
    [{ key: "F10" }],
    [{ key: "s", ctrlKey: true }],
    [{ key: "ArrowUp", altKey: true }],
    [{ key: "ArrowDown", shiftKey: true }],
  ])("%j nie należy do kanwy (null - zdarzenie idzie dalej)", (input) => {
    expect(journeyKeyCommand(input)).toBeNull();
  });
});
