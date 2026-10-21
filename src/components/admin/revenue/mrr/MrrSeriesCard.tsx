// Organizm: MRR w czasie - księga ruchów i niezależna migawka dzienna, osobno
// dla każdej waluty (SPEC §2.2 `mrr`, §6.1; karta S7).
//
// DWA POMIARY, JEDNA OŚ. Księga liczy MRR ze zdarzeń, migawka - ze stanu
// subskrypcji raz na dobę. Ta sama jednostka (waluta), więc jedna oś Y
// i dwie linie; różnica między nimi to zdarzenie, którego księga nie
// zapisała (reguła `data_quality.ledger_drift`). Pod wykresem stoi
// największa różnica z dniem - admin wie, którego dnia szukać.
//
// ZIARNO I STREFA W KLUCZU. `revenueMrrSeriesQueryOptions` dokłada do klucza
// ziarno (z kubełka okna huba) i strefę przeglądarki - w niej hub liczy
// granice okna, więc punkt „1 października" zaczyna się tam, gdzie okno.
//
// NIGDY SUMA WALUT. Każda waluta to osobny wykres; brak migawki w punkcie
// to przerwa w linii (`null`), a nie zero.
//
// Rama wykresu jedzie w osobnym chunku (`lazy`, jak w `MrrBridgeCard`).
import { Suspense, lazy } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { biChart } from "@/components/admin/analytics/biChart";
import { cardStatusOf } from "@/components/admin/revenue/overview/hubWindow";
import { currencyExponent, formatMoneyMinor } from "@/lib/analytics/semantic/format";
import { chartLangFrom, type ChartLang } from "@/lib/charts/format";
import { ensureI18n as ensureRevenueI18n } from "@/lib/i18n-admin-revenue";
import { ensureI18n as ensureFinanceI18n } from "@/lib/i18n-admin-revenue-finance";
import { ensureI18n } from "@/lib/i18n-admin-revenue-tabs";
import type { MrrSeriesGrain } from "@/lib/revenue/finance/dto";
import { revenueMrrSeriesQueryOptions } from "@/lib/revenue/finance/queries";
import type { RevenueRange } from "@/lib/revenue/window";
import { FinanceCardFrame } from "./FinanceCardFrame";
import {
  localDay,
  seriesByCurrency,
  seriesGrainOf,
  seriesTimeZone,
  type CurrencySeries,
} from "./mrrModel";

const ChartCard = lazy(() =>
  import("@/components/admin/analytics/ChartCard").then((m) => ({ default: m.ChartCard })),
);

const LOCALE: Readonly<Record<ChartLang, string>> = { pl: "pl-PL", en: "en-GB" };

export interface MrrSeriesCardProps {
  tenantId: string | null;
  /** Dokładne role sesji - szereg to kwoty, więc tylko administrator. */
  roles: readonly string[];
  range: RevenueRange;
}

/** Podpis punktu: dzień dla ziarna dziennego i tygodniowego, miesiąc dla miesięcznego. */
function pointLabel(day: string, grain: MrrSeriesGrain, lang: ChartLang): string {
  const options: Intl.DateTimeFormatOptions =
    grain === "month" ? { month: "short", year: "numeric" } : { day: "numeric", month: "short" };
  return new Intl.DateTimeFormat(LOCALE[lang], options).format(localDay(day));
}

export function MrrSeriesCard({ tenantId, roles, range }: MrrSeriesCardProps) {
  ensureRevenueI18n();
  ensureFinanceI18n();
  ensureI18n();
  const { t, i18n } = useTranslation();
  const lang = chartLangFrom(i18n.language);
  const isAdmin = roles.includes("admin");
  const grain = seriesGrainOf(range);
  // Strefa jest stałą sesji przeglądarki - czytana raz, nie w każdym renderze.
  const zone = seriesTimeZone();
  const query = useQuery(
    revenueMrrSeriesQueryOptions(tenantId, range, grain, zone, { roleOk: isAdmin }),
  );
  const status = cardStatusOf(query, tenantId);

  let body = null;
  if (status === "ready" && query.data?.state === "ready") {
    const groups = seriesByCurrency(query.data.data.points);
    body =
      groups.length === 0 ? (
        <p role="status" className="m-0 text-sm text-muted-foreground">
          {t("adminRevenue.mrr.seriesEmpty")}
        </p>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <SeriesChart key={group.currency} group={group} grain={grain} lang={lang} />
          ))}
        </div>
      );
  }

  return (
    <FinanceCardFrame
      testId="mrr-series"
      title={t("adminRevenue.mrr.seriesTitle")}
      subtitle={t("adminRevenue.mrr.seriesSubtitle", {
        grain: t(`adminRevenue.mrr.seriesGrain.${grain}`),
        zone,
      })}
      isAdmin={isAdmin}
      status={status}
      onRetry={() => void query.refetch()}
    >
      {body}
    </FinanceCardFrame>
  );
}

/** Zdanie pod wykresem: największa różnica migawki i księgi albo zgodność. */
function DriftNote({ group, lang }: { group: CurrencySeries; lang: ChartLang }) {
  const { t } = useTranslation();
  const day = new Intl.DateTimeFormat(LOCALE[lang], { dateStyle: "long" });
  return (
    <div className="space-y-1 text-xs text-muted-foreground" data-testid="mrr-series-drift">
      {group.maxDrift && group.maxDrift.driftMinor !== null ? (
        <p className="m-0 text-foreground" data-drift="max">
          {t("adminRevenue.mrr.seriesDriftMax", {
            amount: formatMoneyMinor(group.maxDrift.driftMinor, group.currency, lang),
            date: day.format(localDay(group.maxDrift.bucketStart)),
          })}
        </p>
      ) : group.missingSnapshots < group.points.length ? (
        <p className="m-0" data-drift="none">
          {t("adminRevenue.mrr.seriesDriftNone")}
        </p>
      ) : null}
      {group.missingSnapshots > 0 ? (
        <p className="m-0" data-drift="missing">
          {t("adminRevenue.mrr.seriesSnapshotMissing")}
        </p>
      ) : null}
      <p className="m-0">{t("adminRevenue.finance.series.driftHint")}</p>
    </div>
  );
}

function SeriesChart({
  group,
  grain,
  lang,
}: {
  group: CurrencySeries;
  grain: MrrSeriesGrain;
  lang: ChartLang;
}) {
  const { t } = useTranslation();
  const scale = 10 ** currencyExponent(group.currency);
  const categories = group.points.map((p) => pointLabel(p.bucketStart, grain, lang));
  const ledger = group.points.map((p) => p.mrrMinor / scale);
  const snapshot = group.points.map((p) =>
    p.snapshotMrrMinor === null ? null : p.snapshotMrrMinor / scale,
  );
  const ledgerName = t("adminRevenue.finance.series.ledger");
  const snapshotName = t("adminRevenue.finance.series.snapshot");
  const title = t("adminRevenue.mrr.seriesChartTitle", { currency: group.currency });
  const note = <DriftNote group={group} lang={lang} />;
  return (
    <div data-currency={group.currency}>
      <Suspense
        fallback={
          <div className="space-y-1 rounded-[6px] border border-border p-3">
            <p role="status" className="m-0 text-sm text-muted-foreground">
              {t("adminRevenue.common.loading")}
            </p>
            {note}
          </div>
        }
      >
        <ChartCard
          title={title}
          config={biChart({
            kind: "line",
            categories,
            series: [
              { name: ledgerName, values: ledger },
              { name: snapshotName, values: snapshot },
            ],
            unit: ` ${group.currency}`,
            metricId: "mrr",
            smoothing: 0,
            lang,
          })}
          csv={{
            filename: `mrr-series-${group.currency.toLowerCase()}`,
            headers: [
              t("adminRevenue.mrr.seriesBucket"),
              ledgerName,
              snapshotName,
              t("adminRevenue.finance.series.drift"),
            ],
            rows: group.points.map((p, i) => [
              p.bucketStart,
              ledger[i],
              snapshot[i],
              p.driftMinor === null ? null : p.driftMinor / scale,
            ]),
          }}
          footer={note}
        />
      </Suspense>
    </div>
  );
}
