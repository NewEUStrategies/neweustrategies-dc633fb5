// Harmonogram prac klubu - oś etapów, nie lista terminów.
//
// TO NIE JEST DRUGI KALENDARZ. Kalendarz odpowiada "co i kiedy", harmonogram -
// "na którym etapie jesteśmy". Klub, który towarzyszy procesowi legislacyjnemu,
// pracuje etapami o różnej długości (konsultacje, pierwsze czytanie, trilog),
// a nie punktami w czasie. Dlatego zakres dat, stan i postęp - a nie godzina.
//
// SPÓŹNIENIE JEST WYLICZANE, NIE PRZECHOWYWANE. Stan `blocked` ustawia
// prowadzący, a "termin minął, a etap nie jest zamknięty" to fakt o KALENDARZU,
// nie o decyzji człowieka - kolumna trzymająca to w bazie kłamałaby następnego
// dnia po każdym imporcie.
import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { CalendarRange, Link2, ListChecks, TriangleAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useClubMilestones } from "@/lib/clubs/useClubWorkspace";
import {
  isMilestoneOverdue,
  toMilestoneState,
  type ClubMilestoneRow,
} from "@/lib/clubs/workspaceTypes";
import {
  ClubMilestoneMarker,
  ClubMilestoneStateChip,
} from "@/components/clubs/atoms/ClubWorkspaceBadges";
import { ClubScheduleSkeleton } from "@/components/clubs/atoms/ClubWorkspaceSkeletons";
import { ClubErrorNotice } from "@/components/clubs/molecules/ClubErrorNotice";
import { formatDate, uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";

/** Dzisiaj jako `YYYY-MM-DD` w czasie LOKALNYM - `due_on` jest datą bez strefy,
 *  więc porównanie z `toISOString()` przesuwałoby granicę doby. */
function localToday(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function MilestoneItem({
  row,
  clubSlug,
  today,
  last,
}: {
  row: ClubMilestoneRow;
  clubSlug: string;
  today: string;
  last: boolean;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const state = toMilestoneState(row.state);
  const overdue = isMilestoneOverdue(row, today);
  const title = pickLocalized(row, "title", lang);
  const description = pickLocalized(row, "description", lang);

  const range = (() => {
    const opts = { day: "numeric", month: "short", year: "numeric" } as const;
    const from = row.starts_on !== null ? formatDate(row.starts_on, lang, opts) : null;
    const to = row.due_on !== null ? formatDate(row.due_on, lang, opts) : null;
    if (from !== null && to !== null) return `${from} - ${to}`;
    return to ?? from;
  })();

  return (
    <li className="flex gap-3">
      {/* Kolumna osi: marker + kreska do następnego etapu. Ostatni element jej
          nie dostaje, bo oś kończy się na nim, a nie za nim. */}
      <div className="flex flex-col items-center">
        <ClubMilestoneMarker state={state} />
        {!last ? <span className="mt-1 w-px flex-1 bg-border" aria-hidden="true" /> : null}
      </div>

      <article
        className={cn(
          "mb-3 min-w-0 flex-1 rounded-lg border bg-card p-3",
          overdue ? "border-destructive/40" : "border-border/60",
        )}
        data-testid="club-milestone-item"
      >
        <div className="flex flex-wrap items-center gap-2">
          <ClubMilestoneStateChip state={state} />
          {overdue ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-destructive">
              <TriangleAlert className="h-3 w-3" aria-hidden="true" />
              {t("club.schedule.overdue")}
            </span>
          ) : null}
        </div>

        <h3 className="mt-1.5 font-medium leading-tight">{title}</h3>

        {description !== null && description.trim() !== "" ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {range !== null ? (
            <span className="inline-flex items-center gap-1.5">
              <CalendarRange className="h-3.5 w-3.5" aria-hidden="true" />
              {range}
            </span>
          ) : null}
          {row.thread_slug !== null ? (
            <Link
              to="/club/$clubSlug/t/$threadSlug"
              params={{ clubSlug, threadSlug: row.thread_slug }}
              className="inline-flex items-center gap-1 hover:text-foreground"
            >
              <Link2 className="h-3 w-3" aria-hidden="true" />
              {t("club.schedule.linkedThread")}
            </Link>
          ) : null}
        </div>

        {/* Pasek postępu tylko tam, gdzie postęp coś znaczy: etap zaplanowany
            z zerem i etap zamknięty ze setką to dwa paski, które nie niosą
            nic ponad to, co mówi już odznaka stanu. */}
        {state === "active" || (row.progress > 0 && row.progress < 100) ? (
          <div className="mt-2.5">
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={row.progress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={t("club.schedule.progress")}
            >
              <span
                className="block h-full rounded-full bg-primary transition-[width]"
                style={{ width: `${Math.min(100, Math.max(0, row.progress))}%` }}
              />
            </div>
            <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">
              {t("club.schedule.progressValue", { value: row.progress })}
            </p>
          </div>
        ) : null}
      </article>
    </li>
  );
}

export function ClubSchedule({ clubId, clubSlug }: { clubId: string; clubSlug: string }) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const milestonesQ = useClubMilestones(clubId);
  const rows = useMemo(() => milestonesQ.data ?? [], [milestonesQ.data]);
  const today = localToday();

  if (milestonesQ.isError) return <ClubErrorNotice onRetry={() => void milestonesQ.refetch()} />;
  if (milestonesQ.isPending) return <ClubScheduleSkeleton />;

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
          <ListChecks className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">{t("club.schedule.empty")}</p>
        </CardContent>
      </Card>
    );
  }

  const done = rows.filter((row) => toMilestoneState(row.state) === "done").length;
  const overdue = rows.filter((row) => isMilestoneOverdue(row, today)).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-border/60 bg-card/50 px-3 py-2 text-xs text-muted-foreground">
        <span>
          <span className="font-semibold tabular-nums text-foreground">
            {done}/{rows.length}
          </span>{" "}
          {t("club.schedule.doneOf")}
        </span>
        {overdue > 0 ? (
          <span className="inline-flex items-center gap-1.5 text-destructive">
            <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />
            {t("club.schedule.overdueCount", { count: overdue })}
          </span>
        ) : null}
      </div>

      <ol className="max-w-3xl">
        {rows.map((row, index) => (
          <MilestoneItem
            key={row.id}
            row={row}
            clubSlug={clubSlug}
            today={today}
            last={index === rows.length - 1}
          />
        ))}
      </ol>
    </div>
  );
}
