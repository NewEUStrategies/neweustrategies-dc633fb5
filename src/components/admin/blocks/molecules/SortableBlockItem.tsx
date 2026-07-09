// Sortable wrapper for a block row. Uses @dnd-kit/sortable.
// Owns: drag handle, hover toolbar (move/duplicate/remove), selection styling.

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useTranslation } from "react-i18next";
import { ChevronUp, ChevronDown, Copy, Trash2, GripVertical } from "@/lib/lucide-shim";
import { IconButton } from "../atoms/IconButton";

import type { BlockVariantOption } from "@/lib/blocks/variants";

interface Props {
  id: string;
  index: number;
  total: number;
  active: boolean;
  onSelect: () => void;
  onMove: (dir: -1 | 1) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  variants?: BlockVariantOption[] | null;
  currentVariant?: string;
  onVariantChange?: (v: string) => void;
  children: ReactNode;
}

export function SortableBlockItem(props: Props) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.id,
  });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const [toolbarPos, setToolbarPos] = useState<{
    left: number;
    top: number;
    placement: "top" | "bottom";
  }>({ left: 0, top: 0, placement: "top" });

  const setRefs = (node: HTMLDivElement | null) => {
    setNodeRef(node);
    containerRef.current = node;
  };

  useLayoutEffect(() => {
    if (!props.active) return;
    const container = containerRef.current;
    const toolbar = toolbarRef.current;
    if (!container || !toolbar) return;

    const compute = () => {
      const cRect = container.getBoundingClientRect();
      const tRect = toolbar.getBoundingClientRect();
      const margin = 8;
      const vw = window.innerWidth;
      // Prefer right-aligned to the container
      let left = cRect.width - tRect.width - 4;
      // Clamp within viewport horizontally relative to container origin
      const absLeft = cRect.left + left;
      if (absLeft < margin) left += margin - absLeft;
      const absRight = cRect.left + left + tRect.width;
      if (absRight > vw - margin) left -= absRight - (vw - margin);
      // Vertical: place above unless not enough room, then below
      const spaceAbove = cRect.top;
      const placement: "top" | "bottom" =
        spaceAbove < tRect.height + margin ? "bottom" : "top";
      const top = placement === "top" ? -tRect.height - 4 : cRect.height + 4;
      setToolbarPos({ left, top, placement });
    };

    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(container);
    ro.observe(toolbar);
    window.addEventListener("scroll", compute, true);
    window.addEventListener("resize", compute);
    return () => {
      ro.disconnect();
      window.removeEventListener("scroll", compute, true);
      window.removeEventListener("resize", compute);
    };
  }, [props.active]);


  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.45 : 1,
  };

  return (
    <div
      ref={setRefs}
      style={style}
      data-block-id={props.id}
      onClick={props.onSelect}
      className={`group relative pl-8 pr-3 py-1 scroll-mt-24 ${
        props.active
          ? "before:absolute before:left-0 before:top-1 before:bottom-1 before:w-0.5 before:bg-foreground before:rounded"
          : ""
      }`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        onClick={(e) => {
          e.stopPropagation();
          props.onSelect();
        }}
        title={t("blocks.actions.drag")}
        aria-label={t("blocks.actions.drag")}
        className="absolute left-1 top-1/2 -translate-y-1/2 p-1 rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-accent cursor-grab active:cursor-grabbing"
      >
        <GripVertical className="w-3.5 h-3.5" />
      </button>

      {props.active && (
        <div
          ref={toolbarRef}
          style={{ left: toolbarPos.left, top: toolbarPos.top }}
          className="absolute flex items-center gap-0.5 z-20 bg-popover border border-border rounded-md shadow-sm px-1 py-0.5"
        >

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
