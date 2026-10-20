// OPERACJE NA GRAFIE ŚCIEŻKI (S8, SPEC §6.3) - czyste funkcje: graf na wejściu,
// NOWY graf i identyfikatory nowych kroków na wyjściu. Kanwa, lista kroków
// i klawiatura wołają te same funkcje, a menu każdego z tych widoków buduje
// `availableOps` - JEDNO źródło (ryzyko SPEC R-36: lista i kanwa z osobnymi
// menu rozjechałyby się w tym, co wolno zrobić z krokiem).
//
// NIEZMIENNIK: operacja nie dokłada błędu walidacji. Każdy wynik przechodzi
// przez `validateJourneyGraph`; jeśli po operacji jakiegoś kodu błędu jest
// WIĘCEJ niż przed nią, operacja jest odrzucana (`would_break`) z listą kodów.
// Z poprawnego grafu powstaje więc zawsze graf poprawny (świadomie
// niekompletny bywa tylko szkic, który już był niekompletny), a edytor nie
// musi pilnować reguł grafu w każdym przycisku. Przykład: usunięcie maila,
// do którego odwołuje się warunek „otworzył”, jest odrzucane, zanim warunek
// zawiśnie na nieistniejącym kroku.
//
// KOLEJNOŚĆ KRAWĘDZI MA ZNACZENIE (`viewModel.ts`: rodzic = pierwsza krawędź
// wchodząca). Wstawienie kroku zastępuje krawędź W MIEJSCU i dokłada nową tuż
// za nią, a scalenie dopisuje krawędź NA KOŃCU - krok, do którego dołączono
// gałąź, nie zmienia miejsca na kanwie ani numeru.
//
// LIMIT 60 KROKÓW (`JOURNEY_LIMITS.nodesMax`) sprawdzamy przed walidacją:
// komunikat „limit kroków” jest konkretny, „nodes_count” - nie.
import {
  ancestorsOf,
  validateJourneyGraph,
  type GraphIssueCode,
  type GraphValidationContext,
  type JourneyEdge,
  type JourneyGraph,
  type JourneyNode,
} from "@/lib/journeys/graph";
import { JOURNEY_LIMITS } from "@/lib/journeys/limits";
import {
  isTerminalNodeType,
  requiredBranches,
  type JourneyEdgeBranch,
  type JourneyNodeType,
} from "@/lib/journeys/nodeTypes";

/** Identyfikator kroku - ten sam wzorzec co `JourneyNodeSchema` i adres `?node=`. */
export const NODE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export type JourneyOpError =
  | "node_missing"
  | "trigger_protected"
  | "terminal_protected"
  | "limit_nodes"
  | "branch_invalid"
  | "slot_occupied"
  | "not_movable"
  | "target_invalid"
  | "not_split"
  | "not_terminal"
  | "would_break";

export type JourneyOpResult =
  | { ok: true; graph: JourneyGraph; created: string[]; focusId: string | null }
  | { ok: false; error: JourneyOpError; codes?: GraphIssueCode[] };

/** Kontekst walidacji (wyzwalacz decyduje m.in. o zakazie maili windykacji). */
export type JourneyOpsContext = Pick<GraphValidationContext, "triggerEventType">;

/** Teksty domyślne parametrów - UI podaje je z bieżącego słownika. */
export interface DefaultParamText {
  taskTitle: string;
  staffMessage: string;
  tag: string;
}

// Zapas, gdy wołający nie poda tekstów (testy, operacje bez UI). Panel zawsze
// podaje napisy w języku administratora.
const FALLBACK_TEXT: DefaultParamText = {
  taskTitle: "Kontakt w ścieżce - zadanie",
  staffMessage: "Kontakt dotarł do tego kroku ścieżki.",
  tag: "sciezka",
};

/** Zdarzenie domyślne czekania na zdarzenie: najczęstszy cel ścieżek (zakup). */
export const DEFAULT_WAIT_EVENT = "checkout.completed.v1";

/**
 * Parametry nowego kroku - zawsze przechodzą `NODE_PARAMS_SCHEMAS` (test).
 * Domyślne wartości są zachowawcze: dzień czekania, warunek „ma zgodę
 * marketingową”, test A/B 50/50 oceniany po KLIKNIĘCIACH (otwarcia zawyża
 * Apple MPP - wiedza Insidera, scenariusz `mppinfl`), etap tylko do przodu.
 */
export function defaultParams(
  type: JourneyNodeType,
  text: Partial<DefaultParamText> = {},
): unknown {
  const copy = { ...FALLBACK_TEXT, ...text };
  switch (type) {
    case "wait":
      return { mode: "duration", minutes: 24 * 60 };
    case "ab_split":
      return { weights: { A: 50, B: 50 }, winnerMetric: "click" };
    case "if_else":
      return { match: "all", predicates: [{ kind: "consent", marketing: true }] };
    case "set_lifecycle_stage":
      return { stage: "mql" };
    case "set_crm_stage":
      return { stage: "contacted", onlyForward: true };
    case "create_crm_task":
      return { title: copy.taskTitle, dueInDays: 1, assignee: { mode: "owner_or_default" } };
    case "add_tag":
    case "remove_tag":
      return { tag: copy.tag };
    case "newsletter_list":
      return { op: "add", listKey: "newsletter" };
    case "notify_staff":
      return { recipients: "owner", message: copy.staffMessage };
    default:
      return {};
  }
}

/** Parametry czekania na zdarzenie (gałęzie „zdarzenie” i „minął termin”). */
export function waitUntilEventParams(eventType: string = DEFAULT_WAIT_EVENT): unknown {
  return { mode: "until_event", eventType, condition: {}, timeoutMinutes: 3 * 24 * 60 };
}

/**
 * Nowy identyfikator kroku: `<typ>_<n>` z najmniejszym wolnym n. Czytelny
 * w adresie (`?node=send_email_2`) i w statystykach; nigdy nie wraca do
 * identyfikatora usuniętego w TEJ SAMEJ operacji (`taken`).
 */
export function newNodeId(
  graph: Pick<JourneyGraph, "nodes">,
  type: JourneyNodeType,
  taken: ReadonlySet<string> = new Set(),
): string {
  const used = new Set(graph.nodes.map((node) => node.id));
  for (let n = 1; ; n += 1) {
    const id = `${type}_${n}`;
    if (!used.has(id) && !taken.has(id)) return id;
  }
}

// ── Narzędzia ────────────────────────────────────────────────────────────────

function cloneGraph(graph: JourneyGraph): JourneyGraph {
  return {
    nodes: graph.nodes.map((node) => ({ ...node })),
    edges: graph.edges.map((edge) => ({ ...edge })),
  };
}

function nodeOf(graph: JourneyGraph, id: string): JourneyNode | undefined {
  return graph.nodes.find((node) => node.id === id);
}

function edgeIndex(graph: JourneyGraph, from: string, branch: JourneyEdgeBranch): number {
  return graph.edges.findIndex((edge) => edge.from === from && edge.branch === branch);
}

function isLinear(node: JourneyNode): boolean {
  const branches = requiredBranches(node.type, node.params);
  return branches.length === 1 && branches[0] === "next";
}

function reachableFromTrigger(graph: JourneyGraph): Set<string> {
  const trigger = graph.nodes.find((node) => node.type === "trigger");
  const seen = new Set<string>();
  if (!trigger) return seen;
  const stack = [trigger.id];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const edge of graph.edges) if (edge.from === id) stack.push(edge.to);
  }
  return seen;
}

/** Usuwa kroki, które operacja odcięła od wyzwalacza (sieroty sprzed operacji zostają). */
function pruneDetached(graph: JourneyGraph, reachableBefore: ReadonlySet<string>): JourneyGraph {
  const reachable = reachableFromTrigger(graph);
  const dropped = new Set(
    graph.nodes
      .filter((node) => reachableBefore.has(node.id) && !reachable.has(node.id))
      .map((node) => node.id),
  );
  if (dropped.size === 0) return graph;
  return {
    nodes: graph.nodes.filter((node) => !dropped.has(node.id)),
    edges: graph.edges.filter((edge) => !dropped.has(edge.from) && !dropped.has(edge.to)),
  };
}

// Liczniki błędów grafu WEJŚCIOWEGO zapamiętane po tożsamości obiektu: grafy są
// niezmienne (każda operacja zwraca nowy), a `availableOps` sprawdza na sucho
// kilka operacji na tym samym grafie - walidacja „przed” liczy się raz.
const COUNTS_CACHE = new WeakMap<JourneyGraph, Map<string, Map<GraphIssueCode, number>>>();

function errorCounts(graph: JourneyGraph, context: JourneyOpsContext): Map<GraphIssueCode, number> {
  const contextKey = context.triggerEventType ?? "";
  const cached = COUNTS_CACHE.get(graph)?.get(contextKey);
  if (cached) return cached;
  const counts = new Map<GraphIssueCode, number>();
  for (const issue of validateJourneyGraph(graph, context).errors) {
    counts.set(issue.code, (counts.get(issue.code) ?? 0) + 1);
  }
  const perContext = COUNTS_CACHE.get(graph) ?? new Map<string, Map<GraphIssueCode, number>>();
  perContext.set(contextKey, counts);
  COUNTS_CACHE.set(graph, perContext);
  return counts;
}

function finalize(
  before: JourneyGraph,
  after: JourneyGraph,
  created: string[],
  focusId: string | null,
  context: JourneyOpsContext,
): JourneyOpResult {
  if (after.nodes.length > JOURNEY_LIMITS.nodesMax && after.nodes.length > before.nodes.length) {
    return { ok: false, error: "limit_nodes" };
  }
  const was = errorCounts(before, context);
  const now = errorCounts(after, context);
  const worse = [...now].filter(([code, count]) => count > (was.get(code) ?? 0)).map(([c]) => c);
  if (worse.length > 0) return { ok: false, error: "would_break", codes: worse };
  return { ok: true, graph: after, created, focusId };
}

/** Wyjście „końca gałęzi”: brak krawędzi albo krok końcowy z jednym wejściem. */
function endOfSlot(
  graph: JourneyGraph,
  from: string,
  branch: JourneyEdgeBranch,
): { kind: "missing" } | { kind: "terminal"; index: number; terminalId: string } | null {
  const index = edgeIndex(graph, from, branch);
  if (index < 0) return { kind: "missing" };
  const target = nodeOf(graph, graph.edges[index].to);
  if (!target || !isTerminalNodeType(target.type)) return null;
  const incoming = graph.edges.filter((edge) => edge.to === target.id).length;
  return incoming === 1 ? { kind: "terminal", index, terminalId: target.id } : null;
}

function exitNode(graph: JourneyGraph, taken: Set<string>): JourneyNode {
  const id = newNodeId(graph, "exit", taken);
  taken.add(id);
  return { id, type: "exit", params: {} };
}

// ── Wstawianie ───────────────────────────────────────────────────────────────

/**
 * Wstawia krok za `afterId` na gałęzi `branch`. Krok liniowy przejmuje dalszy
 * ciąg gałęzi; krok rozgałęziający deleguje do `insertBranching`; krok końcowy
 * (cel, wyjście) wolno postawić tylko na pustym końcu gałęzi - w środku
 * odciąłby resztę przepływu (do tego służy `replaceTerminal` i usuwanie).
 */
export function insertAfter(
  graph: JourneyGraph,
  afterId: string,
  branch: JourneyEdgeBranch,
  type: JourneyNodeType,
  params?: unknown,
  context: JourneyOpsContext = {},
): JourneyOpResult {
  const after = nodeOf(graph, afterId);
  if (!after) return { ok: false, error: "node_missing" };
  if (type === "trigger") return { ok: false, error: "trigger_protected" };
  if (!requiredBranches(after.type, after.params).includes(branch)) {
    return { ok: false, error: "branch_invalid" };
  }
  const nodeParams = params ?? defaultParams(type);
  if (requiredBranches(type, nodeParams).length > 1) {
    return insertBranching(graph, afterId, branch, type, nodeParams, context);
  }
  const next = cloneGraph(graph);
  const taken = new Set<string>();
  const id = newNodeId(next, type, taken);
  taken.add(id);
  const node: JourneyNode = { id, type, params: nodeParams };
  const index = edgeIndex(next, afterId, branch);
  const created = [id];

  if (isTerminalNodeType(type)) {
    if (index >= 0) {
      const current = nodeOf(next, next.edges[index].to);
      // Pusty koniec gałęzi z „Koniec” można zamienić na cel - ale to robi
      // `replaceTerminal`; wstawienie końca w środek przepływu - nigdy.
      if (!current || !isTerminalNodeType(current.type) || (type !== "goal" && type !== "exit")) {
        return { ok: false, error: "slot_occupied" };
      }
      return replaceTerminal(graph, current.id, type, context);
    }
    next.nodes.push(node);
    next.edges.push({ from: afterId, to: id, branch });
    return finalize(graph, next, created, id, context);
  }

  next.nodes.push(node);
  if (index >= 0) {
    const target = next.edges[index].to;
    next.edges[index] = { from: afterId, to: id, branch };
    next.edges.splice(index + 1, 0, { from: id, to: target, branch: "next" });
  } else {
    const end = exitNode(next, taken);
    next.nodes.push(end);
    created.push(end.id);
    next.edges.push({ from: afterId, to: id, branch }, { from: id, to: end.id, branch: "next" });
  }
  return finalize(graph, next, created, id, context);
}

/**
 * Wstawia krok rozgałęziający (warunek, test A/B, czekanie na zdarzenie).
 * Dotychczasowy ciąg gałęzi idzie PIERWSZĄ gałęzią nowego kroku (tak, A,
 * zdarzenie), każda pozostała wymagana gałąź dostaje własne „Koniec” - nowy
 * krok jest od razu kompletny (`branches_incomplete` się nie pojawia).
 */
export function insertBranching(
  graph: JourneyGraph,
  afterId: string,
  branch: JourneyEdgeBranch,
  type: JourneyNodeType,
  params?: unknown,
  context: JourneyOpsContext = {},
): JourneyOpResult {
  const nodeParams = params ?? defaultParams(type);
  const branches = requiredBranches(type, nodeParams);
  if (branches.length <= 1) return insertAfter(graph, afterId, branch, type, nodeParams, context);
  const after = nodeOf(graph, afterId);
  if (!after) return { ok: false, error: "node_missing" };
  if (!requiredBranches(after.type, after.params).includes(branch)) {
    return { ok: false, error: "branch_invalid" };
  }
  const next = cloneGraph(graph);
  const taken = new Set<string>();
  const id = newNodeId(next, type, taken);
  taken.add(id);
  next.nodes.push({ id, type, params: nodeParams });
  const created = [id];
  const index = edgeIndex(next, afterId, branch);
  const [first, ...rest] = branches;

  if (index >= 0) {
    const target = next.edges[index].to;
    next.edges[index] = { from: afterId, to: id, branch };
    next.edges.splice(index + 1, 0, { from: id, to: target, branch: first });
  } else {
    const end = exitNode(next, taken);
    next.nodes.push(end);
    created.push(end.id);
    next.edges.push({ from: afterId, to: id, branch }, { from: id, to: end.id, branch: first });
  }
  for (const other of rest) {
    const end = exitNode(next, taken);
    next.nodes.push(end);
    created.push(end.id);
    next.edges.push({ from: id, to: end.id, branch: other });
  }
  return finalize(graph, next, created, id, context);
}

// ── Usuwanie ─────────────────────────────────────────────────────────────────

export type RemoveMode = "reconnect" | "subtree";

/**
 * Usuwa krok. `reconnect` - wejścia kroku przechodzą na jego dalszy ciąg
 * (dla rozgałęzienia: ciąg PIERWSZEJ gałęzi, pozostałe gałęzie znikają, jeśli
 * nic innego do nich nie prowadzi). `subtree` - krok i wszystko, co było
 * osiągalne wyłącznie przez niego, znika, a wejścia kończą się nowym
 * „Koniec”. Wyzwalacza i kroków końcowych nie usuwamy (krok końcowy zamienia
 * `replaceTerminal`, a koniec gałęzi łączy `mergeInto`).
 */
export function removeNode(
  graph: JourneyGraph,
  id: string,
  mode: RemoveMode,
  context: JourneyOpsContext = {},
): JourneyOpResult {
  const node = nodeOf(graph, id);
  if (!node) return { ok: false, error: "node_missing" };
  if (node.type === "trigger") return { ok: false, error: "trigger_protected" };
  if (isTerminalNodeType(node.type)) return { ok: false, error: "terminal_protected" };
  const reachableBefore = reachableFromTrigger(graph);
  let next = cloneGraph(graph);
  const taken = new Set<string>([id]);
  const created: string[] = [];

  let continuation: string | null = null;
  if (mode === "reconnect") {
    for (const branch of requiredBranches(node.type, node.params)) {
      const index = edgeIndex(next, id, branch);
      if (index >= 0) {
        continuation = next.edges[index].to;
        break;
      }
    }
  }
  if (continuation === null || continuation === id) {
    const end = exitNode(next, taken);
    next.nodes.push(end);
    created.push(end.id);
    continuation = end.id;
  }
  const target = continuation;
  next.edges = next.edges
    .filter((edge) => edge.from !== id)
    .map((edge) => (edge.to === id ? { ...edge, to: target } : edge));
  next.nodes = next.nodes.filter((entry) => entry.id !== id);
  next = pruneDetached(next, reachableBefore);
  const parent = graph.edges.find((edge) => edge.to === id)?.from ?? null;
  return finalize(graph, next, created, parent, context);
}

// ── Przesuwanie w odcinku ────────────────────────────────────────────────────

/**
 * Zamienia krok z poprzednikiem (`up`) albo następnikiem (`down`) w odcinku
 * liniowym: oba kroki mają jedno wyjście `next`, a między nimi nie ma scalenia
 * (każdy ma dokładnie jedno wejście). Rozgałęzienie i krok końcowy nie
 * przesuwają się - ich poddrzewa nie mają jednoznacznego miejsca.
 */
export function moveWithinSegment(
  graph: JourneyGraph,
  id: string,
  direction: "up" | "down",
  context: JourneyOpsContext = {},
): JourneyOpResult {
  const node = nodeOf(graph, id);
  if (!node) return { ok: false, error: "node_missing" };
  if (direction === "down") {
    const index = edgeIndex(graph, id, "next");
    if (index < 0) return { ok: false, error: "not_movable" };
    const result = swapWithParent(graph, graph.edges[index].to, context);
    return result.ok ? { ...result, focusId: id } : result;
  }
  return swapWithParent(graph, id, context);
}

function swapWithParent(
  graph: JourneyGraph,
  id: string,
  context: JourneyOpsContext,
): JourneyOpResult {
  const b = nodeOf(graph, id);
  if (!b || b.type === "trigger" || !isLinear(b)) return notMovable();
  const intoB = graph.edges.map((edge, index) => ({ edge, index })).filter((e) => e.edge.to === id);
  if (intoB.length !== 1 || intoB[0].edge.branch !== "next") return notMovable();
  const a = nodeOf(graph, intoB[0].edge.from);
  if (!a || a.type === "trigger" || !isLinear(a)) return notMovable();
  const intoA = graph.edges.map((edge, index) => ({ edge, index })).filter((e) => e.edge.to === a.id);
  const outB = edgeIndex(graph, id, "next");
  if (intoA.length !== 1 || outB < 0) return notMovable();
  const next = cloneGraph(graph);
  const pa = intoA[0].index;
  const ab = intoB[0].index;
  next.edges[pa] = { ...next.edges[pa], to: id };
  next.edges[ab] = { from: id, to: a.id, branch: "next" };
  next.edges[outB] = { ...next.edges[outB], from: a.id };
  return finalize(graph, next, [], id, context);
}

function notMovable(): JourneyOpResult {
  return { ok: false, error: "not_movable" };
}

// ── Scalanie ─────────────────────────────────────────────────────────────────

/** Adres wyjścia kroku: krok i gałąź. */
export interface JourneySlotRef {
  from: string;
  branch: JourneyEdgeBranch;
}

/**
 * Kroki, do których wolno dołączyć koniec gałęzi: późniejsze topologicznie
 * i NIE-przodkowie (inaczej powstałby cykl - kontakt krążyłby w nieskończoność,
 * a silnik odwiedza krok raz na zapis), bez wyzwalacza i bez bieżącego końca.
 * W grafie bez cykli oba warunki to jedno: krok nie jest przodkiem `from`
 * dokładnie wtedy, gdy istnieje porządek topologiczny z nim ZA `from` - więc
 * sprawdzamy przodków (jedno przejście wstecz), a nie jeden z wielu porządków.
 * Kolejność = kolejność kroków w grafie (UI sortuje po numerze).
 */
export function mergeTargets(graph: JourneyGraph, slot: JourneySlotRef): string[] {
  const end = endOfSlot(graph, slot.from, slot.branch);
  if (end === null) return [];
  const ancestors = ancestorsOf(graph, slot.from);
  const reachable = reachableFromTrigger(graph);
  const current = end.kind === "terminal" ? end.terminalId : null;
  return graph.nodes
    .filter(
      (node) =>
        node.type !== "trigger" &&
        node.id !== slot.from &&
        node.id !== current &&
        !ancestors.has(node.id) &&
        reachable.has(node.id),
    )
    .map((node) => node.id);
}

/**
 * „Połącz z krokiem…”: koniec gałęzi (brak krawędzi albo „Koniec”/cel z jednym
 * wejściem) prowadzi odtąd do istniejącego kroku. Krawędź scalenia idzie NA
 * KONIEC tablicy - krok docelowy zostaje pod swoim dotychczasowym rodzicem,
 * a tu pojawia się chip „→ dalej jak w kroku …”.
 */
export function mergeInto(
  graph: JourneyGraph,
  slot: JourneySlotRef,
  targetId: string,
  context: JourneyOpsContext = {},
): JourneyOpResult {
  const from = nodeOf(graph, slot.from);
  if (!from) return { ok: false, error: "node_missing" };
  if (!requiredBranches(from.type, from.params).includes(slot.branch)) {
    return { ok: false, error: "branch_invalid" };
  }
  const end = endOfSlot(graph, slot.from, slot.branch);
  if (end === null) return { ok: false, error: "slot_occupied" };
  if (!mergeTargets(graph, slot).includes(targetId)) return { ok: false, error: "target_invalid" };
  const reachableBefore = reachableFromTrigger(graph);
  let next = cloneGraph(graph);
  if (end.kind === "terminal") next.edges.splice(end.index, 1);
  next.edges.push({ from: slot.from, to: targetId, branch: slot.branch });
  next = pruneDetached(next, reachableBefore);
  return finalize(graph, next, [], slot.from, context);
}

// ── Duplikowanie ─────────────────────────────────────────────────────────────

/**
 * Kroki „należące” do `id`: osiągalne z niego i takie, do których KAŻDA
 * krawędź wchodząca wychodzi z tego zbioru (dominacja w poddrzewie). Krok,
 * do którego prowadzi też inna gałąź, jest wspólny - kopia do niego dołącza,
 * zamiast go powielać.
 */
export function ownedSubtree(graph: JourneyGraph, id: string): Set<string> {
  const owned = new Set<string>([id]);
  const reachable = new Set<string>();
  const stack = [id];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (reachable.has(current)) continue;
    reachable.add(current);
    for (const edge of graph.edges) if (edge.from === current) stack.push(edge.to);
  }
  for (let changed = true; changed; ) {
    changed = false;
    for (const candidate of reachable) {
      if (owned.has(candidate)) continue;
      const incoming = graph.edges.filter((edge) => edge.to === candidate);
      if (incoming.length > 0 && incoming.every((edge) => owned.has(edge.from))) {
        owned.add(candidate);
        changed = true;
      }
    }
  }
  return owned;
}

/**
 * Puste końce gałęzi, w które wolno wstawić kopię poddrzewa `id` (każdy
 * sprawdzony próbnym duplikatem). `limit` przerywa po pierwszych trafieniach -
 * menu pyta tylko, czy jakiekolwiek miejsce istnieje.
 */
export function duplicateTargets(
  graph: JourneyGraph,
  id: string,
  context: JourneyOpsContext = {},
  limit = Infinity,
): JourneySlotRef[] {
  const owned = ownedSubtree(graph, id);
  const reachable = reachableFromTrigger(graph);
  const out: JourneySlotRef[] = [];
  for (const node of graph.nodes) {
    if (owned.has(node.id) || !reachable.has(node.id) || isTerminalNodeType(node.type)) continue;
    for (const branch of requiredBranches(node.type, node.params)) {
      if (endOfSlot(graph, node.id, branch) === null) continue;
      const slot = { from: node.id, branch };
      if (duplicateSubtree(graph, id, slot, context).ok) out.push(slot);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

function remapPredicates(params: unknown, mapping: ReadonlyMap<string, string>): unknown {
  if (typeof params !== "object" || params === null) return params;
  const record = params as { predicates?: unknown };
  if (!Array.isArray(record.predicates)) return structuredClone(params);
  return {
    ...structuredClone(params),
    predicates: record.predicates.map((predicate: unknown) => {
      const ref = (predicate as { nodeId?: unknown })?.nodeId;
      return typeof ref === "string" && mapping.has(ref)
        ? { ...(predicate as object), nodeId: mapping.get(ref) }
        : structuredClone(predicate);
    }),
  };
}

/**
 * Duplikat. Bez `target` - kopia JEDNEGO kroku liniowego tuż za oryginałem
 * („Duplikuj” z menu). Z `target` - kopia całego poddrzewa (`ownedSubtree`)
 * wstawiona w pusty koniec gałęzi; warunki „otworzył/kliknął” wskazujące
 * maile z poddrzewa wskazują ich kopie. Treści maili nie kopiujemy (mieszkają
 * w `journey_email_contents`, nie w grafie) - lista problemów pokaże brak
 * treści kopii, zanim pozwoli opublikować.
 */
export function duplicateSubtree(
  graph: JourneyGraph,
  id: string,
  target?: JourneySlotRef,
  context: JourneyOpsContext = {},
): JourneyOpResult {
  const node = nodeOf(graph, id);
  if (!node) return { ok: false, error: "node_missing" };
  if (node.type === "trigger") return { ok: false, error: "trigger_protected" };
  if (isTerminalNodeType(node.type)) return { ok: false, error: "terminal_protected" };
  if (!target) {
    if (!isLinear(node)) return { ok: false, error: "target_invalid" };
    return insertAfter(graph, id, "next", node.type, structuredClone(node.params ?? {}), context);
  }
  const owned = ownedSubtree(graph, id);
  if (owned.has(target.from)) return { ok: false, error: "target_invalid" };
  const from = nodeOf(graph, target.from);
  if (!from || !requiredBranches(from.type, from.params).includes(target.branch)) {
    return { ok: false, error: "branch_invalid" };
  }
  const end = endOfSlot(graph, target.from, target.branch);
  if (end === null) return { ok: false, error: "slot_occupied" };

  const reachableBefore = reachableFromTrigger(graph);
  let next = cloneGraph(graph);
  const taken = new Set<string>();
  const mapping = new Map<string, string>();
  for (const original of graph.nodes) {
    if (!owned.has(original.id)) continue;
    const copyId = newNodeId(next, original.type, taken);
    taken.add(copyId);
    mapping.set(original.id, copyId);
  }
  for (const original of graph.nodes) {
    const copyId = mapping.get(original.id);
    if (copyId === undefined) continue;
    next.nodes.push({
      id: copyId,
      type: original.type,
      params: remapPredicates(original.params ?? {}, mapping),
    });
  }
  const copiedEdges: JourneyEdge[] = graph.edges
    .filter((edge) => owned.has(edge.from))
    .map((edge) => ({
      from: mapping.get(edge.from) as string,
      to: mapping.get(edge.to) ?? edge.to,
      branch: edge.branch,
    }));
  if (end.kind === "terminal") next.edges.splice(end.index, 1);
  next.edges.push({ from: target.from, to: mapping.get(id) as string, branch: target.branch });
  next.edges.push(...copiedEdges);
  next = pruneDetached(next, reachableBefore);
  return finalize(graph, next, [...mapping.values()], mapping.get(id) ?? null, context);
}

// ── Kroki końcowe i test A/B ─────────────────────────────────────────────────

/**
 * Zamienia krok końcowy na inny końcowy (cel <-> wyjście) pod NOWYM
 * identyfikatorem: statystyki kroku są per identyfikator, więc „Koniec”
 * przemianowany na „Cel” nie może dziedziczyć liczników wyjść.
 */
export function replaceTerminal(
  graph: JourneyGraph,
  id: string,
  type: "goal" | "exit",
  context: JourneyOpsContext = {},
): JourneyOpResult {
  const node = nodeOf(graph, id);
  if (!node) return { ok: false, error: "node_missing" };
  if (!isTerminalNodeType(node.type)) return { ok: false, error: "not_terminal" };
  if (node.type === type) return { ok: false, error: "target_invalid" };
  const next = cloneGraph(graph);
  const replacement = newNodeId(next, type, new Set([id]));
  const index = next.nodes.findIndex((entry) => entry.id === id);
  next.nodes[index] = { id: replacement, type, params: defaultParams(type) };
  next.edges = next.edges.map((edge) => (edge.to === id ? { ...edge, to: replacement } : edge));
  return finalize(graph, next, [replacement], replacement, context);
}

/**
 * „Zostaw A/B” (wynik testu): zwycięzca dostaje 100 % ruchu, przegrany 0 %.
 * Struktura i identyfikatory zostają - statystyki obu ramion i treść wariantu
 * przegranego są nadal czytelne w wynikach, a decyzję da się cofnąć wagami.
 */
export function resolveSplit(
  graph: JourneyGraph,
  splitId: string,
  winner: "A" | "B",
  context: JourneyOpsContext = {},
): JourneyOpResult {
  const node = nodeOf(graph, splitId);
  if (!node) return { ok: false, error: "node_missing" };
  if (node.type !== "ab_split") return { ok: false, error: "not_split" };
  const current = (node.params ?? {}) as { winnerMetric?: unknown };
  const winnerMetric = current.winnerMetric === "goal" ? "goal" : "click";
  const next = cloneGraph(graph);
  const index = next.nodes.findIndex((entry) => entry.id === splitId);
  next.nodes[index] = {
    ...next.nodes[index],
    params: { weights: { A: winner === "A" ? 100 : 0, B: winner === "B" ? 100 : 0 }, winnerMetric },
  };
  return finalize(graph, next, [], splitId, context);
}

// ── Menu operacji (jedno źródło) ─────────────────────────────────────────────

export type JourneyOpKind =
  | "insert"
  | "moveUp"
  | "moveDown"
  | "duplicate"
  | "mergeInto"
  | "replaceTerminal"
  | "resolveSplit"
  | "remove"
  | "removeSubtree";

export type JourneyOpLabel =
  | "insert"
  | "insertBranch"
  | "moveUp"
  | "moveDown"
  | "duplicate"
  | "duplicateTo"
  | "mergeInto"
  | "replaceWithGoal"
  | "replaceWithExit"
  | "keepA"
  | "keepB"
  | "remove"
  | "removeKeepFirst"
  | "removeSubtree";

/** Klucze etykiet menu - jawna mapa (zakaz sklejania kluczy). */
export const JOURNEY_OP_LABEL_KEY: Readonly<Record<JourneyOpLabel, string>> = {
  insert: "adminJourneys.common.ops.insert",
  insertBranch: "adminJourneys.common.ops.insertBranch",
  moveUp: "adminJourneys.common.ops.moveUp",
  moveDown: "adminJourneys.common.ops.moveDown",
  duplicate: "adminJourneys.common.ops.duplicate",
  duplicateTo: "adminJourneys.common.ops.duplicateTo",
  mergeInto: "adminJourneys.common.ops.mergeInto",
  replaceWithGoal: "adminJourneys.common.ops.replaceWithGoal",
  replaceWithExit: "adminJourneys.common.ops.replaceWithExit",
  keepA: "adminJourneys.common.ops.keepA",
  keepB: "adminJourneys.common.ops.keepB",
  remove: "adminJourneys.common.ops.remove",
  removeKeepFirst: "adminJourneys.common.ops.removeKeepFirst",
  removeSubtree: "adminJourneys.common.ops.removeSubtree",
};

export interface JourneyOpDescriptor {
  kind: JourneyOpKind;
  label: JourneyOpLabel;
  labelKey: string;
  /** Gałąź wstawienia (`insert`) albo końca gałęzi (`mergeInto`). */
  branch?: JourneyEdgeBranch;
  /** Wariant (`resolveSplit`) albo typ końca (`replaceTerminal`). */
  value?: "A" | "B" | "goal" | "exit";
  /** Klawisz skrótu, który wykonuje tę pozycję na kanwie i liście. */
  shortcut?: "Insert" | "Delete";
  /** Operacja wymaga wyboru: typu z palety, kroku docelowego albo końca gałęzi. */
  needs?: "type" | "target" | "slot";
  destructive?: boolean;
  /** Przed wykonaniem `ConfirmDialog` (usunięcie z dalszymi krokami). */
  confirm?: boolean;
}

function op(
  kind: JourneyOpKind,
  label: JourneyOpLabel,
  extra: Omit<JourneyOpDescriptor, "kind" | "label" | "labelKey"> = {},
): JourneyOpDescriptor {
  return { kind, label, labelKey: JOURNEY_OP_LABEL_KEY[label], ...extra };
}

/**
 * Pozycje menu kroku - TA SAMA lista dla menu `⋯` kanwy, menu listy kroków
 * (`Shift+F10`) i skrótów klawiatury (`shortcut`). Pozycja trafia na listę
 * tylko wtedy, gdy operacja naprawdę się powiedzie (sprawdzamy ją na sucho),
 * więc menu nie proponuje akcji kończącej się odmową.
 */
export function availableOps(
  graph: JourneyGraph,
  nodeId: string,
  context: JourneyOpsContext = {},
): JourneyOpDescriptor[] {
  const node = nodeOf(graph, nodeId);
  if (!node) return [];
  const out: JourneyOpDescriptor[] = [];
  const branches = requiredBranches(node.type, node.params);

  if (isTerminalNodeType(node.type)) {
    const other = node.type === "goal" ? "exit" : "goal";
    out.push(
      op("replaceTerminal", other === "goal" ? "replaceWithGoal" : "replaceWithExit", {
        value: other,
      }),
    );
    const incoming = graph.edges.filter((edge) => edge.to === nodeId);
    if (incoming.length === 1) {
      const slot = { from: incoming[0].from, branch: incoming[0].branch };
      if (mergeTargets(graph, slot).length > 0) {
        out.push(op("mergeInto", "mergeInto", { branch: slot.branch, needs: "target" }));
      }
    }
    return out;
  }

  if (branches.length === 1 && branches[0] === "next") {
    out.push(op("insert", "insert", { branch: "next", shortcut: "Insert", needs: "type" }));
  } else {
    for (const branch of branches) {
      out.push(
        op("insert", "insertBranch", {
          branch,
          needs: "type",
          ...(branch === branches[0] ? { shortcut: "Insert" as const } : {}),
        }),
      );
    }
  }
  if (node.type === "trigger") return out;

  if (moveWithinSegment(graph, nodeId, "up", context).ok) out.push(op("moveUp", "moveUp"));
  if (moveWithinSegment(graph, nodeId, "down", context).ok) out.push(op("moveDown", "moveDown"));

  if (node.type === "ab_split") {
    const weights = (node.params as { weights?: { A?: number; B?: number } })?.weights;
    if (weights?.A !== 100) out.push(op("resolveSplit", "keepA", { value: "A" }));
    if (weights?.B !== 100) out.push(op("resolveSplit", "keepB", { value: "B" }));
  }

  const linear = branches.length === 1 && branches[0] === "next";
  if (linear && duplicateSubtree(graph, nodeId, undefined, context).ok) {
    out.push(op("duplicate", "duplicate"));
  }
  if (duplicateTargets(graph, nodeId, context, 1).length > 0) {
    out.push(op("duplicate", "duplicateTo", { needs: "slot" }));
  }

  const reconnect = removeNode(graph, nodeId, "reconnect", context).ok;
  const subtree = removeNode(graph, nodeId, "subtree", context).ok;
  if (reconnect) {
    out.push(
      op("remove", linear ? "remove" : "removeKeepFirst", {
        destructive: true,
        ...(linear ? { shortcut: "Delete" as const } : {}),
      }),
    );
  }
  if (subtree) {
    out.push(
      op("removeSubtree", "removeSubtree", {
        destructive: true,
        confirm: true,
        ...(!linear || !reconnect ? { shortcut: "Delete" as const } : {}),
      }),
    );
  }
  return out;
}

/** Dane wyboru dla pozycji z `needs` (paleta, krok docelowy, koniec gałęzi). */
export interface JourneyOpInput {
  type?: JourneyNodeType;
  params?: unknown;
  targetId?: string;
  slot?: JourneySlotRef;
}

/** Wykonuje pozycję menu - kanwa, lista i klawiatura wołają TĘ funkcję. */
export function applyOp(
  graph: JourneyGraph,
  nodeId: string,
  descriptor: JourneyOpDescriptor,
  input: JourneyOpInput = {},
  context: JourneyOpsContext = {},
): JourneyOpResult {
  switch (descriptor.kind) {
    case "insert":
      if (!input.type || !descriptor.branch) return { ok: false, error: "target_invalid" };
      return insertAfter(graph, nodeId, descriptor.branch, input.type, input.params, context);
    case "moveUp":
      return moveWithinSegment(graph, nodeId, "up", context);
    case "moveDown":
      return moveWithinSegment(graph, nodeId, "down", context);
    case "duplicate":
      return duplicateSubtree(graph, nodeId, input.slot, context);
    case "mergeInto": {
      const incoming = graph.edges.find((edge) => edge.to === nodeId);
      if (!incoming || !input.targetId) return { ok: false, error: "target_invalid" };
      return mergeInto(graph, { from: incoming.from, branch: incoming.branch }, input.targetId, context);
    }
    case "replaceTerminal":
      return descriptor.value === "goal" || descriptor.value === "exit"
        ? replaceTerminal(graph, nodeId, descriptor.value, context)
        : { ok: false, error: "target_invalid" };
    case "resolveSplit":
      return descriptor.value === "A" || descriptor.value === "B"
        ? resolveSplit(graph, nodeId, descriptor.value, context)
        : { ok: false, error: "target_invalid" };
    case "remove":
      return removeNode(graph, nodeId, "reconnect", context);
    case "removeSubtree":
      return removeNode(graph, nodeId, "subtree", context);
  }
}

/** Pozycja przypisana klawiszowi (`Insert`, `Delete`) albo `undefined`. */
export function opForShortcut(
  ops: readonly JourneyOpDescriptor[],
  shortcut: "Insert" | "Delete",
): JourneyOpDescriptor | undefined {
  return ops.find((entry) => entry.shortcut === shortcut);
}
