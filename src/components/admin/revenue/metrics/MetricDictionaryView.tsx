// Organizm: treść zakładki „Wskaźniki" (SPEC §2.2 `metrics`, §6.5) - słownik
// wskaźników S6 z wartościami okna i oceną benchmarku, powody braków
// i arkusz wskaźnika sterowany adresem.
//
// SŁOWNIK S6, NIE KOPIA. Tabelę, wyszukiwanie po skrócie, nazwie i wzorze,
// filtr grup, „tylko nieaktualne benchmarki", ocenę 5 progami i arkusz
// objaśnienia rysuje `MetricDictionary` (S6) - zakładka podaje mu tylko
// wartości (`metricValuesModel`: migawka spod klucza BI + ekonomika S2
// administratora), liczebności, walutę i segment. Liczb benchmarków hub
// nie zna i nie wymyśla: ocena idzie przez rejestr S6.
//
// ADRES JEST STANEM (`?metric=&ctx=`). Kliknięcie nazwy wskaźnika w wierszu
// słownika przejmujemy w fazie przechwytywania (`onClickCapture`) i zamiast
// lokalnego arkusza słownika otwieramy `MetricSheet` przez adres - inaczej
// widoku nie dałoby się udostępnić, a „Wstecz" nie zamykałby arkusza.
// Przechwytujemy WYŁĄCZNIE przycisk wiersza metryki (`tr[data-metric]`,
// atrybut kontraktu testów S6); wpisy rejestru bez metryki (NPS, aktywacja)
// otwierają arkusz słownika jak dotąd. Gdyby S6 zmienił znacznik, słownik
// wraca do własnego arkusza - nic się nie psuje, ginie tylko adres
// (zgłoszenie: kontrolowany `onOpenMetric` w `MetricDictionary`).
//
// SŁOWNIK LENIWIE (jak w zaślepce I0 i w BI): rejestr, indeks benchmarków
// i arkusz to osobny chunk, a karta powodów maluje się bez czekania na niego.
import { useQuery } from "@tanstack/react-query";
import { Suspense, lazy, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";

import { RevenueTabPending } from "@/components/admin/revenue/atoms/RevenueTabPending";
import { RevenueSection } from "@/components/admin/revenue/molecules/RevenueSection";
import { seriesTimeZone } from "@/components/admin/revenue/mrr/mrrModel";
import { HubCardState } from "@/components/admin/revenue/overview/HubCardState";
import {
  queryDenial,
  snapshotFiltersOf,
  type HubCardStatus,
} from "@/components/admin/revenue/overview/hubWindow";
import type { MetricGroup, MetricId } from "@/lib/analytics/semantic/metrics";
import {
  isRevenueForbidden,
  revenueSnapshotQueryOptions,
} from "@/lib/analytics/semantic/revenueSnapshot.functions";
import { ensureI18n as ensureRevenueI18n } from "@/lib/i18n-admin-revenue";
import { ensureI18n } from "@/lib/i18n-admin-revenue-tabs";
import { revenueEconomicsQueryOptions } from "@/lib/revenue/finance/queries";
import type { RevenueHubSearch, RevenueSegment } from "@/lib/revenue/search";
import type { RevenueRange } from "@/lib/revenue/window";
import { MetricSheet } from "./MetricSheet";
import { MissingDataCard } from "./MissingDataCard";
import {
  benchSegmentOf,
  economicsMonthsOf,
  economicsStateOf,
  metricOfParam,
  metricValuesModel,
  missingGroups,
} from "./metricsModel";

const MetricDictionary = lazy(() =>
  import("@/components/admin/analytics/semantic/organisms/MetricDictionary").then((m) => ({
    default: m.MetricDictionary,
  })),
);

/** Grupy słownika huba - wszystko poza ruchem stron (ten ma ekran BI). */
export const HUB_DICTIONARY_GROUPS: readonly MetricGroup[] = [
  "revenue",
  "retention",
  "funnel",
  "economics",
  "email",
  "community",
  "crm",
];

const SEGMENT_LABEL_KEY: Readonly<Record<RevenueSegment, string>> = {
  all: "adminRevenue.segment.all",
  b2c_individual: "adminRevenue.segment.b2c_individual",
  b2c_reduced: "adminRevenue.segment.b2c_reduced",
  b2b_institution: "adminRevenue.segment.b2b_institution",
};

export interface MetricDictionaryViewProps {
  tenantId: string | null;
  /** Dokładne role sesji (`useAuth().roles`). */
  roles: readonly string[];
  range: RevenueRange;
  currency: string | null;
  segment: RevenueSegment | null;
  /** Surowe `?metric=` i `?ctx=` z walidatora układu. */
  metric: string | undefined;
  ctx: string | undefined;
  onSearchChange: (patch: Partial<RevenueHubSearch>, opts?: { replace?: boolean }) => void;
}

export function MetricDictionaryView({
  tenantId,
  roles,
  range,
  currency,
  segment,
  metric,
  ctx,
  onSearchChange,
}: MetricDictionaryViewProps) {
  ensureRevenueI18n();
  ensureI18n();
  const { t } = useTranslation();
  const isAdmin = roles.includes("admin");
  const snapshot = useQuery(
    revenueSnapshotQueryOptions(tenantId, range, snapshotFiltersOf(currency, segment)),
  );
  const months = economicsMonthsOf(range);
  // Ekonomika to kwoty i koszty - wyłącznie administrator (bramka `roleOk`
  // wyłącza zapytanie redaktora, zanim cokolwiek pójdzie do RPC).
  const economicsQuery = useQuery(
    revenueEconomicsQueryOptions(tenantId, months.fromMonth, months.toMonth, seriesTimeZone(), {
      roleOk: isAdmin,
    }),
  );
  const economics = economicsStateOf(economicsQuery.data, {
    enabled: isAdmin && Boolean(tenantId),
    isError: economicsQuery.isError,
  });
  const model = snapshot.data
    ? metricValuesModel({ snapshot: snapshot.data, economics, currencyFilter: currency, range })
    : null;

  let status: HubCardStatus | "ready";
  if (!tenantId) status = "no_tenant";
  else if (snapshot.data) status = "ready";
  else if (snapshot.isError) {
    status = isRevenueForbidden(snapshot.error)
      ? "forbidden"
      : (queryDenial(snapshot.error) ?? "error");
  } else status = "loading";

  const openMetric = (id: MetricId) => onSearchChange({ metric: id, ctx: undefined });
  const openFromRow = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest('button[aria-haspopup="dialog"]');
    const id = metricOfParam(button?.closest("tr[data-metric]")?.getAttribute("data-metric") ?? "");
    if (button === null || id === null) return;
    event.preventDefault();
    event.stopPropagation();
    openMetric(id);
  };

  const benchSegment = benchSegmentOf(segment);
  const emptyValues = new Map<MetricId, number | null>();
  const emptySamples = new Map<MetricId, number>();

  return (
    <div className="space-y-4" data-testid="revenue-metrics-view">
      <RevenueSection titleKey="adminRevenue.metrics.title" descriptionKey="adminRevenue.metrics.valuesNote">
        <div className="space-y-1 text-xs text-muted-foreground" data-testid="metrics-scope">
          <p className="m-0">
            {t("adminRevenue.metrics.contextLabel")}: {t(SEGMENT_LABEL_KEY[segment ?? "all"])}
          </p>
          {model?.currency ? (
            <p className="m-0">
              {t("adminRevenue.metrics.currencyNote", { currency: model.currency })}
            </p>
          ) : null}
        </div>
        {status === "ready" || status === "loading" ? null : (
          <HubCardState
            status={status}
            forbiddenKey="adminRevenue.common.roleGate"
            unavailableKey="adminRevenue.overview.kpi.sourcesPending"
            onRetry={() => void snapshot.refetch()}
          />
        )}
        {model ? (
          <MissingDataCard
            groups={missingGroups(model.missing)}
            isAdmin={isAdmin}
            onOpenMetric={openMetric}
          />
        ) : null}
        <div onClickCapture={openFromRow} data-testid="metrics-dictionary">
          <Suspense fallback={<RevenueTabPending />}>
            <MetricDictionary
              groups={HUB_DICTIONARY_GROUPS}
              values={model?.values}
              samples={model?.samples}
              currency={model?.currency ?? undefined}
              segment={benchSegment}
            />
          </Suspense>
        </div>
      </RevenueSection>
      <MetricSheet
        metricId={metricOfParam(metric)}
        ctx={ctx}
        values={model?.values ?? emptyValues}
        samples={model?.samples ?? emptySamples}
        currency={model?.currency ?? null}
        segment={benchSegment}
        onClose={() => onSearchChange({ metric: undefined, ctx: undefined })}
        onCtxChange={(next) => onSearchChange({ ctx: next }, { replace: true })}
      />
    </div>
  );
}
