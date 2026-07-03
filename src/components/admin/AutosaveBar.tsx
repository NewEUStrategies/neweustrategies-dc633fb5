// AutosaveBar - compact toolbar showing save status + undo/redo buttons.
// Atom-level UI; receives all state via props (no internal logic).
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Undo2, Redo2, Check, Loader2, AlertTriangle, Circle, RotateCcw } from "@/lib/lucide-shim";
import type { AutosaveStatus } from "@/hooks/useAutosave";

interface Props {
  status: AutosaveStatus;
  error: string | null;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onDiscard?: () => void;
}

export function AutosaveBar({ status, error, canUndo, canRedo, onUndo, onRedo, onDiscard }: Props) {
  const { t } = useTranslation();

  const label =
    status === "saving"
      ? t("admin.autosave.saving", { defaultValue: "Zapisywanie..." })
      : status === "saved"
        ? t("admin.autosave.saved", { defaultValue: "Zapisano" })
        : status === "dirty"
          ? t("admin.autosave.dirty", { defaultValue: "Niezapisane zmiany" })
          : status === "error"
            ? (error ?? t("admin.autosave.error", { defaultValue: "Błąd zapisu" }))
            : t("admin.autosave.idle", { defaultValue: "Gotowe" });

  const Icon =
    status === "saving"
      ? Loader2
      : status === "saved"
        ? Check
        : status === "error"
          ? AlertTriangle
          : Circle;

  const tone =
    status === "error"
      ? "text-destructive"
      : status === "saved"
        ? "text-emerald-600 dark:text-emerald-400"
        : status === "saving"
          ? "text-muted-foreground"
          : "text-muted-foreground";

  return (
    <div className="inline-flex items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={onUndo}
        disabled={!canUndo}
        aria-label={t("admin.autosave.undo", { defaultValue: "Cofnij" })}
        title={t("admin.autosave.undo", { defaultValue: "Cofnij" })}
      >
        <Undo2 className="w-4 h-4" />
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={onRedo}
        disabled={!canRedo}
        aria-label={t("admin.autosave.redo", { defaultValue: "Ponów" })}
        title={t("admin.autosave.redo", { defaultValue: "Ponów" })}
      >
        <Redo2 className="w-4 h-4" />
      </Button>
      <span className={`inline-flex items-center gap-1.5 text-xs ${tone}`} aria-live="polite">
        <Icon className={`w-3.5 h-3.5 ${status === "saving" ? "animate-spin" : ""}`} />
        {label}
      </span>
      {onDiscard && status === "dirty" && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            if (
              window.confirm(
                t("admin.autosave.discardConfirm", {
                  defaultValue: "Odrzucić niezapisane zmiany?",
                }),
              )
            ) {
              onDiscard();
            }
          }}
          aria-label={t("admin.autosave.discard", { defaultValue: "Anuluj zmiany" })}
          title={t("admin.autosave.discard", { defaultValue: "Anuluj zmiany" })}
          className="text-destructive hover:text-destructive"
        >
          <RotateCcw className="w-4 h-4 mr-1" />
          {t("admin.autosave.discard", { defaultValue: "Anuluj zmiany" })}
        </Button>
      )}
    </div>
  );
}
