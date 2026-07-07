// BuilderCanvas - lista widgetow z @dnd-kit/sortable.
// Zaznaczenie klikniete widgeta, hover pokazuje toolbar (dup / usun).
import { useDroppable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Copy, GripVertical, Trash2 } from "lucide-react";
import type { NlWidget, NlLang } from "@/lib/newsletter-builder/types";
import { WidgetPreview } from "./WidgetPreview";

export function BuilderCanvas({
  widgets,
  lang,
  selectedId,
  onSelect,
  onRemove,
  onDuplicate,
}: {
  widgets: NlWidget[];
  lang: NlLang;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: "canvas-drop" });

  if (widgets.length === 0) {
    return (
      <div
        ref={setNodeRef}
        className={
          "flex flex-col items-center justify-center py-24 text-center border-2 border-dashed rounded-xl transition-colors " +
          (isOver ? "border-primary bg-primary/5" : "border-border/60 text-muted-foreground")
        }
      >
        <p className="text-sm font-medium">
          {lang === "pl" ? "Przeciagnij widget z lewego panelu" : "Drag a widget from the left panel"}
        </p>
        <p className="text-xs mt-1 opacity-70">
          {lang === "pl" ? "lub kliknij aby dodac na koniec" : "or click to append"}
        </p>
      </div>
    );
  }

  return (
    <div ref={setNodeRef} className={"space-y-2 " + (isOver ? "outline outline-2 outline-primary/40 outline-offset-4 rounded-lg" : "")}>
      {widgets.map((w) => (
        <SortableItem
          key={w.id}
          widget={w}
          lang={lang}
          selected={w.id === selectedId}
          onSelect={() => onSelect(w.id)}
          onRemove={() => onRemove(w.id)}
          onDuplicate={() => onDuplicate(w.id)}
        />
      ))}
    </div>
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
        aria-label="Przenies"
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
          aria-label="Duplikuj"
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
          aria-label="Usun"
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
