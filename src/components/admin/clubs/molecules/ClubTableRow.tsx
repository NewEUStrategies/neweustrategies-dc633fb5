// Molekuła: JEDEN wiersz tabelaryczny listy klubów (widok od `lg`).
//
// Wyjęta z `organisms/ClubsTable.tsx`, bo ta sama treść wiersza istnieje w DWÓCH
// układach (tabela i karta), a organizm miał ją wpisaną dwa razy - z osobnymi
// kopiami tych samych decyzji o kresce w pustej komórce i o znaczniku zgłoszeń.
// Reguły projekcji wiersza są w `lib/clubs/adminClubsTable.ts`; tutaj jest
// wyłącznie znacznik i JEDNA odpowiedzialność: pokazać `ClubsTableRowView`
// w dziesięciu kolumnach.
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { ChevronRight, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import { ClubStatusBadge, ClubVisibilityBadge } from "../atoms/ClubBadges";
import { CLUB_TABLE_EMPTY_CELL, type ClubsTableRowView } from "@/lib/clubs/adminClubsTable";
import { ensureAdminClubsI18n } from "@/lib/i18n-clubs-admin";

export function ClubTableRow({ view }: { view: ClubsTableRowView }) {
  ensureAdminClubsI18n();
  const { t } = useTranslation();

  return (
    <TableRow className="hover:bg-muted/40">
      <TableCell>
        <Link
          to="/admin/community/clubs/$clubId"
          params={{ clubId: view.id }}
          search={{ tab: "general" }}
          className="font-medium hover:text-primary transition-colors"
        >
          {view.name}
        </Link>
        <div className="text-xs text-muted-foreground">{view.slugPath}</div>
      </TableCell>
      <TableCell>
        <ClubVisibilityBadge visibility={view.visibility} />
      </TableCell>
      <TableCell className="text-right tabular-nums">{view.groupCount}</TableCell>
      <TableCell className="text-right tabular-nums">{view.memberCount}</TableCell>
      <TableCell className="text-right tabular-nums">{view.threadCount}</TableCell>
      <TableCell className="text-right tabular-nums">
        {view.hasPending ? (
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500/15 px-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
            {view.pendingCount}
          </span>
        ) : (
          <span className="text-muted-foreground">{CLUB_TABLE_EMPTY_CELL}</span>
        )}
      </TableCell>
      <TableCell className="max-w-[180px] truncate text-sm text-muted-foreground">
        {view.leads}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
        {view.lastActivity}
      </TableCell>
      <TableCell>
        <ClubStatusBadge status={view.status} />
      </TableCell>
      <TableCell>
        <div className="flex gap-1">
          {/* Podgląd strony klubu. Ta sama treść widziana oczami członka jest
              szybszą weryfikacją ustawień dostępu niż czytanie pięciu dropList
              w edytorze. Nowa karta, bo edycja klubu ma zostać otwarta. */}
          <Button asChild size="icon" variant="ghost" className="h-8 w-8">
            <a
              href={view.publicHref}
              target="_blank"
              rel="noreferrer"
              aria-label={t("adminClubs.openPublic")}
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
          <Button asChild size="icon" variant="ghost" className="h-8 w-8">
            <Link
              to="/admin/community/clubs/$clubId"
              params={{ clubId: view.id }}
              search={{ tab: "general" }}
            >
              <ChevronRight className="h-4 w-4" />
              <span className="sr-only">{t("adminClubs.editClub")}</span>
            </Link>
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
