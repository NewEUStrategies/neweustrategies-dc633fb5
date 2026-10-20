// UKŁAD KANWY ŚCIEŻKI (S8, SPEC §6.3) - pozycje kart, krawędzi, chipów scaleń
// i przycisków „+”, liczone z modelu widoku w O(n), bez pomiaru DOM.
//
// DLACZEGO WŁASNY ALGORYTM, A NIE BIBLIOTEKA GRAFU. Widok jest już DRZEWEM
// (`viewModel.ts`: każdy krok pod pierwszym rodzicem, reszta to chipy), a
// drzewo z kartami STAŁEGO rozmiaru układa się dwoma przejściami: post-order
// liczy szerokość poddrzewa, pre-order rozdaje x. Biblioteka układu grafów
// (dagre/elk) to dziesiątki kilobajtów w chunku edytora za coś, co tu jest
// sumą i średnią - i wynik zależny od heurystyk, którego nie da się przypiąć
// testem geometrii jak `seatingGeometry.ts`.
//
// REGUŁY (SPEC §6.3):
//   * karta: `NODE_W × NODE_H` (280 × 88), identyczna w obu motywach;
//   * post-order: liść = `NODE_W`; krok = max(`NODE_W`, Σ szerokości wyjść
//     + `GAP_X`·(k−1)); wyjściem jest dziecko (szerokość jego poddrzewa),
//     chip scalenia albo brakująca gałąź (`CHIP_W`);
//   * pre-order: wyjścia ustawione od lewej w kolejności gałęzi, cały pas
//     wyjść wyśrodkowany pod krokiem, karta wyśrodkowana w swoim poddrzewie;
//   * y = głębokość·(`NODE_H`+`GAP_Y`) + piętro·`BRANCH_LABEL_H`, gdzie piętro
//     to liczba gałęzi innych niż `next` na drodze od wyzwalacza. SPEC podaje
//     „+ BRANCH_LABEL_H dla gałęzi”; dla jednego poziomu rozgałęzień to ta sama
//     liczba, a liczenie pięter sprawia, że etykieta zagnieżdżonej gałęzi też
//     ma swoje 20 px i nigdy nie wchodzi na kartę;
//   * krawędzie ortogonalne `M x1 y1 V ym H x2 V y2` (od dołu rodzica do góry
//     dziecka); dla gałęzi `next` odcinek poziomy znika (x1 = x2);
//   * drzewa poza przepływem (`detachedRoots`) stoją na prawo od przepływu.
//
// Brak nakładania wynika z konstrukcji: rodzeństwo dostaje rozłączne pasy x
// (szerokość poddrzewa + `GAP_X`), a dziecko leży co najmniej `GAP_Y` pod
// rodzicem. Test geometrii (`layout.test.ts`) sprawdza to na każdej parze.
import type { JourneyEdgeBranch } from "@/lib/journeys/nodeTypes";
import type { JourneyView, JourneyViewNode } from "./viewModel";

export const NODE_W = 280;
export const NODE_H = 88;
export const GAP_Y = 48;
export const GAP_X = 40;
export const BRANCH_LABEL_H = 20;
/** Przycisk „+” na krawędzi (cel dotyku > 24 px, SPEC §6.8). */
export const INSERT_SIZE = 28;
/** Chip scalenia „→ dalej jak w kroku …” i miejsce brakującej gałęzi. */
export const CHIP_W = 160;
export const CHIP_H = 32;
/** Odstęp drzew poza przepływem od przepływu głównego. */
export const DETACHED_GAP = GAP_X * 2;
/** Pas pionowy rzędu: karta + odstęp. */
export const ROW_H = NODE_H + GAP_Y;
/**
 * Odcinek poziomy krawędzi gałęzi leży wyżej niż środek odstępu: pod nim
 * mieszczą się etykieta gałęzi (20 px) i przycisk „+” (28 px).
 */
const BRANCH_RUN = GAP_Y / 4;

export interface JourneyLayoutNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  number: string;
}

export interface JourneyLayoutEdge {
  from: string;
  /** Cel krawędzi; `null` = brakująca gałąź (krawędź do miejsca „+”). */
  to: string | null;
  branch: JourneyEdgeBranch;
  kind: "tree" | "merge" | "open";
  path: string;
  /** Środek-góra etykiety gałęzi; `null` dla `next` (bez etykiety). */
  label: { x: number; y: number } | null;
}

export interface JourneyLayoutChip {
  from: string;
  to: string;
  branch: JourneyEdgeBranch;
  targetNumber: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface JourneyLayoutInsert {
  /** Krok, za którym wstawiamy, i gałąź - adres operacji `insertAfter`. */
  from: string;
  branch: JourneyEdgeBranch;
  /** Obecny cel gałęzi (`null` = gałąź brakująca). */
  to: string | null;
  x: number;
  y: number;
  size: number;
}

export interface JourneyLayout {
  nodes: JourneyLayoutNode[];
  edges: JourneyLayoutEdge[];
  chips: JourneyLayoutChip[];
  inserts: JourneyLayoutInsert[];
  width: number;
  height: number;
}

function rowTop(depth: number, branchLevel: number): number {
  return depth * ROW_H + branchLevel * BRANCH_LABEL_H;
}

function edgePath(x1: number, y1: number, ym: number, x2: number, y2: number): string {
  return `M ${x1} ${y1} V ${ym} H ${x2} V ${y2}`;
}

export function layoutJourney(view: JourneyView): JourneyLayout {
  const get = (id: string) => view.nodes.get(id) as JourneyViewNode;
  const width = new Map<string, number>();

  // ── Post-order (odwrotny pre-order): dzieci zawsze przed rodzicem. ──
  for (let i = view.order.length - 1; i >= 0; i -= 1) {
    const node = get(view.order[i]);
    let span = 0;
    for (const slot of node.slots) {
      span += slot.kind === "child" ? (width.get(slot.id) ?? NODE_W) : CHIP_W;
    }
    span += GAP_X * Math.max(0, node.slots.length - 1);
    width.set(node.id, Math.max(NODE_W, span));
  }

  const left = new Map<string, number>();
  const nodes: JourneyLayoutNode[] = [];
  const edges: JourneyLayoutEdge[] = [];
  const chips: JourneyLayoutChip[] = [];
  const inserts: JourneyLayoutInsert[] = [];
  let height = 0;

  // Korzenie drzew: przepływ, potem drzewa poza przepływem w prawo.
  let cursor = 0;
  const roots = [...(view.root ? [view.root.id] : []), ...view.detachedRoots];
  for (const id of roots) {
    left.set(id, cursor);
    cursor += (width.get(id) ?? NODE_W) + DETACHED_GAP;
  }
  const totalWidth = roots.length === 0 ? 0 : cursor - DETACHED_GAP;

  // ── Pre-order: rodzic przed dziećmi. ──
  for (const id of view.order) {
    const node = get(id);
    const nodeLeft = left.get(id) ?? 0;
    const nodeWidth = width.get(id) ?? NODE_W;
    const x = nodeLeft + (nodeWidth - NODE_W) / 2;
    const y = rowTop(node.depth, node.branchLevel);
    nodes.push({ id, x, y, width: NODE_W, height: NODE_H, depth: node.depth, number: node.number });
    height = Math.max(height, y + NODE_H);

    let span = GAP_X * Math.max(0, node.slots.length - 1);
    for (const slot of node.slots) {
      span += slot.kind === "child" ? (width.get(slot.id) ?? NODE_W) : CHIP_W;
    }
    let slotLeft = nodeLeft + (nodeWidth - span) / 2;
    const x1 = x + NODE_W / 2;
    const y1 = y + NODE_H;

    for (const slot of node.slots) {
      const slotWidth = slot.kind === "child" ? (width.get(slot.id) ?? NODE_W) : CHIP_W;
      const x2 = slotLeft + slotWidth / 2;
      const level = node.branchLevel + (slot.branch === "next" ? 0 : 1);
      const y2 = rowTop(node.depth + 1, level);
      const ym = slot.branch === "next" ? y1 + GAP_Y / 2 : y1 + BRANCH_RUN;
      const label = slot.branch === "next" ? null : { x: x2, y: ym + 4 };
      const to = slot.kind === "child" ? slot.id : slot.kind === "merge" ? slot.to : null;
      edges.push({
        from: id,
        to,
        branch: slot.branch,
        kind: slot.kind === "child" ? "tree" : slot.kind,
        path: edgePath(x1, y1, ym, x2, y2),
        label,
      });

      if (slot.kind === "child") {
        left.set(slot.id, slotLeft);
      } else if (slot.kind === "merge") {
        chips.push({
          from: id,
          to: slot.to,
          branch: slot.branch,
          targetNumber: get(slot.to).number,
          x: slotLeft,
          y: y2,
          width: CHIP_W,
          height: CHIP_H,
        });
        height = Math.max(height, y2 + CHIP_H);
      }

      // „+” na krawędzi: dla `next` w środku odstępu, dla gałęzi tuż nad celem
      // (nad nim jest etykieta), dla brakującej gałęzi - w jej miejscu.
      const insertCenterY =
        slot.kind === "open"
          ? y2 + INSERT_SIZE / 2
          : slot.branch === "next"
            ? y1 + GAP_Y / 2
            : y2 - INSERT_SIZE / 2 - 2;
      inserts.push({
        from: id,
        branch: slot.branch,
        to,
        x: x2 - INSERT_SIZE / 2,
        y: insertCenterY - INSERT_SIZE / 2,
        size: INSERT_SIZE,
      });
      if (slot.kind === "open") height = Math.max(height, y2 + INSERT_SIZE);

      slotLeft += slotWidth + GAP_X;
    }
  }

  return { nodes, edges, chips, inserts, width: totalWidth, height };
}

/**
 * Skala miniatury (galeria szablonów): największa, przy której układ mieści
 * się w ramce, nigdy powiększenie. Miniatura rysuje SVG z `viewBox` układu,
 * więc skala służy do grubości linii i decyzji, czy pokazywać etykiety.
 */
export function fitScale(layout: Pick<JourneyLayout, "width" | "height">, maxW: number, maxH: number) {
  if (layout.width <= 0 || layout.height <= 0) return 1;
  return Math.min(1, maxW / layout.width, maxH / layout.height);
}

/** Rozmiar miniatury galerii (px) - wspólny dla karty i testu. */
export const JOURNEY_THUMBNAIL = { width: 240, height: 120 } as const;
