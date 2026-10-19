/**
 * Organizm: słownik metryk kanonicznych i wskaźników z benchmarkami.
 *
 * Jedno miejsce, w którym da się sprawdzić, co dana nazwa ZNACZY, z jakiego
 * strumienia pochodzi i czego z nią nie wolno zrobić. Renderowany z rejestru w
 * kodzie, więc nie może rozjechać się z definicjami używanymi do liczenia -
 * to jest różnica między słownikiem a dokumentem w intranecie.
 *
 * BENCHMARKI W TYM SAMYM WIERSZU (SPEC §6.5). Metryka z benchmarkiem dostaje
 * kolumny pewności i „stan na” (z alertem, gdy minął termin przeglądu),
 * a przy podanych wartościach - „teraz” i ocenę tą samą regułą co kafel
 * (`evaluateMetricValue`). Wpisy rejestru BEZ metryki (NPS, aktywacja, IPR…)
 * też są wierszami - z powodem, czego system nie mierzy, bo czytelnik szuka
 * ich w słowniku tak samo jak MRR. Nazwa w wierszu otwiera arkusz z pełnym
 * `MetricExplainer` (definicja, wzór, dźwignie, pasma, źródła).
 *
 * TREŚĆ BENCHMARKÓW Z SERWERA, PER GRUPA. Słownik pobiera tylko grupy
 * widocznych wierszy (`benchmarkGroupQueryOptions`, cache na sesję); filtr
 * grupy zawęża też odczyty.
 *
 * Responsywność: tabela przewija się poziomo we własnym kontenerze, więc strona
 * nigdy nie dostaje paska poziomego.
 */
import { useId, useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-semantic";
import { AlertTriangle, BookOpen } from "lucide-react";
import { FormSelect } from "@/components/atoms/FormSelect";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  METRICS,
  METRIC_GROUP,
  streamById,
  type MetricGroup,
  type MetricId,
} from "@/lib/analytics/semantic";
import { bi, type LocalizedBenchmark } from "@/lib/analytics/semantic/benchmarks/adapter";
import {
  BENCHMARK_INDEX,
  primaryBenchmarkFor,
  type BenchmarkIndexEntry,
} from "@/lib/analytics/semantic/benchmarks/index";
import type { BenchContextSegment } from "@/lib/analytics/semantic/benchmarks/types";
import { formatMetricValue } from "@/lib/analytics/semantic/format";
import { abbreviationOf } from "@/lib/analytics/semantic/metricHelp";
import { authoritativeBinding, metricById } from "@/lib/analytics/semantic/metrics";
import { toLocalIsoDate } from "@/lib/analytics/semantic/window";
import { chartLangFrom } from "@/lib/charts/format";
import { ensureI18n as ensureShellI18n } from "@/lib/i18n-admin-revenue-shell";
import { BenchmarkTierBadge } from "../atoms/BenchmarkTierBadge";
import { StreamChip } from "../atoms/StreamChip";
import { benchmarkGroupQueryOptions, evaluateMetricValue } from "../hooks/useBenchmark";
import { MetricExplainerBody } from "../molecules/MetricExplainer";

const METRIC_GROUP_KEY: Readonly<Record<MetricGroup, string>> = {
  traffic: "adminRevenue.benchmark.metricGroup.traffic",
  revenue: "adminRevenue.benchmark.metricGroup.revenue",
  retention: "adminRevenue.benchmark.metricGroup.retention",
  funnel: "adminRevenue.benchmark.metricGroup.funnel",
  economics: "adminRevenue.benchmark.metricGroup.economics",
  email: "adminRevenue.benchmark.metricGroup.email",
  community: "adminRevenue.benchmark.metricGroup.community",
  crm: "adminRevenue.benchmark.metricGroup.crm",
};

const CONFIDENCE_KEY: Readonly<Record<LocalizedBenchmark["confidence"], string>> = {
  low: "adminRevenue.benchmark.confidence.low",
  medium: "adminRevenue.benchmark.confidence.medium",
  high: "adminRevenue.benchmark.confidence.high",
};

const ALL = "all";

/**
 * Wiersz słownika: metryka rejestru (z wpisem wiodącym benchmarku albo bez)
 * albo wpis benchmarku BEZ metryki. Grupy benchmarków (`BenchGroup`) są
 * podzbiorem grup metryk, więc jeden filtr obejmuje oba rodzaje wierszy.
 */
type Row =
  | { kind: "metric"; id: MetricId; group: MetricGroup; entry: BenchmarkIndexEntry | undefined }
  | { kind: "bench"; entry: BenchmarkIndexEntry; group: MetricGroup };

export interface MetricDictionaryProps {
  /** Grupy w słowniku (i w filtrze); brak = wszystkie metryki rejestru. */
  groups?: readonly MetricGroup[];
  /** Wartości bieżące w jednostce metryki - dokładają kolumny „teraz” i „ocena”. */
  values?: ReadonlyMap<MetricId, number | null>;
  /** Liczebność próby per metryka (ocena wstrzymana przy n < 50). */
  samples?: ReadonlyMap<MetricId, number>;
  /** Waluta kwot (`money_minor`). */
  currency?: string;
  /** Segment danych - domyślny kontekst porównania. */
  segment?: BenchContextSegment;
  /** Dzień odniesienia alertu „do przeglądu” (lokalny `YYYY-MM-DD`); domyślnie dziś. */
  today?: string;
}

export function MetricDictionary({
  groups,
  values,
  samples,
  currency,
  segment,
  today,
}: MetricDictionaryProps = {}) {
  ensureShellI18n();
  const { t, i18n } = useTranslation();
  const lang = chartLangFrom(i18n.language);
  const searchId = useId();
  const sheetHeadingId = useId();
  const [group, setGroup] = useState<string>(ALL);
  const [query, setQuery] = useState("");
  const [staleOnly, setStaleOnly] = useState(false);
  const [open, setOpen] = useState<Row | null>(null);
  const refDay = today ?? toLocalIsoDate(new Date());

  const allRows = useMemo((): Row[] => {
    const allowed = groups ? new Set<MetricGroup>(groups) : null;
    const metricRows: Row[] = METRICS.filter(
      (m) => allowed === null || allowed.has(METRIC_GROUP[m.id]),
    ).map((m) => ({
      kind: "metric",
      id: m.id,
      group: METRIC_GROUP[m.id],
      entry: primaryBenchmarkFor(m.id),
    }));
    const benchRows: Row[] = BENCHMARK_INDEX.filter(
      (e) => e.metricId === undefined && (allowed === null || allowed.has(e.group)),
    ).map((entry) => ({ kind: "bench", entry, group: entry.group }));
    return [...metricRows, ...benchRows];
  }, [groups]);

  const groupOptions = useMemo(() => {
    const present = [...new Set(allRows.map((r) => r.group))];
    return [
      { value: ALL, label: t("adminRevenue.benchmark.dictionary.all") },
      ...present.map((g) => ({ value: g, label: t(METRIC_GROUP_KEY[g]) })),
    ];
  }, [allRows, t]);

  const byGroup = allRows.filter((r) => group === ALL || r.group === group);
  // Grupy benchmarków potrzebne widocznym wierszom - tylko je pobieramy.
  const benchGroups = [
    ...new Set(
      byGroup.flatMap((r) =>
        r.kind === "bench" ? [r.entry.group] : r.entry ? [r.entry.group] : [],
      ),
    ),
  ];
  const results = useQueries({
    queries: benchGroups.map((g) => benchmarkGroupQueryOptions(g, lang)),
  });
  const benchByKey = new Map<string, LocalizedBenchmark>();
  for (const r of results) for (const b of r.data?.benchmarks ?? []) benchByKey.set(b.key, b);
  const benchOf = (row: Row): LocalizedBenchmark | null => {
    const key = row.kind === "bench" ? row.entry.key : row.entry?.key;
    return key ? (benchByKey.get(key) ?? null) : null;
  };
  // Termin przeglądu (`reviewBy`) porównujemy jako napis RRRR-MM-DD z LOKALNYM
  // dniem - bez instantów, więc alert nie przeskakuje o północy UTC.
  const isStale = (bench: LocalizedBenchmark | null): boolean =>
    bench !== null && bench.reviewBy < refDay;

  const needle = query.trim().toLowerCase();
  const visible = byGroup.filter((row) => {
    const bench = benchOf(row);
    if (staleOnly && !isStale(bench)) return false;
    if (needle === "") return true;
    const haystack =
      row.kind === "metric"
        ? [
            metricById(row.id).labelPl,
            metricById(row.id).labelEn,
            row.entry?.abbr ?? "",
            authoritativeBinding(row.id).formula,
            bench?.name ?? "",
            bench?.formula ?? "",
          ]
        : [row.entry.abbr, bench?.name ?? "", bench?.expansion ?? "", bench?.formula ?? ""];
    return haystack.some((text) => text.toLowerCase().includes(needle));
  });

  const withValues = values !== undefined;
  const columns = 6 + (withValues ? 2 : 0);
  const detailsButton =
    "text-left font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <Card className="p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold leading-none flex items-center gap-2">
          <BookOpen className="h-4 w-4 shrink-0 text-primary" />
          {t("adminAnalytics.semantic.dictionary.title")}
        </h3>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {t("adminAnalytics.semantic.dictionary.subtitle")}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full sm:w-56">
          <FormSelect
            aria-label={t("adminRevenue.benchmark.dictionary.filterGroup")}
            value={group}
            onValueChange={setGroup}
            options={groupOptions}
            className="h-9 text-xs"
          />
        </div>
        <div className="w-full sm:w-72">
          <label htmlFor={searchId} className="sr-only">
            {t("adminRevenue.benchmark.dictionary.search")}
          </label>
          <Input
            id={searchId}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("adminRevenue.benchmark.dictionary.search")}
            className="h-9 text-xs"
          />
        </div>
        <label className="flex items-center gap-2 text-xs">
          <Checkbox checked={staleOnly} onCheckedChange={(v) => setStaleOnly(v === true)} />
          {t("adminRevenue.benchmark.dictionary.staleOnly")}
        </label>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] border-collapse text-left text-xs">
          <caption className="sr-only">{t("adminRevenue.benchmark.dictionary.caption")}</caption>
          <thead>
            <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="py-2 pr-3 font-medium">
                {t("adminAnalytics.semantic.dictionary.colMetric")}
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                {t("adminAnalytics.semantic.dictionary.colDefinition")}
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                {t("adminAnalytics.semantic.dictionary.colSource")}
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                {t("adminAnalytics.semantic.dictionary.colGuards")}
              </th>
              {withValues ? (
                <>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    {t("adminRevenue.benchmark.dictionary.colNow")}
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    {t("adminRevenue.benchmark.dictionary.colTier")}
                  </th>
                </>
              ) : null}
              <th scope="col" className="py-2 pr-3 font-medium">
                {t("adminRevenue.benchmark.dictionary.colConfidence")}
              </th>
              <th scope="col" className="py-2 font-medium">
                {t("adminRevenue.benchmark.dictionary.colAsOf")}
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={columns} className="py-4 text-center text-muted-foreground">
                  {t("adminRevenue.benchmark.dictionary.empty")}
                </td>
              </tr>
            ) : null}
            {visible.map((row) => {
              const bench = benchOf(row);
              const stale = isStale(bench);
              const benchCells = (
                <>
                  <td className="py-2.5 pr-3 text-muted-foreground" data-confidence>
                    {bench ? t(CONFIDENCE_KEY[bench.confidence]) : "-"}
                  </td>
                  <td className="py-2.5 text-muted-foreground tabular-nums" data-as-of>
                    {bench ? (
                      <span className="flex flex-col gap-0.5">
                        <span>{bench.asOf}</span>
                        {stale ? (
                          <span
                            className="inline-flex items-center gap-1 text-[10px] font-medium text-foreground"
                            data-stale
                          >
                            <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
                            {t("adminRevenue.benchmark.dictionary.staleAlert", {
                              date: bench.reviewBy,
                            })}
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      "-"
                    )}
                  </td>
                </>
              );

              if (row.kind === "bench") {
                return (
                  <tr
                    key={`bench-${row.entry.key}`}
                    className="border-b border-border/60 align-top"
                    data-bench-key={row.entry.key}
                  >
                    <th scope="row" className="py-2.5 pr-3 font-medium">
                      <div className="flex flex-col gap-1">
                        <button
                          type="button"
                          aria-haspopup="dialog"
                          className={detailsButton}
                          onClick={() => setOpen(row)}
                        >
                          <span>{row.entry.abbr}</span>
                        </button>
                        {bench ? (
                          <span className="text-[10px] font-normal text-muted-foreground">
                            {bench.name}
                          </span>
                        ) : null}
                      </div>
                    </th>
                    <td className="py-2.5 pr-3 text-muted-foreground">
                      <p className="leading-relaxed">{bench?.noMetricReason ?? "-"}</p>
                      {bench ? (
                        <code className="mt-1 block break-words font-mono text-[10px]">
                          {bench.formula}
                        </code>
                      ) : null}
                    </td>
                    <td className="py-2.5 pr-3">
                      <span className="text-[10px] font-medium" data-no-metric>
                        {t("adminRevenue.benchmark.dictionary.noMetric")}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-muted-foreground">-</td>
                    {withValues ? (
                      <>
                        <td className="py-2.5 pr-3 text-muted-foreground">-</td>
                        <td className="py-2.5 pr-3 text-muted-foreground">-</td>
                      </>
                    ) : null}
                    {benchCells}
                  </tr>
                );
              }

              const metric = metricById(row.id);
              const authoritative = authoritativeBinding(row.id);
              const label = bi({ pl: metric.labelPl, en: metric.labelEn }, lang);
              const abbr = row.entry?.abbr ?? abbreviationOf(label);
              const value = values?.get(row.id);
              return (
                <tr
                  key={row.id}
                  className="border-b border-border/60 align-top"
                  data-metric={row.id}
                >
                  <th scope="row" className="py-2.5 pr-3 font-medium">
                    <div className="flex flex-col gap-1">
                      <button
                        type="button"
                        aria-haspopup="dialog"
                        className={detailsButton}
                        onClick={() => setOpen(row)}
                      >
                        <span>{label}</span>
                      </button>
                      {abbr !== label ? (
                        <span className="text-[10px] font-normal text-muted-foreground">
                          {abbr}
                        </span>
                      ) : null}
                      <Badge variant="outline" className="w-fit text-[10px]">
                        {t(`adminAnalytics.semantic.dictionary.unit.${metric.unit}`)}
                      </Badge>
                    </div>
                  </th>
                  <td className="py-2.5 pr-3 text-muted-foreground">
                    <p className="leading-relaxed">
                      {bi({ pl: metric.definitionPl, en: metric.definitionEn }, lang)}
                    </p>
                    <code className="mt-1 block break-words font-mono text-[10px]">
                      {authoritative.formula}
                    </code>
                  </td>
                  <td className="py-2.5 pr-3">
                    <div className="flex flex-col items-start gap-1">
                      {metric.bindings.map((b) => (
                        <StreamChip key={b.streamId} streamId={b.streamId} role={b.role} />
                      ))}
                      <span className="text-[10px] text-muted-foreground">
                        {t(
                          `adminAnalytics.semantic.consentGate.${streamById(authoritative.streamId).consentGate}`,
                        )}
                      </span>
                    </div>
                  </td>
                  <td className="py-2.5 pr-3 text-muted-foreground">
                    <ul className="space-y-1">
                      {metric.guards.map((g, idx) => (
                        <li key={idx} className="flex gap-1.5">
                          <span aria-hidden className="leading-4 text-brand">
                            !
                          </span>
                          <span className="leading-4">{g}</span>
                        </li>
                      ))}
                    </ul>
                  </td>
                  {withValues ? (
                    <>
                      <td className="py-2.5 pr-3 tabular-nums" data-now>
                        {formatMetricValue(value ?? null, metric.unit, lang, "-", { currency })}
                      </td>
                      <td className="py-2.5 pr-3">
                        {value === undefined ? (
                          "-"
                        ) : (
                          <BenchmarkTierBadge
                            evaluation={evaluateMetricValue(row.id, value, bench, {
                              n: samples?.get(row.id),
                              currency,
                              segment,
                            })}
                          />
                        )}
                      </td>
                    </>
                  ) : null}
                  {benchCells}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Sheet
        open={open !== null}
        onOpenChange={(next) => {
          if (!next) setOpen(null);
        }}
      >
        <SheetContent
          side="right"
          aria-labelledby={sheetHeadingId}
          aria-describedby={undefined}
          className="w-full overflow-y-auto sm:max-w-lg"
        >
          {open ? (
            <MetricExplainerBody
              metricId={open.kind === "metric" ? open.id : undefined}
              benchKey={open.kind === "bench" ? open.entry.key : undefined}
              value={open.kind === "metric" ? values?.get(open.id) : undefined}
              n={open.kind === "metric" ? samples?.get(open.id) : undefined}
              currency={currency}
              segment={segment}
              lang={lang}
              mode="full"
              headingId={sheetHeadingId}
              heading="sheet"
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </Card>
  );
}
