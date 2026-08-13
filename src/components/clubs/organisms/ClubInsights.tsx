// Pomiar klubu - czy ta deliberacja żyje.
//
// PO CO. Klub, który nie widzi własnej dynamiki, nie ma jak stwierdzić, że
// umiera. Pasek "7 odpowiedzi w tym tygodniu" na stronie klubu liczy się
// z ZAŁADOWANEJ strony wątków, więc mierzy WIDOK, a nie klub - i mówi to
// wprost w swoim podpisie. Ten ekran mierzy klub: liczby idą z RPC, które
// czyta całą tabelę pod bramką `can_read`.
//
// DLACZEGO NIE `ChartCard` Z PANELU. Tamten shell jest dobry (eksport, pełny
// ekran), ale importuje `@/lib/i18n-admin-analytics` jako efekt uboczny -
// czyli dokłada słownik panelu do chunka trasy PRODUKTOWEJ. Bierzemy więc sam
// prymityw `EChart` (klient-only, leniwy - to on trzyma ECharts poza grafem
// SSR) i opakowujemy go własną, minimalną kartą.
//
// CZEGO TU NIE MA: rankingu autorów w klubie pod regułą Chatham House. RPC go
// nie odda, a ten komponent nawet nie rysuje sekcji - lista dziesięciu nazwisk
// deanonimizuje rozmowę skuteczniej niż podpis pod pojedynczym wpisem.
import { useMemo, useState } from "react";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { useTranslation } from "react-i18next";
import {
  BarChart3,
  CalendarClock,
  FileText,
  ListChecks,
  MessagesSquare,
  Timer,
  UserCheck,
  Users2,
} from "lucide-react";
import type { EChartsCoreOption } from "echarts/core";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { EChart } from "@/components/admin/analytics/EChart";
import { useClubActivitySeries, useClubWorkspaceStats } from "@/lib/clubs/useClubWorkspace";
import {
  parseContributors,
  parseGroupBreakdown,
  parseKindBreakdown,
} from "@/lib/clubs/workspaceTypes";
import { ClubInsightsSkeleton } from "@/components/clubs/atoms/ClubWorkspaceSkeletons";
import { ClubErrorNotice } from "@/components/clubs/molecules/ClubErrorNotice";
import { formatDate, formatNumber, uiLocale, uiLang } from "@/lib/i18n/format";

const RANGES = [30, 90, 180] as const;
type Range = (typeof RANGES)[number];

function StatTile({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof MessagesSquare;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card className="p-3">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{label}</span>
      </div>
      <p className="mt-1 text-xl font-semibold leading-tight tabular-nums">{value}</p>
      {hint !== undefined ? (
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{hint}</p>
      ) : null}
    </Card>
  );
}

function ChartPanel({
  title,
  option,
  height,
  empty,
  isEmpty,
}: {
  title: string;
  option: EChartsCoreOption;
  height: number;
  empty: string;
  isEmpty: boolean;
}) {
  return (
    <Card className="p-3">
      <h3 className="mb-1 text-sm font-semibold">{title}</h3>
      {isEmpty ? (
        <p
          className="flex items-center justify-center text-sm text-muted-foreground"
          style={{ height: `${height}px` }}
        >
          {empty}
        </p>
      ) : (
        <EChart option={option} height={height} />
      )}
    </Card>
  );
}

export function ClubInsights({ clubId }: { clubId: string }) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const locale = uiLocale(i18n.language);

  const [range, setRange] = useState<Range>(90);

  const seriesQ = useClubActivitySeries(clubId, range);
  const statsQ = useClubWorkspaceStats(clubId, range);

  const points = useMemo(() => seriesQ.data ?? [], [seriesQ.data]);
  const stats = statsQ.data ?? null;

  const kinds = useMemo(
    () => (stats === null ? [] : parseKindBreakdown(stats.kind_breakdown)),
    [stats],
  );
  const groups = useMemo(
    () => (stats === null ? [] : parseGroupBreakdown(stats.group_breakdown)),
    [stats],
  );
  const contributors = useMemo(
    () => (stats === null ? [] : parseContributors(stats.top_contributors)),
    [stats],
  );

  /** Szereg dzienny. Etykiety osi są krótkie (dzień + miesiąc), bo przy 180
   *  punktach pełna data zlewa się w pasek - `axisLabel` i tak je przerzedza. */
  const activityOption = useMemo<EChartsCoreOption>(() => {
    const labels = points.map((p) =>
      formatDate(`${p.day}T12:00:00`, lang, { day: "numeric", month: "short" }),
    );
    return {
      tooltip: { trigger: "axis" },
      legend: { show: true },
      grid: { left: 8, right: 8, top: 28, bottom: 8, containLabel: true },
      xAxis: { type: "category", data: labels, boundaryGap: false },
      yAxis: { type: "value", minInterval: 1 },
      series: [
        {
          name: t("club.insights.chart.threads"),
          type: "line",
          smooth: true,
          symbol: "none",
          areaStyle: { opacity: 0.18 },
          lineStyle: { width: 2 },
          data: points.map((p) => p.threads),
        },
        {
          name: t("club.insights.chart.replies"),
          type: "line",
          smooth: true,
          symbol: "none",
          areaStyle: { opacity: 0.12 },
          lineStyle: { width: 2 },
          data: points.map((p) => p.replies),
        },
        {
          name: t("club.insights.chart.participants"),
          type: "line",
          smooth: true,
          symbol: "none",
          lineStyle: { width: 2, type: "dashed" },
          data: points.map((p) => p.participants),
        },
      ],
    };
  }, [points, lang, t]);

  /** Rodzaje wątków - słupki POZIOME: etykiety są słowami ("ogłoszenie",
   *  "sondaż"), a pionowe słupki obracałyby je o 45 stopni. */
  const kindOption = useMemo<EChartsCoreOption>(() => {
    const sorted = [...kinds].sort((a, b) => a.count - b.count);
    return {
      tooltip: { trigger: "item" },
      legend: { show: false },
      grid: { left: 8, right: 24, top: 8, bottom: 8, containLabel: true },
      xAxis: { type: "value", minInterval: 1 },
      yAxis: {
        type: "category",
        data: sorted.map((slice) => t(`club.kind.${slice.key}`)),
      },
      series: [
        {
          type: "bar",
          data: sorted.map((slice) => slice.count),
          barMaxWidth: 18,
          itemStyle: { borderRadius: [0, 4, 4, 0] },
          label: { show: true, position: "right", fontSize: 11 },
        },
      ],
    };
  }, [kinds, t]);

  /** Działy klubu - pierścień, bo pytanie brzmi "jak rozkłada się uwaga", czyli
   *  o UDZIAŁ w całości, a nie o wartość bezwzględną. */
  const groupOption = useMemo<EChartsCoreOption>(
    () => ({
      tooltip: { trigger: "item" },
      legend: { show: true, type: "scroll", bottom: 0 },
      series: [
        {
          type: "pie",
          radius: ["45%", "70%"],
          center: ["50%", "45%"],
          avoidLabelOverlap: true,
          itemStyle: { borderRadius: 4, borderWidth: 2 },
          label: { show: false },
          data: groups.map((slice) => ({
            name: pickLocalized(slice, "name", lang),
            value: slice.count,
          })),
        },
      ],
    }),
    [groups, lang],
  );

  if (seriesQ.isError || statsQ.isError) {
    return (
      <ClubErrorNotice
        onRetry={() => {
          void seriesQ.refetch();
          void statsQ.refetch();
        }}
      />
    );
  }
  if (seriesQ.isPending || statsQ.isPending) return <ClubInsightsSkeleton />;

  // Zero wierszy z RPC to brak prawa odczytu, nie pusty klub - i tak samo jak
  // przy `club_view` interfejs nie ma tu czego dopowiadać.
  if (stats === null) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
          <BarChart3 className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">{t("club.insights.empty")}</p>
        </CardContent>
      </Card>
    );
  }

  const median = stats.median_first_reply_hours;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t("club.insights.rangeLabel")}</p>
        <div className="flex gap-1" role="group" aria-label={t("club.insights.rangeLabel")}>
          {RANGES.map((value) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={range === value ? "default" : "outline"}
              aria-pressed={range === value}
              onClick={() => setRange(value)}
            >
              {t("club.insights.rangeDays", { count: value })}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          icon={MessagesSquare}
          label={t("club.insights.kpi.threads")}
          value={formatNumber(stats.threads_window, locale)}
          hint={t("club.insights.kpi.threadsHint", { count: stats.threads_total })}
        />
        <StatTile
          icon={Users2}
          label={t("club.insights.kpi.replies")}
          value={formatNumber(stats.replies_window, locale)}
          hint={t("club.insights.kpi.repliesHint", { count: stats.replies_total })}
        />
        <StatTile
          icon={UserCheck}
          label={t("club.insights.kpi.participants")}
          value={formatNumber(stats.active_participants, locale)}
          hint={t("club.insights.kpi.participantsHint")}
        />
        <StatTile
          icon={Timer}
          label={t("club.insights.kpi.firstReply")}
          // Mediana jest NULL, gdy żaden wątek nie doczekał się odpowiedzi.
          // To jest stan mówiący o klubie - kreska, nie zero.
          value={median === null ? "-" : t("club.insights.hours", { value: median })}
          hint={t("club.insights.kpi.firstReplyHint")}
        />
        <StatTile
          icon={MessagesSquare}
          label={t("club.insights.kpi.unanswered")}
          value={formatNumber(stats.unanswered, locale)}
          hint={t("club.insights.kpi.unansweredHint")}
        />
        <StatTile
          icon={FileText}
          label={t("club.insights.kpi.documents")}
          value={formatNumber(stats.documents_count, locale)}
        />
        <StatTile
          icon={CalendarClock}
          label={t("club.insights.kpi.events")}
          value={formatNumber(stats.upcoming_events, locale)}
        />
        <StatTile
          icon={ListChecks}
          label={t("club.insights.kpi.milestones")}
          value={formatNumber(stats.open_milestones, locale)}
        />
      </div>

      <ChartPanel
        title={t("club.insights.chart.activity")}
        option={activityOption}
        height={280}
        empty={t("club.insights.noData")}
        isEmpty={points.every((p) => p.threads === 0 && p.replies === 0)}
      />

      <div className="grid gap-3 lg:grid-cols-2">
        <ChartPanel
          title={t("club.insights.chart.kinds")}
          option={kindOption}
          height={240}
          empty={t("club.insights.noData")}
          isEmpty={kinds.length === 0}
        />
        <ChartPanel
          title={t("club.insights.chart.groups")}
          option={groupOption}
          height={240}
          empty={t("club.insights.noData")}
          isEmpty={groups.length === 0}
        />
      </div>

      {/* Sekcja rankingu POJAWIA SIĘ tylko wtedy, gdy RPC coś oddało - patrz
          nagłówek pliku. Pusty nagłówek "Najaktywniejsi" w klubie pod regułą
          Chatham House sugerowałby, że nikt nie pisze. */}
      {contributors.length > 0 ? (
        <Card className="p-3">
          <h3 className="mb-2 text-sm font-semibold">{t("club.insights.contributors")}</h3>
          <ul className="grid gap-2 sm:grid-cols-2">
            {contributors.map((person, index) => (
              <li
                key={`${person.name}-${index}`}
                className="flex items-center gap-2.5 rounded-lg border border-border/60 bg-card p-2"
              >
                <Avatar className="h-8 w-8 shrink-0">
                  {person.avatarUrl !== null ? <AvatarImage src={person.avatarUrl} alt="" /> : null}
                  <AvatarFallback className="text-[11px]">
                    {person.name.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1 truncate text-sm">{person.name}</span>
                <span
                  className={cn(
                    "shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] tabular-nums",
                    index === 0 && "bg-primary/10 text-primary",
                  )}
                >
                  {t("club.insights.replyCount", { count: person.count })}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
