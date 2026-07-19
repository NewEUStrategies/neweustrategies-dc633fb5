// Dashboard "Audytorium / retencja" - segmentacja zalogowani vs anonimowi.
// Reużywa EChart wrapper, InsightSection, Card, Tabs z projektu.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-analytics";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Users, UserCheck, UserX, Eye, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EChart } from "./EChart";
import { InsightSection, type Insight } from "./InsightSection";
import {
  getAudienceSegments,
  type AudienceSegmentsResult,
} from "@/lib/analytics/audience.functions";

const RANGES: ReadonlyArray<{ v: number; lKey: string }> = [
  { v: 7, lKey: "adminAnalytics.timeRange.preset7d" },
  { v: 30, lKey: "adminAnalytics.timeRange.preset30d" },
  { v: 90, lKey: "adminAnalytics.timeRange.preset90d" },
];

interface KpiCardProps {
  label: string;
  value: number;
  hint?: string;
  Icon: typeof Users;
  tone: "brand" | "logged" | "anon";
}

function KpiCard({ label, value, hint, Icon, tone }: KpiCardProps) {
  const toneClass =
    tone === "logged"
      ? "bg-cat-finance/10 text-cat-finance border-cat-finance/30"
      : tone === "anon"
        ? "bg-cat-transport/10 text-cat-transport border-cat-transport/30"
        : "bg-brand-ink/10 text-brand-ink border-brand-ink/30";
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {label}
        </span>
        <span
          className={`inline-flex h-8 w-8 items-center justify-center rounded-md border ${toneClass}`}
        >
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div className="mt-2 text-2xl font-display">{value.toLocaleString("pl-PL")}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </Card>
  );
}

export function AudienceSegmentsDashboard() {
  const { t } = useTranslation();
  const [days, setDays] = useState<number>(30);
  const fetchAudience = useServerFn(getAudienceSegments);

  const q = useQuery<AudienceSegmentsResult>({
    queryKey: ["admin", "audience-segments", days],
    queryFn: () => fetchAudience({ data: { days } }),
    staleTime: 60_000,
  });

  const chartOption = useMemo(() => {
    const series = q.data?.series ?? [];
    const dates = series.map((s) => s.day);
    const logged = series.map((s) => s.logged);
    const anon = series.map((s) => s.anon);
    return {
      tooltip: { trigger: "axis" as const },
      legend: {
        data: [t("adminAnalytics.audience.logged"), t("adminAnalytics.audience.anon")],
        top: 0,
      },
      grid: { top: 32, left: 40, right: 16, bottom: 32 },
      xAxis: { type: "category" as const, data: dates, axisLabel: { fontSize: 10 } },
      yAxis: { type: "value" as const },
      series: [
        {
          name: t("adminAnalytics.audience.logged"),
          type: "bar" as const,
          stack: "views",
          data: logged,
          itemStyle: { color: "oklch(0.7 0.18 145)" },
        },
        {
          name: t("adminAnalytics.audience.anon"),
          type: "bar" as const,
          stack: "views",
          data: anon,
          itemStyle: { color: "oklch(0.8 0.15 75)" },
        },
      ],
    };
  }, [q.data, t]);

  const insights: Insight[] = useMemo(() => {
    const out: Insight[] = [];
    if (!q.data) return out;
    const arr = (key: string): string[] => t(key, { returnObjects: true }) as string[];
    const { kpi } = q.data;
    const total = kpi.views_total;
    if (total === 0) {
      out.push({
        id: "empty",
        element: t("adminAnalytics.audience.insights.empty.element"),
        severity: "info",
        title: t("adminAnalytics.audience.insights.empty.title"),
        detail: t("adminAnalytics.audience.insights.empty.detail"),
        fixes: arr("adminAnalytics.audience.insights.empty.fixes"),
      });
      return out;
    }
    const loggedShare = kpi.views_logged / total;
    if (loggedShare < 0.05) {
      out.push({
        id: "low-logged",
        element: t("adminAnalytics.audience.insights.lowLogged.element"),
        severity: "warn",
        title: t("adminAnalytics.audience.insights.lowLogged.title", {
          pct: (loggedShare * 100).toFixed(1),
        }),
        detail: t("adminAnalytics.audience.insights.lowLogged.detail"),
        fixes: arr("adminAnalytics.audience.insights.lowLogged.fixes"),
      });
    } else if (loggedShare > 0.6) {
      out.push({
        id: "high-logged",
        element: t("adminAnalytics.audience.insights.highLogged.element"),
        severity: "good",
        title: t("adminAnalytics.audience.insights.highLogged.title", {
          pct: (loggedShare * 100).toFixed(1),
        }),
        detail: t("adminAnalytics.audience.insights.highLogged.detail"),
        fixes: arr("adminAnalytics.audience.insights.highLogged.fixes"),
      });
    }
    if (kpi.unique_logged > 0 && kpi.views_logged / kpi.unique_logged > 4) {
      out.push({
        id: "loyal-logged",
        element: t("adminAnalytics.audience.insights.loyalLogged.element"),
        severity: "good",
        title: t("adminAnalytics.audience.insights.loyalLogged.title", {
          count: (kpi.views_logged / kpi.unique_logged).toFixed(1),
        }),
        detail: t("adminAnalytics.audience.insights.loyalLogged.detail"),
        fixes: arr("adminAnalytics.audience.insights.loyalLogged.fixes"),
      });
    }
    if (q.data.truncated) {
      out.push({
        id: "trunc",
        element: t("adminAnalytics.audience.insights.trunc.element"),
        severity: "warn",
        title: t("adminAnalytics.audience.insights.trunc.title"),
        detail: t("adminAnalytics.audience.insights.trunc.detail"),
        fixes: arr("adminAnalytics.audience.insights.trunc.fixes"),
      });
    }
    return out;
  }, [q.data, t]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-display text-lg">{t("adminAnalytics.audience.title")}</h3>
          <p className="text-sm text-muted-foreground">
            {t("adminAnalytics.audience.descPre")}
            <code>post_views</code>
            {t("adminAnalytics.audience.descPost")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
            <SelectTrigger className="w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGES.map((r) => (
                <SelectItem key={r.v} value={String(r.v)}>
                  {t(r.lKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {q.isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label={t("adminAnalytics.audience.kpi.viewsTotal")}
          value={q.data?.kpi.views_total ?? 0}
          Icon={Eye}
          tone="brand"
        />
        <KpiCard
          label={t("adminAnalytics.audience.kpi.logged")}
          value={q.data?.kpi.views_logged ?? 0}
          hint={t("adminAnalytics.audience.uniqueHint", { count: q.data?.kpi.unique_logged ?? 0 })}
          Icon={UserCheck}
          tone="logged"
        />
        <KpiCard
          label={t("adminAnalytics.audience.kpi.anon")}
          value={q.data?.kpi.views_anon ?? 0}
          hint={t("adminAnalytics.audience.uniqueHint", { count: q.data?.kpi.unique_anon ?? 0 })}
          Icon={UserX}
          tone="anon"
        />
        <KpiCard
          label={t("adminAnalytics.audience.kpi.uniqueReaders")}
          value={q.data?.kpi.unique_readers ?? 0}
          Icon={Users}
          tone="brand"
        />
      </div>

      <Card className="p-4">
        <div className="mb-2 flex items-center justify-between">
          <h4 className="font-display text-base">{t("adminAnalytics.audience.dailyViews")}</h4>
          {q.data?.truncated && (
            <Badge variant="outline" className="text-xs">
              {t("adminAnalytics.audience.sampleTruncated")}
            </Badge>
          )}
        </div>
        <EChart option={chartOption} height={280} />
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TopPosts
          title={t("adminAnalytics.audience.topLogged")}
          rows={q.data?.top_logged ?? []}
          tone="logged"
        />
        <TopPosts
          title={t("adminAnalytics.audience.topAnon")}
          rows={q.data?.top_anon ?? []}
          tone="anon"
        />
      </div>

      <InsightSection insights={insights} />
    </div>
  );
}

function TopPosts({
  title,
  rows,
  tone,
}: {
  title: string;
  rows: ReadonlyArray<{
    post_id: string;
    title: string;
    slug: string | null;
    views: number;
    uniques: number;
  }>;
  tone: "logged" | "anon";
}) {
  const { t } = useTranslation();
  const dot = tone === "logged" ? "bg-cat-finance" : "bg-cat-transport";
  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className={`inline-block h-2 w-2 rounded-full ${dot}`} aria-hidden />
        <h4 className="font-display text-base">{title}</h4>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">
          {t("adminAnalytics.common.noDataWindow")}
        </p>
      ) : (
        <ol className="divide-y divide-border">
          {rows.map((r, i) => (
            <li key={r.post_id} className="flex items-center gap-3 py-2">
              <span className="w-5 text-xs font-mono text-muted-foreground">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{r.title}</div>
                {r.slug && <div className="truncate text-xs text-muted-foreground">/{r.slug}</div>}
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm font-medium">{r.views.toLocaleString("pl-PL")}</div>
                <div className="text-xs text-muted-foreground">
                  {r.uniques} {t("adminAnalytics.audience.uniqShort")}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
