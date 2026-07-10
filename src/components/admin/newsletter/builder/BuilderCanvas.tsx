// BuilderCanvas - lista widgetow z @dnd-kit/sortable dla pojedynczej sekcji.
// Kazda sekcja przekazuje wlasny `sectionId` - dzieki temu droppable IDs sa
// namespaceowane i widgety mozna DnD-owac takze pomiedzy sekcjami.
// Rozpoznawane IDs:
//   - "sec-{sectionId}-drop"       -> single layout empty drop
//   - "sec-{sectionId}-col-0"      -> pierwsza kolumna
//   - "sec-{sectionId}-col-1"      -> druga kolumna
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Copy, GripVertical, Trash2 } from "lucide-react";
import type { NlWidget, NlLang, NlSectionLayout } from "@/lib/newsletter-builder/types";
import { WidgetPreview } from "./WidgetPreview";

const LAYOUT_GRID: Record<Exclude<NlSectionLayout, "single">, string> = {
  "1-1": "md:grid-cols-[1fr_1fr]",
};

export interface BuilderCanvasProps {
  sectionId: string;
  widgets: NlWidget[];
  lang: NlLang;
  layout?: NlSectionLayout;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
}

export function BuilderCanvas({
  sectionId,
  widgets,
  lang,
  layout = "single",
  selectedId,
  onSelect,
  onRemove,
  onDuplicate,
}: BuilderCanvasProps) {
  if (layout === "single") {
    return (
      <ColumnDropZone
        id={`sec-${sectionId}-drop`}
        sectionId={sectionId}
        widgets={widgets.filter((w) => !w.col)}
        lang={lang}
        selectedId={selectedId}
        onSelect={onSelect}
        onRemove={onRemove}
        onDuplicate={onDuplicate}
      />
    );
  }

  const col0 = widgets.filter((w) => (w.col ?? 0) === 0);
  const col1 = widgets.filter((w) => w.col === 1);

  return (
    <div className={`grid grid-cols-1 ${LAYOUT_GRID[layout]} gap-3`}>
      <ColumnDropZone
        id={`sec-${sectionId}-col-0`}
        sectionId={sectionId}
        widgets={col0}
        lang={lang}
        selectedId={selectedId}
        onSelect={onSelect}
        onRemove={onRemove}
        onDuplicate={onDuplicate}
        columnLabel={lang === "pl" ? "Kolumna 1" : "Column 1"}
      />
      <ColumnDropZone
        id={`sec-${sectionId}-col-1`}
        sectionId={sectionId}
        widgets={col1}
        lang={lang}
        selectedId={selectedId}
        onSelect={onSelect}
        onRemove={onRemove}
        onDuplicate={onDuplicate}
        columnLabel={lang === "pl" ? "Kolumna 2" : "Column 2"}
      />
    </div>
  );
}

function ColumnDropZone({
  id,
  widgets,
  lang,
  selectedId,
  onSelect,
  onRemove,
  onDuplicate,
  columnLabel,
}: {
  id: string;
  sectionId: string;
  widgets: NlWidget[];
  lang: NlLang;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
  columnLabel?: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <SortableContext items={widgets.map((w) => w.id)} strategy={verticalListSortingStrategy}>
      <div
        ref={setNodeRef}
        className={
          "space-y-2 rounded-lg transition-colors " +
          (columnLabel ? "border border-dashed p-2 min-h-[160px] " : "min-h-[120px] ") +
          (isOver ? "border-primary bg-primary/5" : columnLabel ? "border-border/50" : "")
        }
      >
        {columnLabel && (
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 px-1">
            {columnLabel}
          </div>
        )}
        {widgets.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-center text-xs text-muted-foreground opacity-70">
            {lang === "pl" ? "Upusc widget tutaj" : "Drop widget here"}
          </div>
        ) : (
          widgets.map((w) => (
            <SortableItem
              key={w.id}
              widget={w}
              lang={lang}
              selected={w.id === selectedId}
              onSelect={() => onSelect(w.id)}
              onRemove={() => onRemove(w.id)}
              onDuplicate={() => onDuplicate(w.id)}
            />
          ))
        )}
      </div>
    </SortableContext>
  );
}

function SortableItem({
  widget,
  lang,
  selected,
  onSelect,
  onRemove,
  onDuplicate,
}: {
  widget: NlWidget;
  lang: NlLang;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onDuplicate: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: widget.id,
    data: { kind: "widget", col: widget.col ?? 0 },
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={
        "group relative rounded-lg border transition-all " +
        (selected
          ? "border-primary ring-2 ring-primary/30"
          : "border-transparent hover:border-primary/30") +
        (isDragging ? " opacity-40" : "")
      }
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="absolute -left-6 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 text-muted-foreground cursor-grab active:cursor-grabbing p-1"
        aria-label={lang === "pl" ? "Przenies" : "Move"}
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical className="w-4 h-4" />
      </button>
      <div className="absolute -top-3 right-2 z-10 hidden group-hover:flex items-center gap-1 bg-card border border-border rounded-md shadow-sm">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDuplicate();
          }}
          className="p-1 text-muted-foreground hover:text-foreground"
          aria-label={lang === "pl" ? "Duplikuj" : "Duplicate"}
        >
          <Copy className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="p-1 text-destructive hover:bg-destructive/10 rounded-r"
          aria-label={lang === "pl" ? "Usun" : "Remove"}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="p-2">
        <WidgetPreview widget={widget} lang={lang} />
      </div>
    </div>
  );
}
