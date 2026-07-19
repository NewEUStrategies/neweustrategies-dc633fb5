import { Undo, Redo, Trash2 } from "@/lib/lucide-shim";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-builder";
import type { Selection } from "./types";

export function CanvasActionBar({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  selection,
  onDelete,
}: {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  selection: Selection;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const hasSel = !!selection.id && selection.kind !== null && selection.kind !== "inner-section";
  const kindLabel =
    selection.kind === "section"
      ? t("builder.chrome.kindSection")
      : selection.kind === "column"
        ? t("builder.chrome.kindColumn")
        : selection.kind === "widget"
          ? t("builder.chrome.kindWidget")
          : "";
  return (
    <div className="sticky top-0 z-30 mb-2 flex items-center gap-1 px-2 py-1.5 bg-card/95 backdrop-blur border border-border rounded-md shadow-sm">
      <button
        type="button"
        onClick={onUndo}
        disabled={!canUndo}
        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded hover:bg-muted disabled:opacity-30"
        title={t("builder.chrome.undoTitle")}
      >
        <Undo className="w-3.5 h-3.5" /> {t("builder.chrome.undo")}
      </button>
      <button
        type="button"
        onClick={onRedo}
        disabled={!canRedo}
        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded hover:bg-muted disabled:opacity-30"
        title={t("builder.chrome.redoTitle")}
      >
        <Redo className="w-3.5 h-3.5" /> {t("builder.chrome.redo")}
      </button>
      <div className="w-px h-5 bg-border mx-1" />
      <button
        type="button"
        onClick={onDelete}
        disabled={!hasSel}
        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded text-destructive hover:bg-destructive/10 disabled:opacity-30 disabled:text-muted-foreground"
        title={t("builder.chrome.deleteSelTitle")}
      >
        <Trash2 className="w-3.5 h-3.5" />
        {hasSel
          ? t("builder.chrome.deleteKind", { kind: kindLabel })
          : t("builder.chrome.nothingSelected")}
      </button>
    </div>
  );
}
