// MODEL WIDOKU ŚCIEŻKI (S8, SPEC §6.3) - graf (DAG) jako drzewo z chipami scaleń.
//
// PO CO DRZEWO. Silnik wykonuje graf skierowany bez cykli: krok może mieć kilku
// rodziców (dwie gałęzie zbiegają się w jednym mailu). Kanwa, lista kroków
// (`role="tree"`), panel kroku i lista problemów potrzebują jednak JEDNEGO
// miejsca każdego kroku - inaczej ten sam mail rysowałby się dwa razy, a
// numer kroku byłby niejednoznaczny. Każdy węzeł stoi więc pod PIERWSZYM
// rodzicem w kolejności krawędzi (`edges[]`), a każda kolejna krawędź
// wchodząca staje się chipem scalenia „→ dalej jak w kroku 4.2.1” w miejscu,
// z którego wychodzi. Operacje edytora dopisują krawędzie na końcu tablicy, więc
// dołączenie gałęzi do istniejącego kroku nie przenosi go pod nowego rodzica.
//
// KOLEJNOŚĆ DZIECI to kolejność gałęzi węzła: najpierw wymagane gałęzie typu
// (`requiredBranches`: tak/nie, A/B, zdarzenie/termin), potem ewentualne
// nadmiarowe w porządku `next, yes, no, A, B, event, timeout`. Ta sama
// kolejność obowiązuje kanwę (od lewej do prawej) i listę (od góry do dołu) -
// `order` (pre-order) to JEDNA kolejność dla obu widoków.
//
// NUMERACJA HIERARCHICZNA (reguła; przypina ją `viewModel.test.ts`):
//   * wyzwalacz ma numer „1”; ciąg główny numeruje się dalej: 1, 2, 3…;
//   * krok z DOKŁADNIE jednym wyjściem przez gałąź `next` przedłuża swój
//     odcinek - następnik dostaje numer z ostatnią składową +1
//     („3” -> „4”, „4.2.1” -> „4.2.2”);
//   * każde inne wyjście (rozgałęzienie, gałąź inna niż `next`) otwiera nowy
//     odcinek „k.i.1”, gdzie k to numer kroku rozgałęziającego, a i - numer
//     gałęzi WEDŁUG TYPU kroku (tak = 1, nie = 2; A = 1, B = 2; zdarzenie = 1,
//     termin = 2), a nie według tego, ile gałęzi akurat istnieje. Dzięki temu
//     dopisanie brakującej gałęzi „tak” nie przenumerowuje gałęzi „nie”, a
//     operacja w jednej gałęzi nie rusza numerów w drugiej;
//   * kolejność niezwiązanych krawędzi w tablicy nie zmienia żadnego numeru
//     (rodzic = pierwsza krawędź WCHODZĄCA do danego kroku, nie kolejność
//     odkrycia).
//
// GRAF NIEPOPRAWNY NIE RZUCA. Szkic w trakcie pracy bywa niekompletny, a stary
// szkic - uszkodzony: brak wyzwalacza, cykl, sieroty, krawędź do nieistniejącego
// kroku, pusty szkic. Model zawsze zwraca widok: kroki nieosiągalne z
// wyzwalacza trafiają do `unreachable` i do osobnych drzew (`detachedRoots`)
// bez numeru (pusty napis - UI mówi „poza przepływem”), krawędzie wiszące
// znikają, a cykl kończy się chipem scalenia zamiast pętli. Błędy opisuje
// `validateJourneyGraph` - widok ma je pokazać, nie ukryć wyjątkiem.
//
// O(n + e) dla grafu bez cykli (cykl dokłada przejście po krawędziach na każdy
// odcięty krok) i bez rekurencji - graf z uszkodzonego szkicu może być długi.
// Moduł czyta kanwa w przeglądarce - wyłącznie importy liściowe.
import {
  JOURNEY_EDGE_BRANCHES,
  JOURNEY_NODE_TYPES,
  requiredBranches,
  type JourneyEdgeBranch,
  type JourneyNodeType,
} from "@/lib/journeys/nodeTypes";

/** Minimalny kształt grafu (szkic z bazy po łagodnym parsowaniu albo `JourneyGraph`). */
export interface JourneyGraphLike {
  readonly nodes: readonly { readonly id: string; readonly type: JourneyNodeType; readonly params?: unknown }[];
  readonly edges: readonly {
    readonly from: string;
    readonly to: string;
    readonly branch: JourneyEdgeBranch;
  }[];
}

/** Wyjście kroku w kolejności gałęzi: dziecko w drzewie, chip scalenia albo brak. */
export type JourneyViewSlot =
  | { kind: "child"; branch: JourneyEdgeBranch; id: string }
  | { kind: "merge"; branch: JourneyEdgeBranch; to: string }
  | { kind: "open"; branch: JourneyEdgeBranch };

export interface JourneyViewNode {
  id: string;
  type: JourneyNodeType;
  params: unknown;
  /** Rodzic w drzewie (pierwsza krawędź wchodząca) - `null` dla korzeni. */
  parentId: string | null;
  /** Gałąź krawędzi od rodzica - `null` dla korzeni. */
  branch: JourneyEdgeBranch | null;
  /** Dzieci w drzewie, w kolejności gałęzi. */
  children: string[];
  /** Wszystkie wyjścia (dzieci, scalenia, brakujące gałęzie) w kolejności gałęzi. */
  slots: JourneyViewSlot[];
  /** Głębokość w drzewie (korzeń = 0). */
  depth: number;
  /** Liczba gałęzi innych niż `next` na drodze od korzenia (piętra etykiet gałęzi). */
  branchLevel: number;
  /** Numer hierarchiczny („4.2.1”); pusty napis = krok poza przepływem. */
  number: string;
  /** Krok osiągalny z wyzwalacza. */
  reachable: boolean;
}

export interface JourneyMergeChip {
  from: string;
  to: string;
  branch: JourneyEdgeBranch;
  /** Numer kroku docelowego („→ dalej jak w kroku …”); pusty poza przepływem. */
  targetNumber: string;
}

export interface JourneyView {
  /** Wyzwalacz (korzeń przepływu) albo `null` (brak wyzwalacza, pusty szkic). */
  root: JourneyViewNode | null;
  nodes: ReadonlyMap<string, JourneyViewNode>;
  merges: readonly JourneyMergeChip[];
  numbering: ReadonlyMap<string, string>;
  /** Pre-order: przepływ od wyzwalacza, potem drzewa poza przepływem. */
  order: readonly string[];
  /** Kroki nieosiągalne z wyzwalacza (kolejność `nodes[]`). */
  unreachable: readonly string[];
  /** Korzenie drzew poza przepływem (kolejność `nodes[]`). */
  detachedRoots: readonly string[];
}

/** Porządek gałęzi poza wymaganymi przez typ (`JOURNEY_EDGE_BRANCHES`). */
const BRANCH_RANK: Readonly<Record<JourneyEdgeBranch, number>> = Object.fromEntries(
  JOURNEY_EDGE_BRANCHES.map((branch, index) => [branch, index]),
) as Record<JourneyEdgeBranch, number>;

const KNOWN_TYPES: ReadonlySet<string> = new Set(JOURNEY_NODE_TYPES);

/**
 * Numer gałęzi kroku (od 1): pozycja wśród gałęzi wymaganych przez typ, a dla
 * gałęzi nadmiarowej (graf niepoprawny) - za wymaganymi, w porządku globalnym.
 */
export function branchIndex(
  type: JourneyNodeType,
  params: unknown,
  branch: JourneyEdgeBranch,
): number {
  const required = requiredBranches(type, params);
  const position = required.indexOf(branch);
  if (position >= 0) return position + 1;
  return required.length + 1 + BRANCH_RANK[branch];
}

/** Porównanie numerów hierarchicznych składowa po składowej; pusty na końcu. */
export function compareStepNumbers(a: string, b: string): number {
  if (a === b) return 0;
  if (a === "") return 1;
  if (b === "") return -1;
  const left = a.split(".");
  const right = b.split(".");
  const length = Math.min(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const diff = Number(left[i]) - Number(right[i]);
    if (diff !== 0) return diff;
  }
  return left.length - right.length;
}

function nextInSegment(number: string): string {
  const parts = number.split(".");
  parts[parts.length - 1] = String(Number(parts[parts.length - 1]) + 1);
  return parts.join(".");
}

interface IndexedEdge {
  index: number;
  from: string;
  to: string;
  branch: JourneyEdgeBranch;
}

export function buildJourneyView(graph: JourneyGraphLike | null | undefined): JourneyView {
  // ── Węzły: pierwszy wpis o danym id wygrywa, nieznane typy odpadają. ──
  const nodeOrder: string[] = [];
  const byId = new Map<string, { id: string; type: JourneyNodeType; params: unknown }>();
  for (const node of graph?.nodes ?? []) {
    if (typeof node?.id !== "string" || byId.has(node.id) || !KNOWN_TYPES.has(node.type)) continue;
    byId.set(node.id, { id: node.id, type: node.type, params: node.params ?? {} });
    nodeOrder.push(node.id);
  }

  // ── Krawędzie: wiszące odpadają; indeks = pozycja w `edges[]`. ──
  const edges: IndexedEdge[] = [];
  const outgoing = new Map<string, IndexedEdge[]>();
  const incoming = new Map<string, IndexedEdge[]>();
  (graph?.edges ?? []).forEach((edge, index) => {
    if (!edge || !byId.has(edge.from) || !byId.has(edge.to)) return;
    if (!(edge.branch in BRANCH_RANK)) return;
    const entry: IndexedEdge = { index, from: edge.from, to: edge.to, branch: edge.branch };
    edges.push(entry);
    const out = outgoing.get(entry.from);
    if (out) out.push(entry);
    else outgoing.set(entry.from, [entry]);
    const into = incoming.get(entry.to);
    if (into) into.push(entry);
    else incoming.set(entry.to, [entry]);
  });

  const rootId = nodeOrder.find((id) => byId.get(id)?.type === "trigger") ?? null;

  // ── Osiągalność z wyzwalacza. ──
  const reachable = new Set<string>();
  if (rootId !== null) {
    const stack = [rootId];
    while (stack.length > 0) {
      const id = stack.pop() as string;
      if (reachable.has(id)) continue;
      reachable.add(id);
      for (const edge of outgoing.get(id) ?? []) if (!reachable.has(edge.to)) stack.push(edge.to);
    }
  }

  // ── Drzewo: krawędź-rodzic każdego kroku. ──
  const parentEdge = new Map<string, IndexedEdge>();
  const attached = new Set<string>();

  /**
   * Dołącza poddrzewo od `start`. `preferred(t)` mówi, czy krawędź jest tą
   * właściwą dla `t` (dla przepływu: pierwsza wchodząca z kroku osiągalnego;
   * dla drzew poza przepływem: pierwsza napotkana).
   */
  const attachFrom = (start: string, eligible: (edge: IndexedEdge) => boolean) => {
    const stack = [start];
    while (stack.length > 0) {
      const id = stack.pop() as string;
      const out = outgoing.get(id) ?? [];
      // Odwrotnie na stos, żeby pierwsza krawędź była przetwarzana pierwsza.
      for (let i = out.length - 1; i >= 0; i -= 1) {
        const edge = out[i];
        if (attached.has(edge.to) || edge.to === edge.from || !eligible(edge)) continue;
        attached.add(edge.to);
        parentEdge.set(edge.to, edge);
        stack.push(edge.to);
      }
    }
  };

  if (rootId !== null) {
    attached.add(rootId);
    const preferred = new Map<string, number>();
    for (const edge of edges) {
      if (edge.to === rootId || edge.to === edge.from || !reachable.has(edge.from)) continue;
      if (!preferred.has(edge.to)) preferred.set(edge.to, edge.index);
    }
    attachFrom(rootId, (edge) => preferred.get(edge.to) === edge.index);
    // Cykl może odciąć krok od jego „pierwszego” rodzica - wtedy dołączamy go
    // pod pierwszą krawędź z kroku już w drzewie, a resztę cyklu pokazują chipy.
    for (;;) {
      const bridge = edges.find(
        (edge) =>
          attached.has(edge.from) &&
          reachable.has(edge.to) &&
          !attached.has(edge.to) &&
          edge.to !== edge.from,
      );
      if (!bridge) break;
      attached.add(bridge.to);
      parentEdge.set(bridge.to, bridge);
      attachFrom(bridge.to, (edge) => reachable.has(edge.to));
    }
  }

  // ── Drzewa poza przepływem. ──
  const unreachable = nodeOrder.filter((id) => !reachable.has(id));
  const unreachableSet = new Set(unreachable);
  const hasDetachedParent = (id: string) =>
    (incoming.get(id) ?? []).some((edge) => edge.from !== id && unreachableSet.has(edge.from));
  const detachedRoots: string[] = [];
  const startDetached = (id: string) => {
    if (attached.has(id)) return;
    attached.add(id);
    detachedRoots.push(id);
    attachFrom(id, (edge) => unreachableSet.has(edge.to));
  };
  for (const id of unreachable) if (!hasDetachedParent(id)) startDetached(id);
  for (const id of unreachable) startDetached(id);

  // ── Węzły widoku: wyjścia w kolejności gałęzi. ──
  const viewNodes = new Map<string, JourneyViewNode>();
  for (const id of nodeOrder) {
    const node = byId.get(id) as { id: string; type: JourneyNodeType; params: unknown };
    const parent = parentEdge.get(id) ?? null;
    viewNodes.set(id, {
      id,
      type: node.type,
      params: node.params,
      parentId: parent?.from ?? null,
      branch: parent?.branch ?? null,
      children: [],
      slots: [],
      depth: 0,
      branchLevel: 0,
      number: "",
      reachable: reachable.has(id),
    });
  }

  for (const id of nodeOrder) {
    const view = viewNodes.get(id) as JourneyViewNode;
    const rank = (branch: JourneyEdgeBranch) => branchIndex(view.type, view.params, branch);
    const out = [...(outgoing.get(id) ?? [])].sort(
      (a, b) => rank(a.branch) - rank(b.branch) || a.index - b.index,
    );
    const present = new Set<JourneyEdgeBranch>();
    const ranked: { slot: JourneyViewSlot; order: number; tie: number }[] = [];
    for (const edge of out) {
      present.add(edge.branch);
      const slot: JourneyViewSlot =
        parentEdge.get(edge.to) === edge
          ? { kind: "child", branch: edge.branch, id: edge.to }
          : { kind: "merge", branch: edge.branch, to: edge.to };
      ranked.push({ slot, order: rank(edge.branch), tie: edge.index });
    }
    for (const branch of requiredBranches(view.type, view.params)) {
      if (present.has(branch)) continue;
      // Brakująca gałąź na końcu swojej pozycji: przycisk „+” kanwy i lista
      // pokazują ją tam, gdzie gałąź powinna stać.
      ranked.push({ slot: { kind: "open", branch }, order: rank(branch), tie: Infinity });
    }
    ranked.sort((a, b) => a.order - b.order || a.tie - b.tie);
    view.slots = ranked.map((entry) => entry.slot);
    view.children = view.slots.flatMap((slot) => (slot.kind === "child" ? [slot.id] : []));
  }

  // ── Pre-order, głębokość i numery. ──
  const order: string[] = [];
  const walk = (rootIdForTree: string, numbered: boolean) => {
    const root = viewNodes.get(rootIdForTree) as JourneyViewNode;
    root.depth = 0;
    root.branchLevel = 0;
    root.number = numbered ? "1" : "";
    const stack = [rootIdForTree];
    while (stack.length > 0) {
      const id = stack.pop() as string;
      order.push(id);
      const view = viewNodes.get(id) as JourneyViewNode;
      const continues = view.slots.length === 1 && view.slots[0].kind === "child" && view.slots[0].branch === "next";
      const used = new Set<number>();
      for (const slot of view.slots) {
        if (slot.kind !== "child") continue;
        const child = viewNodes.get(slot.id) as JourneyViewNode;
        child.depth = view.depth + 1;
        child.branchLevel = view.branchLevel + (slot.branch === "next" ? 0 : 1);
        if (!numbered) continue;
        if (continues) {
          child.number = nextInSegment(view.number);
          continue;
        }
        let index = branchIndex(view.type, view.params, slot.branch);
        // Zdublowana gałąź (graf niepoprawny) - numer odcinka musi być unikalny.
        while (used.has(index)) index += 1;
        used.add(index);
        child.number = `${view.number}.${index}.1`;
      }
      for (let i = view.children.length - 1; i >= 0; i -= 1) stack.push(view.children[i]);
    }
  };
  if (rootId !== null) walk(rootId, true);
  for (const id of detachedRoots) walk(id, false);

  const numbering = new Map<string, string>();
  for (const id of order) {
    const number = (viewNodes.get(id) as JourneyViewNode).number;
    if (number !== "") numbering.set(id, number);
  }

  const merges: JourneyMergeChip[] = [];
  for (const id of order) {
    for (const slot of (viewNodes.get(id) as JourneyViewNode).slots) {
      if (slot.kind !== "merge") continue;
      merges.push({
        from: id,
        to: slot.to,
        branch: slot.branch,
        targetNumber: viewNodes.get(slot.to)?.number ?? "",
      });
    }
  }

  return {
    root: rootId === null ? null : (viewNodes.get(rootId) ?? null),
    nodes: viewNodes,
    merges,
    numbering,
    order,
    unreachable,
    detachedRoots,
  };
}
