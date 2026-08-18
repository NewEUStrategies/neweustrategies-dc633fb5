// Skróty klawiaturowe historii edycji (undo/redo), wyjęte 1:1 z
// `usePostEditorForm`.
//
// Reguła jest czysta, ale w hooku dało się ją wywołać wyłącznie prawdziwym
// zdarzeniem `keydown` na `window`. Wyprowadzenie jej tutaj pozwala sprawdzić
// wszystkie kombinacje wprost - w tym `Ctrl+Y`, czyli wariant, którego redaktorzy
// przychodzący z Worda używają najczęściej, a który najłatwiej zgubić przy
// refaktorze warunku.

/** Minimalny kształt zdarzenia klawiatury, jakiego potrzebuje ta reguła. */
export interface HistoryKeyEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

export type HistoryAction = "undo" | "redo";

/**
 * Rozpoznaje skrót historii:
 *   * Ctrl+Z / Cmd+Z        -> cofnij
 *   * Shift+Ctrl+Z / Cmd+⇧Z -> ponów
 *   * Ctrl+Y / Cmd+Y        -> ponów (wariant z Windowsa/Worda)
 *
 * `null` znaczy „to nie jest skrót historii" - wywołujący NIE MOŻE wtedy wołać
 * `preventDefault()`, bo zabrałby przeglądarce zwykłe skróty (Ctrl+C, Ctrl+S).
 * Rozpoznanie jest niezależne od wielkości litery, bo z Shiftem `event.key`
 * przychodzi jako „Z".
 */
export function historyShortcut(event: HistoryKeyEvent): HistoryAction | null {
  if (!event.ctrlKey && !event.metaKey) return null;
  const key = event.key.toLowerCase();
  if (key === "z" && !event.shiftKey) return "undo";
  if ((key === "z" && event.shiftKey) || key === "y") return "redo";
  return null;
}
