// Molekuła: przełącznik trybu edytora wizualnego (Gutenberg / Elementor).
// Wyodrębniona 1:1 z paska edytora w admin.posts.$slug. Nazwy silników to
// marki - zostają dosłownie; etykieta "Tryb edytora" jest i18n.
import { useTranslation } from "react-i18next";
import type { EditorType } from "../types";
import "@/lib/i18n-admin-post-panes";

export function EditorModeToggle({
  editor,
  onEditorChange,
}: {
  editor: EditorType;
  onEditorChange: (editor: EditorType) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between gap-3 bg-card border border-border rounded-lg p-2 pl-4">
      <div className="text-xs text-muted-foreground">{t("adminPostPanes.editor.editorMode")}</div>
      <div className="inline-flex rounded-md border border-border bg-background p-0.5">
        <button
          type="button"
          onClick={() => onEditorChange("blocks")}
          className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${editor === "blocks" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          aria-pressed={editor === "blocks"}
        >
          Gutenberg
        </button>
        <button
          type="button"
          onClick={() => onEditorChange("builder")}
          className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${editor === "builder" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          aria-pressed={editor === "builder"}
        >
          Elementor
        </button>
      </div>
    </div>
  );
}
