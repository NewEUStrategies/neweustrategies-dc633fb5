// List View jak w WordPress Gutenberg: drzewo WSZYSTKICH bloków dokumentu
// (z zagnieżdżeniami group/columns), klik = zaznaczenie i doscrollowanie
// w kanwie, Shift+klik = zakres, Ctrl/Cmd+klik = przełączanie, drag&drop
// zmienia kolejność bloków top-level. Fundament: lib/blocks/tree (drzewo),
// lib/blocks/selection (zakresy) - te same prymitywy co kanwa.

import { useMemo } from "react";
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
import type { BlocksDoc } from "@/lib/blocks/types";
import { BLOCK_SPECS } from "@/lib/blocks/registry";
import { flattenBlockTree, type BlockTreeRow } from "@/lib/blocks/tree";
import { blockRange, toggleInSelection } from "@/lib/blocks/selection";
import { GripVertical } from "@/lib/lucide-shim";

interface Props {
  doc: BlocksDoc;
  activeId: string | null;
  selectedIds: readonly string[];
  onSelect: (id: string | null) => void;
  onSelectedIdsChange: (ids: readonly string[]) => void;
  /** Zmiana kolejności bloków top-level (DnD w drzewie). */
  onReorder: (fromIdx: number, toIdx: number) => void;
}

export function BlockListView({
  doc,
  activeId,
  selectedIds,
  onSelect,
  onSelectedIdsChange,
  onReorder,
}: Props) {
  const { t } = useTranslation();
  const rows = useMemo(() => flattenBlockTree(doc.blocks), [doc.blocks]);
  const topLevelIds = useMemo(() => doc.blocks.map((b) => b.id), [doc.blocks]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const scrollToBlock = (id: string) => {
    // Id bloków to bezpieczne `b_[a-z0-9]+` - selektor atrybutu bez escapowania.
    document
      .querySelector(`[data-block-id="${id}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  const handleRowClick = (row: BlockTreeRow, e: React.MouseEvent) => {
    // Selekcja/zakresy działają na blokach TOP-LEVEL (dziecko wskazuje
    // swój korzeń) - spójnie z modelem zaznaczeń kanwy.
    const targetId = row.rootId;
    if (e.shiftKey && (activeId || selectedIds.length)) {
      const anchor = selectedIds[0] ?? activeId;
      if (anchor) {
        e.preventDefault();
        onSelectedIdsChange(blockRange(topLevelIds, anchor, targetId));
        onSelect(null);
        return;
      }
    }
    if (e.metaKey || e.ctrlKey) {
      const base = selectedIds.length ? selectedIds : activeId ? [activeId] : [];
      onSelectedIdsChange(toggleInSelection(topLevelIds, base, targetId));
      onSelect(null);
      return;
    }
    onSelectedIdsChange([]);
    onSelect(targetId);
    scrollToBlock(row.id);
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = topLevelIds.indexOf(String(active.id));
    const to = topLevelIds.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onReorder(from, to);
  };

  if (rows.length === 0) {
    return <p className="text-xs text-muted-foreground italic">{t("blocks.listView.empty")}</p>;
  }

  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
        {t("blocks.listView.title")}
      </p>
      {/* Skróty zaznaczenia blokowego - jedyne miejsce, gdzie redakcja je
          zobaczy bez czytania dokumentacji (Shift+klik działa też tutaj). */}
      <p className="text-[10px] leading-snug text-muted-foreground/80 mb-1.5">
        {t("blocks.selection.hint")}
      </p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={topLevelIds} strategy={verticalListSortingStrategy}>
          <ul role="tree" aria-label={t("blocks.listView.title")} className="space-y-0.5">
            {rows.map((row) => (
              <ListRow
                key={row.id}
                row={row}
                active={row.id === activeId || row.rootId === activeId}
                selected={selectedSet.has(row.rootId)}
                label={t(`blocks.types.${row.type}`)}
                onClick={(e) => handleRowClick(row, e)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function ListRow({
  row,
  active,
  selected,
  label,
  onClick,
}: {
  row: BlockTreeRow;
  active: boolean;
  selected: boolean;
  label: string;
  onClick: (e: React.MouseEvent) => void;
}) {
  const { t } = useTranslation();
  const isTopLevel = row.depth === 0;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.id,
    disabled: !isTopLevel,
  });
  const Icon = BLOCK_SPECS[row.type]?.icon;
  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        paddingLeft: row.depth * 14,
      }}
      role="treeitem"
      aria-selected={selected || active}
      aria-level={row.depth + 1}
      className={isDragging ? "opacity-45" : undefined}
    >
      <button
        type="button"
        onClick={onClick}
        className={`group/row w-full flex items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs transition-colors ${
          selected
            ? "bg-foreground/10 ring-1 ring-foreground/20"
            : active
              ? "bg-accent text-accent-foreground"
              : "hover:bg-accent/60"
        }`}
      >
        {isTopLevel ? (
          <span
            {...attributes}
            {...listeners}
            onClick={(e) => e.stopPropagation()}
            title={t("blocks.actions.drag")}
            className="shrink-0 p-0.5 -ml-0.5 rounded text-muted-foreground opacity-0 group-hover/row:opacity-100 cursor-grab active:cursor-grabbing"
          >
            <GripVertical className="w-3 h-3" />
          </span>
        ) : (
          <span className="w-3.5 shrink-0" aria-hidden />
        )}
        {Icon ? <Icon className="w-3.5 h-3.5 shrink-0 text-muted-foreground" /> : null}
        <span className="shrink-0 font-medium">{label}</span>
        {row.snippet ? (
          <span className="min-w-0 truncate text-muted-foreground">{row.snippet}</span>
        ) : null}
      </button>
    </li>
  );
}
