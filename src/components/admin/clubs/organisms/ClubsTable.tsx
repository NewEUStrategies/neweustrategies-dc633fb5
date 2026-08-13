// Organizm: tabela klubów w panelu.
//
// Responsywność: na wąskim ekranie tabela zamienia się w listę kart, a nie
// w poziomy scroll. Poziomy scroll w tabeli administracyjnej oznacza, że
// kolumna "Akcje" jest niewidoczna dokładnie wtedy, gdy jest potrzebna.
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { ChevronRight, Clock, ExternalLink, Layers, MessagesSquare, Users2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ClubStatusBadge, ClubVisibilityBadge } from "../atoms/ClubBadges";
import type { AdminClubRow, ClubStatus, ClubVisibility } from "@/lib/clubs/types";
import { CLUB_STATUSES, CLUB_VISIBILITIES } from "@/lib/clubs/types";
import { formatDate, uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { ensureAdminClubsI18n } from "@/lib/i18n-clubs-admin";

interface ClubsTableProps {
  rows: AdminClubRow[];
}

/** RPC zwraca `status`/`visibility` jako `string` - zawężamy po słowniku,
 *  a nieznaną wartość degradujemy do sensownego domyślnego zamiast wywracać
 *  render. Nowa wartość CHECK-a nie może zepsuć całej tabeli. */
function asStatus(value: string): ClubStatus {
  return (CLUB_STATUSES as readonly string[]).includes(value) ? (value as ClubStatus) : "draft";
}

function asVisibility(value: string): ClubVisibility {
  return (CLUB_VISIBILITIES as readonly string[]).includes(value)
    ? (value as ClubVisibility)
    : "members";
}

// `formatDate` normalizuje jezyk sam (`uiLocale`), wiec przyjmujemy surowe
// `i18n.language` zamiast tlumaczyc je najpierw na "pl"/"en" - o jedno miejsce
// mniej, w ktorym ta decyzja moze sie rozjechac.
function formatLastActivity(value: string | null, lang: string | undefined): string {
  if (!value) return "-";
  return (
    formatDate(value, lang, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }) || "-"
  );
}

export function ClubsTable({ rows }: ClubsTableProps) {
  ensureAdminClubsI18n();
  const { t, i18n } = useTranslation();
  // Jezyk TRESCI (blizniacze kolumny nazw klubow), nie etykiet - te ida przez
  // `t()`. Komponent wyprowadza go sam, zamiast dostawac `isPl` propsem.
  const lang = uiLang(i18n.language);

  return (
    <>
      {/* Widok tabelaryczny od lg w górę */}
      <div className="hidden lg:block rounded-lg border border-border/60 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("adminClubs.columns.name")}</TableHead>
              <TableHead>{t("adminClubs.columns.visibility")}</TableHead>
              <TableHead className="text-right">{t("adminClubs.columns.groups")}</TableHead>
              <TableHead className="text-right">{t("adminClubs.columns.members")}</TableHead>
              <TableHead className="text-right">{t("adminClubs.columns.threads")}</TableHead>
              <TableHead className="text-right">{t("adminClubs.columns.pending")}</TableHead>
              <TableHead>{t("adminClubs.columns.leads")}</TableHead>
              <TableHead>{t("adminClubs.columns.lastActivity")}</TableHead>
              <TableHead>{t("adminClubs.columns.status")}</TableHead>
              <TableHead className="w-10 sr-only">{t("adminClubs.columns.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} className="hover:bg-muted/40">
                <TableCell>
                  <Link
                    to="/admin/community/clubs/$clubId"
                    params={{ clubId: row.id }}
                    search={{ tab: "general" }}
                    className="font-medium hover:text-primary transition-colors"
                  >
                    {pickLocalized(row, "name", lang)}
                  </Link>
                  <div className="text-xs text-muted-foreground">/{row.slug}</div>
                </TableCell>
                <TableCell>
                  <ClubVisibilityBadge visibility={asVisibility(row.visibility)} />
                </TableCell>
                <TableCell className="text-right tabular-nums">{row.group_count}</TableCell>
                <TableCell className="text-right tabular-nums">{row.member_count}</TableCell>
                <TableCell className="text-right tabular-nums">{row.thread_count}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.pending_count > 0 ? (
                    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500/15 px-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                      {row.pending_count}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </TableCell>
                <TableCell className="max-w-[180px] truncate text-sm text-muted-foreground">
                  {row.lead_names.length > 0 ? row.lead_names.join(", ") : "-"}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                  {formatLastActivity(row.last_activity_at, i18n.language)}
                </TableCell>
                <TableCell>
                  <ClubStatusBadge status={asStatus(row.status)} />
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    {/* Podgląd strony klubu. Ta sama treść widziana oczami
                        członka jest szybszą weryfikacją ustawień dostępu niż
                        czytanie pięciu dropList w edytorze. Nowa karta, bo
                        edycja klubu ma zostać otwarta. */}
                    <Button asChild size="icon" variant="ghost" className="h-8 w-8">
                      <a
                        href={`/club/${row.slug}`}
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
                        params={{ clubId: row.id }}
                        search={{ tab: "general" }}
                      >
                        <ChevronRight className="h-4 w-4" />
                        <span className="sr-only">{t("adminClubs.editClub")}</span>
                      </Link>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Karty poniżej lg - te same dane, układ pionowy */}
      <div className="grid gap-3 lg:hidden">
        {rows.map((row) => (
          <Link
            key={row.id}
            to="/admin/community/clubs/$clubId"
            params={{ clubId: row.id }}
            search={{ tab: "general" }}
            className="rounded-lg border border-border/60 bg-card p-4 transition-colors hover:border-primary/40"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-medium">{pickLocalized(row, "name", lang)}</div>
                <div className="text-xs text-muted-foreground">/{row.slug}</div>
              </div>
              <ClubStatusBadge status={asStatus(row.status)} />
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5" />
                {row.group_count}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Users2 className="h-3.5 w-3.5" />
                {row.member_count}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <MessagesSquare className="h-3.5 w-3.5" />
                {row.thread_count}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                {formatLastActivity(row.last_activity_at, i18n.language)}
              </span>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <ClubVisibilityBadge visibility={asVisibility(row.visibility)} />
              {/* Karta jest jednym wielkim linkiem do edytora, więc podgląd
                  musi zatrzymać propagację - inaczej klik otwiera oba. */}
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  window.open(`/club/${row.slug}`, "_blank", "noopener,noreferrer");
                }}
              >
                <ExternalLink className="h-3 w-3" />
                {t("adminClubs.openPublic")}
              </button>
              {row.pending_count > 0 ? (
                <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                  {t("adminClubs.columns.pending")}: {row.pending_count}
                </span>
              ) : null}
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
