// Molekuła: jedna pozycja harmonogramu.
//
// Data stoi PIERWSZA i w osobnej kolumnie, bo harmonogram czyta się skanując
// terminy, nie tytuły. Ta sama pozycja w kalendarzu pokazuje tylko tytuł -
// tam datą jest komórka siatki.
//
// Termin całodniowy i termin z godziną rysują się RÓŻNIE: "14 września" kontra
// "14 września, 17:00". Bez tego rozróżnienia deadline konsultacji dostawał
// przypadkową godzinę z północy i wyglądał jak spotkanie.
import { useTranslation } from "react-i18next";
import { CalendarPlus, ExternalLink, MapPin, Pencil, Trash2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ClubMilestoneIcon } from "@/components/clubs/atoms/ClubEntryIcon";
import { ClubStatusPill, milestoneTone } from "@/components/clubs/atoms/ClubStatusPill";
import { formatDate, formatDateTime } from "@/lib/i18n/format";
import {
  toClubMilestoneKind,
  toClubMilestoneStatus,
  type ClubThreadMilestoneRow,
} from "@/lib/clubs/workspaceTypes";

/** Etykieta terminu: całodniowy bez godziny, punktowy z godziną, zakres ze
 *  spójnikiem. Wydzielone, bo tego samego napisu używa lista i kafelek dnia. */
export function milestoneWhen(row: ClubThreadMilestoneRow, lang: "pl" | "en"): string {
  const start = row.all_day ? formatDate(row.starts_at, lang) : formatDateTime(row.starts_at, lang);
  if (row.ends_at === null) return start;
  const end = row.all_day ? formatDate(row.ends_at, lang) : formatDateTime(row.ends_at, lang);
  return end === start ? start : `${start} - ${end}`;
}

export function ClubMilestoneRow({
  row,
  lang,
  onEdit,
  onRemove,
}: {
  row: ClubThreadMilestoneRow;
  lang: "pl" | "en";
  onEdit?: (row: ClubThreadMilestoneRow) => void;
  onRemove?: (row: ClubThreadMilestoneRow) => void;
}) {
  const { t } = useTranslation();
  const kind = toClubMilestoneKind(row.kind);
  const status = toClubMilestoneStatus(row.status);
  const canAct = row.can_edit && (onEdit !== undefined || onRemove !== undefined);

  return (
    <li className="group/ms relative flex gap-3 rounded-xl border border-border/60 bg-card p-3 transition-colors hover:border-primary/30 sm:gap-4 sm:p-4">
      <span
        className={
          "mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg " +
          (status === "done"
            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            : status === "cancelled"
              ? "bg-muted text-muted-foreground"
              : "bg-primary/10 text-primary")
        }
      >
        <ClubMilestoneIcon kind={kind} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-medium">{row.title}</span>
          <ClubStatusPill
            label={t(`club.workspace.milestoneStatus.${status}`)}
            tone={milestoneTone(status)}
          />
        </div>

        <p className="mt-1 text-xs font-medium text-muted-foreground">
          <time dateTime={row.starts_at}>{milestoneWhen(row, lang)}</time>
          {" · "}
          {t(`club.workspace.milestoneKind.${kind}`)}
        </p>

        {row.description !== null && row.description.length > 0 ? (
          <p className="mt-1.5 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
            {row.description}
          </p>
        ) : null}

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {row.location !== null && row.location.length > 0 ? (
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3 w-3" aria-hidden="true" />
              {row.location}
            </span>
          ) : null}
          {row.owner_name !== null ? (
            <span>{t("club.workspace.schedule.owner", { name: row.owner_name })}</span>
          ) : null}
          {/* Wydarzenie platformy: link do jego strony, a nie kopia opisu.
              Rejestracja, stream i nagranie żyją tam, nie tutaj. */}
          {row.event_slug !== null && row.event_slug.length > 0 ? (
            <Link
              to="/events/$slug"
              params={{ slug: row.event_slug }}
              className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
            >
              <CalendarPlus className="h-3 w-3" aria-hidden="true" />
              {t("club.workspace.schedule.openEvent")}
            </Link>
          ) : null}
          {row.url !== null && row.url.length > 0 ? (
            <a
              href={row.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
            >
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
              {t("club.workspace.openLink")}
            </a>
          ) : null}
        </div>
      </div>

      {canAct ? (
        <div className="flex shrink-0 gap-0.5 opacity-70 transition-opacity focus-within:opacity-100 group-hover/ms:opacity-100">
          {onEdit !== undefined ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              aria-label={t("club.editor.edit")}
              onClick={() => onEdit(row)}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          ) : null}
          {onRemove !== undefined ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 text-destructive hover:text-destructive"
              aria-label={t("club.workspace.remove")}
              onClick={() => onRemove(row)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
