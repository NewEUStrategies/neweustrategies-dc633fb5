// Systemowy schowek kanwy bloków (Ctrl+C/X/V jak w WordPress Gutenberg).
//
// Odpowiedzialności:
//   - kopiowanie/wycinanie zaznaczonych bloków (sentinel JSON + markup
//     Gutenberga -> interop z WordPressem i innymi wpisami),
//   - wklejanie: bloki własne/WP -> Word/Google Docs -> pliki graficzne
//     -> zwykły tekst (dokładnie w tej kolejności prób),
//   - toasty z poprawną liczbą mnogą (PL/EN),
//   - arbitraż zagnieżdżonych kanw (edytor bloków w modalu buildera nad
//     edytorem wpisu): globalne zdarzenia obsługuje wyłącznie kanwa
//     zamontowana najpóźniej, żeby jedno Ctrl+V nie wklejało dwa razy.
//
// Zdarzenia w polach tekstowych zostawiamy edytorom inline (TipTap ma własną
// obsługę wklejania) - hook działa tylko dla zaznaczenia blokowego.

import { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { Block, BlocksDoc } from "@/lib/blocks/types";
import {
  parseBlocksFromClipboard,
  plainTextToBlocks,
  serializeBlocksForClipboard,
} from "@/lib/blocks/clipboard";
import { filesToImageBlocks, isImageFile } from "@/lib/blocks/imagePaste";
import { looksLikeRichPaste, parseWordHtml } from "@/lib/blocks/wordPaste";
import { isTextEntryBlockType, requestBlockFocus } from "@/lib/blocks/focus";

/**
 * Stos zamontowanych kanw - moduł współdzielony przez wszystkie instancje
 * hooka. Wierzchnia kanwa (ostatnio zamontowana) wygrywa zdarzenia globalne.
 * Trzymamy REFERENCJE (nie elementy): kanwa podmienia węzeł DOM przy przejściu
 * pusty dokument <-> lista bloków, a ref zawsze wskazuje żywy element -
 * porównywanie zapamiętanych elementów blokowało schowek po takiej podmianie.
 */
const MOUNTED_CANVAS_REFS: Array<React.RefObject<HTMLDivElement | null>> = [];

export interface UseBlockClipboardArgs {
  /** Root kanwy (element z `data-block-canvas`). */
  rootRef: React.RefObject<HTMLDivElement | null>;
  /** Aktualny dokument bloków (stabilna referencja). */
  docRef: React.MutableRefObject<BlocksDoc>;
  /** Aktywny blok (stabilna referencja). */
  activeIdRef: React.MutableRefObject<string | null>;
  /** Zaznaczenie wielokrotne (stabilna referencja). */
  selectedIdsRef: React.MutableRefObject<readonly string[]>;
  onChange: (doc: BlocksDoc, immediate?: boolean) => void;
  onSelect: (id: string | null) => void;
  clearSelection: () => void;
  /** Wstawia bloki pod wskazany indeks (fokus na ostatnim tekstowym). */
  insertBlocksAt: (idx: number, blocks: Block[]) => void;
}

export function useBlockClipboard(args: UseBlockClipboardArgs): void {
  const { t } = useTranslation();
  const {
    rootRef,
    docRef,
    activeIdRef,
    selectedIdsRef,
    onChange,
    onSelect,
    clearSelection,
    insertBlocksAt,
  } = args;

  // Rejestracja kanwy w stosie arbitrażu zagnieżdżeń (raz na mount hooka).
  useEffect(() => {
    MOUNTED_CANVAS_REFS.push(rootRef);
    return () => {
      const i = MOUNTED_CANVAS_REFS.indexOf(rootRef);
      if (i >= 0) MOUNTED_CANVAS_REFS.splice(i, 1);
    };
  }, [rootRef]);

  /** Bloki objęte operacją schowka: zaznaczenie wielokrotne albo aktywny blok. */
  const clipboardSelection = useCallback((): Block[] => {
    const arr = docRef.current.blocks;
    if (selectedIdsRef.current.length) {
      const set = new Set(selectedIdsRef.current);
      return arr.filter((b) => set.has(b.id));
    }
    const aid = activeIdRef.current;
    return aid ? arr.filter((b) => b.id === aid) : [];
  }, [docRef, activeIdRef, selectedIdsRef]);

  /** Wkleja bloki: zamienia zaznaczenie wielokrotne albo wstawia po aktywnym. */
  const pasteBlocks = useCallback(
    (incoming: Block[]) => {
      if (!incoming.length) return;
      const arr = docRef.current.blocks;
      const selected = selectedIdsRef.current;
      if (selected.length) {
        const set = new Set(selected);
        const firstIdx = arr.findIndex((b) => set.has(b.id));
        const kept = arr.filter((b) => !set.has(b.id));
        const at = firstIdx < 0 ? kept.length : firstIdx;
        const next = [...kept];
        next.splice(at, 0, ...incoming);
        onChange({ ...docRef.current, blocks: next }, true);
        clearSelection();
        const last = incoming[incoming.length - 1];
        onSelect(last.id);
        if (isTextEntryBlockType(last.type)) requestBlockFocus(last.id, "end");
      } else {
        const aid = activeIdRef.current;
        const idx = aid ? arr.findIndex((b) => b.id === aid) : -1;
        insertBlocksAt(idx < 0 ? arr.length : idx + 1, incoming);
      }
      toast.success(t("blocks.clipboard.pasted", { count: incoming.length }));
    },
    [docRef, selectedIdsRef, activeIdRef, onChange, onSelect, clearSelection, insertBlocksAt, t],
  );

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null): boolean => {
      const el = target as HTMLElement | null;
      return (
        !!el &&
        (el.isContentEditable ||
          el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT")
      );
    };
    const shouldHandle = (e: ClipboardEvent): boolean => {
      if (isEditableTarget(e.target)) return false;
      const root = rootRef.current;
      if (!root) return false;
      const el = e.target as HTMLElement | null;
      const inSomeCanvas = el?.closest?.("[data-block-canvas]") ?? null;
      if (inSomeCanvas) return inSomeCanvas === root;
      // Zdarzenie poza jakąkolwiek kanwą (fokus na body) - obsługuje wierzchnia.
      return MOUNTED_CANVAS_REFS[MOUNTED_CANVAS_REFS.length - 1]?.current === root;
    };

    const onCopyOrCut = (e: ClipboardEvent) => {
      if (!shouldHandle(e)) return;
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) return; // natywne kopiowanie tekstu
      const chosen = clipboardSelection();
      if (!chosen.length || !e.clipboardData) return;
      e.preventDefault();
      const payload = serializeBlocksForClipboard(chosen);
      e.clipboardData.setData("text/html", payload.html);
      e.clipboardData.setData("text/plain", payload.text);
      if (e.type === "cut") {
        const ids = new Set(chosen.map((b) => b.id));
        const next = docRef.current.blocks.filter((b) => !ids.has(b.id));
        onChange({ ...docRef.current, blocks: next }, true);
        clearSelection();
        onSelect(null);
        toast.success(t("blocks.clipboard.cutDone", { count: chosen.length }));
      } else {
        toast.success(t("blocks.clipboard.copied", { count: chosen.length }));
      }
    };

    const onPaste = (e: ClipboardEvent) => {
      if (!shouldHandle(e)) return;
      const dt = e.clipboardData;
      if (!dt) return;
      const html = dt.getData("text/html");
      const plain = dt.getData("text/plain");
      let incoming = parseBlocksFromClipboard(html, plain);
      if (!incoming) {
        const files = Array.from(dt.files ?? []).filter(isImageFile);
        if (files.length) {
          e.preventDefault();
          void filesToImageBlocks(files).then((imageBlocks) => {
            if (imageBlocks.length) pasteBlocks(imageBlocks);
          });
          return;
        }
        if (html && looksLikeRichPaste(html)) incoming = parseWordHtml(html);
        else if (plain.trim()) incoming = plainTextToBlocks(plain);
      }
      if (!incoming?.length) return;
      e.preventDefault();
      pasteBlocks(incoming);
    };

    document.addEventListener("copy", onCopyOrCut);
    document.addEventListener("cut", onCopyOrCut);
    document.addEventListener("paste", onPaste);
    return () => {
      document.removeEventListener("copy", onCopyOrCut);
      document.removeEventListener("cut", onCopyOrCut);
      document.removeEventListener("paste", onPaste);
    };
  }, [rootRef, docRef, clipboardSelection, pasteBlocks, onChange, onSelect, clearSelection, t]);
}
