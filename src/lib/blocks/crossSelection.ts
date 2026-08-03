// Zaznaczenie w POPRZEK bloków (cross-block selection) - parytet z WordPress
// Gutenberg (pakiet `writing-flow`).
//
// Model zaznaczenia blokowego to para KOTWICA (nieruchomy koniec) + OGNISKO
// (ruchomy koniec) oraz wyliczony z nich CIĄGŁY zakres w kolejności dokumentu:
//   - Shift+strzałki przesuwają OGNISKO (rozszerzają i zawężają zakres),
//   - Shift+Home/End skacze ogniskiem do krawędzi dokumentu,
//   - zwykłe strzałki (tryb blokowy) zwijają zaznaczenie do jednego bloku,
//   - pisanie znaku przy zaznaczeniu >= 2 bloków zastępuje je akapitem.
//
// Moduł jest CZYSTY (bez DOM i Reacta) - warstwa DOM (`selectionDom.ts`) oraz
// hook kanwy (`useCrossBlockSelection`) tylko go wołają, dzięki czemu cała
// semantyka zaznaczenia jest testowalna jednostkowo.

import { blockRange } from "./selection";

/** Kierunek ruchu ogniska: -1 = w górę dokumentu, 1 = w dół. */
export type SelectionDirection = -1 | 1;

/** Końce zaznaczenia blokowego (bez wyliczonego zakresu). */
export interface BlockSelectionEnds {
  /** Blok, w którym zaznaczenie się zaczęło - nie rusza się przy Shift. */
  readonly anchorId: string;
  /** Ruchomy koniec zaznaczenia (przesuwany strzałkami / Shift+klikiem). */
  readonly focusId: string;
}

/** Końce + wyliczony ciągły zakres bloków w kolejności dokumentu. */
export interface BlockSelectionRange extends BlockSelectionEnds {
  readonly ids: readonly string[];
}

/** Zapamiętane końce zaznaczenia - mogą być puste (brak zaznaczenia). */
export interface BlockSelectionHint {
  readonly anchorId?: string | null;
  readonly focusId?: string | null;
}

/** Zdarzenie klawiatury zredukowane do pól, których potrzebuje semantyka. */
export interface SelectionKeyEvent {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
}

/** Zakres od kotwicy do ogniska; `null`, gdy żaden koniec nie istnieje. */
export function makeSelectionRange(
  ids: readonly string[],
  anchorId: string,
  focusId: string,
): BlockSelectionRange | null {
  const anchorIdx = ids.indexOf(anchorId);
  const focusIdx = ids.indexOf(focusId);
  if (anchorIdx < 0 && focusIdx < 0) return null;
  // Kotwica mogła zniknąć (np. blok usunięty w międzyczasie) - wtedy
  // zaznaczenie zwija się do ogniska i odwrotnie.
  const anchor = anchorIdx >= 0 ? anchorId : focusId;
  const focus = focusIdx >= 0 ? focusId : anchorId;
  return { anchorId: anchor, focusId: focus, ids: blockRange(ids, anchor, focus) };
}

/**
 * Shift+strzałka: przesuwa OGNISKO o jeden blok w podanym kierunku.
 * `null`, gdy nie ma dokąd (krawędź dokumentu) - wołający nie zmienia stanu.
 */
export function extendSelection(
  ids: readonly string[],
  ends: BlockSelectionEnds,
  dir: SelectionDirection,
): BlockSelectionRange | null {
  const focusIdx = ids.indexOf(ends.focusId);
  if (focusIdx < 0) return null;
  const nextIdx = focusIdx + dir;
  if (nextIdx < 0 || nextIdx >= ids.length) return null;
  return makeSelectionRange(ids, ends.anchorId, ids[nextIdx]);
}

/**
 * Shift+Home / Shift+End: ognisko skacze do krawędzi dokumentu (zaznaczenie
 * od kotwicy do pierwszego / ostatniego bloku).
 */
export function extendSelectionToEdge(
  ids: readonly string[],
  ends: BlockSelectionEnds,
  dir: SelectionDirection,
): BlockSelectionRange | null {
  if (ids.length === 0) return null;
  const edgeId = dir < 0 ? ids[0] : ids[ids.length - 1];
  if (edgeId === ends.focusId) return null; // ognisko już na krawędzi
  return makeSelectionRange(ids, ends.anchorId, edgeId);
}

/**
 * Zwykła strzałka w trybie blokowym: zaznaczenie zwija się do JEDNEGO bloku
 * sąsiadującego z dotychczasowym ogniskiem (jak w WP - wyjście z zaznaczenia
 * wielokrotnego przez nawigację).
 */
export function moveSelection(
  ids: readonly string[],
  ends: BlockSelectionEnds,
  dir: SelectionDirection,
): BlockSelectionRange | null {
  const focusIdx = ids.indexOf(ends.focusId);
  if (focusIdx < 0) return null;
  const nextIdx = Math.min(Math.max(focusIdx + dir, 0), ids.length - 1);
  const target = ids[nextIdx];
  return { anchorId: target, focusId: target, ids: [target] };
}

/**
 * Odtwarza końce zaznaczenia z bieżącej listy zaznaczonych id. `hint` to
 * ostatnio zapamiętane końce (kanwa) - używamy ich tylko wtedy, gdy nadal
 * należą do zaznaczenia; inaczej zaznaczenie mogło przyjść z innego źródła
 * (List View, przywrócenie historii) i końce wyznaczają skrajne bloki.
 */
export function currentSelectionRange(
  ids: readonly string[],
  selectedIds: readonly string[],
  hint: BlockSelectionHint = {},
): BlockSelectionRange | null {
  const inSelection = new Set(selectedIds);
  const ordered = ids.filter((id) => inSelection.has(id));
  if (ordered.length === 0) return null;
  const anchorId = hint.anchorId && inSelection.has(hint.anchorId) ? hint.anchorId : ordered[0];
  const focusId =
    hint.focusId && inSelection.has(hint.focusId) ? hint.focusId : ordered[ordered.length - 1];
  return { anchorId, focusId, ids: ordered };
}

/** Porównanie zaznaczeń - chroni przed zbędnym setState w pętli `selectionchange`. */
export function isSameSelection(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Czy klawisz wprowadza ZNAK (a nie steruje edytorem)? Przy zaznaczeniu wielu
 * bloków taki klawisz zastępuje je akapitem - dokładnie jak `onBeforeInput`
 * w WP. Modyfikatory (Ctrl/Cmd/Alt) i klawisze funkcyjne są wykluczone;
 * kompozycja IME idzie własną ścieżką i celowo nie jest tu obsługiwana.
 */
export function isPrintableKey(event: SelectionKeyEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  // Nazwy klawiszy specjalnych mają > 1 znak ("Enter", "ArrowUp", "Tab"...).
  return [...event.key].length === 1;
}
