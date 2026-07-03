// Sortable wrapper for a block row. Uses @dnd-kit/sortable.
// Owns: drag handle, hover toolbar (move/duplicate/remove), selection styling.

import type { ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useTranslation } from "react-i18next";
import { ChevronUp, ChevronDown, Copy, Trash2, GripVertical } from "@/lib/lucide-shim";
import { IconButton } from "../atoms/IconButton";

interface Props {
  id: string;
  index: number;
  total: number;
  active: boolean;
  onSelect: () => void;
  onMove: (dir: -1 | 1) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  children: ReactNode;
}

export function SortableBlockItem(props: Props) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.id,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.45 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-block-id={props.id}
      onClick={props.onSelect}
      className={`group relative pl-8 pr-3 py-1 scroll-mt-24 ${
        props.active
          ? "before:absolute before:left-0 before:top-1 before:bottom-1 before:w-0.5 before:bg-primary before:rounded"
          : ""
      }`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
        title={t("blocks.actions.drag")}
        aria-label={t("blocks.actions.drag")}
        className="absolute left-1 top-1/2 -translate-y-1/2 p-1 rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-accent cursor-grab active:cursor-grabbing"
      >
        <GripVertical className="w-3.5 h-3.5" />
      </button>

      {props.active && (
        <div className="absolute -right-1 top-0 -translate-y-full pb-1 flex items-center gap-0.5 z-10 bg-popover border border-border rounded-md shadow-sm px-1 py-0.5">
          <IconButton
            disabled={props.index === 0}
            onClick={(e) => {
              e.stopPropagation();
              props.onMove(-1);
            }}
            title={t("blocks.actions.up")}
            aria-label={t("blocks.actions.up")}
          >
            <ChevronUp className="w-3 h-3" />
          </IconButton>
          <IconButton
            disabled={props.index === props.total - 1}
            onClick={(e) => {
              e.stopPropagation();
              props.onMove(1);
            }}
            title={t("blocks.actions.down")}
            aria-label={t("blocks.actions.down")}
          >
            <ChevronDown className="w-3 h-3" />
          </IconButton>
          <IconButton
            onClick={(e) => {
              e.stopPropagation();
              props.onDuplicate();
            }}
            title={t("blocks.actions.duplicate")}
            aria-label={t("blocks.actions.duplicate")}
          >
            <Copy className="w-3 h-3" />
          </IconButton>
          <IconButton
            danger
            onClick={(e) => {
              e.stopPropagation();
              props.onRemove();
            }}
            title={t("blocks.actions.remove")}
            aria-label={t("blocks.actions.remove")}
          >
            <Trash2 className="w-3 h-3" />
          </IconButton>
        </div>
      )}

      {props.children}
    </div>
  );
}
