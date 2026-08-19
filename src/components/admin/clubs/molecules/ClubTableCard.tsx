// Molekuła: JEDEN klub jako karta (widok poniżej `lg`).
//
// Wyjęta z `organisms/ClubsTable.tsx` razem z `ClubTableRow` - te dwie molekuły
// to DWA UKŁADY tej samej treści, a nie dwa różne widoki. Poziomy scroll
// w tabeli administracyjnej chowa kolumnę „Akcje" dokładnie wtedy, gdy jest
// potrzebna, więc na wąskim ekranie wiersz staje się kartą.
//
// JEDYNA rzecz, której nie ma wariant tabelaryczny: cała karta jest jednym
// linkiem do edytora, więc podgląd publiczny MUSI zatrzymać propagację -
// inaczej jedno kliknięcie otwiera edytor I stronę klubu.
import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { Clock, ExternalLink, Layers, MessagesSquare, Users2 } from "lucide-react";
import { ClubStatusBadge, ClubVisibilityBadge } from "../atoms/ClubBadges";
import type { ClubsTableRowView } from "@/lib/clubs/adminClubsTable";
import { ensureAdminClubsI18n } from "@/lib/i18n-clubs-admin";

/**
 * Podgląd publiczny z wnętrza linku. Nazwana funkcja, a nie ciało handlera,
 * bo robi TRZY rzeczy poza stanem i każda z nich jest tu konieczna: bez
 * `preventDefault` przeglądarka rusza za linkiem karty, bez `stopPropagation`
 * link karty dostaje kliknięcie mimo to, a `noopener` odcina nowej karcie
 * dostęp do `window.opener`.
 */
function openClubPublicPreview(event: MouseEvent<HTMLButtonElement>, href: string): void {
  event.preventDefault();
  event.stopPropagation();
  window.open(href, "_blank", "noopener,noreferrer");
}

export function ClubTableCard({ view }: { view: ClubsTableRowView }) {
  ensureAdminClubsI18n();
  const { t } = useTranslation();

  return (
    <Link
      to="/admin/community/clubs/$clubId"
      params={{ clubId: view.id }}
      search={{ tab: "general" }}
      className="rounded-lg border border-border/60 bg-card p-4 transition-colors hover:border-primary/40"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-medium">{view.name}</div>
          <div className="text-xs text-muted-foreground">{view.slugPath}</div>
        </div>
        <ClubStatusBadge status={view.status} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Layers className="h-3.5 w-3.5" />
          {view.groupCount}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Users2 className="h-3.5 w-3.5" />
          {view.memberCount}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <MessagesSquare className="h-3.5 w-3.5" />
          {view.threadCount}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5" />
          {view.lastActivity}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <ClubVisibilityBadge visibility={view.visibility} />
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground"
          onClick={(event) => openClubPublicPreview(event, view.publicHref)}
        >
          <ExternalLink className="h-3 w-3" />
          {t("adminClubs.openPublic")}
        </button>
        {view.hasPending ? (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
            {t("adminClubs.columns.pending")}: {view.pendingCount}
          </span>
        ) : null}
      </div>
    </Link>
  );
}
