// Host for the shared confirm/prompt dialogs (lib/appDialogs.ts). Mounted
// once in __root.tsx - callers anywhere in the tree just await
// confirmDialog()/promptDialog() instead of window.confirm()/window.prompt().
import { useEffect, useId, useState, type FormEvent } from "react";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { subscribeAppDialog, type PendingDialog } from "@/lib/appDialogs";
export function AppDialogHost() {
  const [pending, setPending] = useState<PendingDialog | null>(null);
  const [value, setValue] = useState("");
  const inputId = useId();
  const { t } = useTranslation();

  useEffect(
    () =>
      subscribeAppDialog((p) => {
        setPending(p);
        if (p?.request.kind === "prompt") setValue(p.request.defaultValue ?? "");
      }),
    [],
  );

  if (!pending) return null;
  const req = pending.request;
  const cancelLabel = req.cancelLabel ?? t("common.cancel");

  if (req.kind === "confirm") {
    const confirmLabel = req.confirmLabel ?? (isPl ? "Potwierdź" : "Confirm");
    return (
      <AlertDialog
        open
        onOpenChange={(next) => {
          if (!next) pending.resolve(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{req.title}</AlertDialogTitle>
            {req.description && <AlertDialogDescription>{req.description}</AlertDialogDescription>}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => pending.resolve(false)}>
              {cancelLabel}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => pending.resolve(true)}
              className={
                req.destructive
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : undefined
              }
            >
              {confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  const confirmLabel = req.confirmLabel ?? (isPl ? "Zapisz" : "Save");
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    pending.resolve(value);
  };
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) pending.resolve(null);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{req.title}</DialogTitle>
            {req.description && <DialogDescription>{req.description}</DialogDescription>}
          </DialogHeader>
          <div className="py-4 space-y-2">
            {req.label && <Label htmlFor={inputId}>{req.label}</Label>}
            <Input
              id={inputId}
              value={value}
              placeholder={req.placeholder}
              onChange={(e) => setValue(e.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => pending.resolve(null)}>
              {cancelLabel}
            </Button>
            <Button type="submit">{confirmLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
