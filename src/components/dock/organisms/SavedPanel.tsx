// Organizm: zapisane elementy. Czyta istniejące zakładki (artykuły, strony,
// wydarzenia) - nie tworzy drugiego magazynu zapisów.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bookmark, CalendarDays, FileText, Newspaper } from "lucide-react";
import { DockPanelShell } from "../DockPanelShell";
import { DockEmptyState } from "../atoms/DockEmptyState";
import { useSavedEntries, type SavedKind } from "@/lib/dock/useSaved";
import { cn } from "@/lib/utils";

const ICON: Record<SavedKind, typeof Newspaper> = {
  post: Newspaper,
  page: FileText,
  event: CalendarDays,
};

const FILTERS = ["all", "post", "page", "event"] as const;

export function SavedPanel({ onClose, lang }: { onClose: () => void; lang: "pl" | "en" }) {
  const { t } = useTranslation();
  const savedQ = useSavedEntries(lang);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [query, setQuery] = useState("");

  const entries = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (savedQ.data ?? []).filter((entry) => {
      if (filter !== "all" && entry.kind !== filter) return false;
      return needle.length === 0 || entry.title.toLowerCase().includes(needle);
    });
  }, [savedQ.data, filter, query]);

  return (
    <DockPanelShell
      title={t("dock.saved.title")}
      icon={<Bookmark className="h-4 w-4" />}
      onClose={onClose}
    >
      <div className="space-y-2 border-b border-border p-3">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("dock.saved.searchPlaceholder")}
          aria-label={t("dock.saved.searchPlaceholder")}
          className="w-full rounded-[6px] border border-input bg-background px-3 py-2 text-sm text-foreground"
        />
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              aria-pressed={filter === value}
              className={cn(
                "rounded-[6px] px-2.5 py-1 text-xs font-medium transition-colors",
                filter === value
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {t(`dock.saved.filters.${value}`)}
            </button>
          ))}
        </div>
      </div>

      {savedQ.isError ? (
        <DockEmptyState>{t("dock.error")}</DockEmptyState>
      ) : entries.length === 0 ? (
        <DockEmptyState icon={<Bookmark className="h-6 w-6" aria-hidden />}>
          {t("dock.saved.empty")}
        </DockEmptyState>
      ) : (
        <ul className="divide-y divide-border">
          {entries.map((entry) => {
            const Icon = ICON[entry.kind];
            return (
              <li key={entry.id}>
                <a
                  href={entry.href}
                  className="flex items-center gap-2 px-3 py-2.5 transition-colors hover:bg-muted"
                >
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                    {entry.title}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </DockPanelShell>
  );
}
