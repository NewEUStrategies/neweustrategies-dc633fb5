// Molekuła: pasek statystyk wątku pod nagłówkiem.
//
// Cztery liczby, które odpowiadają na pytanie „czy to jeszcze żyje i czy jest
// z czego korzystać", zanim czytelnik przewinie choć raz. To jest ta sama
// rola, którą na liście wątków pełni `ClubThreadHeat` - z tą różnicą, że tu
// mamy komplet danych, a nie sam licznik odpowiedzi.
//
// Pozycja bez wartości NIE renderuje się jako zero. „0 źródeł" wygląda jak
// zepsuty panel; brak pozycji wygląda jak wątek, który jeszcze źródeł nie ma.
// Jedynym wyjątkiem są odpowiedzi - zero odpowiedzi to informacja, i to
// najważniejsza w całym module (V1 par. 5.2).
import { useTranslation } from "react-i18next";
import { CalendarClock, FileText, MessageSquare, Users2 } from "lucide-react";
import { formatDateShort } from "@/lib/i18n/format";
import type { ClubWorkspaceSummary } from "@/lib/clubs/threadWorkspaceTypes";

function Stat({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span aria-hidden="true" className="text-muted-foreground/70">
        {icon}
      </span>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

export function ClubHubStats({
  summary,
  replyCount,
  lang,
}: {
  summary: ClubWorkspaceSummary;
  /** Licznik z karty wątku - prawdziwy nawet zanim dojdzie spis treści. */
  replyCount: number;
  lang: "pl" | "en";
}) {
  const { t } = useTranslation();

  return (
    <dl className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2.5 border-t border-border/50 pt-4">
      <Stat
        icon={<MessageSquare className="h-4 w-4" />}
        value={String(replyCount)}
        label={t("club.threadHub.stat.replies", { count: replyCount })}
      />
      {summary.participants > 0 ? (
        <Stat
          icon={<Users2 className="h-4 w-4" />}
          value={String(summary.participants)}
          label={t("club.threadHub.stat.participants", { count: summary.participants })}
        />
      ) : null}
      {summary.documents > 0 ? (
        <Stat
          icon={<FileText className="h-4 w-4" />}
          value={String(summary.documents)}
          label={t("club.threadHub.stat.documents", { count: summary.documents })}
        />
      ) : null}
      {summary.nextMilestoneAt !== null ? (
        <Stat
          icon={<CalendarClock className="h-4 w-4" />}
          value={formatDateShort(summary.nextMilestoneAt, lang)}
          label={t("club.threadHub.stat.nextMilestone")}
        />
      ) : null}
    </dl>
  );
}
