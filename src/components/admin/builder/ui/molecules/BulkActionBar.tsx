// Floating action bar shown when multiple widgets are marquee-selected.
// Renders bulk operations (duplicate, delete, copy, clear) so the editor can
// act on many widgets at once without switching the sidebar to a different
// mode. Rendered outside VisualCanvas so it isn't affected by the canvas
// pointer-events reset used to kill link navigation inside the preview.
import { Copy, Trash2, Plus, X } from "@/lib/lucide-shim";

interface Props {
  count: number;
  onDuplicate: () => void;
  onDelete: () => void;
  onCopy: () => void;
  onClear: () => void;
}

export function BulkActionBar({ count, onDuplicate, onDelete, onCopy, onClear }: Props) {
  if (count < 1) return null;
  return (
    <div
      role="toolbar"
      aria-label="Zaznaczone widgety"
      data-builder-chrome
      className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2 inline-flex items-center gap-2 rounded-full border border-border bg-card/95 px-3 py-2 shadow-lg backdrop-blur"
    >
      <span className="pl-1 pr-2 text-xs font-medium">
        Zaznaczono <span className="font-semibold text-brand">{count}</span>{" "}
        {count === 1 ? "widget" : count < 5 ? "widgety" : "widgetów"}
      </span>
      <span aria-hidden className="h-4 w-px bg-border" />
      <button
        type="button"
        onClick={onCopy}
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs hover:bg-muted"
        title="Kopiuj (Ctrl/⌘+C)"
      >
        <Copy className="h-3.5 w-3.5" />
        Kopiuj
      </button>
      <button
        type="button"
        onClick={onDuplicate}
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs hover:bg-muted"
        title="Duplikuj (Ctrl/⌘+D)"
      >
        <Plus className="h-3.5 w-3.5" />
        Duplikuj
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
        title="Usuń (Delete)"
      >
        <Trash2 className="h-3.5 w-3.5" />
        Usuń
      </button>
      <span aria-hidden className="h-4 w-px bg-border" />
      <button
        type="button"
        onClick={onClear}
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
        title="Odznacz (Esc)"
      >
        <X className="h-3.5 w-3.5" />
        Odznacz
      </button>
    </div>
  );
}
