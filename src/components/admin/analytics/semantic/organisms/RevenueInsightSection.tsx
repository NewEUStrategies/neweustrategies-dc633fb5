// Organizm: sekcja „Przychód i lejek” na ekranie BI (/admin/analytics/bi) -
// najważniejsze wskaźniki huba z oceną na tle rynku (SPEC §6.5, karta S6).
//
// TA SAMA LICZBA CO W HUBIE. Sekcja czyta `getRevenueSnapshot` przez
// `revenueSnapshotQueryOptions` - ten sam klucz cache co hub i pulpit (AD-19),
// więc przejście BI → hub nie pobiera migawki drugi raz i obie strony nie
// mogą pokazać dwóch różnych MRR. Okres to okresy huba BEZ „własnego zakresu”
// (BI nie ma pól dat; zakres ustawia się w hubie).
//
// ROLA. Administrator widzi kwoty i wskaźniki finansowe; redaktor - lejek,
// komunikację i społeczność, a w miejscu kwot kafle zablokowane (ta sama
// siatka, bez „0 zł”). Rola przychodzi z SESJI przez odpowiedź serwera
// (`role`); serwer odmawiający dostępu (42501) daje stan „dostępne dla
// administratora i redaktora”, a nie toast z błędem.
//
// KAŻDY KAFEL Z REJESTRU (SPEC §6.2): `metricId`, ocena albo jawny powód jej
// braku, objaśnienie przy etykiecie i odnośnik do zakładki huba. Przychód
// zrealizowany niesie też werdykt uzgodnienia księgi z zamówieniami.
//
// `?metric=` (adres do udostępnienia) otwiera pełne objaśnienie w arkuszu;
// parametr jest walidowany rejestrem metryk - trasa BI nie ma
// `validateSearch` (chunk wejściowy), więc czytamy go `useSearch({strict:false})`.
//
// Słownik grup przychodowych jest LENIWY: ładuje się dopiero po rozwinięciu.
import { lazy, Suspense, useId, useMemo, useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowUpRight, Loader2 } from "lucide-react";
import { DashboardPeriodTabs } from "@/components/admin/dashboard/DashboardPeriodTabs";
import { RoleGateNotice } from "@/components/admin/revenue/molecules/RoleGateNotice";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { KpiTile } from "@/components/admin/analytics/KpiTile";
import { formatMetricValue } from "@/lib/analytics/semantic/format";
import { bi } from "@/lib/analytics/semantic/benchmarks/adapter";
import {
  metricById,
  METRICS,
  type MetricGroup,
  type MetricId,
} from "@/lib/analytics/semantic/metrics";
import type { ReconciliationEntry } from "@/lib/analytics/semantic/reconcile";
import {
  isRevenueForbidden,
  revenueSnapshotQueryOptions,
  type RevenueSnapshotResult,
} from "@/lib/analytics/semantic/revenueSnapshot.functions";
import { chartLangFrom, type ChartLang } from "@/lib/charts/format";
import { ensureI18n as ensureAnalyticsI18n } from "@/lib/i18n-admin-analytics";
import { ensureI18n as ensureRevenueI18n } from "@/lib/i18n-admin-revenue";
import { ensureI18n as ensureShellI18n } from "@/lib/i18n-admin-revenue-shell";
import { REVENUE_PERIODS, type RevenuePeriod } from "@/lib/revenue/search";
import { resolveRevenueRange } from "@/lib/revenue/window";
import { useCurrentTenantId } from "@/lib/tenant";
import { VerdictBadge } from "../atoms/VerdictBadge";
import { evaluateMetricValue, useBenchmark } from "../hooks/useBenchmark";
import { MetricExplainerBody } from "../molecules/MetricExplainer";

const MetricDictionary = lazy(() =>
  import("./MetricDictionary").then((m) => ({ default: m.MetricDictionary })),
);

/** Okresy huba bez `custom` - BI nie ma pól dat. */
const BI_PERIODS = REVENUE_PERIODS.filter(
  (p): p is Exclude<RevenuePeriod, "custom"> => p !== "custom",
);
type BiPeriod = (typeof BI_PERIODS)[number];

const PERIOD_LABEL_KEY: Readonly<Record<BiPeriod, string>> = {
  week: "adminRevenue.period.week",
  month: "adminRevenue.period.month",
  "prev-month": "adminRevenue.period.prev-month",
  quarter: "adminRevenue.period.quarter",
  "half-year": "adminRevenue.period.half-year",
  year: "adminRevenue.period.year",
  ltm: "adminRevenue.period.ltm",
};

/** Kafel sekcji: metryka i zakładka huba ze szczegółami. */
interface TileSpec {
  metricId: MetricId;
  tab: "mrr" | "retention" | "funnel" | "community" | "metrics";
}

/** Kafle administratora: kwoty i retencja (SPEC §6.5). */
export const ADMIN_TILES: readonly TileSpec[] = [
  { metricId: "mrr", tab: "mrr" },
  { metricId: "arr", tab: "mrr" },
  { metricId: "net_revenue_retention", tab: "retention" },
  { metricId: "logo_churn_monthly", tab: "retention" },
  { metricId: "revenue_realized", tab: "mrr" },
  { metricId: "trial_to_paid_rate", tab: "funnel" },
];

/** Kafle redaktora: lejek, komunikacja, społeczność (widzi je także administrator). */
export const EDITOR_TILES: readonly TileSpec[] = [
  { metricId: "registered_to_paid_rate", tab: "funnel" },
  { metricId: "paywall_conversion_rate", tab: "funnel" },
  { metricId: "checkout_conversion_rate", tab: "funnel" },
  { metricId: "email_open_rate", tab: "metrics" },
  { metricId: "event_attendance_rate", tab: "community" },
  { metricId: "club_active_member_rate", tab: "community" },
];

/** Grupy słownika BI - wszystko, co nie jest ruchem stron. */
const REVENUE_GROUPS: readonly MetricGroup[] = [
  "revenue",
  "retention",
  "funnel",
  "economics",
  "email",
  "community",
  "crm",
];

/** Wysokość kafla KPI - szkielet ładowania tej samej wysokości (bez CLS). */
const TILE_SKELETON = "h-[104px]";

function InsightTile({
  spec,
  entry,
  previous,
  money,
  locked,
  lang,
  onOpenFull,
}: {
  spec: TileSpec;
  entry: ReconciliationEntry | undefined;
  previous: number | null;
  money: RevenueSnapshotResult["money"][MetricId] | undefined;
  locked: boolean;
  lang: ChartLang;
  onOpenFull: (id: MetricId) => void;
}) {
  const { t } = useTranslation();
  const def = metricById(spec.metricId);
  const label = bi({ pl: def.labelPl, en: def.labelEn }, lang);
  const { bench } = useBenchmark({ metricId: spec.metricId, lang, enabled: !locked });
  const value = entry?.canonicalValue ?? null;
  const currency = money?.[0]?.currency;
  const evaluation = evaluateMetricValue(spec.metricId, value, bench, { currency });
  const drillHref = `/admin/revenue/${spec.tab}`;

  if (locked) {
    return <KpiTile label={label} value="-" metricId={spec.metricId} lockedReason="admin_only" />;
  }
  return (
    <div data-tile={spec.metricId}>
      <KpiTile
        label={label}
        value={formatMetricValue(value, def.unit, lang, "-", { currency })}
        metricId={spec.metricId}
        lang={lang}
        current={value ?? undefined}
        previous={previous ?? undefined}
        money={def.currencyBound ? (money ?? null) : undefined}
        benchmark={evaluation}
        drillHref={drillHref}
        onOpenFull={() => onOpenFull(spec.metricId)}
        annotation={
          spec.metricId === "revenue_realized" && entry ? (
            <div role="group" aria-label={t("adminAnalytics.bi.revenue.reconciliation")}>
              <VerdictBadge verdict={entry.verdict} />
            </div>
          ) : undefined
        }
      />
    </div>
  );
}

export function RevenueInsightSection() {
  ensureAnalyticsI18n();
  ensureRevenueI18n();
  ensureShellI18n();
  const { t, i18n } = useTranslation();
  const lang = chartLangFrom(i18n.language);
  const tenantId = useCurrentTenantId();
  const headingId = useId();
  const sheetHeadingId = useId();
  const [period, setPeriod] = useState<BiPeriod>("month");
  const [dictionaryOpen, setDictionaryOpen] = useState(false);
  // Chwila odniesienia zamrożona na czas życia sekcji: klucz zapytania
  // z `Date.now()` w renderze zmieniałby się co render i pobierał w kółko.
  const [nowMs] = useState(() => Date.now());
  const range = useMemo(() => resolveRevenueRange(period, nowMs), [period, nowMs]);
  const query = useQuery(revenueSnapshotQueryOptions(tenantId, range));

  const search: Record<string, unknown> = useSearch({ strict: false });
  const navigate = useNavigate();
  const metricParam = typeof search.metric === "string" ? search.metric : null;
  const openMetric = METRICS.some((m) => m.id === metricParam) ? (metricParam as MetricId) : null;
  const setMetric = (id: MetricId | null): void => {
    void navigate({
      to: ".",
      search: (prev: Record<string, unknown>) => {
        const next = { ...prev };
        if (id === null) delete next.metric;
        else next.metric = id;
        return next;
      },
      replace: true,
    });
  };

  const data = query.data;
  const entries = new Map<MetricId, ReconciliationEntry>(
    (data?.entries ?? []).map((e) => [e.metricId, e]),
  );
  const previous = new Map<MetricId, number | null>(
    (data?.deltas ?? []).map((d) => [d.metricId, d.previous]),
  );
  const values = new Map<MetricId, number | null>(
    (data?.entries ?? []).map((e) => [e.metricId, e.canonicalValue]),
  );
  const isAdmin = data?.role === "admin";
  // Źródło niepodłączone (RPC wycinka-właściciela jeszcze bez migracji) to nie
  // awaria i nie zero: mówimy to wprost, żeby rząd kresek nie wyglądał na
  // zepsuty pomiar.
  const sourcesPending = data?.streams.some((s) => s.reason === "not_configured") ?? false;

  const tiles = (specs: readonly TileSpec[], locked: boolean) => (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
      {specs.map((spec) => (
        <InsightTile
          key={spec.metricId}
          spec={spec}
          entry={entries.get(spec.metricId)}
          previous={previous.get(spec.metricId) ?? null}
          money={data?.money[spec.metricId]}
          locked={locked}
          lang={lang}
          onOpenFull={setMetric}
        />
      ))}
    </div>
  );

  let body;
  if (query.isError && isRevenueForbidden(query.error)) {
    body = <RoleGateNotice requiredRole="admin_or_editor" />;
  } else if (query.isError) {
    body = (
      <div role="alert" className="flex flex-wrap items-center gap-2 text-sm">
        <span>{t("adminAnalytics.bi.revenue.error")}</span>
        <Button type="button" size="sm" variant="outline" onClick={() => void query.refetch()}>
          {t("adminAnalytics.bi.revenue.retry")}
        </Button>
      </div>
    );
  } else if (!data) {
    body = (
      <div aria-busy="true" className="space-y-2">
        <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          {t("adminAnalytics.bi.revenue.loading")}
        </p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {ADMIN_TILES.map((spec) => (
            <div key={spec.metricId} className={`${TILE_SKELETON} rounded-[6px] bg-muted/50`} />
          ))}
        </div>
      </div>
    );
  } else {
    body = (
      <div className="space-y-4">
        {sourcesPending ? (
          <p data-testid="revenue-sources-pending" className="text-xs text-muted-foreground">
            {t("adminAnalytics.bi.revenue.sourcesPending")}
          </p>
        ) : null}
        <section aria-labelledby={`${headingId}-finance`} className="space-y-2">
          <h3 id={`${headingId}-finance`} className="text-xs font-semibold text-muted-foreground">
            {t("adminAnalytics.bi.revenue.finance")}
          </h3>
          {tiles(ADMIN_TILES, !isAdmin)}
        </section>
        <section aria-labelledby={`${headingId}-engagement`} className="space-y-2">
          <h3
            id={`${headingId}-engagement`}
            className="text-xs font-semibold text-muted-foreground"
          >
            {t("adminAnalytics.bi.revenue.engagement")}
          </h3>
          {tiles(EDITOR_TILES, false)}
        </section>
      </div>
    );
  }

  return (
    <Card className="p-4 space-y-4" aria-labelledby={headingId} role="region">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={headingId} className="text-base font-semibold leading-tight">
            {t("adminAnalytics.bi.revenue.title")}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("adminAnalytics.bi.revenue.subtitle")}
          </p>
        </div>
        <Button asChild size="sm" variant="outline" className="h-8 gap-1 text-xs">
          <Link to="/admin/revenue">
            {t("adminAnalytics.bi.revenue.openHub")}
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </Button>
      </div>

      <DashboardPeriodTabs
        value={period}
        onChange={setPeriod}
        periods={BI_PERIODS}
        labelKey={(p) => PERIOD_LABEL_KEY[p]}
      />

      {body}

      <div className="border-t border-border pt-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 text-xs"
          aria-expanded={dictionaryOpen}
          onClick={() => setDictionaryOpen((o) => !o)}
        >
          {dictionaryOpen
            ? t("adminAnalytics.bi.revenue.dictionaryHide")
            : t("adminAnalytics.bi.revenue.dictionaryShow")}
        </Button>
        {dictionaryOpen ? (
          <Suspense
            fallback={
              <p role="status" className="py-4 text-xs text-muted-foreground">
                {t("adminAnalytics.common.loadingData")}
              </p>
            }
          >
            <div className="pt-3">
              <MetricDictionary groups={REVENUE_GROUPS} values={values} />
            </div>
          </Suspense>
        ) : null}
      </div>

      <Sheet
        open={openMetric !== null}
        onOpenChange={(next) => {
          if (!next) setMetric(null);
        }}
      >
        <SheetContent
          side="right"
          aria-labelledby={sheetHeadingId}
          aria-describedby={undefined}
          className="w-full overflow-y-auto sm:max-w-lg"
        >
          {openMetric ? (
            <MetricExplainerBody
              metricId={openMetric}
              value={values.has(openMetric) ? (values.get(openMetric) ?? null) : undefined}
              currency={data?.money[openMetric]?.[0]?.currency}
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
