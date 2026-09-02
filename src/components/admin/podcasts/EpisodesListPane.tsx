// Lista odcinków panelu podcastów - WYCIĄG z `routes/admin.podcasts.tsx`.
//
// CO TU MIESZKA: cztery liczniki, wyszukiwanie, filtr statusu i tabela
// odcinków z dwoma akcjami (otwórz w edytorze, poproś o potwierdzenie
// usunięcia). Komponent jest BEZ WŁASNEGO STANU FILTRA - fraza i status
// wchodzą propsami z trasy, bo w trasie przetrwają przejście do ustawień
// i z powrotem (przeniesienie ich tutaj wyczyściłoby filtr przy każdym
// zamknięciu innego panelu).
//
// Same reguły (liczniki, filtrowanie, etykiety) są czystymi funkcjami
// z `lib/podcast/shape.ts` i mają tam własną tabelę przypadków; ten plik
// odpowiada za to, że wynik trafia do właściwej komórki.
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Check, Clock, FileText, Mic, Search, Trash2 } from "@/lib/lucide-shim";
import { PodcastStatCard } from "@/components/admin/podcasts/PodcastStatCard";
import { PodcastStatusBadge } from "@/components/admin/podcasts/PodcastStatusBadge";
import type { PodcastShow } from "@/lib/podcast/types";
import { formatDuration } from "@/lib/podcast/types";
import {
  PODCAST_STATUS_FILTERS,
  episodeListTitle,
  filterPodcastRows,
  podcastAdminStats,
  showTitleIndex,
  type AdminPodcastRow,
  type PodcastStatusFilter,
} from "@/lib/podcast/shape";
import { ensureI18n as ensureAdminPodcastsI18n } from "@/lib/i18n-admin-podcasts";

export function EpisodesListPane({
  rows,
  shows,
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  onOpen,
  onRequestRemove,
}: {
  rows: AdminPodcastRow[] | undefined;
  shows: PodcastShow[];
  search: string;
  onSearchChange: (value: string) => void;
  statusFilter: PodcastStatusFilter;
  onStatusFilterChange: (value: PodcastStatusFilter) => void;
  onOpen: (id: string) => void;
  onRequestRemove: (id: string) => void;
}) {
  ensureAdminPodcastsI18n();
  const { t } = useTranslation();
  const showTitleById = useMemo(() => showTitleIndex(shows), [shows]);
  const stats = useMemo(() => podcastAdminStats(rows), [rows]);
  const filtered = useMemo(
    () => filterPodcastRows(rows, search, statusFilter),
    [rows, search, statusFilter],
  );

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <PodcastStatCard
          icon={Mic}
          label={t("adminPodcasts.statAll")}
          value={String(stats.total)}
          tone="default"
        />
        <PodcastStatCard
          icon={Check}
          label={t("adminPodcasts.statPublished")}
          value={String(stats.published)}
          tone="success"
        />
        <PodcastStatCard
          icon={FileText}
          label={t("adminPodcasts.statDrafts")}
          value={String(stats.drafts)}
          tone="warning"
        />

        <PodcastStatCard
          icon={Clock}
          label={t("adminPodcasts.statTotalTime")}
          value={formatDuration(stats.totalSeconds)}
          tone="default"
        />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t("adminPodcasts.searchPlaceholder")}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-1 p-1 rounded-md bg-muted/60 border border-border">
          {PODCAST_STATUS_FILTERS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onStatusFilterChange(s)}
              className={`px-3 py-1.5 text-xs rounded font-medium ${statusFilter === s ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              {s === "all"
                ? t("adminPodcasts.filterAll")
                : s === "published"
                  ? t("adminPodcasts.filterPublished")
                  : s === "draft"
                    ? t("adminPodcasts.filterDrafts")
                    : t("adminPodcasts.filterArchived")}
            </button>
          ))}
        </div>
      </div>

      <section className="bg-card border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground border-b border-border bg-muted/30">
            <tr>
              <th className="text-left p-3 w-16"></th>
              <th className="text-left p-3">{t("adminPodcasts.colTitle")}</th>
              <th className="text-left p-3 w-40">{t("adminPodcasts.colShow")}</th>
              <th className="text-left p-3 w-24">S/E</th>
              <th className="text-left p-3 w-24">{t("adminPodcasts.colTime")}</th>
              <th className="text-left p-3 w-32">Status</th>
              <th className="p-3 w-24"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr
                key={r.id}
                className="border-b border-border/60 hover:bg-muted/30 transition-colors"
              >
                <td className="p-2">
                  {r.cover_image_url ? (
                    <img
                      src={r.cover_image_url}
                      alt=""
                      className="w-12 h-12 rounded-md object-cover border border-border"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-md bg-muted flex items-center justify-center">
                      <Mic className="w-4 h-4 text-muted-foreground" />
                    </div>
                  )}
                </td>
                <td className="p-3">
                  <button
                    className="hover:underline text-left font-medium"
                    onClick={() => onOpen(r.id)}
                  >
                    {episodeListTitle(r)}
                  </button>
                  <div className="text-xs text-muted-foreground font-mono">{r.slug}</div>
                </td>
                <td className="p-3 text-xs text-muted-foreground">
                  {r.show_id ? (showTitleById.get(r.show_id) ?? "—") : "—"}
                </td>
                <td className="p-3 text-xs tabular-nums">
                  {r.season ? `S${r.season}` : "-"}
                  {r.episode_number ? ` E${r.episode_number}` : ""}
                </td>
                <td className="p-3 text-xs tabular-nums">{formatDuration(r.duration_seconds)}</td>
                <td className="p-3">
                  <PodcastStatusBadge status={r.status} />
                </td>
                <td className="p-3 text-right">
                  <button
                    onClick={() => onRequestRemove(r.id)}
                    className="text-xs text-destructive hover:underline inline-flex items-center gap-1"
                  >
                    <Trash2 className="w-3 h-3" />
                    {t("adminPodcasts.remove")}
                  </button>
                </td>
              </tr>
            ))}
            {!filtered.length && (
              <tr>
                <td colSpan={7} className="p-10 text-center text-muted-foreground">
                  {rows?.length
                    ? t("adminPodcasts.emptyFiltered")
                    : t("adminPodcasts.emptyNoEpisodes")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}
