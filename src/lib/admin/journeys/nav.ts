// NAWIGACJA KLAWIATURĄ PO ŚCIEŻCE (S8, SPEC §6.3 A11y) - czyste funkcje fokusu
// nad modelem widoku i mapa klawiszy na polecenia.
//
// JEDEN TAB STOP. Kanwa i lista kroków to jedno zatrzymanie Tab (roving
// tabindex jak `SeatMapCanvas.tsx`): po wejściu strzałki przesuwają fokus po
// krokach, a Tab wychodzi z kanwy. Logika „dokąd teraz” mieszka tutaj, a nie
// w komponentach, żeby kanwa, lista i testy nawigacji (`nav.test.ts`) miały
// JEDNĄ definicję - dwa komponenty z własnymi regułami rozjechałyby się przy
// pierwszej poprawce.
//
// DWA TRYBY:
//   * `canvas` - przestrzennie: ↓ do pierwszego wyjścia kroku (przepływ w dół),
//     ↑ do rodzica, ←/→ do SĄSIEDNIEJ GAŁĘZI (z dowolnej głębokości gałęzi:
//     najbliższy przodek z rodzeństwem po tej stronie), Home/End - początek
//     i ostatni krok przepływu;
//   * `outline` - wzorzec WAI-ARIA drzewa (`role="tree"`): ↑/↓ poprzedni
//     i następny element w kolejności czytania, → pierwsze dziecko, ← rodzic.
// W obu trybach chip scalenia jest osobnym elementem fokusu: Enter na chipie
// przenosi fokus do kroku docelowego („→ dalej jak w kroku 4.2.1” działa jak
// odnośnik), a Enter na kroku otwiera panel kroku.
//
// Moduł bez zależności runtime (liść).
import type { JourneyEdgeBranch } from "@/lib/journeys/nodeTypes";
import type { JourneyView, JourneyViewNode } from "./viewModel";

export type JourneyFocus =
  | { kind: "node"; id: string }
  | { kind: "merge"; from: string; branch: JourneyEdgeBranch; to: string };

export type JourneyNavDirection = "up" | "down" | "left" | "right" | "home" | "end";
export type JourneyNavMode = "canvas" | "outline";

/** Stabilny klucz elementu fokusu (atrybut `data-focus-key`, roving tabindex). */
export function focusKey(focus: JourneyFocus): string {
  return focus.kind === "node" ? `node:${focus.id}` : `merge:${focus.from}:${focus.branch}`;
}

/** Wyjścia kroku, na które da się przenieść fokus (dzieci i chipy, bez braków). */
function focusableSlots(node: JourneyViewNode): JourneyFocus[] {
  const out: JourneyFocus[] = [];
  for (const slot of node.slots) {
    if (slot.kind === "child") out.push({ kind: "node", id: slot.id });
    else if (slot.kind === "merge") {
      out.push({ kind: "merge", from: node.id, branch: slot.branch, to: slot.to });
    }
  }
  return out;
}

/**
 * Wszystkie elementy fokusu w kolejności czytania (pre-order, chip w miejscu
 * swojej gałęzi). To ta sama kolejność, w jakiej lista kroków je rysuje.
 */
export function focusItems(view: JourneyView): JourneyFocus[] {
  const items: JourneyFocus[] = [];
  const roots = [...(view.root ? [view.root.id] : []), ...view.detachedRoots];
  const stack: JourneyFocus[] = roots.map((id) => ({ kind: "node" as const, id })).reverse();
  while (stack.length > 0) {
    const item = stack.pop() as JourneyFocus;
    items.push(item);
    if (item.kind !== "node") continue;
    const node = view.nodes.get(item.id);
    if (!node) continue;
    const slots = focusableSlots(node);
    for (let i = slots.length - 1; i >= 0; i -= 1) stack.push(slots[i]);
  }
  return items;
}

function parentOf(view: JourneyView, focus: JourneyFocus): JourneyFocus | null {
  if (focus.kind === "merge") return { kind: "node", id: focus.from };
  const parentId = view.nodes.get(focus.id)?.parentId ?? null;
  return parentId === null ? null : { kind: "node", id: parentId };
}

function siblingsOf(view: JourneyView, focus: JourneyFocus): JourneyFocus[] {
  const parent = parentOf(view, focus);
  if (parent === null || parent.kind !== "node") return [];
  const node = view.nodes.get(parent.id);
  return node ? focusableSlots(node) : [];
}

function sameFocus(a: JourneyFocus, b: JourneyFocus): boolean {
  return focusKey(a) === focusKey(b);
}

/** Czy element nadal istnieje w widoku (po operacji fokus mógł zniknąć). */
export function focusExists(view: JourneyView, focus: JourneyFocus | null): boolean {
  if (focus === null) return false;
  if (focus.kind === "node") return view.nodes.has(focus.id);
  const from = view.nodes.get(focus.from);
  return from ? focusableSlots(from).some((item) => sameFocus(item, focus)) : false;
}

/** Pierwszy element (wyzwalacz) - fokus startowy kanwy i listy. */
export function initialFocus(view: JourneyView): JourneyFocus | null {
  return focusItems(view)[0] ?? null;
}

/**
 * Następny fokus po klawiszu kierunku. Brak ruchu (koniec przepływu, brak
 * sąsiedniej gałęzi) zwraca BIEŻĄCY element - fokus nie znika z kanwy.
 */
export function moveFocus(
  view: JourneyView,
  current: JourneyFocus | null,
  direction: JourneyNavDirection,
  mode: JourneyNavMode = "canvas",
): JourneyFocus | null {
  const items = focusItems(view);
  if (items.length === 0) return null;
  if (current === null || !focusExists(view, current)) return items[0];
  const index = items.findIndex((item) => sameFocus(item, current));

  if (direction === "home") return items[0];
  if (direction === "end") return items[items.length - 1];

  if (mode === "outline") {
    if (direction === "down") return items[Math.min(items.length - 1, index + 1)];
    if (direction === "up") return items[Math.max(0, index - 1)];
    if (direction === "left") return parentOf(view, current) ?? current;
    // right: pierwsze dziecko (drzewo bez zwijania - każdy krok jest rozwinięty).
    if (current.kind !== "node") return current;
    const node = view.nodes.get(current.id);
    return (node && focusableSlots(node)[0]) ?? current;
  }

  if (direction === "down") {
    if (current.kind !== "node") return current;
    const node = view.nodes.get(current.id);
    return (node && focusableSlots(node)[0]) ?? current;
  }
  if (direction === "up") return parentOf(view, current) ?? current;

  // left/right: najbliższy przodek (albo sam element) z rodzeństwem po tej stronie.
  const step = direction === "right" ? 1 : -1;
  let probe: JourneyFocus | null = current;
  while (probe !== null) {
    const siblings = siblingsOf(view, probe);
    const position = siblings.findIndex((item) => sameFocus(item, probe as JourneyFocus));
    const target = siblings[position + step];
    if (position >= 0 && target) return target;
    probe = parentOf(view, probe);
  }
  return current;
}

/** Skutek Enter: panel kroku albo skok do celu chipu scalenia. */
export type JourneyActivation =
  { type: "openPanel"; nodeId: string } | { type: "focus"; focus: JourneyFocus };

export function activateFocus(focus: JourneyFocus): JourneyActivation {
  return focus.kind === "node"
    ? { type: "openPanel", nodeId: focus.id }
    : { type: "focus", focus: { kind: "node", id: focus.to } };
}

/** Polecenie klawiatury kanwy i listy (SPEC §6.3 „klawisze”). */
export type JourneyKeyCommand =
  | { type: "move"; direction: JourneyNavDirection }
  | { type: "activate" }
  | { type: "palette" }
  | { type: "delete" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "zoomIn" }
  | { type: "zoomOut" }
  | { type: "zoomReset" }
  | { type: "escape" }
  | { type: "menu" };

export interface JourneyKeyInput {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

const MOVE_KEYS: Readonly<Record<string, JourneyNavDirection>> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  Home: "home",
  End: "end",
};

/**
 * Klawisz -> polecenie albo `null` (klawisz nie należy do kanwy - zdarzenie
 * idzie dalej, np. Tab wychodzi z kanwy). Ctrl na Windows/Linux i Cmd na
 * macOS znaczą to samo. Backspace działa jak Delete, bo klawiatura Maca nie
 * ma osobnego klawisza usuwania w przód.
 */
export function journeyKeyCommand(input: JourneyKeyInput): JourneyKeyCommand | null {
  const mod = Boolean(input.ctrlKey || input.metaKey);
  if (input.altKey) return null;
  if (mod) {
    const key = input.key.toLowerCase();
    if (key === "z") return input.shiftKey ? { type: "redo" } : { type: "undo" };
    if (key === "=" || key === "+") return { type: "zoomIn" };
    if (key === "-" || key === "_") return { type: "zoomOut" };
    if (key === "0") return { type: "zoomReset" };
    return null;
  }
  if (input.key in MOVE_KEYS && !input.shiftKey) {
    return { type: "move", direction: MOVE_KEYS[input.key] };
  }
  if (input.key === "F10" && input.shiftKey) return { type: "menu" };
  switch (input.key) {
    case "Enter":
      return { type: "activate" };
    case "Insert":
    case "+":
      return { type: "palette" };
    case "Delete":
    case "Backspace":
      return { type: "delete" };
    case "Escape":
      return { type: "escape" };
    case "ContextMenu":
      return { type: "menu" };
    default:
      return null;
  }
}
