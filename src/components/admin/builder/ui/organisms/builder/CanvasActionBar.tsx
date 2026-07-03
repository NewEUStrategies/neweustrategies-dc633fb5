import { Undo, Redo, Trash2 } from "@/lib/lucide-shim";
import type { Selection } from "./types";

export function CanvasActionBar({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  selection,
  onDelete,
}: {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  selection: Selection;
  onDelete: () => void;
}) {
  const hasSel = !!selection.id && selection.kind !== null && selection.kind !== "inner-section";
  const kindLabel =
    selection.kind === "section"
      ? "sekcję"
      : selection.kind === "column"
        ? "kolumnę"
        : selection.kind === "widget"
          ? "widget"
          : "";
  return (
    <div className="sticky top-0 z-30 mb-2 flex items-center gap-1 px-2 py-1.5 bg-card/95 backdrop-blur border border-border rounded-md shadow-sm">
      <button
        type="button"
        onClick={onUndo}
        disabled={!canUndo}
        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded hover:bg-muted disabled:opacity-30"
        title="Cofnij (Ctrl/Cmd+Z)"
      >
        <Undo className="w-3.5 h-3.5" /> Cofnij
      </button>
      <button
        type="button"
        onClick={onRedo}
        disabled={!canRedo}
        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded hover:bg-muted disabled:opacity-30"
        title="Ponów (Ctrl/Cmd+Shift+Z)"
      >
        <Redo className="w-3.5 h-3.5" /> Ponów
      </button>
      <div className="w-px h-5 bg-border mx-1" />
      <button
        type="button"
        onClick={onDelete}
        disabled={!hasSel}
        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded text-destructive hover:bg-destructive/10 disabled:opacity-30 disabled:text-muted-foreground"
        title="Usuń zaznaczony element (Delete)"
      >
        <Trash2 className="w-3.5 h-3.5" />
        {hasSel ? `Usuń ${kindLabel}` : "Nic nie wybrano"}
      </button>
    </div>
  );
}
