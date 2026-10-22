// Zakładka „Wyniki” panelu kroku (S8, SPEC §6.3; montuje ją S8.3 pod
// `?node=<id>&tab=results`) - liczby jednego kroku w oknie statystyk: wejścia,
// wykonania, pominięcia, błędy, czekający, wyniki kroku (gałąź, wariant,
// powód pominięcia), mail kroku z ocenami S6 i test A/B podziału.
//
// TO SAMO ZAPYTANIE CO KANWA. Klucz `journeyKeys.stats(…)` w oknie
// `journeyStatsWindow` jest wspólny z nakładką statystyk i widokiem „Wyniki”,
// więc otwarcie panelu nie pobiera liczb drugi raz.
//
// BRAK WEJŚĆ TO ZDANIE. Krok bez wiersza statystyk w oknie nie dostaje tabeli
// zer - panel mówi, że w tym oknie nikt do niego nie doszedł. Czekających
// zestawienie dzienne nie liczy (`source: "rollup"`), więc zamiast zera jest
// wyjaśnienie.
import { useId, useMemo, useState, type ReactNode } from "react";
import { useHydrated } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { MeasurementConsentNote } from "@/components/admin/newsletter/measurement/MeasurementConsentNote";

import { RevenueTabPending } from "@/components/admin/revenue/atoms/RevenueTabPending";
import { MfaRequiredNotice } from "@/components/admin/revenue/molecules/MfaRequiredNotice";
import { RoleGateNotice } from "@/components/admin/revenue/molecules/RoleGateNotice";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { journeyAccessDenial, journeyCapabilities } from "@/lib/admin/journeys/access";
import { journeyDetailQueryOptions } from "@/lib/admin/journeys/journeyQueries";
import {
  isJourneyStatsPartial,
  journeyAbNodes,
  journeyEmailRates,
  journeyOutcomeRows,
  journeyStatsWindow,
} from "@/lib/admin/journeys/results";
import { chartLangFrom, formatPercent } from "@/lib/charts/format";
import { formatNumber } from "@/lib/i18n/format";
import { ensureI18n as ensureJourneysI18n } from "@/lib/i18n-admin-journeys";
import { ensureI18n as ensureListI18n } from "@/lib/i18n-admin-journeys-list";
import { ensureI18n } from "@/lib/i18n-admin-journeys-results";
import type { JourneyNodeStats } from "@/lib/journeys/dto";
import { journeyLabelKey } from "@/lib/journeys/labels";
import { journeyStatsQueryOptions } from "@/lib/journeys/queries";
import type { RevenuePeriod } from "@/lib/revenue/search";
import { JourneyAbCard } from "./JourneyAbCard";
import {
  CtorBadge,
  JourneyMppHint,
  JourneyRateValue,
  useJourneyBenchmarks,
  type JourneyRateEvaluator,
} from "./JourneyEmailsTable";
import { JourneyResultsUnavailable, JourneyRollupNote } from "./JourneyResults";

export interface JourneyNodeResultsProps {
  journeyId: string;
  nodeId: string;
  /** Wersja do oglądania; `null` = wszystkie wersje w oknie. */
  versionId?: string | null;
  /** Okno statystyk edytora (`?stats=`, bez `off`); domyślnie `month`. */
  period?: RevenuePeriod;
}

export function JourneyNodeResults({
  journeyId,
  nodeId,
  versionId = null,
  period = "month",
}: JourneyNodeResultsProps) {
  ensureJourneysI18n();
  ensureListI18n();
  ensureI18n();
  const hydrated = useHydrated();
  return (
    <div data-testid="journey-node-results" data-node-id={nodeId} className="space-y-3">
      {hydrated ? (
        <NodeResultsContent
          journeyId={journeyId}
          nodeId={nodeId}
          versionId={versionId}
          period={period}
        />
      ) : (
        <RevenueTabPending />
      )}
    </div>
  );
}

function NodeResultsContent({
  journeyId,
  nodeId,
  versionId,
  period,
}: Required<JourneyNodeResultsProps>) {
  const { t, i18n } = useTranslation();
  const lang = chartLangFrom(i18n.language);
  const { roles, tenantId } = useAuth();
  const tenant = tenantId ?? null;
  const caps = journeyCapabilities(roles);
  const headingId = useId();
  const [nowMs] = useState(() => Date.now());
  const statsWindow = useMemo(() => journeyStatsWindow(period, nowMs), [period, nowMs]);
  const enabled = caps.canEdit && tenant !== null;

  const stats = useQuery({
    ...journeyStatsQueryOptions(journeyId, versionId, statsWindow.sinceIso, statsWindow.untilIso),
    enabled,
  });
  const detail = useQuery({ ...journeyDetailQueryOptions(journeyId), enabled });
  const detailData = detail.data?.state === "ready" ? detail.data.data : null;
  const statsData = stats.data?.state === "ready" ? stats.data.data : null;
  const node = statsData?.nodes.find((entry) => entry.nodeId === nodeId) ?? null;
  const evaluate = useJourneyBenchmarks(
    detailData?.definition.templateKey ?? null,
    lang,
    Boolean(node?.email),
  );

  if (!caps.canEdit) return <RoleGateNotice requiredRole="admin_or_editor" />;
  const denial = journeyAccessDenial(stats.error ?? detail.error);
  if (denial === "mfa_required") return <MfaRequiredNotice />;
  if (denial === "role" || stats.data?.state === "forbidden") {
    return <RoleGateNotice requiredRole="admin_or_editor" />;
  }
  if (stats.data?.state === "unavailable") return <JourneyResultsUnavailable />;
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

  const partial = isJourneyStatsPartial(statsData);
  const graph = detailData?.draft?.graph ?? null;
  const graphNode = graph?.nodes.find((entry) => entry.id === nodeId) ?? null;
  const isSplit = graphNode?.type === "ab_split" || node?.type === "ab_split";
  const abNode = isSplit
    ? (journeyAbNodes(graph, statsData).find((entry) => entry.nodeId === nodeId) ?? null)
    : null;
  const isEmail = graphNode?.type === "send_email" || node?.type === "send_email";

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <h3 id={headingId} className="m-0 text-sm font-semibold">
        {t("adminJourneys.nodeResults.title")}
      </h3>
      <p className="m-0 text-xs text-muted-foreground">
        {t("adminJourneys.nodeResults.description")}
      </p>
      {partial ? <JourneyRollupNote fullDataFrom={null} /> : null}

      {node ? (
        <>
          <NodeCounts node={node} partial={partial} lang={lang} />
          <NodeOutcomes node={node} />
          {isEmail ? <NodeEmail node={node} evaluate={evaluate} lang={lang} /> : null}
        </>
      ) : (
        <p role="status" className="m-0 text-sm text-muted-foreground">
          {t("adminJourneys.nodeResults.notInStats")}
        </p>
      )}

      {abNode ? <JourneyAbCard journeyId={journeyId} node={abNode} canEdit={caps.canEdit} /> : null}
    </section>
  );
}

function NodeCounts({
  node,
  partial,
  lang,
}: {
  node: JourneyNodeStats;
  partial: boolean;
  lang: "pl" | "en";
}) {
  const { t } = useTranslation();
  const items: { key: string; label: string; value: string }[] = [
    {
      key: "entered",
      label: t("adminJourneys.nodeResults.entered"),
      value: formatNumber(node.entered, lang),
    },
    {
      key: "succeeded",
      label: t("adminJourneys.nodeResults.succeeded"),
      value: formatNumber(node.succeeded, lang),
    },
    {
      key: "skipped",
      label: t("adminJourneys.nodeResults.skipped"),
      value: formatNumber(node.skipped, lang),
    },
    {
      key: "failed",
      label: t("adminJourneys.nodeResults.failed"),
      value: formatNumber(node.failed, lang),
    },
    {
      key: "dead",
      label: t("adminJourneys.nodeResults.dead"),
      value: formatNumber(node.dead, lang),
    },
    {
      key: "waitingNow",
      label: t("adminJourneys.nodeResults.waitingNow"),
      value: partial ? "—" : formatNumber(node.waitingNow, lang),
    },
  ];
  return (
    <div className="space-y-1">
      <h4 className="sr-only">{t("adminJourneys.nodeResults.counts")}</h4>
      <dl className="m-0 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {items.map((item) => (
          <div
            key={item.key}
            data-count={item.key}
            className="rounded-[6px] border border-border px-2 py-1.5"
          >
            <dt className="text-[11px] text-muted-foreground">{item.label}</dt>
            <dd className="m-0 text-sm font-semibold tabular-nums">{item.value}</dd>
          </div>
        ))}
      </dl>
      {partial ? (
        <p className="m-0 text-[11px] text-muted-foreground">
          {t("adminJourneys.nodeResults.waitingRollup")}
        </p>
      ) : null}
    </div>
  );
}

function NodeOutcomes({ node }: { node: JourneyNodeStats }) {
  const { t, i18n } = useTranslation();
  const lang = chartLangFrom(i18n.language);
  const rows = journeyOutcomeRows(node);
  return (
    <div className="space-y-1">
      <h4 className="m-0 text-xs font-semibold">{t("adminJourneys.nodeResults.outcomes")}</h4>
      {rows.length === 0 ? (
        <p className="m-0 text-xs text-muted-foreground">
          {t("adminJourneys.nodeResults.outcomesEmpty")}
        </p>
      ) : (
        <table className="w-full text-left text-xs">
          <caption className="sr-only">{t("adminJourneys.nodeResults.outcomesCaption")}</caption>
          <thead className="text-muted-foreground">
            <tr>
              <th scope="col" className="py-1 pr-3 font-medium">
                {t("adminJourneys.nodeResults.outcome")}
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                {t("adminJourneys.nodeResults.count")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.code} data-outcome={row.code} className="border-t border-border">
                <th scope="row" className="py-1 pr-3 font-normal">
                  {row.outcome
                    ? t(journeyLabelKey("stepOutcome", row.outcome))
                    : t("adminJourneys.nodeResults.outcomeOther", { code: row.code })}
                </th>
                <td className="py-1 text-right tabular-nums">{formatNumber(row.count, lang)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function NodeEmail({
  node,
  evaluate,
  lang,
}: {
  node: JourneyNodeStats;
  evaluate: JourneyRateEvaluator;
  lang: "pl" | "en";
}) {
  const { t } = useTranslation();
  const email = node.email;
  if (!email) {
    return (
      <div className="space-y-1">
        <h4 className="m-0 text-xs font-semibold">{t("adminJourneys.nodeResults.email")}</h4>
        <p className="m-0 text-xs text-muted-foreground">
          {t("adminJourneys.nodeResults.emailEmpty")}
        </p>
      </div>
    );
  }
  const rates = journeyEmailRates(email);
  const row = (key: string, label: ReactNode, value: ReactNode) => (
    <div key={key} data-email={key} className="flex items-start justify-between gap-3 py-1">
      <dt className="flex items-center gap-0.5 text-muted-foreground">{label}</dt>
      <dd className="m-0 text-right">{value}</dd>
    </div>
  );
  return (
    <div className="space-y-1">
      <h4 className="m-0 text-xs font-semibold">{t("adminJourneys.nodeResults.email")}</h4>
      <dl className="m-0 divide-y divide-border text-xs">
        {row(
          "queued",
          t("adminJourneys.results.emails.columns.queued"),
          <span className="tabular-nums">{formatNumber(email.queued, lang)}</span>,
        )}
        {row(
          "sent",
          t("adminJourneys.results.emails.columns.sent"),
          <span className="tabular-nums">{formatNumber(email.sent, lang)}</span>,
        )}
        {row(
          "humanOpens",
          <>
            {t("adminJourneys.results.emails.columns.humanOpens")}
            <JourneyMppHint />
          </>,
          <JourneyRateValue
            count={email.uniqueHumanOpens}
            rate={rates.openRate}
            evaluation={evaluate("openRate", rates.openRate, rates.delivered)}
            lang={lang}
          />,
        )}
        {row(
          "clicks",
          t("adminJourneys.results.emails.columns.clicks"),
          <JourneyRateValue
            count={email.uniqueClicks}
            rate={rates.clickRate}
            evaluation={evaluate("clickRate", rates.clickRate, rates.delivered)}
            lang={lang}
          />,
        )}
        {row(
          "ctor",
          <>
            {t("adminJourneys.results.emails.columns.ctor")}
            <JourneyMppHint />
          </>,
          <span className="inline-flex flex-col items-end gap-0.5">
            <span className="tabular-nums">
              {rates.ctor === null ? "—" : formatPercent(rates.ctor, lang)}
            </span>
            <CtorBadge
              evaluation={evaluate("ctor", rates.ctor, email.uniqueHumanOpens)}
              lang={lang}
            />
          </span>,
        )}
        {row(
          "unsubscribed",
          t("adminJourneys.results.emails.columns.unsubscribed"),
          <JourneyRateValue
            count={email.unsubscribed}
            rate={rates.unsubscribeRate}
            evaluation={evaluate("unsubscribeRate", rates.unsubscribeRate, rates.delivered)}
            lang={lang}
          />,
        )}
        {row(
          "bounced",
          t("adminJourneys.results.emails.columns.bounced"),
          <JourneyRateValue
            count={email.bounced}
            rate={rates.bounceRate}
            evaluation={evaluate("bounceRate", rates.bounceRate, email.sent)}
            lang={lang}
          />,
        )}
        {row(
          "complained",
          t("adminJourneys.results.emails.columns.complained"),
          <JourneyRateValue
            count={email.complained}
            rate={rates.complaintRate}
            evaluation={evaluate("complaintRate", rates.complaintRate, rates.delivered)}
            lang={lang}
          />,
        )}
        {row(
          "fallbackLocale",
          t("adminJourneys.results.emails.columns.fallbackLocale"),
          <span className="tabular-nums">{formatNumber(email.fallbackLocale, lang)}</span>,
        )}
      </dl>
      {/* I9d-Y2: otwarcia i kliknięcia tylko u odbiorców ze zgodą na pomiar. */}
      <MeasurementConsentNote scope="journey" />
    </div>
  );
}
