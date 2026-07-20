// Górny pasek edytora wpisu: powrót/krok, wskaźnik kroków 1→2, autosave bar,
// usuwanie i zapis. Wyodrębnione 1:1 z trasy admin.posts.$slug.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Save, Trash2, FileText, Settings as SettingsIcon } from "@/lib/lucide-shim";
import { AutosaveBar } from "@/components/admin/AutosaveBar";
import { Button } from "@/components/ui/button";
import type { PostEditorFormApi } from "./usePostEditorForm";

export function PostEditorHeader({
  step,
  onStepChange,
  formApi,
}: {
  step: "details" | "content";
  onStepChange: (step: "details" | "content") => void;
  formApi: PostEditorFormApi;
}) {
  const { t } = useTranslation();
  const { autosave, history, busy, save, del, discardToSaved } = formApi;
  return (
    <div className="flex items-center justify-between gap-4 flex-wrap">
      {step === "details" ? (
        <Link
          to="/admin/posts"
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <ArrowLeft className="w-4 h-4" /> {t("admin.back")}
        </Link>
      ) : (
        <button
          onClick={() => onStepChange("details")}
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <ArrowLeft className="w-4 h-4" /> Szczegóły wpisu
        </button>
      )}
      <div className="flex items-center gap-2">
        {/* Step indicator */}
        <div className="hidden md:flex items-center gap-1 mr-2 text-xs">
          <button
            onClick={() => onStepChange("details")}
            className={`px-2 py-1 rounded inline-flex items-center gap-1 ${step === "details" ? "bg-brand text-brand-foreground" : "bg-muted hover:bg-muted/70"}`}
          >
            <SettingsIcon className="w-3.5 h-3.5" /> 1. Szczegóły
          </button>
          <span className="text-muted-foreground">→</span>
          <button
            onClick={() => onStepChange("content")}
            className={`px-2 py-1 rounded inline-flex items-center gap-1 ${step === "content" ? "bg-brand text-brand-foreground" : "bg-muted hover:bg-muted/70"}`}
          >
            <FileText className="w-3.5 h-3.5" /> 2. Treść
          </button>
        </div>
        <AutosaveBar
          status={autosave.status}
          error={autosave.error}
          canUndo={history.canUndo}
          canRedo={history.canRedo}
          onUndo={history.undo}
          onRedo={history.redo}
          onDiscard={discardToSaved}
        />

        <Button variant="ghost" size="sm" onClick={del}>
          <Trash2 className="w-4 h-4 mr-1 text-destructive" /> {t("admin.delete")}
        </Button>
        <Button onClick={save} disabled={busy}>
          <Save className="w-4 h-4 mr-2" /> {busy ? "..." : t("admin.save")}
        </Button>
      </div>
    </div>
  );
}
