// Ciało okna „niezapisane zmiany". ŚWIADOMIE osobny moduł: to jedyne miejsce
// w tej parze plików, które importuje Radiksa (`alert-dialog`), więc import
// dynamiczny z hosta trzyma `vendor-radix` poza bootem każdej strony. Host
// (`UnsavedChangesGuardHost`) montuje ten moduł dopiero, gdy jest o co pytać.
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { resolveLeaveConfirmation } from "@/lib/unsavedChanges";

export function UnsavedChangesGuardDialog() {
  const { t } = useTranslation();

  return (
    <AlertDialog
      open
      onOpenChange={(next) => {
        if (!next) resolveLeaveConfirmation(false);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("admin.unsavedChangesTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("admin.unsavedChanges")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => resolveLeaveConfirmation(false)}>
            {t("admin.stay")}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => resolveLeaveConfirmation(true)}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {t("admin.leave")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
