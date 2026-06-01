import { useState } from "react";
import { Plus, Trash2 } from "@/lib/lucide-shim";
import { StructurePicker } from "../../../StructurePicker";

export function SectionDropZone({
  onInsert, index, prominent, label,
  onRemoveAbove, onRemoveBelow,
}: {
  onInsert: (spans: number[]) => void; index: number;
  prominent?: boolean; label?: string;
  onRemoveAbove?: () => void;
  onRemoveBelow?: () => void;
}) {
  const [open, setOpen] = useState(false);
  if (open) {
    return (
      <div data-section-inserter className="my-2 p-2 border border-brand/60 rounded bg-card shadow-sm" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2 gap-2">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Wybierz strukturę</span>
          <div className="flex items-center gap-1">
            {onRemoveAbove && (
              <button
                type="button"
                onClick={() => { onRemoveAbove(); setOpen(false); }}
                title="Usuń sekcję powyżej"
                className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] text-destructive hover:bg-destructive/10 rounded"
              >
                <Trash2 className="w-3 h-3" />
                Usuń ↑ powyżej
              </button>
            )}
            {onRemoveBelow && (
              <button
                type="button"
                onClick={() => { onRemoveBelow(); setOpen(false); }}
                title="Usuń sekcję poniżej"
                className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] text-destructive hover:bg-destructive/10 rounded"
              >
                <Trash2 className="w-3 h-3" />
                Usuń ↓ poniżej
              </button>
            )}
            <button type="button" onClick={() => setOpen(false)} className="px-1 text-[11px] text-muted-foreground hover:text-foreground">×</button>
          </div>
        </div>
        <StructurePicker onPick={(s) => { onInsert(s); setOpen(false); }} cols={7} compact />
      </div>
    );
  }
  return (
    <div data-section-inserter className="my-1 group" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={label ?? `Wstaw sekcję w pozycji ${index + 1}`}
        className={`w-full rounded inline-flex items-center justify-center gap-1.5 text-[10px] transition ${
          prominent
            ? "h-[42px] border border-dashed border-brand/40 text-brand/80 hover:border-brand hover:bg-brand/5"
            : "h-5 border border-dashed border-transparent text-muted-foreground group-hover:border-brand/40 group-hover:text-brand"
        }`}
      >
        <Plus className={`w-3 h-3 ${prominent ? "" : "opacity-0 group-hover:opacity-100"}`} />
        {label && <span>{label}</span>}
      </button>
    </div>
  );
}

