// Atom: „Przywróć domyślne" - JEDEN wygląd i JEDNA umowa w całym panelu.
//
// PO CO. Do 2026-11 ten sam przycisk istniał w kilkunastu wersjach: podkreślony
// link 12 px obok „Zapisz" (preferowane źródło Google, baner cookies), obrys bez
// ikony, „ghost" z ikoną albo surowy `<button>` - a reset całego formularza
// raz pytał o zgodę natywnym `confirm()`, a raz kasował pracę bez słowa.
// Atom narzuca: obrys + ikona cofnięcia, wysokość sąsiedniego „Zapisz",
// podpis PL/EN ze słownika panelu i opcjonalne potwierdzenie w oknie
// dialogowym platformy zamiast natywnego `confirm()`. Domyślnie BEZ okna:
// reset podmienia tylko niezapisany szkic, więc jest odwracalny (nie
// klikając „Zapisz"); okno włącza panel, który świadomie o to prosi.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";

export interface RestoreDefaultsButtonProps {
  onRestore: () => void;
  /** Własny podpis modułu; domyślnie „Przywróć domyślne" / „Restore defaults". */
  label?: string;
  /**
   * Potwierdzenie przed resetem. `true` = treść ogólna, napis = własna treść,
   * `false` (domyślnie) = bez okna, bo reset dotyczy niezapisanego szkicu.
   */
  confirm?: boolean | string;
  disabled?: boolean;
  size?: "sm" | "default";
  className?: string;
}

export function RestoreDefaultsButton({
  onRestore,
  label,
  confirm = false,
  disabled = false,
  size = "default",
  className,
}: RestoreDefaultsButtonProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const text = label ?? t("admin.restoreDefaults.label");

  const trigger = (
    <Button
      type="button"
      variant="outline"
      size={size}
      disabled={disabled}
      onClick={() => (confirm ? setOpen(true) : onRestore())}
      className={cn(
        "gap-1.5 text-muted-foreground hover:text-foreground",
        size === "sm" && "[&_svg]:size-3.5",
        className,
      )}
    >
      <RotateCcw aria-hidden="true" />
      {text}
    </Button>
  );

  if (!confirm) return trigger;

  return (
    <>
      {trigger}
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("admin.restoreDefaults.confirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {typeof confirm === "string" ? confirm : t("admin.restoreDefaults.confirmBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("admin.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onRestore();
                setOpen(false);
              }}
            >
              <RotateCcw className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {t("admin.restoreDefaults.confirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
