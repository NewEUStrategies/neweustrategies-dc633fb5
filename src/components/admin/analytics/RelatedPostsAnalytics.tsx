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
import {
  InsightSection,
  type Insight,
} from "@/components/admin/analytics/InsightSection";

function nice(n: number): string {
  if (!Number.isFinite(n)) return "-";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function RelatedPostsAnalytics() {
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
          return `${names[i]} × ${names[j]}<br/>wspólnych wpisów: <b>${c}</b>`;
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
  }, [report, tagIdToName]);

  const popularityScatterOption = useMemo<EChartsCoreOption>(() => {
    const rows = (report?.popularity ?? []).slice(0, 40);
    return {
      tooltip: {
        trigger: "item",
        formatter: (raw: unknown) => {
          const p = raw as { value: [number, number]; name: string };
          return `${p.name}<br/>Views: <b>${p.value[0]}</b><br/>Unikalnych: <b>${p.value[1]}</b>`;
        },
      },
      grid: { left: 40, right: 20, top: 16, bottom: 30, containLabel: true },
      xAxis: { type: "value", name: "Views", nameGap: 22 },
      yAxis: { type: "value", name: "Unikalnych", nameGap: 30 },
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
  }, [report]);

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
          if (p.dataType === "edge") return `${p.value} klik.`;
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
  }, [report]);

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
          return `${row.title ?? row.post_id.slice(0, 8)}<br/>Klik.: <b>${row.clicks}</b><br/>Źródeł: ${row.sources}`;
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
  }, [report]);

  // ---- Interpretacja + rekomendacje ---------------------------------------
  const insights = useMemo<Insight[]>(() => {
    if (!report) return [];
    const list: Insight[] = [];
    const s = report.summary;

    // Widoczność silnika: czy w ogóle klikają w rekomendacje?
    if (s.total_views > 100 && s.total_clicks === 0) {
      list.push({
        id: "no-clicks",
        element: "Rekomendacje",
        severity: "critical",
        title: "Brak klików w rekomendacje w oknie",
        detail: `Odnotowano ${s.total_views} wyświetleń wpisów, ale 0 klików w powiązane. Sygnały nie działają lub nie są wyświetlane.`,
        fixes: [
          "Sprawdź czy sekcja Powiązane wpisy jest włączona globalnie i pod wpisami.",
          "Zmniejsz próg `min_score` w zakładce Konfiguracja - być może wszystko jest odfiltrowane.",
          "Sprawdź czy strategia źródła nie jest zbyt restrykcyjna (spróbuj `Kategorie + Tagi`).",
        ],
      });
    } else if (s.total_clicks > 0 && s.total_views > 0) {
      const ctr = (s.total_clicks / s.total_views) * 100;
      const sev: Insight["severity"] = ctr >= 3 ? "good" : ctr >= 1 ? "info" : "warn";
      list.push({
        id: "ctr",
        element: "KPI - CTR rekomendacji",
        severity: sev,
        title: `CTR rekomendacji: ${ctr.toFixed(2)}%`,
        detail: `${s.total_clicks} klik. na ${s.total_views} wyświetleń. Benchmark redakcyjny: 1-3%.`,
        fixes:
          sev === "good"
            ? ["Utrzymaj obecną konfigurację, testuj większy `items_limit` żeby zwiększyć zasięg."]
            : [
                "Podnieś wagę `weight_tags` - tagi lepiej łączą niepowiązane kategorie.",
                "Włącz `use_idf` - rzadkie tagi tworzą trafniejsze pary.",
                "Zmień `layout` na slider - często zwiększa CTR na mobile.",
              ],
      });
    }

    // Zbyt mała pula kategorii
    const cats = report.top_categories;
    const smallCats = cats.filter((c) => c.posts_count > 0 && c.posts_count < 3);
    if (cats.length > 0 && smallCats.length >= 3) {
      list.push({
        id: "small-cats",
        element: "Struktura - kategorie",
        severity: "warn",
        title: `${smallCats.length} kategorii z <3 wpisami`,
        detail: "Kategorie o niskiej liczności generują ubogie rekomendacje. Silnik dopasuje 1-2 wpisy i skończy.",
        fixes: [
          "Scal małe kategorie w jedną (np. redirects + aktualizacja post_categories).",
          "Podnieś wagę `weight_tags` względem `weight_categories` - tagi pokryją większy graf.",
        ],
      });
    }

    // Sygnał behawioralny nieużywany
    if (s.total_reads === 0 && s.total_views > 50) {
      list.push({
        id: "no-reads",
        element: "Personalizacja - historia czytania",
        severity: "info",
        title: "Brak sygnałów z historii czytania zalogowanych użytkowników",
        detail: "user_read_history jest puste w tym oknie - personalizacja nie ma na czym się oprzeć.",
        fixes: [
          "Wpięcie logowania czasu czytania (np. IntersectionObserver + timer) do user_read_history.",
          "Do czasu zebrania danych utrzymuj `weight_personalization` na 3 - nie zaszkodzi, a zacznie działać automatycznie.",
        ],
      });
    }

    // Współwystępowanie tagów - słaby graf
    const coPairs = report.tag_cooccurrence;
    if (coPairs.length > 0) {
      const avg = coPairs.reduce((a, p) => a + p.c, 0) / coPairs.length;
      if (avg < 2) {
        list.push({
          id: "sparse-tags",
          element: "Otagowanie",
          severity: "warn",
          title: "Rzadki graf współwystępowania tagów",
          detail: `Średnia liczba wspólnych wpisów w parze tagów to ${avg.toFixed(1)}. Silnik ma mało punktów zaczepienia.`,
          fixes: [
            "Dotaguj wpisy - cel: min. 3 tagi/wpis, każdy tag min. 5 wpisów.",
            "Zbuduj słownik tagów kanonicznych (unikaj duplikatów typu 'AI' vs 'ai' vs 'sztuczna inteligencja').",
          ],
        });
      } else {
        list.push({
          id: "healthy-tags",
          element: "Otagowanie",
          severity: "good",
          title: "Zdrowy graf tagów",
          detail: `Średnio ${avg.toFixed(1)} wspólnych wpisów na parę - IDF ma z czego liczyć.`,
          fixes: [],
        });
      }
    }

    // Hub-posty
    const hubs = report.hub_targets;
    if (hubs.length > 0 && hubs[0].clicks >= 5) {
      list.push({
        id: "hub",
        element: "Hub - najsilniej rekomendowany",
        severity: "info",
        title: `Hub-post: ${hubs[0].title ?? hubs[0].post_id.slice(0, 8)}`,
        detail: `${hubs[0].clicks} klik. z ${hubs[0].sources} różnych źródeł. To wpis który wchłania ruch.`,
        fixes: [
          "Zadbaj o CTA / konwersję na tej stronie - trafia tu dużo osób z rekomendacji.",
          "Rozważ dodanie tego wpisu do menu głównego lub sidebar 'Polecane'.",
        ],
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
          element: "Popularność vs rekomendacja",
          severity: "warn",
          title: `${popularButNotRec.length} popularnych wpisów spoza top-10 rekomendacji`,
          detail: "Wpisy z dużym ruchem nie trafiają do rekomendacji - silnik nie promuje najsilniejszych treści.",
          fixes: [
            "Podnieś `weight_popularity` (np. 3-4) - popularność wzmocni ranking.",
            "Sprawdź otagowanie tych wpisów - być może są izolowane w grafie kategorii/tagów.",
          ],
        });
      }
    }

    return list;
  }, [report]);

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
          <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Odśwież
        </Button>
        <div className="text-xs text-muted-foreground inline-flex items-center gap-1">
          <TrendingUp className="w-3 h-3" /> Analiza per tenant, okno {report?.summary.window_days ?? range.days} dni
        </div>
        {isLoading ? (
          <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" /> Ładowanie...
          </span>
        ) : null}
      </div>

      {!report ? (
        <Card className="p-6 text-sm text-muted-foreground">Brak danych w oknie.</Card>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiTile label="Wpisy opublikowane" value={nice(report.summary.total_posts)} />
            <KpiTile
              label="Wyświetlenia (okno)"
              value={nice(report.summary.total_views)}
              current={report.summary.total_views}
            />
            <KpiTile
              label="Klik. w rekomendacje"
              value={nice(report.summary.total_clicks)}
              current={report.summary.total_clicks}
            />
            <KpiTile
              label="Czytania (zalogowani)"
              value={nice(report.summary.total_reads)}
              current={report.summary.total_reads}
            />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <ChartCard
              title="Top kategorie"
              subtitle="Liczba opublikowanych wpisów w kategorii"
              option={topCatsOption}
              height={360}
            />
            <ChartCard
              title="Top tagi"
              subtitle="Liczba opublikowanych wpisów z tagiem"
              option={topTagsOption}
              height={360}
            />
          </div>

          <ChartCard
            title="Współwystępowanie tagów"
            subtitle="Heatmapa: ile wpisów łączy dwa tagi (im ciemniej, tym silniejsza więź w grafie rekomendacji)"
            option={coocurrenceOption}
            height={440}
          />

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <ChartCard
              title="Popularność wpisów"
              subtitle="Wyświetlenia vs unikalni odwiedzający - kandydaci do wzmocnienia w silniku"
              option={popularityScatterOption}
              height={360}
            />
            <ChartCard
              title="Hub-posty (najczęstsze cele klików)"
              subtitle="Wpisy w które ludzie klikają z rekomendacji"
              option={hubBarOption}
              height={360}
            />
          </div>

          <ChartCard
            title="Ścieżki źródło → cel (klik w rekomendację)"
            subtitle="Sankey top-25 par - pokazuje jak rekomendacje realnie kierują ruch między wpisami"
            option={sankeyOption}
            height={420}
          />

          <InsightSection
            title="Interpretacja i rekomendacje - silnik rekomendacji"
            subtitle="Diagnoza sygnałów per tenant + konkretne działania do zastosowania w konfiguracji"
            insights={insights}
          />
        </>
      )}
    </div>
  );
}
