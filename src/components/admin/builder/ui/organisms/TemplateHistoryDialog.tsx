// Dialog showing revision history for a section template.
// Allows: insert a revision as a new section into canvas,
// or restore a revision as the current template content (creates a new revision via DB trigger).
import {
  useTemplateRevisions,
  type SectionTemplate,
  type TemplateRevision,
} from "@/lib/builder/templates";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Clock, Undo as RotateCcw, Plus } from "@/lib/lucide-shim";

interface Props {
  template: SectionTemplate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInsert: (rev: TemplateRevision) => void;
  onRestore: (rev: TemplateRevision) => void;
}

function fmt(iso: string): string {
  try {
    return new Date(iso).toLocaleString("pl-PL", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export function TemplateHistoryDialog({
  template,
  open,
  onOpenChange,
  onInsert,
  onRestore,
}: Props) {
  const { items, loading } = useTemplateRevisions(open ? (template?.id ?? null) : null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="inline-flex items-center gap-2">
            <Clock className="w-4 h-4" /> Historia: {template?.name ?? ""}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Każda zmiana szablonu jest automatycznie zapisywana. Możesz wstawić starszą wersję jako
            nową sekcję na canvasie lub przywrócić ją jako aktualną treść szablonu.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="text-xs text-muted-foreground py-6 text-center">Ładowanie historii…</div>
        ) : items.length === 0 ? (
          <div className="text-xs text-muted-foreground py-6 text-center">Brak rewizji.</div>
        ) : (
          <ul className="space-y-1.5 max-h-[60vh] overflow-y-auto">
            {items.map((r, idx) => (
              <li
                key={r.id}
                className="flex items-center gap-2 p-2 border border-border rounded text-xs"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">
                    {idx === 0 ? "Aktualna" : `Wersja #${items.length - idx}`}
                    <span className="text-muted-foreground font-normal"> · {r.name}</span>
                  </div>
                  <div className="text-muted-foreground text-[10px]">{fmt(r.created_at)}</div>
                </div>
                <button
                  type="button"
                  onClick={() => onInsert(r)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-muted border border-border"
                  title="Wstaw tę wersję jako nową sekcję"
                >
                  <Plus className="w-3 h-3" /> Wstaw
                </button>
                {idx !== 0 && (
                  <button
                    type="button"
                    onClick={() => onRestore(r)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-brand hover:text-brand-foreground border border-border"
                    title="Przywróć jako aktualną treść szablonu"
                  >
                    <RotateCcw className="w-3 h-3" /> Przywróć
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
