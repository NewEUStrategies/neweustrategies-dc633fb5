// Host component: renders the styled leave-confirmation dialog whenever the
// unsaved-changes store has a pending prompt. Mounted once in __root.tsx.
import { useEffect, useState } from "react";
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
import {
  resolveLeaveConfirmation,
  subscribeLeaveConfirmation,
} from "@/lib/unsavedChanges";

export function UnsavedChangesGuardHost() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  useEffect(() => subscribeLeaveConfirmation((p) => setOpen(p !== null)), []);

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) resolveLeaveConfirmation(false);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("admin.unsavedChangesTitle", { defaultValue: "Niezapisane zmiany" })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("admin.unsavedChanges", {
              defaultValue:
                "Masz niezapisane zmiany - czy na pewno chcesz opuścić edytor?",
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => resolveLeaveConfirmation(false)}>
            {t("admin.stay", { defaultValue: "Zostań" })}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => resolveLeaveConfirmation(true)}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {t("admin.leave", { defaultValue: "Opuść bez zapisania" })}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
