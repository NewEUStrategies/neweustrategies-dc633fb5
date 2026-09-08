// Organizm: kolejka „do przeczytania później". Filtry stanu, oznaczanie
// przeczytane/nieprzeczytane, archiwum i usuwanie.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Archive, BookOpen, Check, RotateCcw, Trash2 } from "lucide-react";
import { DockPanelShell } from "../DockPanelShell";
import { DockEmptyState } from "../atoms/DockEmptyState";
import { useReadLater, useRemoveReadLater, useSetReadLaterState } from "@/lib/dock/useReadLater";
import { cn } from "@/lib/utils";

const FILTERS = ["unread", "all", "archived"] as const;

export function ReadLaterPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const listQ = useReadLater();
  const setState = useSetReadLaterState();
  const remove = useRemoveReadLater();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("unread");
  const [query, setQuery] = useState("");

  const items = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (listQ.data ?? []).filter((item) => {
      if (filter === "unread" && item.state !== "unread") return false;
      if (filter === "archived" && item.state !== "archived") return false;
      if (needle.length === 0) return true;
      return (item.title ?? item.url ?? "").toLowerCase().includes(needle);
    });
  }, [listQ.data, filter, query]);

  return (
    <DockPanelShell
      title={t("dock.readLater.title")}
      icon={<BookOpen className="h-4 w-4" />}
      onClose={onClose}
    >
      <div className="space-y-2 border-b border-border p-3">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("dock.readLater.searchPlaceholder")}
          aria-label={t("dock.readLater.searchPlaceholder")}
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
              {t(`dock.readLater.filters.${value}`)}
            </button>
          ))}
        </div>
      </div>

      {listQ.isError ? (
        <DockEmptyState>{t("dock.error")}</DockEmptyState>
      ) : items.length === 0 ? (
        <DockEmptyState icon={<BookOpen className="h-6 w-6" aria-hidden />}>
          {t("dock.readLater.empty")}
        </DockEmptyState>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item) => {
            const label = item.title ?? item.url ?? item.entity_id;
            const href = item.url ?? null;
            return (
              <li key={item.id} className="flex items-center gap-2 px-3 py-2.5">
                {href ? (
                  <a
                    href={href}
                    className="min-w-0 flex-1 truncate text-sm text-foreground hover:underline"
                    aria-label={t("dock.readLater.open")}
                  >
                    {label}
                  </a>
                ) : (
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">{label}</span>
                )}
                <button
                  type="button"
                  onClick={() =>
                    setState.mutate({
                      id: item.id,
                      state: item.state === "read" ? "unread" : "read",
                    })
                  }
                  aria-label={
                    item.state === "read"
                      ? t("dock.readLater.markUnread")
                      : t("dock.readLater.markRead")
                  }
                  className="rounded-[6px] p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {item.state === "read" ? (
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                  ) : (
                    <Check className="h-3.5 w-3.5" aria-hidden />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setState.mutate({ id: item.id, state: "archived" })}
                  aria-label={t("dock.readLater.archive")}
                  className="rounded-[6px] p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <Archive className="h-3.5 w-3.5" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => remove.mutate(item.id)}
                  aria-label={t("dock.readLater.remove")}
                  className="rounded-[6px] p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </DockPanelShell>
  );
}
