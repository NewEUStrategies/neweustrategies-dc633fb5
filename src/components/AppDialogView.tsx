// Ciało wspólnych okien `confirm`/`prompt`. ŚWIADOMIE osobny moduł: to jedyne
// miejsce w tej parze plików, które importuje Radiksa (`dialog`,
// `alert-dialog`) razem z polami formularza, więc import dynamiczny z hosta
// trzyma `vendor-radix` poza bootem każdej strony. Host (`AppDialogHost`)
// montuje ten moduł dopiero wtedy, gdy ktoś naprawdę o okno poprosi.
//
// Stan pola tekstowego zostaje W HOŚCIE (zwykły `useState`, bez Radiksa):
// zgłoszenie zasiewa `defaultValue` w chwili nadejścia, więc nowe pytanie nie
// może zastać starej treści. Tu przyjeżdża już gotową parą wartość/setter.
import { useId, type FormEvent } from "react";
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
import type { PendingDialog } from "@/lib/appDialogs";

export function AppDialogView({
  pending,
  value,
  onValueChange,
}: {
  pending: PendingDialog;
  value: string;
  onValueChange: (next: string) => void;
}) {
  const inputId = useId();
  const { t } = useTranslation();

  const req = pending.request;
  const cancelLabel = req.cancelLabel ?? t("common.cancel");

  if (req.kind === "confirm") {
    const confirmLabel = req.confirmLabel ?? t("common.confirm");
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

  const confirmLabel = req.confirmLabel ?? t("common.save");
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
              onChange={(e) => onValueChange(e.target.value)}
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
