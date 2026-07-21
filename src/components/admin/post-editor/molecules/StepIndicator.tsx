// Molekuła: wskaźnik kroków 1 (Szczegóły) -> 2 (Treść) w pasku edytora wpisu.
// Klikalny - pozwala skakać między krokami. Wyodrębniony z PostEditorHeader.
import { useTranslation } from "react-i18next";
import { FileText, Settings as SettingsIcon } from "@/lib/lucide-shim";
import type { EditorStep } from "../types";
import "@/lib/i18n-admin-post-panes";

export function StepIndicator({
  step,
  onStepChange,
}: {
  step: EditorStep;
  onStepChange: (step: EditorStep) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="hidden md:flex items-center gap-1 mr-2 text-xs">
      <button
        onClick={() => onStepChange("details")}
        className={`px-2 py-1 rounded inline-flex items-center gap-1 ${step === "details" ? "bg-brand text-brand-foreground" : "bg-muted hover:bg-muted/70"}`}
      >
        <SettingsIcon className="w-3.5 h-3.5" /> {t("adminPostPanes.editor.step1")}
      </button>
      <span className="text-muted-foreground">→</span>
      <button
        onClick={() => onStepChange("content")}
        className={`px-2 py-1 rounded inline-flex items-center gap-1 ${step === "content" ? "bg-brand text-brand-foreground" : "bg-muted hover:bg-muted/70"}`}
      >
        <FileText className="w-3.5 h-3.5" /> {t("adminPostPanes.editor.step2")}
      </button>
    </div>
  );
}
