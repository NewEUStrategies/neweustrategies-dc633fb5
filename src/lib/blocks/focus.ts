// Przenoszenie karetki między blokami (zachowanie WordPress Gutenberg):
// Enter dzieli akapit i pisze się dalej w nowym bloku, Backspace na pustym
// bloku wraca karetką na koniec poprzedniego, transformacja (markdown / slash)
// zostawia karetkę w nowym bloku.
//
// Mechanizm celowo działa na DOM (data-block-id -> pierwszy edytowalny
// element), a nie na API konkretnego edytora: bloki mają różne implementacje
// (TipTap/ProseMirror, contentEditable, textarea, input) i wszystkie reagują
// poprawnie na ustawienie natywnej selekcji + focus. Nowy blok montuje się
// dopiero po commicie Reacta, więc próba jest ponawiana przez kilka klatek.

/**
 * Umiejscowienie karetki: początek, koniec albo OFFSET znakowy w tekście
 * (liczony jak `textContent` - scalanie bloków celuje w punkt złączenia).
 */
export type CaretPlacement = "start" | "end" | number;

const EDITABLE_SELECTOR = [
  '[contenteditable="true"]',
  "textarea",
  'input[type="text"]',
  "input:not([type])",
].join(", ");

/** Ustawia DOM-ową selekcję na znakowym offsecie wewnątrz contentEditable. */
function setCaretAtTextOffset(editable: HTMLElement, offset: number): void {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  const walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, offset);
  let node = walker.nextNode() as Text | null;
  while (node) {
    const len = node.nodeValue?.length ?? 0;
    if (remaining <= len) {
      range.setStart(node, remaining);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    remaining -= len;
    node = walker.nextNode() as Text | null;
  }
  // Offset poza treścią (lub brak węzłów tekstowych) - koniec zawartości.
  range.selectNodeContents(editable);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * Ustawia fokus + karetkę w edytowalnym elemencie bloku. `false` gdy bloku
 * (lub jego pola tekstowego) jeszcze nie ma w DOM - wołający ponawia.
 *
 * Wybór pola: najpierw jawny marker `[data-block-editable]` (bloki z wieloma
 * polami - np. `code` ma input języka PRZED textarea kodu - wskazują nim
 * właściwe pole), dopiero potem heurystyka "pierwszy edytowalny w poddrzewie".
 */
export function focusBlockEditable(blockId: string, pos: CaretPlacement): boolean {
  if (typeof document === "undefined") return true;
  // Id bloków to `b_[a-z0-9]+`; CSS.escape defensywnie, z fallbackiem dla
  // środowisk testowych bez implementacji.
  const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(blockId) : blockId;
  const host = document.querySelector<HTMLElement>(`[data-block-id="${escaped}"]`);
  if (!host) return false;
  const marked = host.querySelector<HTMLElement>("[data-block-editable]");
  const scope = marked ?? host;
  const editable = scope.matches(EDITABLE_SELECTOR)
    ? scope
    : scope.querySelector<HTMLElement>(EDITABLE_SELECTOR);
  if (!editable) return false; // pole montuje się po hoście (TipTap) - ponów

  editable.focus();
  if (editable instanceof HTMLTextAreaElement || editable instanceof HTMLInputElement) {
    const max = editable.value.length;
    const at = pos === "end" ? max : pos === "start" ? 0 : Math.min(Math.max(pos, 0), max);
    try {
      editable.setSelectionRange(at, at);
    } catch {
      // input types bez selekcji - sam focus wystarczy
    }
    return true;
  }

  if (typeof pos === "number") {
    setCaretAtTextOffset(editable, pos);
    return true;
  }
  const selection = window.getSelection();
  if (!selection) return true;
  const range = document.createRange();
  range.selectNodeContents(editable);
  range.collapse(pos === "start");
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

const MAX_ATTEMPTS = 30; // ~0,5 s przy 60 fps - nowy blok montuje się znacznie szybciej

/** Czas ważności oczekującego fokusu - okno na wyścig z `setContent` TipTapa. */
const PENDING_FOCUS_TTL_MS = 800;

interface PendingFocus {
  id: string;
  pos: CaretPlacement;
  until: number;
}

/**
 * Ostatnie żądanie fokusu. `setContent` TipTapa (synchronizacja treści po
 * scaleniu/undo) mapuje selekcję na KONIEC dokumentu i może wygrać wyścig
 * z pętlą rAF - edytory inline po własnym `setContent` wołają
 * `reapplyPendingBlockFocus`, żeby karetka wróciła w żądane miejsce.
 */
let pendingFocus: PendingFocus | null = null;

/** Ponawia fokus przez kilka klatek, aż świeżo wstawiony blok się zamontuje. */
export function requestBlockFocus(blockId: string, pos: CaretPlacement): void {
  if (typeof window === "undefined") return;
  pendingFocus = { id: blockId, pos, until: Date.now() + PENDING_FOCUS_TTL_MS };
  let attempts = 0;
  const tick = () => {
    if (pendingFocus?.id !== blockId) return; // nowsze żądanie przejęło karetkę
    if (focusBlockEditable(blockId, pos)) return;
    attempts += 1;
    if (attempts < MAX_ATTEMPTS) window.requestAnimationFrame(tick);
  };
  window.requestAnimationFrame(tick);
}

/**
 * Ponowne nałożenie oczekującego fokusu na blok - wołane przez edytory inline
 * bezpośrednio po ich `setContent`, aby deterministycznie wygrać wyścig
 * o pozycję karetki niezależnie od kolejności rAF vs efekty Reacta.
 */
export function reapplyPendingBlockFocus(blockId: string): void {
  if (!pendingFocus || pendingFocus.id !== blockId) return;
  if (Date.now() > pendingFocus.until) {
    pendingFocus = null;
    return;
  }
  focusBlockEditable(blockId, pendingFocus.pos);
}

/**
 * Typy bloków, w których po wstawieniu ma się dać od razu pisać.
 * Celowo BEZ "html" - jego edycja żyje w sidebarze (kanwa to sam podgląd),
 * a heurystyka mogłaby złapać pole wewnątrz sanitizowanego HTML-a użytkownika.
 */
const TEXT_ENTRY_TYPES = new Set([
  "paragraph",
  "heading",
  "list",
  "quote",
  "code",
  "preformatted",
  "verse",
  "pullquote",
  "callout",
  "details",
]);

export function isTextEntryBlockType(type: string): boolean {
  return TEXT_ENTRY_TYPES.has(type);
}
