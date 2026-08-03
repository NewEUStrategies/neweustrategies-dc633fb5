// Warstwa DOM zaznaczenia blokowego: tłumaczy natywną selekcję przeglądarki
// (Selection/Range) na końce zaznaczenia BLOKOWEGO i przełącza kanwę w tryb
// blokowy. Semantyka zakresów żyje w `crossSelection.ts` - tutaj jest tylko
// most do DOM-u, dzięki czemu obie warstwy testujemy osobno.
//
// Dlaczego przez DOM, a nie przez API edytora: każdy blok ma własną instancję
// edytora (TipTap/ProseMirror, contentEditable, textarea), więc zaznaczenie
// przechodzące MIĘDZY blokami nie istnieje w żadnym z nich - jedynym wspólnym
// układem odniesienia jest drzewo dokumentu kanwy.

import type { BlockSelectionEnds } from "./crossSelection";

/**
 * Pola formularza i treści edytowalne - tam zaznaczenie zostaje natywne.
 * `isContentEditable` jest prawdziwe dla CAŁEGO poddrzewa hosta edycji (klik
 * w `<strong>` wewnątrz akapitu też jest „w treści"), a `closest` domyka
 * przypadki węzłów wewnątrz kontrolek (np. `<option>` w `<select>`).
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el !== "object") return false;
  if (el.isContentEditable === true) return true;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return typeof el.closest === "function" && el.closest("input, textarea, select") !== null;
}

/**
 * Id bloku NAJWYŻSZEGO poziomu (bezpośredniego dziecka kanwy), w którym leży
 * węzeł. Zagnieżdżenia (`group`/`columns`) mają własne `data-block-id`, więc
 * idziemy w górę aż do kanwy i bierzemy NAJBARDZIEJ ZEWNĘTRZNY - zaznaczenie
 * blokowe operuje na blokach top-level, tak jak schowek i List View.
 */
export function topLevelBlockIdFromNode(node: Node | null, root: HTMLElement): string | null {
  if (!node) return null;
  let el: HTMLElement | null =
    node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;
  let found: string | null = null;
  while (el && el !== root) {
    if (!root.contains(el)) return null; // węzeł spoza tej kanwy
    const id = el.getAttribute("data-block-id");
    if (id) found = id;
    el = el.parentElement;
  }
  return el === root ? found : null;
}

/**
 * Końce natywnej selekcji przetłumaczone na bloki top-level. `null`, gdy
 * selekcja jest zwinięta, pusta albo leży poza kanwą. Kolejność kotwica ->
 * ognisko odzwierciedla KIERUNEK zaznaczania (przeciąganie w górę daje
 * kotwicę pod ogniskiem), żeby Shift+strzałki kontynuowały ruch użytkownika.
 */
export function domSelectionEnds(
  root: HTMLElement,
  selection: Selection | null,
): BlockSelectionEnds | null {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const anchorId =
    topLevelBlockIdFromNode(selection.anchorNode, root) ??
    topLevelBlockIdFromNode(range.startContainer, root);
  const focusId =
    topLevelBlockIdFromNode(selection.focusNode, root) ??
    topLevelBlockIdFromNode(range.endContainer, root);
  if (!anchorId || !focusId) return null;
  return { anchorId, focusId };
}

/** Usuwa natywną selekcję tekstu (zaznaczenie blokowe ją zastępuje). */
export function clearDomSelection(): void {
  if (typeof window === "undefined") return;
  window.getSelection()?.removeAllRanges();
}

/**
 * Przejście w TRYB BLOKOWY: karetka znika z edytora inline, a fokus wraca na
 * kanwę (`tabIndex=-1`). Dzięki temu zdarzenia klawiatury i schowka mają
 * target wewnątrz `[data-block-canvas]` - Firefox/Safari nie gwarantują
 * `copy`/`keydown` przy fokusie na `<body>` (ten sam wzorzec co w WP).
 */
export function enterBlockSelectionMode(root: HTMLElement | null): void {
  if (typeof document === "undefined") return;
  const active = document.activeElement;
  if (active instanceof HTMLElement && root?.contains(active) && active !== root) active.blur();
  clearDomSelection();
  root?.focus({ preventScroll: true });
}
