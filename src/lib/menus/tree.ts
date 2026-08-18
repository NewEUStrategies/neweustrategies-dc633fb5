// Reguły drzewa menu - wyprowadzone z organizmu `MenuManager.tsx`.
//
// DLACZEGO OSOBNY MODUŁ. Cała logika hierarchii (budowa drzewa, głębokość,
// przenoszenie z ochroną przed cyklem, wcięcia, kasowanie poddrzewa,
// przygotowanie payloadu zapisu) mieszkała w domknięciach `setItems(...)`
// wewnątrz komponentu na 1545 linii. Żadnej z tych reguł nie dało się sprawdzić
// bez wyrenderowania całego edytora razem z react-query, DnD i toastami -
// i dlatego plik stał na 0% pokrycia, mimo że to najgęstsza logika modułu.
//
// Funkcje są generyczne po KSZTAŁCIE pozycji (`local_id`, `parent_local_id`,
// `position`), więc test składa fixture z trzech pól zamiast pełnego wiersza
// menu, a komponent podaje swój `MenuClientItem` bez rzutowania.
//
// KONTRAKT NIEZMIENNY DLA WSZYSTKICH REDUKTORÓW: zwracają NOWĄ tablicę
// (albo tę samą referencję, gdy operacja jest niedozwolona - to jest sygnał
// „nic nie rób" dla `setItems`), nigdy nie mutują wejścia.
import {
  DEFAULT_MEGA_CONFIG,
  type MegaConfig,
  type MenuItemInput,
  type MenuItemType,
} from "./types";

/** Maksymalna liczba POZIOMÓW menu (1 = same pozycje najwyższego rzędu). */
export const MAX_MENU_DEPTH = 3;

/** Bezpiecznik pętli przy liczeniu głębokości w danych z cyklem. */
const DEPTH_CYCLE_GUARD = 10;

/** Minimalny kształt, jakiego wymagają reguły drzewa. */
export interface MenuTreeItem {
  local_id: string;
  parent_local_id: string | null;
  position: number;
}

/**
 * Pozycja w modelu klienta edytora: hierarchia przez `parent_local_id`,
 * stabilne `local_id` nadawane przy wczytaniu (serwer zna własne UUID-y).
 */
export interface MenuClientItem extends MenuTreeItem {
  item_type: MenuItemType;
  ref_id: string | null;
  label_pl: string;
  label_en: string;
  href: string;
  target: "_self" | "_blank";
  css_class: string;
  icon: string;
  mega_enabled: boolean;
  mega_config: MegaConfig;
}

export interface MenuTreeNode<T extends MenuTreeItem = MenuClientItem> {
  item: T;
  children: MenuTreeNode<T>[];
}

/** Tryb upuszczenia przeciąganej pozycji względem pozycji docelowej. */
export type MenuDropMode = "before" | "after" | "child";

/**
 * Buduje drzewo z płaskiej listy, sortując rodzeństwo po `position`.
 *
 * Pozycja wskazująca rodzica, którego NIE MA na liście, nie trafia do drzewa:
 * ląduje w kubełku, po który nikt nie sięga (patrz test „sierota"). To jest
 * dzisiejsze zachowanie edytora, przeniesione tu bez zmian.
 *
 * Cykl w danych (A rodzicem B, B rodzicem A) nie zawiesza budowy: żaden
 * z wierzchołków pierścienia nie jest korzeniem, więc rekurencja nigdy do
 * niego nie wchodzi.
 */
export function buildMenuTree<T extends MenuTreeItem>(items: readonly T[]): MenuTreeNode<T>[] {
  const byParent = new Map<string | null, T[]>();
  for (const it of items) {
    const key = it.parent_local_id;
    const arr = byParent.get(key) ?? [];
    arr.push(it);
    byParent.set(key, arr);
  }
  const build = (parent: string | null): MenuTreeNode<T>[] =>
    (byParent.get(parent) ?? [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((item) => ({ item, children: build(item.local_id) }));
  return build(null);
}

/**
 * Głębokość pozycji (0 = najwyższy poziom). Pętla w danych jest przerywana
 * po `DEPTH_CYCLE_GUARD` krokach - liczba i tak przekroczy wtedy limit
 * poziomów, więc operacja zostanie odrzucona, a edytor nie zawiśnie.
 */
export function depthOf<T extends MenuTreeItem>(items: readonly T[], localId: string): number {
  let depth = 0;
  let current: T | undefined = items.find((i) => i.local_id === localId);
  while (current?.parent_local_id) {
    depth++;
    const parentId: string = current.parent_local_id;
    current = items.find((i) => i.local_id === parentId);
    if (depth > DEPTH_CYCLE_GUARD) break;
  }
  return depth;
}

/** Zbiór identyfikatorów pozycji i całego jej poddrzewa. */
export function descendantIds<T extends MenuTreeItem>(
  items: readonly T[],
  localId: string,
): Set<string> {
  const out = new Set<string>();
  const collect = (id: string) => {
    if (out.has(id)) return; // bezpiecznik na cykl w danych
    out.add(id);
    for (const child of items.filter((c) => c.parent_local_id === id)) collect(child.local_id);
  };
  collect(localId);
  return out;
}

/** Renumeruje `position` na 0..n-1 - bez dziur i bez duplikatów. */
function renumber<T extends MenuTreeItem>(list: readonly T[]): T[] {
  return list.map((it, idx) => ({ ...it, position: idx }));
}

function sortedSiblings<T extends MenuTreeItem>(items: readonly T[], parent: string | null): T[] {
  return items.filter((i) => i.parent_local_id === parent).sort((a, b) => a.position - b.position);
}

/**
 * Przenosi pozycję pod wskazany cel. Zwraca WEJŚCIE (ta sama referencja), gdy
 * ruch jest niedozwolony: nieznana pozycja, cel wewnątrz własnego poddrzewa
 * (to zrobiłoby z drzewa pierścień) albo przekroczenie limitu poziomów.
 */
export function moveMenuItem<T extends MenuTreeItem>(
  items: readonly T[],
  dragId: string,
  targetId: string | null,
  mode: MenuDropMode,
): readonly T[] {
  const dragged = items.find((i) => i.local_id === dragId);
  if (!dragged) return items;
  if (targetId && descendantIds(items, dragId).has(targetId)) return items;

  let newParent: string | null = dragged.parent_local_id;
  if (targetId === null) {
    newParent = null;
  } else if (mode === "child") {
    newParent = targetId;
  } else {
    newParent = items.find((i) => i.local_id === targetId)?.parent_local_id ?? null;
  }
  if (newParent && depthOf(items, newParent) + 1 >= MAX_MENU_DEPTH) return items;

  const others = items.filter((i) => i.local_id !== dragId);
  const siblings = others.filter((i) => i.parent_local_id === newParent);
  const remaining = others.filter((i) => i.parent_local_id !== newParent);
  let insertIndex = siblings.length;
  if (targetId && mode !== "child") {
    const targetIdx = siblings.findIndex((s) => s.local_id === targetId);
    if (targetIdx >= 0) insertIndex = mode === "before" ? targetIdx : targetIdx + 1;
  }
  const updated = { ...dragged, parent_local_id: newParent };
  const reordered = renumber([
    ...siblings.slice(0, insertIndex),
    updated,
    ...siblings.slice(insertIndex),
  ]);
  return [...remaining, ...reordered];
}

/**
 * Wcięcie w prawo: pozycja staje się OSTATNIM dzieckiem swojego poprzedniego
 * rodzeństwa. Bez poprzednika (pierwsza w rzędzie) i po przekroczeniu limitu
 * poziomów operacja jest bezskuteczna.
 */
export function indentMenuItem<T extends MenuTreeItem>(
  items: readonly T[],
  localId: string,
): readonly T[] {
  const it = items.find((i) => i.local_id === localId);
  if (!it) return items;
  const siblings = sortedSiblings(items, it.parent_local_id);
  const idx = siblings.findIndex((s) => s.local_id === localId);
  if (idx <= 0) return items; // brak poprzedniego rodzeństwa
  const newParent = siblings[idx - 1].local_id;
  if (depthOf(items, newParent) + 1 >= MAX_MENU_DEPTH) return items;

  const newParentChildren = sortedSiblings(items, newParent);
  const updatedItem = {
    ...it,
    parent_local_id: newParent,
    position: newParentChildren.length,
  };
  const remainingSiblings = renumber(siblings.filter((s) => s.local_id !== localId));
  const others = items.filter(
    (i) =>
      i.parent_local_id !== it.parent_local_id &&
      i.parent_local_id !== newParent &&
      i.local_id !== localId,
  );
  return [...others, ...remainingSiblings, ...newParentChildren, updatedItem];
}

/**
 * Które gałęzie trzeba rozwinąć, żeby wcięta pozycja została widoczna.
 * Zwraca id nowego rodzica albo `null`, gdy wcięcie nie miałoby skutku.
 */
export function parentToExpandOnIndent<T extends MenuTreeItem>(
  items: readonly T[],
  localId: string,
): string | null {
  const it = items.find((i) => i.local_id === localId);
  if (!it) return null;
  const siblings = sortedSiblings(items, it.parent_local_id);
  const idx = siblings.findIndex((s) => s.local_id === localId);
  return idx > 0 ? siblings[idx - 1].local_id : null;
}

/**
 * Cofnięcie w lewo: pozycja wychodzi poziom wyżej i ląduje TUŻ ZA swoim
 * dotychczasowym rodzicem (a nie na końcu rzędu - inaczej gubi kontekst).
 */
export function outdentMenuItem<T extends MenuTreeItem>(
  items: readonly T[],
  localId: string,
): readonly T[] {
  const it = items.find((i) => i.local_id === localId);
  if (!it || !it.parent_local_id) return items;
  const parent = items.find((i) => i.local_id === it.parent_local_id);
  if (!parent) return items;
  const grandParent = parent.parent_local_id;

  const grandSiblings = sortedSiblings(items, grandParent);
  const parentIdx = grandSiblings.findIndex((s) => s.local_id === parent.local_id);
  const insertAt = parentIdx + 1;

  const oldSiblings = renumber(
    sortedSiblings(items, it.parent_local_id).filter((s) => s.local_id !== localId),
  );
  const updatedItem = { ...it, parent_local_id: grandParent };
  const reorderedGrand = renumber([
    ...grandSiblings.slice(0, insertAt),
    updatedItem,
    ...grandSiblings.slice(insertAt),
  ]);
  const others = items.filter(
    (i) =>
      i.parent_local_id !== it.parent_local_id &&
      i.parent_local_id !== grandParent &&
      i.local_id !== localId,
  );
  return [...others, ...oldSiblings, ...reorderedGrand];
}

/** Usuwa pozycję RAZEM z całym poddrzewem - osierocone dzieci byłyby gorsze. */
export function removeMenuSubtree<T extends MenuTreeItem>(
  items: readonly T[],
  localId: string,
): readonly T[] {
  const doomed = descendantIds(items, localId);
  return items.filter((it) => !doomed.has(it.local_id));
}

/** Zmiana pojedynczego pola pozycji (inline edytor). */
export function updateMenuItemById<T extends MenuTreeItem>(
  items: readonly T[],
  localId: string,
  patch: Partial<T>,
): readonly T[] {
  return items.map((it) => (it.local_id === localId ? { ...it, ...patch } : it));
}

/** Ładunek nowej pozycji dokładanej z panelu „Dodaj" (strona/wpis/tag/link). */
export interface MenuItemDraft {
  item_type: MenuItemType;
  ref_id: string | null;
  label_pl: string;
  label_en: string;
  href: string;
}

/**
 * Dokłada pozycje na KONIEC najwyższego poziomu. Generator identyfikatorów
 * jest wstrzykiwany, żeby test nie zależał od `crypto.randomUUID`.
 */
export function appendMenuItems(
  items: readonly MenuClientItem[],
  drafts: readonly MenuItemDraft[],
  makeId: () => string,
): readonly MenuClientItem[] {
  const nextPos = items.filter((i) => i.parent_local_id === null).length;
  const additions: MenuClientItem[] = drafts.map((draft, idx) => ({
    local_id: makeId(),
    parent_local_id: null,
    position: nextPos + idx,
    item_type: draft.item_type,
    ref_id: draft.ref_id,
    label_pl: draft.label_pl,
    label_en: draft.label_en,
    href: draft.href,
    target: "_self",
    css_class: "",
    icon: "",
    mega_enabled: false,
    mega_config: DEFAULT_MEGA_CONFIG,
  }));
  return [...items, ...additions];
}

/**
 * Payload zapisu. `label_pl` jest w schemacie WYMAGANE (min 1 znak), więc
 * pozycja bez nazwy dostaje adres, a w ostateczności etykietę zastępczą -
 * podaje ją wywołujący ze słownika, bo ta wartość LĄDUJE W BAZIE i pokaże się
 * czytelnikowi w nawigacji.
 */
export function toSavePayload(
  items: readonly MenuClientItem[],
  fallbackLabel: string,
): MenuItemInput[] {
  return items.map((it) => ({
    local_id: it.local_id,
    parent_local_id: it.parent_local_id,
    position: it.position,
    item_type: it.item_type,
    label_pl: it.label_pl || it.href || fallbackLabel,
    label_en: it.label_en,
    ref_id: it.ref_id,
    href: it.href,
    target: it.target,
    css_class: it.css_class,
    icon: it.icon,
    mega_enabled: it.mega_enabled,
    mega_config: it.mega_config,
  }));
}

/**
 * Strefa upuszczenia z pionowej pozycji kursora nad wierszem (0 = górna
 * krawędź, 1 = dolna). Górne 30% to „przed", dolne 30% to „za", środek
 * zagnieżdża - chyba że pozycja jest już na ostatnim dozwolonym poziomie,
 * wtedy środek degraduje do „za" zamiast zapraszać do ruchu, który i tak
 * zostałby odrzucony.
 */
export function dropZoneForOffset(ratio: number, depth: number): MenuDropMode {
  if (ratio < 0.3) return "before";
  if (ratio > 0.7) return "after";
  return depth + 1 < MAX_MENU_DEPTH ? "child" : "after";
}
