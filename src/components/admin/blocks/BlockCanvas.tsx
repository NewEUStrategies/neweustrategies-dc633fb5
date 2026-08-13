// Kanwa bloków z drag&drop (@dnd-kit), atomowymi akcjami i pisaniem płynącym
// przez cały dokument (parytet z WordPress Gutenberg). Każda mutacja
// przechodzi przez `onChange`, który u góry trafia w history hook (undo/redo).
//
// Zachowania Gutenberga:
//   - Enter przenosi karetkę do nowego bloku, Backspace na pustym bloku wraca
//     na koniec poprzedniego, Backspace na początku niepustego SCALA bloki
//     (karetka w punkcie złączenia), strzałki przechodzą między blokami,
//   - zaznaczenie wielokrotne: dwustopniowe Ctrl+A, Shift+klik (zakres),
//     Ctrl/Cmd+klik (przełączanie), Ctrl+Shift+D (duplikat),
//   - zaznaczenie w POPRZEK bloków (`useCrossBlockSelection`): przeciąganie
//     myszą przez granicę bloku, Shift+strzałki (także eskalacja z wnętrza
//     akapitu), Shift+Home/End, pisanie po zaznaczeniu wielu bloków,
//   - schowek Ctrl+C/X/V przez `useBlockClipboard` (interop z WordPressem).

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { Block, BlocksDoc, BlockType } from "@/lib/blocks/types";
import { newBlockId } from "@/lib/blocks/types";
import { isTextEntryBlockType, requestBlockFocus } from "@/lib/blocks/focus";
import { regenerateBlockIds } from "@/lib/blocks/clipboard";
import { htmlTextLength, innerInlineHtml, mergeInlineIntoHtml } from "@/lib/blocks/merge";
import { escapeInlineText } from "@/lib/blocks/inlineHtml";
import { isEditableTarget } from "@/lib/blocks/selectionDom";
import type { SelectionDirection } from "@/lib/blocks/crossSelection";
import { getTransformTargets, transformBlock } from "@/lib/blocks/transforms";
import { useBlockClipboard } from "./hooks/useBlockClipboard";
import { useCrossBlockSelection } from "./hooks/useCrossBlockSelection";
import { BlockSelectionAnnouncer } from "./atoms/BlockSelectionAnnouncer";
import { BlockEditRenderer, BlockWithToolbar } from "./BlockEditRenderer";
import { BlockInserter } from "./BlockInserter";
import { BlockAppender } from "./molecules/BlockAppender";
import { SortableBlockItem, type BlockTransformOption } from "./molecules/SortableBlockItem";
import { getBlockVariants } from "@/lib/blocks/variants";
import { BLOCK_SPECS } from "@/lib/blocks/registry";

interface Props {
  doc: BlocksDoc;
  activeId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (doc: BlocksDoc, immediate?: boolean) => void;
  /** Zaznaczenie wielokrotne - kontrolowane przez rodzica (dzieli je List View). */
  selectedIds: readonly string[];
  onSelectedIdsChange: (ids: readonly string[]) => void;
}

export function BlockCanvas({
  doc,
  activeId,
  onSelect,
  onChange,
  selectedIds,
  onSelectedIdsChange,
}: Props) {
  const { t } = useTranslation();
  const blocks = doc.blocks;
  const ids = useMemo(() => blocks.map((b) => b.id), [blocks]);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Zaznaczenie WIELU bloków (Ctrl/Cmd+A jak w Word) - stan kontrolowany
  // przez rodzica (PostBlockEditor), bo dzieli go z List View w sidebarze.
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  // Stable ref to current doc/blocks so callbacks don't churn.
  const docRef = useRef(doc);
  docRef.current = doc;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;

  /**
   * KAŻDA mutacja dokumentu przechodzi tędy: `docRef` jest aktualizowany
   * OPTYMISTYCZNIE (nie dopiero przy re-renderze), więc sekwencyjne mutacje
   * w jednym ticku się SKŁADAJĄ. Bez tego Enter-split gubił przycięcie bloku
   * źródłowego: `deleteRange` -> onChange(przycięty), a `insertAt` czytał
   * jeszcze stary `docRef` i nadpisywał dokument wersją sprzed przycięcia
   * (ogon się duplikował).
   */
  const emitChange = useCallback(
    (next: BlocksDoc, immediate?: boolean) => {
      docRef.current = next;
      onChange(next, immediate);
    },
    [onChange],
  );

  /**
   * Pisanie przy zaznaczeniu WIELU bloków zastępuje je jednym akapitem -
   * dokładnie jak `onBeforeInput` w WP. Wpisany znak trafia do treści
   * ZAESCAPOWANY (nigdy jako markup), więc `<`/`&` nie potrafią wstrzyknąć
   * HTML-a do dokumentu.
   */
  const replaceSelectionWithParagraph = useCallback(
    (typed: string) => {
      const set = new Set(selectedIdsRef.current);
      if (set.size < 2) return;
      const arr = docRef.current.blocks;
      const firstIdx = arr.findIndex((b) => set.has(b.id));
      const kept = arr.filter((b) => !set.has(b.id));
      const fresh: Block = {
        id: newBlockId(),
        type: "paragraph",
        data: { html: typed ? `<p>${escapeInlineText(typed)}</p>` : "" },
      };
      const next = [...kept];
      next.splice(firstIdx < 0 ? kept.length : firstIdx, 0, fresh);
      emitChange({ ...docRef.current, blocks: next }, true);
      selectedIdsRef.current = [];
      onSelectedIdsChange([]);
      onSelect(fresh.id);
      requestBlockFocus(fresh.id, "end");
    },
    [emitChange, onSelect, onSelectedIdsChange],
  );

  // Jedyny właściciel zaznaczenia blokowego: klik z modyfikatorami, Shift+
  // strzałki, przeciąganie przez granicę bloku i pisanie po zaznaczeniu.
  const selection = useCrossBlockSelection({
    rootRef,
    docRef,
    activeIdRef,
    selectedIdsRef,
    onSelectedIdsChange,
    onSelect,
    replaceSelection: replaceSelectionWithParagraph,
  });
  const { clear: clearSelection, selectAll: selectAllBlocks } = selection;

  const removeSelected = useCallback(() => {
    const set = new Set(selectedIds);
    if (set.size === 0) return;
    const next = docRef.current.blocks.filter((b) => !set.has(b.id));
    emitChange({ ...docRef.current, blocks: next.length ? next : [] }, true);
    clearSelection();
    onSelect(null);
  }, [selectedIds, emitChange, onSelect, clearSelection]);

  /**
   * Ctrl+Shift+D (jak w WP): duplikuje zaznaczenie wielokrotne albo aktywny
   * blok; kopie (ze świeżymi id, także w zagnieżdżeniach) lądują za ostatnim
   * duplikowanym blokiem i przejmują zaznaczenie.
   */
  const duplicateSelection = useCallback((): boolean => {
    const arr = docRef.current.blocks;
    const chosenIds = selectedIdsRef.current.length
      ? new Set(selectedIdsRef.current)
      : activeIdRef.current
        ? new Set([activeIdRef.current])
        : null;
    if (!chosenIds?.size) return false;
    const chosen = arr.filter((b) => chosenIds.has(b.id));
    if (!chosen.length) return false;
    const copies = regenerateBlockIds(chosen);
    const lastIdx = arr.reduce((acc, b, i) => (chosenIds.has(b.id) ? i : acc), -1);
    const next = [...arr];
    next.splice(lastIdx + 1, 0, ...copies);
    emitChange({ ...docRef.current, blocks: next }, true);
    if (copies.length === 1) {
      clearSelection();
      onSelect(copies[0].id);
    } else {
      selection.selectRange(copies[0].id, copies[copies.length - 1].id);
    }
    return true;
  }, [emitChange, onSelect, clearSelection, selection]);

  /**
   * Klik w blok z modyfikatorami (jak w WP): Shift = zakres od kotwicy,
   * Ctrl/Cmd = przełączenie pojedynczego bloku, bez modyfikatorów = zwykłe
   * zaznaczenie aktywnego bloku (i nowa kotwica).
   *
   * Ctrl/Cmd+klik wewnątrz treści zostawiamy przeglądarce (to nie jest gest
   * zaznaczania tekstu), ale Shift+klik w treść INNEGO bloku eskaluje do
   * zaznaczenia blokowego - parytet z WP, gdzie zaznaczenie tekstowe nie
   * potrafi przekroczyć granicy bloku i zamienia się w zaznaczenie bloków.
   * Wyjątkiem są POLA FORMULARZA bloku (np. język bloku `code`): tam Shift+klik
   * ma zostać natywnym rozszerzeniem zaznaczenia w obrębie pola.
   */
  const handleBlockClick = useCallback(
    (id: string, e?: React.MouseEvent) => {
      const target = e?.target as HTMLElement | null;
      const inFormField = Boolean(target?.closest?.("input, textarea, select"));
      if (e?.shiftKey && !inFormField && selection.extendTo(id)) {
        e.preventDefault();
        return;
      }
      if ((e?.metaKey || e?.ctrlKey) && !isEditableTarget(target)) {
        selection.toggle(id);
        return;
      }
      selection.anchorTo(id);
    },
    [selection],
  );

  // Klawiatura dokumentu: Ctrl/Cmd+A poza edytorem zaznacza wszystkie bloki,
  // Ctrl+Shift+D duplikuje, Delete/Backspace usuwa zaznaczone, Escape czyści.
  // Strzałki i pisanie po zaznaczeniu obsługuje `useCrossBlockSelection`.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inEditable = isEditableTarget(e.target);
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "d") {
        // Działa też podczas pisania (duplikuje aktywny blok) - parytet z WP.
        if (duplicateSelection()) e.preventDefault();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a" && !inEditable) {
        e.preventDefault();
        selectAllBlocks();
        return;
      }
      if (selectedIds.length === 0) return;
      if (e.key === "Escape") {
        clearSelection();
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && !inEditable) {
        e.preventDefault();
        removeSelected();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selectAllBlocks, clearSelection, removeSelected, duplicateSelection, selectedIds.length]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const insertAt = useCallback(
    (idx: number, block: Block, immediate = true) => {
      const next = [...docRef.current.blocks];
      next.splice(idx, 0, block);
      emitChange({ ...docRef.current, blocks: next }, immediate);
      onSelect(block.id);
      // Gutenberg-flow: po Enter / wstawieniu bloku tekstowego piszesz dalej
      // bez klikania - karetka ląduje na początku świeżego bloku.
      if (isTextEntryBlockType(block.type)) requestBlockFocus(block.id, "start");
    },
    [emitChange, onSelect],
  );

  const replaceBlock = useCallback(
    (id: string, next: Block, immediate = false) => {
      const updated = docRef.current.blocks.map((b) => (b.id === id ? next : b));
      emitChange({ ...docRef.current, blocks: updated }, immediate);
    },
    [emitChange],
  );

  /** Replace a block in place with one or more new blocks (e.g. markdown transform). */
  const replaceWith = useCallback(
    (id: string, replacement: Block[]) => {
      const idx = docRef.current.blocks.findIndex((b) => b.id === id);
      if (idx < 0) return;
      const next = [...docRef.current.blocks];
      next.splice(idx, 1, ...replacement);
      emitChange({ ...docRef.current, blocks: next }, true);
      const last = replacement[replacement.length - 1];
      onSelect(last?.id ?? null);
      // Transformacja (markdown "## " / slash / wklejka) nie może gubić
      // karetki - piszesz dalej na końcu ostatniego bloku zamiennika.
      if (last && isTextEntryBlockType(last.type)) requestBlockFocus(last.id, "end");
    },
    [emitChange, onSelect],
  );

  /** Usuwa pusty blok (Backspace) i cofa karetkę na koniec sąsiada - jak w WP. */
  const deleteEmptyAt = useCallback(
    (idx: number) => {
      const arr = docRef.current.blocks;
      if (arr.length <= 1) return;
      const neighbor = arr[idx - 1] ?? arr[idx + 1];
      const next = arr.filter((_, i) => i !== idx);
      emitChange({ ...docRef.current, blocks: next }, true);
      if (neighbor) {
        onSelect(neighbor.id);
        if (isTextEntryBlockType(neighbor.type)) requestBlockFocus(neighbor.id, "end");
      } else {
        onSelect(null);
      }
    },
    [emitChange, onSelect],
  );

  /**
   * Backspace na początku niepustego akapitu/nagłówka scala go z poprzednim
   * blokiem tekstowym; karetka ląduje dokładnie w punkcie złączenia - jak w WP.
   * `false`, gdy scalenie nie ma sensu (brak poprzednika / typ nietekstowy) -
   * wtedy edytor inline zostawia domyślne zachowanie przeglądarki.
   */
  const mergeWithPrevious = useCallback(
    (idx: number): boolean => {
      const arr = docRef.current.blocks;
      const current = arr[idx];
      const prev = arr[idx - 1];
      if (!current || !prev) return false;
      const incomingInner =
        current.type === "paragraph"
          ? innerInlineHtml(String(current.data.html ?? ""))
          : current.type === "heading"
            ? String(current.data.text ?? "")
            : null;
      if (incomingInner === null) return false;

      let mergedPrev: Block | null = null;
      let caretOffset = 0;
      if (prev.type === "paragraph") {
        const merged = mergeInlineIntoHtml(String(prev.data.html ?? ""), incomingInner);
        mergedPrev = { ...prev, data: { ...prev.data, html: merged.html } };
        caretOffset = merged.caretOffset;
      } else if (prev.type === "heading") {
        const prevText = String(prev.data.text ?? "");
        caretOffset = htmlTextLength(prevText);
        mergedPrev = { ...prev, data: { ...prev.data, text: `${prevText}${incomingInner}` } };
      } else {
        return false;
      }

      const next = arr
        .filter((_, i) => i !== idx)
        .map((b) => (b.id === prev.id && mergedPrev ? mergedPrev : b));
      emitChange({ ...docRef.current, blocks: next }, true);
      onSelect(prev.id);
      requestBlockFocus(prev.id, caretOffset);
      return true;
    },
    [emitChange, onSelect],
  );

  /**
   * Fokus na najbliższy blok TEKSTOWY nad/pod wskazanym indeksem (strzałki na
   * krawędziach treści). `false` gdy w tym kierunku nie ma już gdzie pisać.
   */
  const focusNeighborText = useCallback(
    (idx: number, dir: -1 | 1): boolean => {
      const arr = docRef.current.blocks;
      for (let i = idx + dir; i >= 0 && i < arr.length; i += dir) {
        if (isTextEntryBlockType(arr[i].type)) {
          onSelect(arr[i].id);
          requestBlockFocus(arr[i].id, dir < 0 ? "end" : "start");
          return true;
        }
      }
      return false;
    },
    [onSelect],
  );

  /** Wstawia wiele bloków pod wskazany indeks (wklejka ze schowka). */
  const insertBlocksAt = useCallback(
    (idx: number, incoming: Block[]) => {
      if (!incoming.length) return;
      const next = [...docRef.current.blocks];
      next.splice(idx, 0, ...incoming);
      emitChange({ ...docRef.current, blocks: next }, true);
      const last = incoming[incoming.length - 1];
      onSelect(last.id);
      if (isTextEntryBlockType(last.type)) requestBlockFocus(last.id, "end");
    },
    [emitChange, onSelect],
  );

  const move = useCallback(
    (idx: number, dir: -1 | 1) => {
      const j = idx + dir;
      const arr = docRef.current.blocks;
      if (j < 0 || j >= arr.length) return;
      const next = arrayMove(arr, idx, j);
      emitChange({ ...docRef.current, blocks: next }, true);
    },
    [emitChange],
  );

  const duplicate = useCallback(
    (idx: number) => {
      const orig = docRef.current.blocks[idx];
      if (!orig) return;
      // Świeże id także w zagnieżdżeniach (columns/group) - kopia nie może
      // współdzielić identyfikatorów z oryginałem.
      const copy: Block = regenerateBlockIds([orig])[0];
      const next = [...docRef.current.blocks];
      next.splice(idx + 1, 0, copy);
      emitChange({ ...docRef.current, blocks: next }, true);
    },
    [emitChange],
  );

  const remove = useCallback(
    (idx: number) => {
      const removed = docRef.current.blocks[idx];
      const next = docRef.current.blocks.filter((_, i) => i !== idx);
      emitChange({ ...docRef.current, blocks: next }, true);
      if (activeId === removed?.id) onSelect(null);
    },
    [emitChange, onSelect, activeId],
  );

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const from = docRef.current.blocks.findIndex((b) => b.id === active.id);
      const to = docRef.current.blocks.findIndex((b) => b.id === over.id);
      if (from < 0 || to < 0) return;
      emitChange({ ...docRef.current, blocks: arrayMove(docRef.current.blocks, from, to) }, true);
    },
    [emitChange],
  );

  // Schowek bloków (Ctrl+C/X/V, interop z WordPressem, wklejki Word/obrazy).
  useBlockClipboard({
    rootRef,
    docRef,
    activeIdRef,
    selectedIdsRef,
    onChange: emitChange,
    onSelect,
    clearSelection,
    insertBlocksAt,
  });

  // Memoizowane pozycje menu „Przekształć w" - lista zależy wyłącznie od TYPU
  // bloku i języka UI, więc jedna mapa obsługuje wszystkie bloki kanwy.
  const transformOptionsFor = useMemo(() => {
    const cache = new Map<BlockType, BlockTransformOption[]>();
    return (block: Block): BlockTransformOption[] => {
      const hit = cache.get(block.type);
      if (hit) return hit;
      const options = getTransformTargets(block).map((type) => ({
        type,
        label: t(`blocks.types.${type}`),
        icon: BLOCK_SPECS[type].icon,
      }));
      cache.set(block.type, options);
      return options;
    };
  }, [t]);

  if (blocks.length === 0) {
    // Pusty dokument jak w WP: wiersz „Wpisz / aby wybrać blok" + przycisk „+".
    return (
      <div ref={rootRef} data-block-canvas className="py-8">
        <BlockAppender
          onAppendParagraph={() =>
            insertAt(0, { id: newBlockId(), type: "paragraph", data: { html: "" } })
          }
          onInsert={(b) => insertAt(0, b)}
          onInsertBlocks={(list) => insertBlocksAt(0, list)}
        />
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div
          ref={rootRef}
          data-block-canvas
          tabIndex={-1}
          className="block-canvas space-y-0.5 outline-none"
          data-theme-typography
          data-builder-renderer
          data-cms-content
        >
          <BlockInserter
            onInsert={(b) => insertAt(0, b)}
            onInsertBlocks={(list) => insertBlocksAt(0, list)}
          />
          {blocks.map((b, idx) => {
            const variants = getBlockVariants(b.type);
            const currentVariant =
              typeof b.data.variant === "string" ? (b.data.variant as string) : undefined;
            return (
              <div key={b.id} data-block-type={b.type}>
                <SortableBlockItem
                  id={b.id}
                  index={idx}
                  total={blocks.length}
                  active={b.id === activeId}
                  selected={selectedSet.has(b.id)}
                  typeLabel={BLOCK_SPECS[b.type]?.label ?? b.type}
                  typeIcon={BLOCK_SPECS[b.type]?.icon}
                  onSelect={(e) => handleBlockClick(b.id, e)}
                  onMove={(dir) => move(idx, dir)}
                  onDuplicate={() => duplicate(idx)}
                  onRemove={() => remove(idx)}
                  variants={variants}
                  currentVariant={currentVariant}
                  onVariantChange={(v) =>
                    replaceBlock(b.id, { ...b, data: { ...b.data, variant: v } })
                  }
                  transforms={transformOptionsFor(b)}
                  onTransform={(type) => {
                    const replacement = transformBlock(b, type as BlockType);
                    if (replacement) replaceWith(b.id, replacement);
                  }}
                >
                  <BlockWithToolbar
                    block={b}
                    isActive={b.id === activeId}
                    onChange={(n) => replaceBlock(b.id, n)}
                  >
                    <BlockEditRenderer
                      block={b}
                      isActive={b.id === activeId}
                      onChange={(n) => replaceBlock(b.id, n)}
                      onTransform={(replacement) => replaceWith(b.id, replacement)}
                      onInsertAfter={(blk) => insertAt(idx + 1, blk)}
                      onDeleteEmpty={() => deleteEmptyAt(idx)}
                      onMergeWithPrevious={() => mergeWithPrevious(idx)}
                      onFocusPrevious={() => focusNeighborText(idx, -1)}
                      onFocusNext={() => focusNeighborText(idx, 1)}
                      onSelectAllBlocks={selectAllBlocks}
                      onExtendBlockSelection={(dir: SelectionDirection) =>
                        selection.extendFromBlock(b.id, dir)
                      }
                    />
                  </BlockWithToolbar>
                </SortableBlockItem>
                <BlockInserter
                  onInsert={(blk) => insertAt(idx + 1, blk)}
                  onInsertBlocks={(list) => insertBlocksAt(idx + 1, list)}
                />
              </div>
            );
          })}
          <BlockAppender
            onAppendParagraph={() =>
              insertAt(blocks.length, { id: newBlockId(), type: "paragraph", data: { html: "" } })
            }
            onInsert={(b) => insertAt(blocks.length, b)}
            onInsertBlocks={(list) => insertBlocksAt(blocks.length, list)}
          />
          <BlockSelectionAnnouncer count={selectedIds.length} />
        </div>
      </SortableContext>
    </DndContext>
  );
}
