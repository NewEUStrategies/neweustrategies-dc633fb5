/**
 * Related Posts - BI dashboard (zakładka Analiza).
 *
 * Wizualizuje sygnały silnika rekomendacji per tenant:
 *  - KPI: liczba wpisów, wyświetleń, klików rekomendacji, czytań
 *  - Bar: top kategorie / top tagi (liczba wpisów)
 *  - Heatmap: współwystępowanie tagów (top 25×25)
 *  - Scatter: popularność wpisów (views × uniques)
 *  - Sankey: top pary "źródło - cel" z klików w rekomendacje
 *  - Bar: hub-posty (najczęściej rekomendowane cele)
 *  - InsightSection: interpretacja + rekomendacje algorytmiczne
 *
 * Dane pochodzą z `getRelatedInsights` (RPC `related_posts_signals`).
 * Wszystko izolowane per tenant przez auth-middleware + admin gate.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-analytics";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Loader2, RefreshCw, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { EChartsCoreOption } from "echarts/core";
import { getRelatedInsights } from "@/lib/relatedInsights.functions";
import { ChartCard } from "@/components/admin/analytics/ChartCard";
import { KpiTile } from "@/components/admin/analytics/KpiTile";
import {
  TimeRangeFilter,
  buildPresetRange,
  type TimeRangeValue,
} from "@/components/admin/analytics/TimeRangeFilter";
import { InsightSection, type Insight } from "@/components/admin/analytics/InsightSection";

function nice(n: number): string {
  if (!Number.isFinite(n)) return "-";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function RelatedPostsAnalytics() {
  const { t } = useTranslation();
  const fetchInsights = useServerFn(getRelatedInsights);
  const [range, setRange] = useState<TimeRangeValue>(() => buildPresetRange("30d"));

  const query = useQuery({
    queryKey: ["related-insights", range.days],
    queryFn: () => fetchInsights({ data: { days: range.days } }),
    staleTime: 60_000,
  });
  const report = query.data;
  const isLoading = query.isLoading;

  const tagIdToName = useMemo(() => {
    const m = new Map<string, string>();
    (report?.top_tags ?? []).forEach((t) => m.set(t.tag_id, t.name));
    return m;
  }, [report]);

  // ---- Wykresy -----------------------------------------------------------
  const topCatsOption = useMemo<EChartsCoreOption>(() => {
    const cats = (report?.top_categories ?? []).slice(0, 15);
    return {
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      grid: { left: 8, right: 16, top: 12, bottom: 24, containLabel: true },
      xAxis: { type: "value" },
      yAxis: {
        type: "category",
        data: cats.map((c) => c.name).reverse(),
        axisLabel: { fontSize: 11, width: 140, overflow: "truncate" },
      },
      series: [
        {
          type: "bar",
          data: cats.map((c) => c.posts_count).reverse(),
          itemStyle: { borderRadius: [0, 4, 4, 0], color: "#2a78d6" },
          label: { show: true, position: "right", fontSize: 10 },
        },
      ],
    };
  }, [report]);

  const topTagsOption = useMemo<EChartsCoreOption>(() => {
    const tags = (report?.top_tags ?? []).slice(0, 20);
    return {
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      grid: { left: 8, right: 16, top: 12, bottom: 24, containLabel: true },
      xAxis: { type: "value" },
      yAxis: {
        type: "category",
        data: tags.map((c) => c.name).reverse(),
        axisLabel: { fontSize: 11, width: 140, overflow: "truncate" },
      },
      series: [
        {
          type: "bar",
          data: tags.map((c) => c.posts_count).reverse(),
          itemStyle: { borderRadius: [0, 4, 4, 0], color: "#1baf7a" },
          label: { show: true, position: "right", fontSize: 10 },
        },
      ],
    };
  }, [report]);

  const coocurrenceOption = useMemo<EChartsCoreOption>(() => {
    const pairs = report?.tag_cooccurrence ?? [];
    const idSet = new Set<string>();
    pairs.forEach((p) => {
      idSet.add(p.a);
      idSet.add(p.b);
    });
    const ids = Array.from(idSet).slice(0, 25);
    const idx = new Map(ids.map((id, i) => [id, i]));
    const names = ids.map((id) => tagIdToName.get(id) ?? id.slice(0, 6));
    const maxC = pairs.reduce((mx, p) => Math.max(mx, p.c), 0);
    const cells: [number, number, number][] = [];
    pairs.forEach((p) => {
      const i = idx.get(p.a);
      const j = idx.get(p.b);
      if (i === undefined || j === undefined) return;
      cells.push([i, j, p.c]);
      cells.push([j, i, p.c]);
    });
    return {
      tooltip: {
        position: "top",
        formatter: (raw: unknown) => {
          const p = raw as { value: [number, number, number] };
          const [i, j, c] = p.value;
          return `${names[i]} × ${names[j]}<br/>${t("adminAnalytics.related.coocLabel")}<b>${c}</b>`;
        },
      },
      grid: { top: 20, left: 8, right: 8, bottom: 90, containLabel: true },
      xAxis: {
        type: "category",
        data: names,
        axisLabel: { rotate: 45, fontSize: 10, interval: 0 },
      },
      yAxis: { type: "category", data: names, axisLabel: { fontSize: 10, interval: 0 } },
      visualMap: {
        min: 0,
        max: Math.max(1, maxC),
        calculable: false,
        orient: "horizontal",
        left: "center",
        bottom: 4,
        inRange: { color: ["#f1f5f9", "#2a78d6", "#0f172a"] },
        textStyle: { fontSize: 10 },
      },
      series: [
        {
          type: "heatmap",
          data: cells,
          progressive: 0,
          itemStyle: { borderRadius: 2, borderColor: "hsl(var(--background))", borderWidth: 1 },
        },
      ],
    };
  }, [report, tagIdToName, t]);

  const popularityScatterOption = useMemo<EChartsCoreOption>(() => {
    const rows = (report?.popularity ?? []).slice(0, 40);
    return {
      tooltip: {
        trigger: "item",
        formatter: (raw: unknown) => {
          const p = raw as { value: [number, number]; name: string };
          return `${p.name}<br/>${t("adminAnalytics.related.views")}: <b>${p.value[0]}</b><br/>${t("adminAnalytics.related.uniques")}: <b>${p.value[1]}</b>`;
        },
      },
      grid: { left: 40, right: 20, top: 16, bottom: 30, containLabel: true },
      xAxis: { type: "value", name: t("adminAnalytics.related.views"), nameGap: 22 },
      yAxis: { type: "value", name: t("adminAnalytics.related.uniques"), nameGap: 30 },
      series: [
        {
          type: "scatter",
          symbolSize: (v: number[]) => Math.max(6, Math.min(28, Math.sqrt(v[0]) * 1.5)),
          data: rows.map((r) => ({
            name: r.title ?? r.post_id.slice(0, 8),
            value: [r.views, r.uniques],
          })),
          itemStyle: { color: "#eda100", opacity: 0.75 },
        },
      ],
    };
  }, [report, t]);

  const sankeyOption = useMemo<EChartsCoreOption>(() => {
    const pairs = (report?.click_pairs ?? []).slice(0, 25);
    const nodeSet = new Set<string>();
    pairs.forEach((p) => {
      nodeSet.add(`s:${p.source_post_id}|${p.source_title ?? p.source_post_id.slice(0, 6)}`);
      nodeSet.add(`t:${p.target_post_id}|${p.target_title ?? p.target_post_id.slice(0, 6)}`);
    });
    const nodes = Array.from(nodeSet).map((key) => {
      const [, label] = key.split("|");
      return { name: key, label: { formatter: label.slice(0, 32) } };
    });
    const links = pairs.map((p) => ({
      source: `s:${p.source_post_id}|${p.source_title ?? p.source_post_id.slice(0, 6)}`,
      target: `t:${p.target_post_id}|${p.target_title ?? p.target_post_id.slice(0, 6)}`,
      value: p.clicks,
    }));
    return {
      tooltip: {
        trigger: "item",
        formatter: (raw: unknown) => {
          const p = raw as { dataType: string; value?: number; name?: string };
          if (p.dataType === "edge") return `${p.value} ${t("adminAnalytics.related.clicksShort")}`;
          return (p.name ?? "").split("|")[1] ?? "";
        },
      },
      series: [
        {
          type: "sankey",
          left: 10,
          right: 120,
          top: 12,
          bottom: 12,
          nodeWidth: 12,
          nodeGap: 8,
          label: {
            fontSize: 10,
            formatter: (p: { name: string }) => (p.name.split("|")[1] ?? "").slice(0, 32),
          },
          data: nodes,
          links,
          lineStyle: { color: "gradient", curveness: 0.5 },
        },
      ],
    };
  }, [report, t]);

  const hubBarOption = useMemo<EChartsCoreOption>(() => {
    const rows = (report?.hub_targets ?? []).slice(0, 12).reverse();
    return {
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (raw: unknown) => {
          const arr = raw as Array<{ dataIndex: number; value: number; name: string }>;
          if (!arr[0]) return "";
          const row = rows[arr[0].dataIndex];
          return `${row.title ?? row.post_id.slice(0, 8)}<br/>${t("adminAnalytics.related.hubClicksLabel")}<b>${row.clicks}</b><br/>${t("adminAnalytics.related.hubSourcesLabel")}${row.sources}`;
        },
      },
      grid: { left: 8, right: 24, top: 12, bottom: 20, containLabel: true },
      xAxis: { type: "value" },
      yAxis: {
        type: "category",
        data: rows.map((r) => r.title ?? r.post_id.slice(0, 8)),
        axisLabel: { fontSize: 10, width: 170, overflow: "truncate" },
      },
      series: [
        {
          type: "bar",
          data: rows.map((r) => r.clicks),
          itemStyle: { borderRadius: [0, 4, 4, 0], color: "#4a3aa7" },
          label: { show: true, position: "right", fontSize: 10 },
        },
      ],
    };
  }, [report, t]);

  // ---- Interpretacja + rekomendacje ---------------------------------------
  const insights = useMemo<Insight[]>(() => {
    if (!report) return [];
    const list: Insight[] = [];
    const s = report.summary;

    const arr = (key: string): string[] => t(key, { returnObjects: true }) as string[];

    // Widoczność silnika: czy w ogóle klikają w rekomendacje?
    if (s.total_views > 100 && s.total_clicks === 0) {
      list.push({
        id: "no-clicks",
        element: t("adminAnalytics.related.insights.noClicks.element"),
        severity: "critical",
        title: t("adminAnalytics.related.insights.noClicks.title"),
        detail: t("adminAnalytics.related.insights.noClicks.detail", { views: s.total_views }),
        fixes: arr("adminAnalytics.related.insights.noClicks.fixes"),
      });
    } else if (s.total_clicks > 0 && s.total_views > 0) {
      const ctr = (s.total_clicks / s.total_views) * 100;
      const sev: Insight["severity"] = ctr >= 3 ? "good" : ctr >= 1 ? "info" : "warn";
      list.push({
        id: "ctr",
        element: t("adminAnalytics.related.insights.ctr.element"),
        severity: sev,
        title: t("adminAnalytics.related.insights.ctr.title", { ctr: ctr.toFixed(2) }),
        detail: t("adminAnalytics.related.insights.ctr.detail", {
          clicks: s.total_clicks,
          views: s.total_views,
        }),
        fixes:
          sev === "good"
            ? arr("adminAnalytics.related.insights.ctr.fixesGood")
            : arr("adminAnalytics.related.insights.ctr.fixesBad"),
      });
    }

    // Zbyt mała pula kategorii
    const cats = report.top_categories;
    const smallCats = cats.filter((c) => c.posts_count > 0 && c.posts_count < 3);
    if (cats.length > 0 && smallCats.length >= 3) {
      list.push({
        id: "small-cats",
        element: t("adminAnalytics.related.insights.smallCats.element"),
        severity: "warn",
        title: t("adminAnalytics.related.insights.smallCats.title", { count: smallCats.length }),
        detail: t("adminAnalytics.related.insights.smallCats.detail"),
        fixes: arr("adminAnalytics.related.insights.smallCats.fixes"),
      });
    }

    // Sygnał behawioralny nieużywany
    if (s.total_reads === 0 && s.total_views > 50) {
      list.push({
        id: "no-reads",
        element: t("adminAnalytics.related.insights.noReads.element"),
        severity: "info",
        title: t("adminAnalytics.related.insights.noReads.title"),
        detail: t("adminAnalytics.related.insights.noReads.detail"),
        fixes: arr("adminAnalytics.related.insights.noReads.fixes"),
      });
    }

    // Współwystępowanie tagów - słaby graf
    const coPairs = report.tag_cooccurrence;
    if (coPairs.length > 0) {
      const avg = coPairs.reduce((a, p) => a + p.c, 0) / coPairs.length;
      if (avg < 2) {
        list.push({
          id: "sparse-tags",
          element: t("adminAnalytics.related.insights.sparseTags.element"),
          severity: "warn",
          title: t("adminAnalytics.related.insights.sparseTags.title"),
          detail: t("adminAnalytics.related.insights.sparseTags.detail", { avg: avg.toFixed(1) }),
          fixes: arr("adminAnalytics.related.insights.sparseTags.fixes"),
        });
      } else {
        list.push({
          id: "healthy-tags",
          element: t("adminAnalytics.related.insights.healthyTags.element"),
          severity: "good",
          title: t("adminAnalytics.related.insights.healthyTags.title"),
          detail: t("adminAnalytics.related.insights.healthyTags.detail", { avg: avg.toFixed(1) }),
          fixes: [],
        });
      }
    }

    // Hub-posty
    const hubs = report.hub_targets;
    if (hubs.length > 0 && hubs[0].clicks >= 5) {
      list.push({
        id: "hub",
        element: t("adminAnalytics.related.insights.hub.element"),
        severity: "info",
        title: t("adminAnalytics.related.insights.hub.title", {
          name: hubs[0].title ?? hubs[0].post_id.slice(0, 8),
        }),
        detail: t("adminAnalytics.related.insights.hub.detail", {
          clicks: hubs[0].clicks,
          sources: hubs[0].sources,
        }),
        fixes: arr("adminAnalytics.related.insights.hub.fixes"),
      });
    }

    // Popularność vs rekomendacja
    const pop = report.popularity;
    if (pop.length > 0 && hubs.length > 0) {
      const hubIds = new Set(hubs.map((h) => h.post_id));
      const popularButNotRec = pop.slice(0, 10).filter((p) => !hubIds.has(p.post_id));
      if (popularButNotRec.length >= 3) {
        list.push({
          id: "mismatch",
          element: t("adminAnalytics.related.insights.mismatch.element"),
          severity: "warn",
          title: t("adminAnalytics.related.insights.mismatch.title", {
            count: popularButNotRec.length,
          }),
          detail: t("adminAnalytics.related.insights.mismatch.detail"),
          fixes: arr("adminAnalytics.related.insights.mismatch.fixes"),
        });
      }
    }

    return list;
  }, [report, t]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <TimeRangeFilter value={range} onChange={setRange} />
        <Button
          variant="outline"
          size="sm"
          onClick={() => query.refetch()}
          className="h-7"
          disabled={isLoading}
        >
          <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> {t("adminAnalytics.common.refresh")}
        </Button>
        <div className="text-xs text-muted-foreground inline-flex items-center gap-1">
          <TrendingUp className="w-3 h-3" />{" "}
          {t("adminAnalytics.related.windowInfo", {
            days: report?.summary.window_days ?? range.days,
          })}
        </div>
        {isLoading ? (
          <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" /> {t("adminAnalytics.common.loading")}
          </span>
        ) : null}
      </div>

      {!report ? (
        <Card className="p-6 text-sm text-muted-foreground">
          {t("adminAnalytics.common.noDataWindow")}
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiTile
              label={t("adminAnalytics.related.kpi.posts")}
              value={nice(report.summary.total_posts)}
            />
            <KpiTile
              label={t("adminAnalytics.related.kpi.views")}
              value={nice(report.summary.total_views)}
              current={report.summary.total_views}
            />
            <KpiTile
              label={t("adminAnalytics.related.kpi.clicks")}
              value={nice(report.summary.total_clicks)}
              current={report.summary.total_clicks}
            />
            <KpiTile
              label={t("adminAnalytics.related.kpi.reads")}
              value={nice(report.summary.total_reads)}
              current={report.summary.total_reads}
            />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <ChartCard
              title={t("adminAnalytics.related.charts.topCatsTitle")}
              subtitle={t("adminAnalytics.related.charts.topCatsSubtitle")}
              option={topCatsOption}
              height={360}
            />
            <ChartCard
              title={t("adminAnalytics.related.charts.topTagsTitle")}
              subtitle={t("adminAnalytics.related.charts.topTagsSubtitle")}
              option={topTagsOption}
              height={360}
            />
          </div>

          <ChartCard
            title={t("adminAnalytics.related.charts.coocTitle")}
            subtitle={t("adminAnalytics.related.charts.coocSubtitle")}
            option={coocurrenceOption}
            height={440}
          />

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <ChartCard
              title={t("adminAnalytics.related.charts.popularityTitle")}
              subtitle={t("adminAnalytics.related.charts.popularitySubtitle")}
              option={popularityScatterOption}
              height={360}
            />
            <ChartCard
              title={t("adminAnalytics.related.charts.hubTitle")}
              subtitle={t("adminAnalytics.related.charts.hubSubtitle")}
              option={hubBarOption}
              height={360}
            />
          </div>

          <ChartCard
            title={t("adminAnalytics.related.charts.sankeyTitle")}
            subtitle={t("adminAnalytics.related.charts.sankeySubtitle")}
            option={sankeyOption}
            height={420}
          />

          <InsightSection
            title={t("adminAnalytics.related.insightsTitle")}
            subtitle={t("adminAnalytics.related.insightsSubtitle")}
            insights={insights}
          />
        </>
      )}
    </div>
  );
}
