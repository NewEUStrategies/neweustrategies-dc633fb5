// Sortable wrapper for a block row. Uses @dnd-kit/sortable.
// Owns: drag handle, hover toolbar (move/duplicate/remove), selection styling,
// and a permanent "size badge" (jak `TREŚĆ - MAX 960PX` w LayoutScaffold) który
// pokazuje typ bloku oraz zmierzoną szerokość x wysokość - dostępny dla każdego
// bloku w CMS builderze wpisów.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-blocks";
import {
  ChevronUp,
  ChevronDown,
  Copy,
  Trash2,
  GripVertical,
  Link as LinkIcon,
  Check,
} from "@/lib/lucide-shim";
import { IconButton } from "../atoms/IconButton";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import type { BlockVariantOption } from "@/lib/blocks/variants";

type BlockIcon = React.ComponentType<{ className?: string }>;

/** Pozycja menu „Przekształć w" (jak w WP: akapit -> nagłówek/lista/cytat…). */
export interface BlockTransformOption {
  type: string;
  label: string;
  icon: BlockIcon;
}

interface Props {
  id: string;
  index: number;
  total: number;
  active: boolean;
  /** Blok objęty zaznaczeniem wielokrotnym (Ctrl/Cmd+A). */
  selected?: boolean;
  /** Etykieta typu bloku widoczna w stałym badge'u (np. "AKAPIT", "OBRAZ"). */
  typeLabel?: string;
  /** Ikona bieżącego typu - trigger menu „Przekształć w" w toolbarze. */
  typeIcon?: BlockIcon;
  /** Klik w blok; zdarzenie niesie modyfikatory (Shift/Ctrl = multi-select). */
  onSelect: (e?: React.MouseEvent) => void;
  onMove: (dir: -1 | 1) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  variants?: BlockVariantOption[] | null;
  currentVariant?: string;
  onVariantChange?: (v: string) => void;
  /** Dostępne transformacje typu (puste/undefined = menu ukryte). */
  transforms?: BlockTransformOption[];
  onTransform?: (type: string) => void;
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
      const placement: "top" | "bottom" = spaceAbove < tRect.height + margin ? "bottom" : "top";
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
  }, []);

  // Ciągły pomiar szerokosci x wysokosci bloku (bez zaokrąglania w dół do 0,
  // gdy element jeszcze się nie zamountował). Aktualizacja przez
  // ResizeObserver - badge zawsze zna aktualne rozmiary renderu.
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.round(r.width), h: Math.round(r.height) });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.45 : 1,
  };

  const [copied, setCopied] = useState(false);
  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(props.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* noop */
    }
  };

  const [transformOpen, setTransformOpen] = useState(false);
  const hasTransforms = Boolean(props.transforms?.length && props.onTransform);
  const TypeIcon = props.typeIcon;

  const transformItems = (onPick: (type: string) => void) =>
    (props.transforms ?? []).map((option) => {
      const OptionIcon = option.icon;
      return (
        <button
          key={option.type}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPick(option.type);
          }}
          className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-accent text-left"
        >
          <OptionIcon className="w-4 h-4 text-muted-foreground" />
          {option.label}
        </button>
      );
    });

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={setRefs}
          style={style}
          data-block-id={props.id}
          onClick={props.onSelect}
          onContextMenu={() => props.onSelect()}
          aria-selected={props.selected || undefined}
          data-block-selected={props.selected ? "true" : undefined}
          className={`group relative pl-8 pr-3 pt-2 pb-2 scroll-mt-24 rounded-sm ${
            props.active
              ? "before:absolute before:left-0 before:top-1 before:bottom-1 before:w-0.5 before:bg-foreground before:rounded"
              : ""
          } ${props.selected ? "bg-foreground/10 ring-1 ring-foreground/20" : ""}`.trim()}
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

          {/* Badge typu/rozmiaru bloku ukryty - informacja dostępna w menu kontekstowym. */}

          <div
            ref={toolbarRef}
            style={{ left: toolbarPos.left, top: toolbarPos.top }}
            onClick={(e) => e.stopPropagation()}
            aria-hidden={!props.active}
            data-widget-toolbar="block"
            className={`absolute flex max-w-[min(100%,calc(100vw-1.5rem))] flex-wrap items-center gap-1 z-50 bg-popover border border-border rounded-md shadow-lg px-1 py-0.5 transition-all duration-150 ${
              props.active
                ? "opacity-100 visible pointer-events-auto translate-y-0"
                : "opacity-0 invisible pointer-events-none translate-y-1"
            }`}
          >
            {hasTransforms && (
              <>
                <Popover open={transformOpen} onOpenChange={setTransformOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      onClick={(e) => e.stopPropagation()}
                      title={t("blocks.transform.menuLabel", { defaultValue: "Przekształć w" })}
                      aria-label={t("blocks.transform.menuLabel", {
                        defaultValue: "Przekształć w",
                      })}
                      className="flex items-center gap-0.5 px-1.5 h-6 rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      {TypeIcon ? <TypeIcon className="w-3.5 h-3.5" /> : null}
                      <ChevronDown className="w-3 h-3" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    className="w-56 p-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <p className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                      {t("blocks.transform.menuLabel", { defaultValue: "Przekształć w" })}
                    </p>
                    <div className="max-h-72 overflow-y-auto">
                      {transformItems((type) => {
                        setTransformOpen(false);
                        props.onTransform?.(type);
                      })}
                    </div>
                  </PopoverContent>
                </Popover>
                <span aria-hidden className="mx-1 h-4 w-px bg-border" />
              </>
            )}

            {props.variants && props.variants.length > 1 && props.onVariantChange && (
              <>
                <div
                  className="flex items-center gap-0.5"
                  role="group"
                  aria-label={t("blocks.actions.variant")}
                >
                  {props.variants.map((v) => {
                    const isCurrent = v.key === props.currentVariant;
                    return (
                      <button
                        key={v.key}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!isCurrent) props.onVariantChange!(v.key);
                        }}
                        aria-pressed={isCurrent}
                        title={v.label}
                        className={`px-2 h-6 text-[11px] font-medium rounded transition-colors ${
                          isCurrent
                            ? "bg-foreground text-background"
                            : "text-muted-foreground hover:bg-accent hover:text-foreground"
                        }`}
                      >
                        {v.label}
                      </button>
                    );
                  })}
                </div>
                <span aria-hidden className="mx-1 h-4 w-px bg-border" />
              </>
            )}

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

          {props.children}
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className="w-60">
        <ContextMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {props.typeLabel || t("blocks.actions.block")}
          {size.w && size.h ? ` · ${size.w}×${size.h}px` : ""}
        </ContextMenuLabel>
        <ContextMenuSeparator />

        {props.variants && props.variants.length > 1 && props.onVariantChange && (
          <>
            <ContextMenuSub>
              <ContextMenuSubTrigger>{t("blocks.actions.variant")}</ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuRadioGroup
                  value={props.currentVariant ?? ""}
                  onValueChange={(v) => props.onVariantChange?.(v)}
                >
                  {props.variants.map((v) => (
                    <ContextMenuRadioItem key={v.key} value={v.key}>
                      {v.label}
                    </ContextMenuRadioItem>
                  ))}
                </ContextMenuRadioGroup>
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSeparator />
          </>
        )}

        {hasTransforms && (
          <>
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                {t("blocks.transform.menuLabel", { defaultValue: "Przekształć w" })}
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="max-h-72 overflow-y-auto">
                {(props.transforms ?? []).map((option) => {
                  const OptionIcon = option.icon;
                  return (
                    <ContextMenuItem
                      key={option.type}
                      onSelect={() => props.onTransform?.(option.type)}
                    >
                      <OptionIcon className="w-3.5 h-3.5 mr-2" />
                      {option.label}
                    </ContextMenuItem>
                  );
                })}
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSeparator />
          </>
        )}

        <ContextMenuItem disabled={props.index === 0} onSelect={() => props.onMove(-1)}>
          <ChevronUp className="w-3.5 h-3.5 mr-2" />
          {t("blocks.actions.up")}
        </ContextMenuItem>
        <ContextMenuItem
          disabled={props.index === props.total - 1}
          onSelect={() => props.onMove(1)}
        >
          <ChevronDown className="w-3.5 h-3.5 mr-2" />
          {t("blocks.actions.down")}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => props.onDuplicate()}>
          <Copy className="w-3.5 h-3.5 mr-2" />
          {t("blocks.actions.duplicate")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => void copyId()}>
          {copied ? (
            <Check className="w-3.5 h-3.5 mr-2" />
          ) : (
            <LinkIcon className="w-3.5 h-3.5 mr-2" />
          )}
          {t("blocks.actions.copyId")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          className="text-destructive focus:text-destructive"
          onSelect={() => props.onRemove()}
        >
          <Trash2 className="w-3.5 h-3.5 mr-2" />
          {t("blocks.actions.remove")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
