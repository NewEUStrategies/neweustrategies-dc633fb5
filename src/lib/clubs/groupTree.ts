// Hierarchia działów klubu (grupy i podgrupy).
//
// DLACZEGO TO JEST W WARSTWIE UI, A NIE W BAZIE. `club_groups` nie ma kolumny
// rodzica - model jest płaski i nie ma powodu go migrować tylko po to, żeby
// interfejs mógł narysować wcięcie. Redakcja i tak nazywa działy hierarchicznie
// (`bezpieczenstwo`, `bezpieczenstwo-cyber`), więc hierarchia JEST w danych -
// tyle że w slugu. Ta funkcja ją odczytuje i nic więcej: gdy konwencja nie
// występuje, drzewo jest płaskie i widok wygląda dokładnie jak wcześniej.
//
// Rodzicem jest NAJDŁUŻSZY pasujący prefiks (`a-b-c` woli `a-b` od `a`),
// dzięki czemu trzeci poziom nie ląduje przy korzeniu.
import type { ClubGroupRow } from "./types";

export interface ClubGroupNode {
  group: ClubGroupRow;
  depth: number;
  children: ClubGroupNode[];
  /** Suma wątków w dziale i wszystkich jego podgrupach. */
  totalThreads: number;
}

const SEPARATORS = ["-", "/", "_"] as const;

function isChildSlug(childSlug: string, parentSlug: string): boolean {
  if (childSlug === parentSlug) return false;
  return SEPARATORS.some((sep) => childSlug.startsWith(`${parentSlug}${sep}`));
}

/** Buduje drzewo działów. Kolejność rodzeństwa = kolejność wejściowa. */
export function buildClubGroupTree(groups: readonly ClubGroupRow[]): ClubGroupNode[] {
  const nodes = new Map<string, ClubGroupNode>();
  for (const group of groups) {
    nodes.set(group.id, { group, depth: 0, children: [], totalThreads: group.thread_count ?? 0 });
  }

  const roots: ClubGroupNode[] = [];
  for (const group of groups) {
    const node = nodes.get(group.id);
    if (node === undefined) continue;
    let parent: ClubGroupRow | null = null;
    for (const candidate of groups) {
      if (!isChildSlug(group.slug, candidate.slug)) continue;
      if (parent === null || candidate.slug.length > parent.slug.length) parent = candidate;
    }
    const parentNode = parent === null ? undefined : nodes.get(parent.id);
    if (parentNode === undefined) roots.push(node);
    else parentNode.children.push(node);
  }

  const applyDepth = (node: ClubGroupNode, depth: number): number => {
    node.depth = depth;
    let total = node.group.thread_count ?? 0;
    for (const child of node.children) total += applyDepth(child, depth + 1);
    node.totalThreads = total;
    return total;
  };
  for (const root of roots) applyDepth(root, 0);

  return roots;
}

/** Spłaszcza drzewo do listy w kolejności wyświetlania (pre-order). */
export function flattenClubGroupTree(nodes: readonly ClubGroupNode[]): ClubGroupNode[] {
  const out: ClubGroupNode[] = [];
  const walk = (list: readonly ClubGroupNode[]): void => {
    for (const node of list) {
      out.push(node);
      walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

/** Znajduje węzeł po identyfikatorze - potrzebny do panelu wybranego działu. */
export function findClubGroupNode(
  nodes: readonly ClubGroupNode[],
  groupId: string | null,
): ClubGroupNode | null {
  if (groupId === null) return null;
  for (const node of nodes) {
    if (node.group.id === groupId) return node;
    const found = findClubGroupNode(node.children, groupId);
    if (found !== null) return found;
  }
  return null;
}

/** Ścieżka od korzenia do węzła - okruszki nad panelem działu. */
export function clubGroupPath(
  nodes: readonly ClubGroupNode[],
  groupId: string | null,
): ClubGroupNode[] {
  if (groupId === null) return [];
  for (const node of nodes) {
    if (node.group.id === groupId) return [node];
    const rest = clubGroupPath(node.children, groupId);
    if (rest.length > 0) return [node, ...rest];
  }
  return [];
}
