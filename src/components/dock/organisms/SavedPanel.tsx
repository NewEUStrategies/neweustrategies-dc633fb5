// Organizm: zapisane elementy + kolejka „do przeczytania". Czyta istniejące
// zakładki (artykuły, strony, wydarzenia) oraz kolejkę user_read_later -
// nie tworzy drugiego magazynu zapisów.
//
// ── TRZY POPRAWKI ODCZUWANEJ PŁYNNOŚCI ───────────────────────────────────
//  1. STAN OCZEKIWANIA MÓWI PRAWDĘ. Panel pokazywał „Nic jeszcze nie
//     zapisałeś", gdy zapytanie było jeszcze w drodze - czyli podawał
//     nieprawdę zamiast przyznać, że nie wie. Kolejność gałęzi to teraz
//     błąd -> oczekiwanie (szkielet wiersza) -> puste -> lista.
//  2. JEDNO SCALENIE, NIE JEDNO NA ZNAK. Scalenie dwóch źródeł i sortowanie
//     całej listy siedziało w jednym `useMemo` razem z filtrowaniem po
//     frazie, więc KAŻDE naciśnięcie klawisza w wyszukiwarce sortowało
//     wszystko od nowa. Teraz scalenie zależy tylko od danych, a filtr -
//     tylko od frazy i wybranego rodzaju.
//  3. PISANIE ZOSTAJE PŁYNNE. Fraza idzie przez `useDeferredValue`, więc
//     przerysowanie listy ma niski priorytet i nie blokuje pola tekstowego
//     (ta sama technika, co w wyszukiwarce skrzynki czatu).
import { useDeferredValue, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Archive,
  Bookmark,
  BookOpen,
  CalendarDays,
  Check,
  FileText,
  Newspaper,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { DockPanelShell } from "../DockPanelShell";
import { DockEmptyState } from "../atoms/DockEmptyState";
import { savedEntryTitle, useSavedEntries } from "@/lib/dock/useSaved";
import { useReadLater, useRemoveReadLater, useSetReadLaterState } from "@/lib/dock/useReadLater";
import { cn } from "@/lib/utils";
import "@/lib/i18n-dock";

type SavedKind = "post" | "page" | "event" | "readLater";

const ICON: Record<SavedKind, typeof Newspaper> = {
  post: Newspaper,
  page: FileText,
  event: CalendarDays,
  readLater: BookOpen,
};

const FILTERS = ["all", "post", "page", "event", "readLater"] as const;

interface SavedListItem {
  id: string;
  kind: SavedKind;
  title: string;
  href: string | null;
  savedAt: string;
  state?: "unread" | "read" | "archived";
}

/** Wiersze oczekiwania w geometrii wiersza realnego - bez przeskoku układu. */
function PendingRows() {
  return (
    <ul aria-busy="true" className="divide-y divide-border">
      {["w-11/12", "w-3/4", "w-5/6", "w-2/3", "w-10/12"].map((width) => (
        <li key={width} className="flex items-center gap-2 px-3 py-2.5">
          <span className="skeleton-shimmer h-4 w-4 shrink-0 rounded-full" />
          <span className={cn("skeleton-shimmer h-4 rounded-[6px]", width)} />
        </li>
      ))}
    </ul>
  );
}

export function SavedPanel({ onClose, lang }: { onClose: () => void; lang: "pl" | "en" }) {
  const { t } = useTranslation();
  const savedQ = useSavedEntries();
  const readLaterQ = useReadLater();
  const setState = useSetReadLaterState();
  const remove = useRemoveReadLater();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);

  const isPending = savedQ.isPending || readLaterQ.isPending;
  const isError = savedQ.isError || readLaterQ.isError;

  // Scalenie + sortowanie: zależy WYŁĄCZNIE od danych i języka tytułu.
  const merged = useMemo<SavedListItem[]>(() => {
    const saved: SavedListItem[] = (savedQ.data ?? []).map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      title: savedEntryTitle(entry, lang),
      href: entry.href,
      savedAt: entry.savedAt,
    }));
    const readLater: SavedListItem[] = (readLaterQ.data ?? []).map((item) => ({
      id: item.id,
      kind: "readLater",
      title: item.title ?? item.url ?? item.entity_id,
      href: item.url ?? null,
      savedAt: item.created_at,
      state: item.state,
    }));
    return [...saved, ...readLater].sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt));
  }, [savedQ.data, readLaterQ.data, lang]);

  // Filtr: zależy tylko od frazy i rodzaju, więc pisanie nie sortuje listy.
  const entries = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase();
    return merged.filter((entry) => {
      if (filter === "readLater") return entry.kind === "readLater";
      if (filter !== "all" && entry.kind !== filter) return false;
      return needle.length === 0 || entry.title.toLowerCase().includes(needle);
    });
  }, [merged, filter, deferredQuery]);

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

      {isError ? (
        <DockEmptyState>{t("dock.error")}</DockEmptyState>
      ) : isPending ? (
        <PendingRows />
      ) : entries.length === 0 ? (
        <DockEmptyState icon={<Bookmark className="h-6 w-6" aria-hidden />}>
          {t("dock.saved.empty")}
        </DockEmptyState>
      ) : (
        <ul className="divide-y divide-border">
          {entries.map((entry) => {
            const Icon = ICON[entry.kind];
            const isReadLater = entry.kind === "readLater";
            return (
              <li key={`${entry.kind}-${entry.id}`} className="flex items-center gap-2 px-3 py-2.5">
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                {entry.href ? (
                  <a
                    href={entry.href}
                    className="min-w-0 flex-1 truncate text-sm text-foreground hover:underline"
                    aria-label={t("dock.saved.open")}
                  >
                    {entry.title}
                  </a>
                ) : (
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                    {entry.title}
                  </span>
                )}
                {isReadLater && entry.state && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        setState.mutate({
                          id: entry.id,
                          state: entry.state === "read" ? "unread" : "read",
                        })
                      }
                      aria-label={
                        entry.state === "read"
                          ? t("dock.readLater.markUnread")
                          : t("dock.readLater.markRead")
                      }
                      className="rounded-[6px] p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      {entry.state === "read" ? (
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                      ) : (
                        <Check className="h-3.5 w-3.5" aria-hidden />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setState.mutate({ id: entry.id, state: "archived" })}
                      aria-label={t("dock.readLater.archive")}
                      className="rounded-[6px] p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <Archive className="h-3.5 w-3.5" aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove.mutate(entry.id)}
                      aria-label={t("dock.readLater.remove")}
                      className="rounded-[6px] p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </DockPanelShell>
  );
}
