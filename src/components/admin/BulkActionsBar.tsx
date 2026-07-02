import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Trash2, X, Check, Layers } from "@/lib/lucide-shim";

export type BulkStatus = "draft" | "pending_review" | "published" | "archived";

const DEFAULT_STATUSES: BulkStatus[] = ["draft", "published", "archived"];

interface Props {
  count: number;
  onClear: () => void;
  onApplyStatus: (status: BulkStatus) => Promise<void> | void;
  onDelete: () => Promise<void> | void;
  onMigrateToBlocks?: () => Promise<void> | void;
  /** Selectable statuses; posts add pending_review and gate published by role. */
  statuses?: BulkStatus[];
}

export function BulkActionsBar({
  count,
  onClear,
  onApplyStatus,
  onDelete,
  onMigrateToBlocks,
  statuses = DEFAULT_STATUSES,
}: Props) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<BulkStatus | "">("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  if (count === 0) return null;

  const apply = async () => {
    if (!status) return;
    setBusy(true);
    try {
      await onApplyStatus(status);
      setStatus("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-muted/40 border-b border-border text-sm">
        <span className="font-medium">
          {t("admin.bulk.selected", { defaultValue: "{{count}} zaznaczonych", count })}
        </span>
        <Button size="sm" variant="ghost" onClick={onClear} className="h-7 px-2">
          <X className="w-3.5 h-3.5 mr-1" /> {t("admin.list.clear", { defaultValue: "Wyczyść" })}
        </Button>
        <div className="mx-2 h-4 w-px bg-border" />
        <span className="text-muted-foreground">
          {t("admin.bulk.changeStatus", { defaultValue: "Zmień status:" })}
        </span>
        <Select value={status} onValueChange={(v) => setStatus(v as BulkStatus)}>
          <SelectTrigger className="h-7 w-40">
            <SelectValue placeholder={t("admin.bulk.pick", { defaultValue: "Wybierz..." })} />
          </SelectTrigger>
          <SelectContent>
            {statuses.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`admin.status.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="secondary"
          onClick={apply}
          disabled={!status || busy}
          className="h-7"
        >
          <Check className="w-3.5 h-3.5 mr-1" />{" "}
          {t("admin.bulk.apply", { defaultValue: "Zastosuj" })}
        </Button>
        <div className="ml-auto flex items-center gap-2">
          {onMigrateToBlocks && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onMigrateToBlocks()}
              disabled={busy}
              className="h-7"
            >
              <Layers className="w-3.5 h-3.5 mr-1" />
              {t("admin.bulk.migrateToBlocks", { defaultValue: "Konwertuj na bloki" })}
            </Button>
          )}
          <Button
            size="sm"
            variant="destructive"
            onClick={() => setConfirmDelete(true)}
            disabled={busy}
            className="h-7"
          >
            <Trash2 className="w-3.5 h-3.5 mr-1" />
            {t("admin.bulk.deleteSelected", { defaultValue: "Usuń zaznaczone" })}
          </Button>
        </div>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("admin.bulk.confirmDeleteTitle", {
                defaultValue: "Usunąć {{count}} elementów?",
                count,
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin.bulk.confirmDeleteDescription", {
                defaultValue:
                  "Tej operacji nie można cofnąć. Zaznaczone elementy zostaną trwale usunięte.",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("admin.bulk.cancel", { defaultValue: "Anuluj" })}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                setBusy(true);
                try {
                  await onDelete();
                } finally {
                  setBusy(false);
                  setConfirmDelete(false);
                }
              }}
            >
              {t("admin.bulk.delete", { defaultValue: "Usuń" })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
