// Widok „Wyniki” edytora ścieżki (S8, SPEC §6.3 „Wyniki”; montuje go S8.3
// pod `?view=results`) - kafle, wejścia/cele w czasie, przejścia kroków,
// powody wyjścia, karty A/B i tabela maili dla okna statystyk.
//
// DANE: `journeyStatsQueryOptions` (podsumowanie, kroki, warianty) i
// `journeySeriesQueryOptions` (seria dzienna) w oknie z `journeyStatsWindow`
// - ten sam klucz co nakładka statystyk na kanwie i zakładka „Wyniki” panelu
// kroku, więc przełączenie widoku nie pobiera liczb drugi raz. Graf do
// numeracji to wersja, której wyniki oglądamy (wskazana albo opublikowana),
// a dopiero bez wersji - szkic.
//
// KAFLE Z REJESTRU S6. „Konwersja do celu” to `KpiTile` z `metricId`
// (`journey_goal_rate`): objaśnienie z rejestru i ocena `BenchmarkTierBadge`
// liczona `evaluateMetricValue` (próba = wejścia; poniżej progu rejestru -
// jawne „mała próba”). Liczb benchmarków ten plik nie zna.
//
// STARE OKNA (Z-I9c-06). Gdy baza czyta zestawienie dzienne (`source:
// "rollup"`), podsumowanie zapisów obejmuje tylko zachowane zapisy: karta
// mówi to wprost, podaje dzień, od którego dane są pełne (admin - z karty
// retencji), kafle zerowe pokazują kreskę, a ocena konwersji przechodzi
// w „brak danych”. Zero nigdy nie udaje braku danych.
//
// STANY ZAMIAST TREŚCI (karta, nie toast): przed hydratacją - wczytywanie;
// brak roli -> `RoleGateNotice`; brak `aal2` -> `MfaRequiredNotice`; funkcje
// niewdrożone -> komunikat z następnym krokiem; brak ścieżki; puste okno ->
// zdanie z następnym krokiem.
import { useCallback, useId, useMemo, useState } from "react";
import { useHydrated } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { useTranslation } from "react-i18next";

import { KpiTile } from "@/components/admin/analytics/KpiTile";
import { RevenueTabPending } from "@/components/admin/revenue/atoms/RevenueTabPending";
import { MfaRequiredNotice } from "@/components/admin/revenue/molecules/MfaRequiredNotice";
import { RoleGateNotice } from "@/components/admin/revenue/molecules/RoleGateNotice";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { journeyAccessDenial, journeyCapabilities } from "@/lib/admin/journeys/access";
import {
  journeyDetailQueryOptions,
  journeyVersionQueryOptions,
} from "@/lib/admin/journeys/journeyQueries";
import {
  isJourneyStatsPartial,
  journeyAbNodes,
  journeyEmailRows,
  journeyExitRows,
  journeyFullDataFrom,
  journeyStatsWindow,
  journeyStepRows,
  journeySubjects,
} from "@/lib/admin/journeys/results";
import type { BenchmarkEvaluation } from "@/lib/analytics/semantic/benchmarks/evaluate";
import { chartLangFrom, formatPercent, type ChartLang } from "@/lib/charts/format";
import { formatDate, formatDateOnly, formatNumber } from "@/lib/i18n/format";
import { ensureI18n as ensureJourneysI18n } from "@/lib/i18n-admin-journeys";
import { ensureI18n as ensureListI18n } from "@/lib/i18n-admin-journeys-list";
import { ensureI18n } from "@/lib/i18n-admin-journeys-results";
import type { JourneyStatsDto } from "@/lib/journeys/dto";
import { journeyLabelKey } from "@/lib/journeys/labels";
import type { JourneyNodeType } from "@/lib/journeys/nodeTypes";
import { journeySeriesQueryOptions, journeyStatsQueryOptions } from "@/lib/journeys/queries";
import { dataRetentionQueryOptions } from "@/lib/privacy/dataRetentionQueries";
import type { RevenuePeriod } from "@/lib/revenue/search";
import { JourneyAbCard } from "./JourneyAbCard";
import { JourneyEmailsTable, useJourneyBenchmarks } from "./JourneyEmailsTable";
import { JourneyExitsCard } from "./JourneyExitsCard";
import { JourneyStepFunnel } from "./JourneyStepFunnel";
import { JourneyTrendCard } from "./JourneyTrendCard";

/** Nazwa kroku w kartach wyników - jedna dla lejka, maili, A/B i panelu kroku. */
export function useJourneyStepLabel(): (row: {
  number: string;
  type: JourneyNodeType | null;
}) => string {
  ensureJourneysI18n();
  ensureI18n();
  const { t } = useTranslation();
  return useCallback(
    (row) => {
      const type = row.type ? t(journeyLabelKey("nodeType", row.type)) : "—";
      return row.number
        ? t("adminJourneys.results.stepLabel", { number: row.number, type })
        : t("adminJourneys.results.stepOutside", { type });
    },
    [t],
  );
}

/**
 * Podpis okna z zestawienia dziennego (Z-I9c-06): co jest niepełne i od kiedy
 * dane są pełne. Bez daty (redaktor nie czyta retencji) - gdzie jej szukać.
 */
export function JourneyRollupNote({ fullDataFrom }: { fullDataFrom: string | null }) {
  ensureI18n();
  const { t, i18n } = useTranslation();
  const lang = chartLangFrom(i18n.language);
  return (
    <div
      role="note"
      data-testid="journey-rollup-note"
      className="space-y-1 rounded-[6px] border border-border bg-muted/30 p-3 text-xs"
    >
      <p className="m-0 flex items-center gap-2 font-semibold text-foreground">
        <Info className="h-4 w-4 shrink-0" aria-hidden="true" />
        {t("adminJourneys.results.rollup.title")}
      </p>
      <p className="m-0 text-muted-foreground">{t("adminJourneys.results.rollup.body")}</p>
      <p className="m-0 text-muted-foreground">
        {fullDataFrom
          ? t("adminJourneys.results.rollup.since", { date: formatDateOnly(fullDataFrom, lang) })
          : t("adminJourneys.results.rollup.sinceUnknown")}
      </p>
    </div>
  );
}

/** Funkcje silnika jeszcze niewdrożone - komunikat z następnym krokiem. */
export function JourneyResultsUnavailable() {
  ensureI18n();
  const { t } = useTranslation();
  return (
    <div
      role="status"
      data-testid="journey-results-unavailable"
      className="space-y-1 rounded-[6px] border border-border bg-muted/30 p-4 text-sm"
    >
      <p className="m-0 flex items-center gap-2 font-semibold text-foreground">
        <Info className="h-4 w-4 shrink-0" aria-hidden="true" />
        {t("adminJourneys.results.unavailableTitle")}
      </p>
      <p className="m-0 text-muted-foreground">{t("adminJourneys.results.unavailableNext")}</p>
    </div>
  );
}

export interface JourneyResultsProps {
  journeyId: string;
  /** Wersja do oglądania; `null` = wszystkie wersje w oknie (graf: opublikowana). */
  versionId?: string | null;
  /** Okres huba z `?stats=` edytora (bez `off`); domyślnie `month`. */
  period?: RevenuePeriod;
}

export function JourneyResults({
  journeyId,
  versionId = null,
  period = "month",
}: JourneyResultsProps) {
  ensureJourneysI18n();
  ensureListI18n();
  ensureI18n();
  const { t } = useTranslation();
  const hydrated = useHydrated();
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      data-testid="journey-results"
      data-journey-id={journeyId}
      className="space-y-4"
    >
      <h2 id={headingId} className="m-0 text-lg font-semibold">
        {t("adminJourneys.results.title")}
      </h2>
      {hydrated ? (
        <JourneyResultsContent journeyId={journeyId} versionId={versionId} period={period} />
      ) : (
        <RevenueTabPending />
      )}
    </section>
  );
}

function JourneyResultsContent({ journeyId, versionId, period }: Required<JourneyResultsProps>) {
  const { t, i18n } = useTranslation();
  const lang = chartLangFrom(i18n.language);
  const { roles, tenantId } = useAuth();
  const tenant = tenantId ?? null;
  const caps = journeyCapabilities(roles);
  const stepLabel = useJourneyStepLabel();
  // „Teraz” raz na montaż - okno i tak jest kwantowane, a klucz zapytania
  // nie może zmieniać się przy każdym renderze.
  const [nowMs] = useState(() => Date.now());
  const statsWindow = useMemo(() => journeyStatsWindow(period, nowMs), [period, nowMs]);
  const emailsHeadingId = useId();
  const enabled = caps.canEdit && tenant !== null;

  const detail = useQuery({ ...journeyDetailQueryOptions(journeyId), enabled });
  const detailData = detail.data?.state === "ready" ? detail.data.data : null;
  const shownVersionId = versionId ?? detailData?.definition.publishedVersionId ?? null;
  const version = useQuery({
    ...journeyVersionQueryOptions(journeyId, shownVersionId ?? ""),
    enabled: enabled && shownVersionId !== null,
  });
  const versionData = version.data?.state === "ready" ? version.data.data : null;
  const stats = useQuery({
    ...journeyStatsQueryOptions(journeyId, versionId, statsWindow.sinceIso, statsWindow.untilIso),
    enabled,
  });
  const series = useQuery({
    ...journeySeriesQueryOptions(journeyId, statsWindow.sinceIso, statsWindow.untilIso),
    enabled,
  });
  const statsData = stats.data?.state === "ready" ? stats.data.data : null;
  const partial = isJourneyStatsPartial(statsData);
  // Dzień zapieczętowania czyta wyłącznie admin (karta retencji = `requireAdmin`).
  const retention = useQuery({
    ...dataRetentionQueryOptions(tenant),
    enabled: enabled && caps.canManageEngine && partial,
  });
  const fullDataFrom = partial
    ? journeyFullDataFrom(
        retention.data?.state === "ready" ? retention.data.data.journeySealed : null,
      )
    : null;
  const evaluate = useJourneyBenchmarks(
    detailData?.definition.templateKey ?? null,
    lang,
    statsData !== null,
  );

  if (!caps.canEdit) return <RoleGateNotice requiredRole="admin_or_editor" />;
  const denial = journeyAccessDenial(stats.error ?? detail.error ?? series.error);
  if (denial === "mfa_required") return <MfaRequiredNotice />;
  if (
    denial === "role" ||
    stats.data?.state === "forbidden" ||
    detail.data?.state === "forbidden"
  ) {
    return <RoleGateNotice requiredRole="admin_or_editor" />;
  }
  if (stats.data?.state === "unavailable" || detail.data?.state === "unavailable") {
    return <JourneyResultsUnavailable />;
  }
  if (detail.data?.state === "not_found") {
    return (
      <p role="status" className="m-0 text-sm text-muted-foreground">
        {t("adminJourneys.results.notFound")}
      </p>
    );
  }
  if (stats.isError) {
    return (
      <div role="alert" className="space-y-2 text-sm">
        <p className="m-0 text-destructive">{t("adminJourneys.results.loadError")}</p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7"
          onClick={() => void stats.refetch()}
        >
          {t("adminJourneys.common.retry")}
        </Button>
      </div>
    );
  }
  if (!statsData) {
    return (
      <p role="status" className="m-0 text-sm text-muted-foreground">
        {t("adminJourneys.results.loading")}
      </p>
    );
  }

  const graph = versionData?.graph ?? detailData?.draft?.graph ?? null;
  const contents = versionData?.contents ?? detailData?.contents ?? [];
  const shownVersion =
    versionId === null
      ? null
      : (detailData?.versions.find((entry) => entry.id === versionId)?.version ?? null);
  const untilInclusive = new Date(Date.parse(statsData.until) - 1);
  const windowText = t("adminJourneys.results.window", {
    since: formatDate(statsData.since, lang),
    until: formatDate(untilInclusive, lang),
  });
  const versionText =
    shownVersion === null
      ? t("adminJourneys.results.versionAll")
      : t("adminJourneys.results.versionValue", { version: shownVersion });

  const empty = !partial && statsData.journey.enrolled === 0 && statsData.nodes.length === 0;

  return (
    <div className="space-y-4">
      <p className="m-0 text-sm text-muted-foreground">{t("adminJourneys.results.description")}</p>
      <p className="m-0 text-xs text-muted-foreground" data-testid="journey-results-window">
        {windowText} · {versionText}
      </p>

      {partial ? <JourneyRollupNote fullDataFrom={fullDataFrom} /> : null}

      {empty ? (
        <div role="status" className="space-y-1 rounded-[6px] border border-border p-4 text-sm">
          <p className="m-0 font-semibold text-foreground">{t("adminJourneys.results.empty")}</p>
          <p className="m-0 text-muted-foreground">{t("adminJourneys.results.emptyNext")}</p>
        </div>
      ) : (
        <>
          <JourneyKpis stats={statsData} partial={partial} lang={lang} evaluate={evaluate} />
          <JourneyTrendCard
            points={series.data?.state === "ready" ? series.data.data : null}
            fullDataFrom={fullDataFrom}
            isLoading={series.isLoading}
            isError={series.isError || series.data?.state === "unavailable"}
            onRetry={() => void series.refetch()}
          />
          <div className="grid gap-4 lg:grid-cols-2">
            <JourneyStepFunnel rows={journeyStepRows(graph, statsData)} stepLabel={stepLabel} />
            <JourneyExitsCard rows={journeyExitRows(statsData)} />
          </div>
          {journeyAbNodes(graph, statsData).map((node) => (
            <JourneyAbCard
              key={node.nodeId}
              journeyId={journeyId}
              node={node}
              canEdit={caps.canEdit}
            />
          ))}
          <section aria-labelledby={emailsHeadingId} className="space-y-2">
            <h3 id={emailsHeadingId} className="m-0 text-sm font-semibold">
              {t("adminJourneys.results.emails.title")}
            </h3>
            <p className="m-0 text-xs text-muted-foreground">
              {t("adminJourneys.results.emails.description")}
            </p>
            <JourneyEmailsTable
              rows={journeyEmailRows(graph, statsData)}
              templateKey={detailData?.definition.templateKey ?? null}
              subjects={journeySubjects(contents, lang)}
              stepLabel={stepLabel}
            />
          </section>
        </>
      )}
    </div>
  );
}

function JourneyKpis({
  stats,
  partial,
  lang,
  evaluate,
}: {
  stats: JourneyStatsDto;
  partial: boolean;
  lang: ChartLang;
  evaluate: ReturnType<typeof useJourneyBenchmarks>;
}) {
  const { t } = useTranslation();
  const { journey } = stats;
  const exited = Object.values(journey.exited).reduce((sum, count) => sum + (count ?? 0), 0);
  // Okno z zestawienia: zero w podsumowaniu znaczy „zapisy usunięte”, nie
  // „nikt” - kreska zamiast liczby.
  const count = (value: number) => (partial && value === 0 ? "—" : formatNumber(value, lang));
  const partialNote = partial ? (
    <p className="m-0 text-[11px] text-muted-foreground">
      {t("adminJourneys.results.kpi.partial")}
    </p>
  ) : undefined;
  const goalEvaluation: BenchmarkEvaluation | null = partial
    ? { tier: "none", why: "no_data" }
    : evaluate("goalRate", journey.goalRate, journey.enrolled);

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" data-testid="journey-results-kpis">
      <KpiTile
        label={t("adminJourneys.results.kpi.enrolled")}
        value={count(journey.enrolled)}
        lang={lang}
        annotation={partialNote}
      />
      <KpiTile
        label={t("adminJourneys.results.kpi.active")}
        value={count(journey.active + journey.waiting)}
        lang={lang}
        annotation={
          <p className="m-0 text-[11px] text-muted-foreground">
            {t("adminJourneys.results.kpi.activeHint", {
              count: formatNumber(journey.waiting, lang),
            })}
          </p>
        }
      />
      <KpiTile
        label={t("adminJourneys.results.kpi.goalReached")}
        value={count(journey.goalReached)}
        lang={lang}
        annotation={partialNote}
      />
      <KpiTile
        label={t("adminJourneys.results.kpi.goalRate")}
        value={
          journey.goalRate === null || (partial && journey.goalReached === 0)
            ? "—"
            : formatPercent(journey.goalRate, lang)
        }
        lang={lang}
        metricId="journey_goal_rate"
        benchmark={goalEvaluation ?? undefined}
        n={journey.enrolled}
        annotation={
          <p className="m-0 text-[11px] text-muted-foreground">
            {t("adminJourneys.results.kpi.goalNote")}
          </p>
        }
      />
      <KpiTile
        label={t("adminJourneys.results.kpi.exited")}
        value={count(exited)}
        lang={lang}
        annotation={partialNote}
      />
    </div>
  );
}
