import { useTranslation } from "react-i18next";
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
import "@/lib/i18n-builder";

export type DeleteKind = "section" | "column" | "widget";

export function ConfirmDeleteDialog({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: { kind: DeleteKind; id: string } | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  const LABELS: Record<DeleteKind, { title: string; desc: string }> = {
    section: {
      title: t("builder.confirmDelete.sectionTitle"),
      desc: t("builder.confirmDelete.sectionDesc"),
    },
    column: {
      title: t("builder.confirmDelete.columnTitle"),
      desc: t("builder.confirmDelete.columnDesc"),
    },
    widget: {
      title: t("builder.confirmDelete.widgetTitle"),
      desc: t("builder.confirmDelete.widgetDesc"),
    },
  };
  const open = !!pending;
  const copy = pending ? LABELS[pending.kind] : LABELS.widget;
  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.title}</AlertDialogTitle>
          <AlertDialogDescription>{copy.desc}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("builder.common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={onConfirm}
            autoFocus
          >
            {t("builder.common.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
