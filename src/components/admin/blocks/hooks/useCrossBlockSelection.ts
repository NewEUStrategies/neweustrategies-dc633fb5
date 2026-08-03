// Zaznaczenie w POPRZEK bloków (cross-block selection) - domknięcie parytetu
// z WordPress Gutenberg (`writing-flow`). Hook jest JEDYNYM właścicielem
// zaznaczenia blokowego kanwy; kanwa woła jego kontroler zamiast samodzielnie
// składać listy id.
//
// Obsługiwane przepływy:
//   1. PRZECIĄGANIE MYSZĄ przez granicę bloku - natywna selekcja tekstu
//      zamienia się w zaznaczenie CAŁYCH bloków (WP robi to samo w
//      `useSelectionObserver`); po puszczeniu przycisku karetka znika,
//      a fokus wraca na kanwę, więc Ctrl+C/X i Delete działają na blokach.
//   2. SHIFT+STRZAŁKI - przesuwają ruchomy koniec zaznaczenia; wywołane
//      z wnętrza akapitu/nagłówka na krawędzi treści eskalują zaznaczenie
//      tekstowe do blokowego (`extendFromBlock`).
//   3. SHIFT+HOME/END - zaznaczenie od kotwicy do krawędzi dokumentu.
//   4. Zwykłe strzałki w trybie blokowym - zwijają zaznaczenie do jednego bloku.
//   5. PISANIE przy zaznaczeniu >= 2 bloków - zastępuje je akapitem
//      (odpowiednik `onBeforeInput` w WP; kompozycja IME celowo poza zakresem).
//
// Zdarzenia globalne przechodzą przez arbitraż `canvasStack`, więc zagnieżdżona
// kanwa (edytor bloków w modalu buildera) nie rusza zaznaczenia kanwy pod nią.

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { BlocksDoc } from "@/lib/blocks/types";
import {
  currentSelectionRange,
  extendSelection,
  extendSelectionToEdge,
  isPrintableKey,
  isSameSelection,
  makeSelectionRange,
  moveSelection,
  type BlockSelectionEnds,
  type BlockSelectionHint,
  type BlockSelectionRange,
  type SelectionDirection,
} from "@/lib/blocks/crossSelection";
import {
  domSelectionEnds,
  enterBlockSelectionMode,
  isEditableTarget,
} from "@/lib/blocks/selectionDom";
import { toggleInSelection } from "@/lib/blocks/selection";
import { canvasOwnsEvent, useCanvasStack, type CanvasRef } from "./canvasStack";

/** Atrybut kanwy na czas przeciągania - CSS gasi natywne podświetlenie tekstu. */
const MULTI_SELECTING_ATTR = "data-multi-selecting";

export interface UseCrossBlockSelectionArgs {
  /** Root kanwy (element z `data-block-canvas`, `tabIndex=-1`). */
  rootRef: CanvasRef;
  /** Aktualny dokument (referencja aktualizowana optymistycznie przez kanwę). */
  docRef: React.MutableRefObject<BlocksDoc>;
  /** Aktywny blok (edytowany treściowo). */
  activeIdRef: React.MutableRefObject<string | null>;
  /** Zaznaczenie wielokrotne - referencja czytana przez handlery zdarzeń. */
  selectedIdsRef: React.MutableRefObject<readonly string[]>;
  /** Zapis zaznaczenia do stanu rodzica (dzieli je kanwa i List View). */
  onSelectedIdsChange: (ids: readonly string[]) => void;
  /** Ustawienie/wyzerowanie aktywnego bloku. */
  onSelect: (id: string | null) => void;
  /** Zastąpienie zaznaczonych bloków akapitem z wpisanym znakiem (WP). */
  replaceSelection: (typed: string) => void;
}

/** Kontroler zaznaczenia blokowego udostępniany kanwie. */
export interface BlockSelectionController {
  /** Klik bez modyfikatorów - nowa kotwica, zaznaczenie blokowe czyszczone. */
  anchorTo: (id: string) => void;
  /** Shift+klik - zakres od kotwicy do wskazanego bloku (`false` = brak zmiany). */
  extendTo: (id: string) => boolean;
  /** Zaznaczenie gotowego zakresu (np. świeżych kopii po Ctrl+Shift+D). */
  selectRange: (fromId: string, toId: string) => void;
  /** Ctrl/Cmd+klik - przełączenie pojedynczego bloku w zaznaczeniu. */
  toggle: (id: string) => void;
  /** Ctrl/Cmd+A (druga eskalacja) - wszystkie bloki dokumentu. */
  selectAll: () => void;
  /** Escape / klik poza zaznaczeniem - czyszczenie (bez zabierania fokusu). */
  clear: () => void;
  /** Shift+strzałka z wnętrza edytora inline na krawędzi treści. */
  extendFromBlock: (blockId: string, dir: SelectionDirection) => boolean;
}

interface DragState {
  /** Czy przeciąganie zamieniło się już w zaznaczenie blokowe. */
  multi: boolean;
}

export function useCrossBlockSelection(args: UseCrossBlockSelectionArgs): BlockSelectionController {
  const {
    rootRef,
    docRef,
    activeIdRef,
    selectedIdsRef,
    onSelectedIdsChange,
    onSelect,
    replaceSelection,
  } = args;

  // Końce zaznaczenia (kotwica + ognisko). Kotwicą jest ostatni blok kliknięty
  // bez modyfikatorów albo blok, z którego wyszła eskalacja Shift+strzałką.
  const endsRef = useRef<{ anchorId: string | null; focusId: string | null }>({
    anchorId: null,
    focusId: null,
  });
  const dragRef = useRef<DragState | null>(null);

  useCanvasStack(rootRef);

  const docIds = useCallback((): string[] => docRef.current.blocks.map((b) => b.id), [docRef]);

  /**
   * Jedyne miejsce zapisu zaznaczenia. `selectedIdsRef` aktualizujemy
   * OPTYMISTYCZNIE (jak `docRef` w kanwie), żeby sekwencyjne operacje w jednym
   * ticku - np. Shift+strzałka trzymana na repeat - składały się na sobie
   * zamiast czytać stan sprzed re-renderu.
   */
  const commit = useCallback(
    (ids: readonly string[], ends: BlockSelectionHint | null) => {
      endsRef.current = { anchorId: ends?.anchorId ?? null, focusId: ends?.focusId ?? null };
      const next = [...ids];
      if (!isSameSelection(next, selectedIdsRef.current)) {
        selectedIdsRef.current = next;
        onSelectedIdsChange(next);
      }
      if (next.length) onSelect(null);
    },
    [selectedIdsRef, onSelectedIdsChange, onSelect],
  );

  const applyRange = useCallback(
    (range: BlockSelectionRange) => commit(range.ids, range),
    [commit],
  );

  /** Bieżące końce zaznaczenia; fallback na aktywny blok (pisanie w treści). */
  const ends = useCallback((): BlockSelectionEnds | null => {
    const ids = docIds();
    const range = currentSelectionRange(ids, selectedIdsRef.current, endsRef.current);
    if (range) return range;
    const active = activeIdRef.current;
    return active ? { anchorId: active, focusId: active } : null;
  }, [docIds, selectedIdsRef, activeIdRef]);

  const anchorTo = useCallback(
    (id: string) => {
      endsRef.current = { anchorId: id, focusId: id };
      if (selectedIdsRef.current.length) {
        selectedIdsRef.current = [];
        onSelectedIdsChange([]);
      }
      onSelect(id);
    },
    [selectedIdsRef, onSelectedIdsChange, onSelect],
  );

  const extendTo = useCallback(
    (id: string): boolean => {
      const anchor = endsRef.current.anchorId ?? activeIdRef.current;
      if (!anchor || anchor === id) return false;
      const range = makeSelectionRange(docIds(), anchor, id);
      if (!range) return false;
      enterBlockSelectionMode(rootRef.current);
      applyRange(range);
      return true;
    },
    [activeIdRef, docIds, rootRef, applyRange],
  );

  const selectRange = useCallback(
    (fromId: string, toId: string) => {
      const range = makeSelectionRange(docIds(), fromId, toId);
      if (!range) return;
      enterBlockSelectionMode(rootRef.current);
      applyRange(range);
    },
    [docIds, rootRef, applyRange],
  );

  const toggle = useCallback(
    (id: string) => {
      const base = selectedIdsRef.current.length
        ? selectedIdsRef.current
        : activeIdRef.current
          ? [activeIdRef.current]
          : [];
      const next = toggleInSelection(docIds(), base, id);
      enterBlockSelectionMode(rootRef.current);
      // Zaznaczenie punktowe bywa NIECIĄGŁE - kotwicę zostawiamy pierwszą,
      // a ognisko przesuwamy na ostatnio kliknięty blok (dalsze Shift+strzałki
      // ruszają właśnie nim, jak w WP).
      commit(next, { anchorId: endsRef.current.anchorId ?? id, focusId: id });
    },
    [selectedIdsRef, activeIdRef, docIds, rootRef, commit],
  );

  const selectAll = useCallback(() => {
    const ids = docIds();
    enterBlockSelectionMode(rootRef.current);
    commit(ids, ids.length ? { anchorId: ids[0], focusId: ids[ids.length - 1] } : null);
  }, [docIds, rootRef, commit]);

  const clear = useCallback(() => commit([], null), [commit]);

  const extendFromBlock = useCallback(
    (blockId: string, dir: SelectionDirection): boolean => {
      const ids = docIds();
      const base = selectedIdsRef.current.length
        ? currentSelectionRange(ids, selectedIdsRef.current, endsRef.current)
        : { anchorId: blockId, focusId: blockId };
      if (!base) return false;
      const next = extendSelection(ids, base, dir);
      if (!next) return false;
      enterBlockSelectionMode(rootRef.current);
      applyRange(next);
      return true;
    },
    [docIds, selectedIdsRef, rootRef, applyRange],
  );

  // 1. Przeciąganie myszą przez granicę bloku -> zaznaczenie blokowe.
  useEffect(() => {
    const setMultiSelecting = (on: boolean) => {
      const root = rootRef.current;
      if (!root) return;
      if (on) root.setAttribute(MULTI_SELECTING_ATTR, "true");
      else root.removeAttribute(MULTI_SELECTING_ATTR);
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || event.isPrimary === false) return;
      const root = rootRef.current;
      if (!root || !canvasOwnsEvent(rootRef, event.target)) return;
      const el = event.target as Node | null;
      if (!el || !root.contains(el)) return;
      dragRef.current = { multi: false };
    };

    const onSelectionChange = () => {
      const drag = dragRef.current;
      const root = rootRef.current;
      if (!drag || !root) return;
      const spanned = domSelectionEnds(root, window.getSelection());
      if (!spanned || spanned.anchorId === spanned.focusId) {
        // Powrót do jednego bloku - oddajemy zaznaczenie natywnemu tekstowi.
        if (drag.multi) {
          drag.multi = false;
          setMultiSelecting(false);
          commit([], null);
        }
        return;
      }
      const range = makeSelectionRange(docIds(), spanned.anchorId, spanned.focusId);
      if (!range) return;
      drag.multi = true;
      setMultiSelecting(true);
      applyRange(range);
    };

    const finishDrag = () => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag?.multi) return;
      setMultiSelecting(false);
      // Karetka znika, fokus wraca na kanwę - dalsze Ctrl+C/X/Delete i
      // Shift+strzałki działają na blokach, nie na tekście.
      enterBlockSelectionMode(rootRef.current);
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("pointerup", finishDrag, true);
    document.addEventListener("pointercancel", finishDrag, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("pointerup", finishDrag, true);
      document.removeEventListener("pointercancel", finishDrag, true);
    };
  }, [rootRef, docIds, applyRange, commit]);

  // 2-5. Klawiatura trybu blokowego (poza polami tekstowymi).
  useEffect(() => {
    /**
     * Klawiatura należy do kanwy tylko wtedy, gdy zdarzenie przyszło Z NIEJ
     * albo gdy nic nie ma fokusu (`body`/dokument - stan po wejściu w tryb
     * blokowy w przeglądarkach, które nie utrzymują fokusu na wrapperze).
     * Sam arbitraż zagnieżdżeń nie wystarcza: przy zaznaczonych blokach fokus
     * może siedzieć na przycisku sidebara, a wtedy wpisany znak nie może
     * podmienić treści dokumentu.
     */
    const ownsKeyboard = (target: EventTarget | null): boolean => {
      if (!canvasOwnsEvent(rootRef, target)) return false;
      const el = target as Node | null;
      if (el && rootRef.current?.contains(el)) return true;
      return el === null || el === document.body || el === document;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (isEditableTarget(event.target)) return; // edytory inline mają swoją obsługę
      if (!ownsKeyboard(event.target)) return;

      const ids = docIds();
      if (ids.length === 0) return;
      const selected = selectedIdsRef.current;
      const base = ends();

      if (event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const dir: SelectionDirection | null =
          event.key === "ArrowUp" || event.key === "Home"
            ? -1
            : event.key === "ArrowDown" || event.key === "End"
              ? 1
              : null;
        if (dir !== null) {
          if (!base) return;
          event.preventDefault(); // blokujemy przewijanie strony w trybie blokowym
          const next =
            event.key === "Home" || event.key === "End"
              ? extendSelectionToEdge(ids, base, dir)
              : extendSelection(ids, base, dir);
          if (next) applyRange(next);
          return;
        }
      }

      if (selected.length === 0) return;

      if (!event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          if (!base) return;
          event.preventDefault();
          const next = moveSelection(ids, base, event.key === "ArrowUp" ? -1 : 1);
          if (next) applyRange(next);
          return;
        }
      }

      // Pisanie po zaznaczeniu WIELU bloków zastępuje je akapitem (WP).
      // Jeden zaznaczony blok celowo NIE jest nadpisywany - to zbyt łatwa
      // droga do utraty treści przy przypadkowym klawiszu.
      if (selected.length < 2) return;
      if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        replaceSelection("");
        return;
      }
      if (isPrintableKey(event)) {
        event.preventDefault();
        replaceSelection(event.key);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [rootRef, docIds, selectedIdsRef, ends, applyRange, replaceSelection]);

  // Sprzątanie atrybutu przy odmontowaniu (kanwa może zniknąć w trakcie drag).
  useEffect(
    () => () => {
      rootRef.current?.removeAttribute(MULTI_SELECTING_ATTR);
    },
    [rootRef],
  );

  return useMemo(
    () => ({ anchorTo, extendTo, selectRange, toggle, selectAll, clear, extendFromBlock }),
    [anchorTo, extendTo, selectRange, toggle, selectAll, clear, extendFromBlock],
  );
}
