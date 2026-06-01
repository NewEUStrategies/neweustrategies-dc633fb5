import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";

export type DeleteKind = "section" | "column" | "widget";

const LABELS: Record<DeleteKind, { title: string; desc: string }> = {
  section: { title: "Usunąć sekcję?", desc: "Sekcja wraz ze wszystkimi kolumnami i widgetami zostanie usunięta. Operację możesz cofnąć skrótem Ctrl+Z." },
  column:  { title: "Usunąć kolumnę?", desc: "Kolumna wraz ze wszystkimi widgetami zostanie usunięta. Operację możesz cofnąć skrótem Ctrl+Z." },
  widget:  { title: "Usunąć widget?",  desc: "Widget zostanie usunięty. Operację możesz cofnąć skrótem Ctrl+Z." },
};

export function ConfirmDeleteDialog({
  pending, onCancel, onConfirm,
}: {
  pending: { kind: DeleteKind; id: string } | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const open = !!pending;
  const copy = pending ? LABELS[pending.kind] : LABELS.widget;
  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.title}</AlertDialogTitle>
          <AlertDialogDescription>{copy.desc}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Anuluj</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={onConfirm}
            autoFocus
          >
            Usuń
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
