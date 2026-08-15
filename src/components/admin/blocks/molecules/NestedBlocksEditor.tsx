// Mini-kanwa dzieci bloku kontenerowego (group/row/stack/grid/columns) -
// "Etap 1b: nested editor". Dziecko kontenera ma te same możliwości edycji
// co blok top-level: ten sam dyspozytor edytorów (BlockEditRenderer), pełny
// inserter, transformacje markdown/slash, scalanie Backspace, płynne
// przejścia karetki i drag&drop w obrębie kontenera (własny DndContext -
// dnd-kit izoluje konteksty, więc nie koliduje z kanwą główną).

import { useCallback, useRef, useState } from "react";
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
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Block } from "@/lib/blocks/types";
import { isTextEntryBlockType, requestBlockFocus } from "@/lib/blocks/focus";
import { htmlTextLength, innerInlineHtml, mergeInlineIntoHtml } from "@/lib/blocks/merge";
import { insertChildAt, moveChild, removeChildAt, replaceChildWith } from "@/lib/blocks/nested";
import { regenerateBlockIds } from "@/lib/blocks/clipboard";
import { ChevronDown, ChevronUp, Copy, GripVertical, Trash2 } from "@/lib/lucide-shim";
import { IconButton } from "../atoms/IconButton";
import { BlockInserter } from "../BlockInserter";
import { BlockEditRenderer, BlockWithToolbar } from "../BlockEditRenderer";

interface Props {
  /** Dzieci kontenera (kształt identyczny z rendererem publicznym). */
  blocks: Block[];
  onChange: (children: Block[]) => void;
  /** Etykieta pustego stanu (i18n po stronie wołającego). */
  emptyLabel?: string;
}

export function NestedBlocksEditor({ blocks, onChange, emptyLabel }: Props) {
  const { t } = useTranslation();
  const [activeChildId, setActiveChildId] = useState<string | null>(null);

  // Aktualne dzieci dla callbacków (mutacje w jednym ticku muszą się składać
  // - identyczny kontrakt jak emitChange w kanwie głównej).
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  const emit = useCallback(
    (next: Block[]) => {
      blocksRef.current = next;
      onChange(next);
    },
    [onChange],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const insertAt = useCallback(
    (idx: number, block: Block) => {
      emit(insertChildAt(blocksRef.current, idx, block));
      setActiveChildId(block.id);
      if (isTextEntryBlockType(block.type)) requestBlockFocus(block.id, "start");
    },
    [emit],
  );

  const replaceWith = useCallback(
    (id: string, replacement: Block[]) => {
      emit(replaceChildWith(blocksRef.current, id, replacement));
      const last = replacement[replacement.length - 1];
      setActiveChildId(last?.id ?? null);
      if (last && isTextEntryBlockType(last.type)) requestBlockFocus(last.id, "end");
    },
    [emit],
  );

  const deleteEmptyAt = useCallback(
    (idx: number) => {
      const arr = blocksRef.current;
      if (arr.length <= 1) {
        // Ostatnie dziecko może zniknąć - kontener zostaje pusty (jak w WP).
        emit([]);
        setActiveChildId(null);
        return;
      }
      const neighbor = arr[idx - 1] ?? arr[idx + 1];
      emit(removeChildAt(arr, idx));
      if (neighbor) {
        setActiveChildId(neighbor.id);
        if (isTextEntryBlockType(neighbor.type)) requestBlockFocus(neighbor.id, "end");
      }
    },
    [emit],
  );

  const mergeWithPrevious = useCallback(
    (idx: number): boolean => {
      const arr = blocksRef.current;
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
      const next = removeChildAt(arr, idx).map((b) =>
        b.id === prev.id && mergedPrev ? mergedPrev : b,
      );
      emit(next);
      setActiveChildId(prev.id);
      requestBlockFocus(prev.id, caretOffset);
      return true;
    },
    [emit],
  );

  const focusNeighbor = useCallback((idx: number, dir: -1 | 1): boolean => {
    const arr = blocksRef.current;
    for (let i = idx + dir; i >= 0 && i < arr.length; i += dir) {
      if (isTextEntryBlockType(arr[i].type)) {
        setActiveChildId(arr[i].id);
        requestBlockFocus(arr[i].id, dir < 0 ? "end" : "start");
        return true;
      }
    }
    return false;
  }, []);

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const arr = blocksRef.current;
      const from = arr.findIndex((b) => b.id === active.id);
      const to = arr.findIndex((b) => b.id === over.id);
      if (from < 0 || to < 0) return;
      emit(moveChild(arr, from, to));
    },
    [emit],
  );

  if (blocks.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-2">
        <p className="text-[11px] text-muted-foreground italic mb-1">
          {emptyLabel ?? t("blocks.nested.empty")}
        </p>
        <BlockInserter
          variant="fab"
          onInsert={(b) => insertAt(0, b)}
          onInsertBlocks={(list) => {
            emit([...blocksRef.current, ...list]);
          }}
        />
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-0.5" data-nested-canvas>
          <BlockInserter
            onInsert={(b) => insertAt(0, b)}
            onInsertBlocks={(list) => emit([...list, ...blocksRef.current])}
          />
          {blocks.map((child, idx) => (
            <div key={child.id}>
              <NestedChildRow
                block={child}
                index={idx}
                total={blocks.length}
                active={child.id === activeChildId}
                onSelect={() => setActiveChildId(child.id)}
                onMove={(dir) => emit(moveChild(blocksRef.current, idx, idx + dir))}
                onDuplicate={() => {
                  const copy = regenerateBlockIds([child])[0];
                  emit(insertChildAt(blocksRef.current, idx + 1, copy));
                  setActiveChildId(copy.id);
                }}
                onRemove={() => {
                  emit(removeChildAt(blocksRef.current, idx));
                  setActiveChildId(null);
                }}
              >
                <BlockWithToolbar
                  block={child}
                  isActive={child.id === activeChildId}
                  onChange={(n) => emit(blocksRef.current.map((b) => (b.id === n.id ? n : b)))}
                >
                  <BlockEditRenderer
                    block={child}
                    isActive={child.id === activeChildId}
                    onChange={(n) => emit(blocksRef.current.map((b) => (b.id === n.id ? n : b)))}
                    onTransform={(replacement) => replaceWith(child.id, replacement)}
                    onInsertAfter={(blk) => insertAt(idx + 1, blk)}
                    onDeleteEmpty={() => deleteEmptyAt(idx)}
                    onMergeWithPrevious={() => mergeWithPrevious(idx)}
                    onFocusPrevious={() => focusNeighbor(idx, -1)}
                    onFocusNext={() => focusNeighbor(idx, 1)}
                    onSelectAllBlocks={() => undefined}
                    // Zaznaczenie blokowe żyje na poziomie kanwy głównej -
                    // wewnątrz kontenera Shift+strzałka zostaje zaznaczeniem
                    // tekstowym (blok-rodzic zaznacza się klikiem w jego obwód).
                    onExtendBlockSelection={() => false}
                  />
                </BlockWithToolbar>
              </NestedChildRow>
              <BlockInserter
                onInsert={(b) => insertAt(idx + 1, b)}
                onInsertBlocks={(list) => {
                  const arr = [...blocksRef.current];
                  arr.splice(idx + 1, 0, ...list);
                  emit(arr);
                }}
              />
            </div>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

/** Wiersz dziecka: uchwyt DnD + kompaktowy pasek akcji na hover. */
function NestedChildRow({
  block,
  index,
  total,
  active,
  onSelect,
  onMove,
  onDuplicate,
  onRemove,
  children,
}: {
  block: Block;
  index: number;
  total: number;
  active: boolean;
  onSelect: () => void;
  onMove: (dir: -1 | 1) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-block-id={block.id}
      data-block-type={block.type}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      className={`group/nested relative rounded-sm pl-6 pr-1 py-1 ${
        isDragging ? "opacity-45" : ""
      } ${active ? "ring-1 ring-foreground/20" : ""}`.trim()}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
        title={t("blocks.actions.drag")}
        aria-label={t("blocks.actions.drag")}
        className="absolute left-0 top-1/2 -translate-y-1/2 p-0.5 rounded text-muted-foreground opacity-0 group-hover/nested:opacity-100 hover:bg-accent cursor-grab active:cursor-grabbing"
      >
        <GripVertical className="w-3 h-3" />
      </button>

      <div
        onClick={(e) => e.stopPropagation()}
        className="absolute right-1 -top-2.5 z-40 hidden group-hover/nested:flex items-center gap-0.5 rounded-md border border-border bg-popover px-0.5 py-0.5 shadow-sm"
      >
        <IconButton
          disabled={index === 0}
          onClick={() => onMove(-1)}
          title={t("blocks.actions.up")}
          aria-label={t("blocks.actions.up")}
        >
          <ChevronUp className="w-3 h-3" />
        </IconButton>
        <IconButton
          disabled={index === total - 1}
          onClick={() => onMove(1)}
          title={t("blocks.actions.down")}
          aria-label={t("blocks.actions.down")}
        >
          <ChevronDown className="w-3 h-3" />
        </IconButton>
        <IconButton
          onClick={onDuplicate}
          title={t("blocks.actions.duplicate")}
          aria-label={t("blocks.actions.duplicate")}
        >
          <Copy className="w-3 h-3" />
        </IconButton>
        <IconButton
          danger
          onClick={onRemove}
          title={t("blocks.actions.remove")}
          aria-label={t("blocks.actions.remove")}
        >
          <Trash2 className="w-3 h-3" />
        </IconButton>
      </div>

      {children}
    </div>
  );
}
