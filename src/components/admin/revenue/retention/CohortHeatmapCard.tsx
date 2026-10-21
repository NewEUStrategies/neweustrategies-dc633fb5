// Organizm: kohorty miesięczne jako mapa ciepła - udział subskrypcji z miesiąca
// startu, które wciąż płacą w kolejnych miesiącach (SPEC §2.2 `retention`,
// §6.2: „kohorty `heatmap`"; karta S7).
//
// WIERSZ = KOHORTA, KOLUMNA = MIESIĄC ŻYCIA. Tak silnik czyta mapę ciepła
// z konfiguracji (seria = wiersz). Wierszy jest najwyżej `COHORT_ROWS`
// (limit serii silnika), a zakres kończy się na miesiącu wybranego okresu -
// starsze kohorty widać po cofnięciu okresu.
//
// PUSTE POLE ≠ 0. Komórka miesiąca, który jeszcze nie minął, nie przychodzi
// z SQL; w siatce jest `null` (puste pole), nigdy 0 % - podpis pod mapą
// mówi to wprost. Saldo otwarcia księgi nie tworzy kohorty (hint S2).
//
// „DANE OD …" (SPEC §6.2). Kohorta M12 istnieje dopiero 12 miesięcy po
// początku księgi - `ProvenanceNote` z `dataSince` migawki mówi, od kiedy
// wynik jest pełny.
import { Suspense, lazy } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { biChart } from "@/components/admin/analytics/biChart";
import { ProvenanceNote } from "@/components/admin/revenue/atoms/ProvenanceNote";
import { FinanceCardFrame } from "@/components/admin/revenue/mrr/FinanceCardFrame";
import { localDay } from "@/components/admin/revenue/mrr/mrrModel";
import type { SnapshotMeta } from "@/components/admin/revenue/mrr/useSnapshotMeta";
import { cardStatusOf } from "@/components/admin/revenue/overview/hubWindow";
import { chartLangFrom, type ChartLang } from "@/lib/charts/format";
import { ensureI18n as ensureRevenueI18n } from "@/lib/i18n-admin-revenue";
import { ensureI18n as ensureFinanceI18n } from "@/lib/i18n-admin-revenue-finance";
import { ensureI18n } from "@/lib/i18n-admin-revenue-tabs";
import { revenueCohortsQueryOptions } from "@/lib/revenue/finance/queries";
import type { RevenueRange } from "@/lib/revenue/window";
import { cohortGrid, cohortWindowOf, type CohortGrid } from "./retentionModel";

const ChartCard = lazy(() =>
  import("@/components/admin/analytics/ChartCard").then((m) => ({ default: m.ChartCard })),
);

const LOCALE: Readonly<Record<ChartLang, string>> = { pl: "pl-PL", en: "en-GB" };

export interface CohortHeatmapCardProps {
  tenantId: string | null;
  roles: readonly string[];
  range: RevenueRange;
  meta: SnapshotMeta | undefined;
}

function monthLabel(month: string, lang: ChartLang): string {
  return new Intl.DateTimeFormat(LOCALE[lang], { month: "short", year: "numeric" }).format(
    localDay(month),
  );
}

export function CohortHeatmapCard({ tenantId, roles, range, meta }: CohortHeatmapCardProps) {
  ensureRevenueI18n();
  ensureFinanceI18n();
  ensureI18n();
  const { t, i18n } = useTranslation();
  const lang = chartLangFrom(i18n.language);
  const isAdmin = roles.includes("admin");
  const { fromMonth, toMonth } = cohortWindowOf(range);
  const query = useQuery(
    revenueCohortsQueryOptions(tenantId, fromMonth, toMonth, { roleOk: isAdmin }),
  );
  const status = cardStatusOf(query, tenantId);

  let body = null;
  if (status === "ready" && query.data?.state === "ready") {
    const grid = cohortGrid(query.data.data);
    body = (
      <div className="space-y-2">
        <p className="m-0 text-xs text-muted-foreground" data-testid="cohorts-range">
          {t("adminRevenue.retention.cohortsRange", {
            from: monthLabel(fromMonth, lang),
            to: monthLabel(toMonth, lang),
          })}
        </p>
        {grid.rows.length === 0 ? (
          <p role="status" className="m-0 text-sm text-muted-foreground">
            {t("adminRevenue.retention.cohortsEmpty")}
          </p>
        ) : (
          <CohortChart grid={grid} lang={lang} />
        )}
        <ProvenanceNote dataSince={meta?.dataSince ?? null} environment="live" />
      </div>
    );
  }

  return (
    <FinanceCardFrame
      testId="cohort-heatmap"
      title={t("adminRevenue.finance.cohorts.title")}
      subtitle={t("adminRevenue.finance.cohorts.hint")}
      isAdmin={isAdmin}
      status={status}
      onRetry={() => void query.refetch()}
    >
      {body}
    </FinanceCardFrame>
  );
}

function CohortChart({ grid, lang }: { grid: CohortGrid; lang: ChartLang }) {
  const { t } = useTranslation();
  const categories = grid.offsets.map((n) => t("adminRevenue.finance.cohorts.offset", { n }));
  // Udział w punktach procentowych (silnik dokleja jednostkę „%"); `null`
  // zostaje `null` - pusta komórka, nie zero.
  const series = grid.rows.map((row) => ({
    name: monthLabel(row.cohortMonth, lang),
    values: row.shares.map((share) => (share === null ? null : Math.round(share * 1000) / 10)),
  }));
  const notElapsed = t("adminRevenue.retention.cohortsNotElapsed");
  const footer = (
    <p className="m-0 text-xs text-muted-foreground" data-testid="cohorts-not-elapsed">
      {notElapsed}
    </p>
  );
  return (
    <Suspense
      fallback={
        <div className="space-y-1 rounded-[6px] border border-border p-3">
          <p role="status" className="m-0 text-sm text-muted-foreground">
            {t("adminRevenue.common.loading")}
          </p>
          {footer}
        </div>
      }
    >
      <ChartCard
        title={t("adminRevenue.retention.cohortsCaption")}
        config={biChart({
          kind: "heatmap",
          categories,
          series,
          unit: "%",
          showLegend: false,
          lang,
        })}
        csv={{
          filename: "revenue-cohorts",
          headers: [
            t("adminRevenue.finance.cohorts.cohortMonth"),
            t("adminRevenue.finance.cohorts.size"),
            ...categories,
          ],
          rows: grid.rows.map((row, index) => [
            row.cohortMonth.slice(0, 7),
            row.size,
            ...(series[index]?.values ?? []),
          ]),
        }}
        footer={footer}
      />
    </Suspense>
  );
}
