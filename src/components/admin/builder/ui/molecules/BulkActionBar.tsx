// Floating action bar shown when multiple widgets are marquee-selected.
// Renders bulk operations (duplicate, delete, copy, clear) so the editor can
// act on many widgets at once without switching the sidebar to a different
// mode. Rendered outside VisualCanvas so it isn't affected by the canvas
// pointer-events reset used to kill link navigation inside the preview.
import { Copy, Trash2, Plus, X } from "@/lib/lucide-shim";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-builder";

interface Props {
  count: number;
  onDuplicate: () => void;
  onDelete: () => void;
  onCopy: () => void;
  onClear: () => void;
}

export function BulkActionBar({ count, onDuplicate, onDelete, onCopy, onClear }: Props) {
  const { t } = useTranslation();
  if (count < 1) return null;
  const noun =
    count === 1
      ? t("builder.bulk.widget1")
      : count < 5
        ? t("builder.bulk.widgetFew")
        : t("builder.bulk.widgetMany");
  return (
    <div
      role="toolbar"
      aria-label={t("builder.bulk.ariaSelected")}
      data-builder-chrome
      className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2 inline-flex items-center gap-2 rounded-full border border-border bg-card/95 px-3 py-2 shadow-lg backdrop-blur"
    >
      <span className="pl-1 pr-2 text-xs font-medium">
        {t("builder.bulk.selected")} <span className="font-semibold text-brand">{count}</span>{" "}
        {noun}
      </span>
      <span aria-hidden className="h-4 w-px bg-border" />
      <button
        type="button"
        onClick={onCopy}
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs hover:bg-muted"
        title={t("builder.bulk.copyTitle")}
      >
        <Copy className="h-3.5 w-3.5" />
        {t("builder.bulk.copy")}
      </button>
      <button
        type="button"
        onClick={onDuplicate}
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs hover:bg-muted"
        title={t("builder.bulk.duplicateTitle")}
      >
        <Plus className="h-3.5 w-3.5" />
        {t("builder.bulk.duplicate")}
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
        title={t("builder.bulk.deleteTitle")}
      >
        <Trash2 className="h-3.5 w-3.5" />
        {t("builder.common.delete")}
      </button>
      <span aria-hidden className="h-4 w-px bg-border" />
      <button
        type="button"
        onClick={onClear}
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
        title={t("builder.bulk.deselectTitle")}
      >
        <X className="h-3.5 w-3.5" />
        {t("builder.bulk.deselect")}
      </button>
    </div>
  );
}
