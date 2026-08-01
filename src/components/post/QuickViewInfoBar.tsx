import { Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";
import { formatDate } from "@/lib/i18n/format";

type Category =
  { slug: string; name_pl?: string | null; name_en?: string | null } | null | undefined;

interface Props {
  lang: "pl" | "en";
  readMinutes?: number | null;
  publishedAt?: string | null;
  updatedAt?: string | null;
  primaryCategory?: Category;
  /** Akcje wyrownane do prawej (np. przycisk "Udostepnij pelny artykul"). */
  trailing?: ReactNode;
}

/**
 * Compact "Quick View" info strip rendered above the article body when
 * `post_layout_settings.quick_view_info` is enabled. Foxiz-style pill row:
 * primary category dot, reading time, and last update indicator.
 */
export function QuickViewInfoBar({
  lang,
  readMinutes,
  publishedAt,
  updatedAt,
  primaryCategory,
  trailing,
}: Props) {
  const { t } = useTranslation();
  const catLabel = primaryCategory
    ? (lang === "pl" ? primaryCategory.name_pl : primaryCategory.name_en) || primaryCategory.slug
    : null;

  const displayDate = updatedAt || publishedAt || null;
  const isUpdated = Boolean(
    updatedAt && publishedAt && new Date(updatedAt) > new Date(publishedAt),
  );
  const dateText = displayDate
    ? formatDate(displayDate, lang, { year: "numeric", month: "short", day: "numeric" })
    : null;

  if (!catLabel && !readMinutes && !dateText && !trailing) return null;

  return (
    <div
      className="no-print cms-meta flex flex-wrap items-center gap-x-4 gap-y-2 mb-6 pb-3 border-b border-border/60 text-xs"
      data-quick-view-info
    >
      {catLabel && (
        <span className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-wider text-[color:var(--brand,var(--primary))]">
          <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
          {catLabel}
        </span>
      )}
      {typeof readMinutes === "number" && readMinutes > 0 && (
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <Clock className="h-3.5 w-3.5" aria-hidden />
          {t("post.readMinutes", { count: readMinutes, defaultValue: "{{count}} min read" })}
        </span>
      )}
      {dateText && (
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          {isUpdated && (
            <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
              {t("post.updated", { defaultValue: lang === "pl" ? "Aktualizacja" : "Updated" })}
            </span>
          )}
          <time dateTime={displayDate ?? undefined}>{dateText}</time>
        </span>
      )}
      {trailing && <span className="ml-auto inline-flex items-center">{trailing}</span>}
    </div>
  );
}
