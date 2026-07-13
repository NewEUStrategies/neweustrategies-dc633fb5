// Reusable "linked source" adornment for admin settings inputs.
// Renders a small badge that shows the canonical value coming from another
// admin surface (e.g. Theme Options) with a deep link, and treats the local
// input as an optional override. When the local value is empty, the resolved
// value falls back to the linked source.
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";

export type LinkedSourceProps = {
  sourceLabel: string;
  sourceHref: string;
  sourceValue?: string | null;
  /** Optional preview renderer for non-text values (e.g. image thumbnail). */
  preview?: ReactNode;
  hint?: string;
};

/**
 * Small header shown above a settings input to indicate that its value is
 * inherited from another admin screen. Keeps the local field usable as an
 * override; empty local field = use `sourceValue`.
 */
export function LinkedSourceHeader({
  sourceLabel,
  sourceHref,
  sourceValue,
  preview,
  hint,
}: LinkedSourceProps) {
  const { t } = useTranslation();
  const hasValue = Boolean(sourceValue && sourceValue.trim().length > 0);
  return (
    <div className="mb-2 rounded-md border border-dashed border-border bg-muted/30 p-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {preview}
          <div className="min-w-0">
            <div className="font-medium text-foreground">
              {t("admin.linkedSource.label", { defaultValue: "Źródło" })}: {sourceLabel}
            </div>
            {hasValue ? (
              <div className="text-muted-foreground truncate font-mono text-[11px]">
                {sourceValue}
              </div>
            ) : (
              <div className="text-muted-foreground">
                {t("admin.linkedSource.empty", { defaultValue: "Brak wartości w źródle." })}
              </div>
            )}
          </div>
        </div>
        <Link
          to={sourceHref}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted"
        >
          {t("admin.linkedSource.manage", { defaultValue: "Zarządzaj" })}
          <ExternalLink className="w-3 h-3" />
        </Link>
      </div>
      {hint && <p className="mt-1 text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function LinkedImagePreview({ src }: { src?: string | null }) {
  if (!src) {
    return (
      <div className="w-10 h-10 rounded border border-border bg-background flex items-center justify-center text-[10px] text-muted-foreground">
        —
      </div>
    );
  }
  return (
    <img
      src={src}
      alt=""
      className="w-10 h-10 rounded border border-border bg-background object-contain"
      loading="lazy"
    />
  );
}
