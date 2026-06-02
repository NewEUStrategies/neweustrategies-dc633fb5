import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Trash2, X, Check, Layers } from "@/lib/lucide-shim";

export type BulkStatus = "draft" | "published" | "archived";

interface Props {
  count: number;
  onClear: () => void;
  onApplyStatus: (status: BulkStatus) => Promise<void> | void;
  onDelete: () => Promise<void> | void;
  onMigrateToBlocks?: () => Promise<void> | void;
}

export function BulkActionsBar({ count, onClear, onApplyStatus, onDelete }: Props) {
  const [status, setStatus] = useState<BulkStatus | "">("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  if (count === 0) return null;

  const apply = async () => {
    if (!status) return;
    setBusy(true);
    try { await onApplyStatus(status); setStatus(""); } finally { setBusy(false); }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-muted/40 border-b border-border text-sm">
        <span className="font-medium">{count} zaznaczonych</span>
        <Button size="sm" variant="ghost" onClick={onClear} className="h-7 px-2">
          <X className="w-3.5 h-3.5 mr-1" /> Wyczyść
        </Button>
        <div className="mx-2 h-4 w-px bg-border" />
        <span className="text-muted-foreground">Zmień status:</span>
        <Select value={status} onValueChange={(v) => setStatus(v as BulkStatus)}>
          <SelectTrigger className="h-7 w-36"><SelectValue placeholder="Wybierz..." /></SelectTrigger>
          <SelectContent>
            <SelectItem value="draft">Szkic</SelectItem>
            <SelectItem value="published">Opublikowany</SelectItem>
            <SelectItem value="archived">Zarchiwizowany</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" variant="secondary" onClick={apply} disabled={!status || busy} className="h-7">
          <Check className="w-3.5 h-3.5 mr-1" /> Zastosuj
        </Button>
        <div className="ml-auto">
          <Button size="sm" variant="destructive" onClick={() => setConfirmDelete(true)} disabled={busy} className="h-7">
            <Trash2 className="w-3.5 h-3.5 mr-1" /> Usuń zaznaczone
          </Button>
        </div>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Usunąć {count} elementów?</AlertDialogTitle>
            <AlertDialogDescription>
              Tej operacji nie można cofnąć. Zaznaczone elementy zostaną trwale usunięte.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Anuluj</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => { setBusy(true); try { await onDelete(); } finally { setBusy(false); setConfirmDelete(false); } }}
            >
              Usuń
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
