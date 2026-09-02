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
 *
 * STANY, KTÓRE NIE SĄ POMIAREM. Panel rozdziela „trwa pomiar", „odczyt padł"
 * i „okno zostało odczytane i nic w nim nie ma" na trzy różne karty ze słownika
 * `adminAnalytics.common.*`. Jeden komunikat na trzy stany stawiał twierdzenie
 * o pomiarze, którego nie było: „Brak danych w oknie." wisiało zarówno w
 * pierwszej sekundzie po wejściu, jak i po padniętym RPC.
 *
 * IZOLACJA WARSZTATÓW. Klucz react-query niesie identyfikator najemcy, a
 * zapytanie jest wstrzymane do jego rozwiązania - inaczej panel następnego
 * warsztatu trafiałby w ten sam wpis cache i (przy `staleTime`) malował
 * kategorie, tagi i tytuły wpisów poprzedniego bez ani jednego żądania w sieci.
 *
 * ALTERNATYWA TEKSTOWA. Każdy z sześciu wykresów dostaje `csv`, więc `ChartCard`
 * wiąże jego region z tabelą tych samych danych (`aria-describedby`) i wystawia
 * eksport CSV. Kanwa ECharts jest dla czytnika ekranu pustym prostokątem.
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
import { useCurrentTenantId } from "@/lib/tenant";
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

/** Kształt `csv` przyjmowany przez `ChartCard` (eksport + tabela danych). */
interface ChartCsv {
  filename: string;
  headers: string[];
  rows: ReadonlyArray<ReadonlyArray<unknown>>;
}

/** Podpis wpisu na osi i w tabeli: tytuł, a bez niego skrócony identyfikator. */
function postLabel(title: string | null, postId: string, chars = 8): string {
  return title ?? postId.slice(0, chars);
}

export function RelatedPostsAnalytics() {
  const { t } = useTranslation();
  const fetchInsights = useServerFn(getRelatedInsights);
  const tenantId = useCurrentTenantId();
  const [range, setRange] = useState<TimeRangeValue>(() => buildPresetRange("30d"));

  const query = useQuery({
    // NAJEMCA W KLUCZU, nie tylko okno. Klient react-query powstaje raz na
    // aplikację i przeżywa przełączenie warsztatu, więc bez identyfikatora
    // najemcy panel warsztatu B trafiał w TEN SAM wpis co panel warsztatu A -
    // a przy `staleTime: 60_000` react-query nie ponawiał zapytania, czyli
    // wyciek szedł bez ani jednego żądania w sieci i był widoczny wyłącznie
    // na ekranie.
    queryKey: ["related-insights", tenantId ?? "", range.days],
    queryFn: () => fetchInsights({ data: { days: range.days } }),
    // Odczyt puszczony przed rozwiązaniem najemcy wpadłby do cache pod kluczem
    // z pustym warsztatem - i stamtąd trafiłby do pierwszego, który zapyta.
    enabled: Boolean(tenantId),
    staleTime: 60_000,
  });
  const report = query.data;
  // POMIAR W TOKU to także nierozwiązany najemca: zapytanie jest wtedy
  // wstrzymane, więc `isLoading` z react-query jest fałszywe, a panel nadal
  // nie ma CZEGO pokazać.
  const isMeasuring = !tenantId || query.isLoading;
  const readError = query.error;
  const readReason =
    readError instanceof Error && readError.message
      ? readError.message
      : t("adminAnalytics.common.unknownReason");

  const tagIdToName = useMemo(() => {
    const m = new Map<string, string>();
    (report?.top_tags ?? []).forEach((t) => m.set(t.tag_id, t.name));
    return m;
  }, [report]);

  // ---- Zbiory wierszy ----------------------------------------------------
  // Wykres i jego tabela danych jadą z JEDNEGO przyciętego zbioru. Dwa osobne
  // `slice`/`reverse` to dwie okazje na rozjazd: tabela czytałaby się wtedy jak
  // inny pomiar niż słupki nad nią, przy niezmienionym wyglądzie panelu.
  const cats = useMemo(() => (report?.top_categories ?? []).slice(0, 15), [report]);
  const tags = useMemo(() => (report?.top_tags ?? []).slice(0, 20), [report]);
  const popRows = useMemo(() => (report?.popularity ?? []).slice(0, 40), [report]);
  const clickPairs = useMemo(() => (report?.click_pairs ?? []).slice(0, 25), [report]);
  /** Huby w kolejności RANKINGU (najmocniejszy pierwszy); oś Y odwraca ją niżej. */
  const hubsRanked = useMemo(() => (report?.hub_targets ?? []).slice(0, 12), [report]);

  // ---- Wykresy -----------------------------------------------------------
  const topCatsOption = useMemo<EChartsCoreOption>(() => {
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
  }, [cats]);

  const topTagsOption = useMemo<EChartsCoreOption>(() => {
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
  }, [tags]);

  /**
   * Macierz współwystępowania: nazwy osi, komórki i pary do tabeli danych.
   *
   * Jeden memo na trzy rzeczy, bo wszystkie trzy muszą wyjść z TEGO SAMEGO
   * przycięcia do 25 tagów. Komórka wskazująca poza macierz to `undefined`
   * w indeksie - ECharts narysowałby ją w rogu jako fałszywe współwystępowanie,
   * a tabela wypisałaby pustą nazwę tagu.
   */
  const cooc = useMemo(() => {
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
    // Tabela dostaje PARY, nie komórki: macierz jest symetryczna, więc dwie
    // lustrzane komórki to jedna informacja, a drugi wiersz byłby duplikatem.
    const rows: Array<[string, number]> = [];
    pairs.forEach((p) => {
      const i = idx.get(p.a);
      const j = idx.get(p.b);
      if (i === undefined || j === undefined) return;
      cells.push([i, j, p.c]);
      cells.push([j, i, p.c]);
      rows.push([`${names[i]} × ${names[j]}`, p.c]);
    });
    return { names, cells, maxC, rows };
  }, [report, tagIdToName]);

  const coocurrenceOption = useMemo<EChartsCoreOption>(() => {
    const { names, cells, maxC } = cooc;
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
  }, [cooc, t]);

  const popularityScatterOption = useMemo<EChartsCoreOption>(() => {
    const rows = popRows;
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
            name: postLabel(r.title, r.post_id),
            value: [r.views, r.uniques],
          })),
          itemStyle: { color: "#eda100", opacity: 0.75 },
        },
      ],
    };
  }, [popRows, t]);

  const sankeyOption = useMemo<EChartsCoreOption>(() => {
    const pairs = clickPairs;
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
  }, [clickPairs, t]);

  const hubBarOption = useMemo<EChartsCoreOption>(() => {
    // Oś Y rysuje kategorie od dołu, więc ranking idzie tu ODWROTNIE, a
    // podpowiedź czyta ten sam odwrócony porządek - inaczej dymek nad słupkiem
    // pokazywałby liczby sąsiada.
    const rows = [...hubsRanked].reverse();
    return {
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (raw: unknown) => {
          const arr = raw as Array<{ dataIndex: number; value: number; name: string }>;
          if (!arr[0]) return "";
          const row = rows[arr[0].dataIndex];
          return `${postLabel(row.title, row.post_id)}<br/>${t("adminAnalytics.related.hubClicksLabel")}<b>${row.clicks}</b><br/>${t("adminAnalytics.related.hubSourcesLabel")}${row.sources}`;
        },
      },
      grid: { left: 8, right: 24, top: 12, bottom: 20, containLabel: true },
      xAxis: { type: "value" },
      yAxis: {
        type: "category",
        data: rows.map((r) => postLabel(r.title, r.post_id)),
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
  }, [hubsRanked, t]);

  // ---- Alternatywa tekstowa dla SZEŚCIU wykresów --------------------------
  // `ChartCard` wiąże region wykresu z tabelą danych (`aria-describedby`)
  // WYŁĄCZNIE wtedy, gdy dostanie `csv`. Bez niego sześć kanw tego panelu było
  // dla czytnika ekranu sześcioma pustymi prostokątami z samą nazwą, a eksport
  // CSV nie istniał.
  //
  // KOLUMNY IDĄ ZA TYM, CO JEST NA DANYM WYKRESIE. Nagłówek wymiaru bierze
  // tytuł karty (tak samo jak pulpity GSC i GA4), a kolumny wartości - te same
  // klucze słownika, które opisują liczby w podpowiedzi tego wykresu. Wiersze
  // idą PORZĄDKIEM RANKINGU (najmocniejszy pierwszy), czyli tak, jak czyta się
  // słupki poziome od góry: oś Y jest odwrócona tylko dlatego, że ECharts
  // rysuje kategorie od dołu.
  const catsCsv: ChartCsv = {
    filename: "related-top-categories",
    headers: [
      t("adminAnalytics.related.charts.topCatsTitle"),
      t("adminAnalytics.related.charts.topCatsSubtitle"),
    ],
    rows: cats.map((c) => [c.name, c.posts_count]),
  };
  const tagsCsv: ChartCsv = {
    filename: "related-top-tags",
    headers: [
      t("adminAnalytics.related.charts.topTagsTitle"),
      t("adminAnalytics.related.charts.topTagsSubtitle"),
    ],
    rows: tags.map((tg) => [tg.name, tg.posts_count]),
  };
  const coocCsv: ChartCsv = {
    filename: "related-tag-cooccurrence",
    headers: [t("adminAnalytics.related.charts.coocTitle"), t("adminAnalytics.related.coocLabel")],
    rows: cooc.rows,
  };
  const popularityCsv: ChartCsv = {
    filename: "related-popularity",
    headers: [
      t("adminAnalytics.related.charts.popularityTitle"),
      t("adminAnalytics.related.views"),
      t("adminAnalytics.related.uniques"),
    ],
    rows: popRows.map((r) => [postLabel(r.title, r.post_id), r.views, r.uniques]),
  };
  const sankeyCsv: ChartCsv = {
    filename: "related-click-paths",
    // Para „źródło → cel" jedzie w JEDNEJ kolumnie, bo jednym elementem wykresu
    // jest tu wstęga między dwoma węzłami, a nie osobny węzeł.
    headers: [
      t("adminAnalytics.related.charts.sankeyTitle"),
      t("adminAnalytics.related.clicksShort"),
    ],
    rows: clickPairs.map((p) => [
      `${postLabel(p.source_title, p.source_post_id, 6)} → ${postLabel(p.target_title, p.target_post_id, 6)}`,
      p.clicks,
    ]),
  };
  const hubsCsv: ChartCsv = {
    filename: "related-hubs",
    headers: [
      t("adminAnalytics.related.charts.hubTitle"),
      t("adminAnalytics.related.hubClicksLabel"),
      t("adminAnalytics.related.hubSourcesLabel"),
    ],
    rows: hubsRanked.map((hb) => [postLabel(hb.title, hb.post_id), hb.clicks, hb.sources]),
  };

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
          disabled={isMeasuring}
        >
          <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> {t("adminAnalytics.common.refresh")}
        </Button>
        <div className="text-xs text-muted-foreground inline-flex items-center gap-1">
          <TrendingUp className="w-3 h-3" />{" "}
          {t("adminAnalytics.related.windowInfo", {
            days: report?.summary.window_days ?? range.days,
          })}
        </div>
        {isMeasuring ? (
          <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" /> {t("adminAnalytics.common.loading")}
          </span>
        ) : null}
      </div>

      {/* TRZY STANY, TRZY KARTY - nie jeden komunikat na trzy sytuacje.
          „Brak danych w oknie." jest TWIERDZENIEM O POMIARZE i wolno je
          postawić dopiero wtedy, gdy pomiar się odbył. Wcześniej ten sam napis
          obsługiwał także „jeszcze nie wiem" i „odczyt padł": administrator z
          padniętym RPC `related_posts_signals` czytał z ekranu, że silnik
          rekomendacji nie ma danych, choć o danych nikt się nie dowiedział.
          Kolejność gałęzi jest istotna: pomiar w toku wyprzedza awarię, bo
          `error` z poprzedniego okna przeżywa start nowego zapytania. */}
      {isMeasuring ? (
        <Card className="p-6 text-sm text-muted-foreground space-y-1">
          <div className="inline-flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            {t("adminAnalytics.common.measuring")}
          </div>
          <p className="text-xs">{t("adminAnalytics.common.measuringHint")}</p>
        </Card>
      ) : readError ? (
        <Card role="alert" className="p-6 text-sm space-y-1 border-destructive/40 bg-destructive/5">
          <div className="font-medium text-destructive">
            {t("adminAnalytics.common.readFailedReason", { reason: readReason })}
          </div>
          <p className="text-xs text-muted-foreground">
            {t("adminAnalytics.common.readFailedHint")}
          </p>
        </Card>
      ) : !report ? (
        // Odczyt się odbył i nie przyniósł raportu (RPC oddało `null`) - to
        // ZMIERZONE ZERO, więc tu i tylko tu wolno postawić ten komunikat.
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
              csv={catsCsv}
              height={360}
            />
            <ChartCard
              title={t("adminAnalytics.related.charts.topTagsTitle")}
              subtitle={t("adminAnalytics.related.charts.topTagsSubtitle")}
              option={topTagsOption}
              csv={tagsCsv}
              height={360}
            />
          </div>

          <ChartCard
            title={t("adminAnalytics.related.charts.coocTitle")}
            subtitle={t("adminAnalytics.related.charts.coocSubtitle")}
            option={coocurrenceOption}
            csv={coocCsv}
            height={440}
          />

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <ChartCard
              title={t("adminAnalytics.related.charts.popularityTitle")}
              subtitle={t("adminAnalytics.related.charts.popularitySubtitle")}
              option={popularityScatterOption}
              csv={popularityCsv}
              height={360}
            />
            <ChartCard
              title={t("adminAnalytics.related.charts.hubTitle")}
              subtitle={t("adminAnalytics.related.charts.hubSubtitle")}
              option={hubBarOption}
              csv={hubsCsv}
              height={360}
            />
          </div>

          <ChartCard
            title={t("adminAnalytics.related.charts.sankeyTitle")}
            subtitle={t("adminAnalytics.related.charts.sankeySubtitle")}
            option={sankeyOption}
            csv={sankeyCsv}
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
