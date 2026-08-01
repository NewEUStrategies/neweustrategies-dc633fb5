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

export type CaretPosition = "start" | "end";

const EDITABLE_SELECTOR = [
  '[contenteditable="true"]',
  "textarea",
  'input[type="text"]',
  "input:not([type])",
].join(", ");

/** Ustawia fokus + karetkę w edytowalnym elemencie bloku. `false` gdy bloku
 *  jeszcze nie ma w DOM (wołający może ponowić) lub nie ma pola tekstowego. */
export function focusBlockEditable(blockId: string, pos: CaretPosition): boolean {
  if (typeof document === "undefined") return true;
  const host = document.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(blockId)}"]`);
  if (!host) return false;
  const editable = host.querySelector<HTMLElement>(EDITABLE_SELECTOR);
  if (!editable) return true; // blok bez pola tekstowego (obraz, embed…) - nic do fokusowania

  editable.focus();
  if (editable instanceof HTMLTextAreaElement || editable instanceof HTMLInputElement) {
    const at = pos === "end" ? editable.value.length : 0;
    try {
      editable.setSelectionRange(at, at);
    } catch {
      // input types bez selekcji - sam focus wystarczy
    }
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

/** Ponawia fokus przez kilka klatek, aż świeżo wstawiony blok się zamontuje. */
export function requestBlockFocus(blockId: string, pos: CaretPosition): void {
  if (typeof window === "undefined") return;
  let attempts = 0;
  const tick = () => {
    if (focusBlockEditable(blockId, pos)) return;
    attempts += 1;
    if (attempts < MAX_ATTEMPTS) window.requestAnimationFrame(tick);
  };
  window.requestAnimationFrame(tick);
}

/** Typy bloków, w których po wstawieniu ma się dać od razu pisać. */
const TEXT_ENTRY_TYPES = new Set([
  "paragraph",
  "heading",
  "list",
  "quote",
  "code",
  "html",
  "preformatted",
  "verse",
  "pullquote",
  "callout",
]);

export function isTextEntryBlockType(type: string): boolean {
  return TEXT_ENTRY_TYPES.has(type);
}
