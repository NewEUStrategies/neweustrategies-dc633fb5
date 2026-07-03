import { Plus } from "@/lib/lucide-shim";
import { StructurePicker } from "../../../StructurePicker";

export function EmptyState({
  onAdd,
  title,
  hint,
  onLoadHomepage,
}: {
  onAdd: (spans: number[]) => void;
  title?: string;
  hint?: string;
  onLoadHomepage?: () => void;
}) {
  return (
    <div
      data-section-inserter
      className="bg-card/60 border-2 border-dashed border-brand/40 rounded-lg p-8 my-4"
    >
      <div className="text-center mb-5">
        <div className="mx-auto w-10 h-10 rounded-full bg-brand/10 text-brand inline-flex items-center justify-center mb-3">
          <Plus className="w-5 h-5" />
        </div>
        <h3 className="text-sm font-semibold mb-1">{title ?? "Zacznij budować stronę"}</h3>
        <p className="text-xs text-muted-foreground">
          {hint ?? "Wybierz strukturę pierwszej sekcji."}
        </p>
        {onLoadHomepage && (
          <button
            type="button"
            onClick={onLoadHomepage}
            className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-brand text-brand-foreground text-xs font-semibold hover:opacity-90 transition"
          >
            <Plus className="w-3.5 h-3.5" />
            Wczytaj layout strony głównej
          </button>
        )}
      </div>
      <div className="max-w-3xl mx-auto">
        <StructurePicker onPick={onAdd} cols={4} />
      </div>
    </div>
  );
}
