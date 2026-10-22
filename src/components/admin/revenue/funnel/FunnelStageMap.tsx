// Organizm: mapa lejka czytelnika - odwiedzający (osobny strumień), konta,
// aktywacja, paywall, kasa, płatność (SPEC §2.2 `funnel`, §6.1, §6.2).
//
// JEDEN ORGANIZM DLA ZAKŁADKI I KOKPITU. Lejek montuje `full`, Kokpit
// `compact`; oba wołają `revenueFunnelQueryOptions` z tymi samymi
// argumentami (okno, segment, tor), więc mini lejek to TEN SAM wpis cache co
// zakładka - nie druga kopia liczb, która mogłaby się rozjechać.
//
// ODWIEDZAJĄCY NIGDY NIE SĄ MIANOWNIKIEM. Pochodzą z analityki ze zgodą
// (`first_party`), konta - z księgi (`lifecycle`): to dwie różne populacje.
// Dlatego stoją OBOK listy kroków (nie jako jej pierwszy pasek - szerokość
// paska `FunnelBars` liczy się względem pierwszego kroku, więc byłaby
// ukrytym ilorazem), a przejście do kont podpisuje zdanie
// `adminRevenue.funnel.separateStream` zamiast procentu.
//
// AKTYWACJA = „BRAK DEFINICJI" (D-02). Krok jest na mapie, bo admin pyta
// o niego jako pierwszy, ale bez liczby i bez `MetricId` - zgadnięta
// definicja aktywacji dałaby liczbę, której nikt nie umie obronić.
//
// UDZIAŁY Z SQL. Zasięg paywalla i konwersja kasy to ilorazy kohortowe
// z agregatu (`revenueFunnelSteps`), a nie dzielenie sąsiednich liczb; start
// kasy liczy zamówienia, a paywall konta, więc ten krok udziału nie ma.
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { FunnelBars, type FunnelBarsStep } from "@/components/admin/analytics/FunnelBars";
import {
  evaluateMetricValue,
  useBenchmark,
} from "@/components/admin/analytics/semantic/hooks/useBenchmark";
import { MoneyByCurrencyText } from "@/components/admin/revenue/molecules/MoneyByCurrencyText";
import { HubCardState } from "@/components/admin/revenue/overview/HubCardState";
import { cardStatusOf } from "@/components/admin/revenue/overview/hubWindow";
import { Button } from "@/components/ui/button";
import { formatMetricValue } from "@/lib/analytics/semantic/format";
import { chartLangFrom, type ChartLang } from "@/lib/charts/format";
import { ensureI18n as ensureFunnelI18n } from "@/lib/i18n-admin-revenue-funnel";
import { ensureI18n } from "@/lib/i18n-admin-revenue-tabs";
import type { RevenueFunnelDto } from "@/lib/revenue/funnel/dto";
import { revenueFunnelSteps, type RevenueFunnelStep } from "@/lib/revenue/funnel/funnelStages";
import { revenueFunnelQueryOptions } from "@/lib/revenue/funnel/queries";
import type { RevenueSegment, RevenueTrack } from "@/lib/revenue/search";
import type { RevenueRange } from "@/lib/revenue/window";
import { STAGE_LABEL_KEY, funnelFiltersOf, type FunnelMapStage } from "./funnelStageKeys";

const LOCALE: Readonly<Record<ChartLang, string>> = { pl: "pl-PL", en: "en-GB" };

export interface FunnelStageMapProps {
  tenantId: string | null;
  range: RevenueRange;
  /** Segment z adresu; brak = `all` (ten sam klucz). */
  segment: RevenueSegment | null;
  track?: RevenueTrack;
  variant?: "full" | "compact";
  /** Wariant pełny: otwarcie arkusza kroku (`?stage=`). */
  onOpenStage?: (stage: FunnelMapStage) => void;
}

export function FunnelStageMap({
  tenantId,
  range,
  segment,
  track = "all",
  variant = "full",
  onOpenStage,
}: FunnelStageMapProps) {
  ensureFunnelI18n();
  ensureI18n();
  const { t, i18n } = useTranslation();
  const lang = chartLangFrom(i18n.language);
  const headingId = useId();
  const full = variant === "full";
  const query = useQuery(
    revenueFunnelQueryOptions(tenantId, range, funnelFiltersOf(segment, track)),
  );
  // Benchmarki tylko w pełnym wariancie (`FunnelBars` i tak chowa je w zwartym).
  const phr = useBenchmark({ metricId: "paywall_hit_rate", lang, enabled: full });
  const ccr = useBenchmark({ metricId: "checkout_conversion_rate", lang, enabled: full });
  const status = cardStatusOf(query, tenantId);
  const number = new Intl.NumberFormat(LOCALE[lang]);

  const stepLabel = (stage: FunnelMapStage) => {
    const text =
      stage === "activation" ? (
        <>
          {t(STAGE_LABEL_KEY.activation)}{" "}
          <span className="font-normal text-muted-foreground">
            ({t("adminRevenue.funnelTab.stage.activationUndefined")})
          </span>
        </>
      ) : (
        t(STAGE_LABEL_KEY[stage])
      );
    if (!full || !onOpenStage) return text;
    return (
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={t("adminRevenue.funnelTab.map.openStage", { stage: t(STAGE_LABEL_KEY[stage]) })}
        onClick={() => onOpenStage(stage)}
        className="rounded-[6px] text-left underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {text}
      </button>
    );
  };

  let body;
  if (status !== "ready") {
    body = (
      <HubCardState
        status={status}
        forbiddenKey="adminRevenue.funnel.state.forbidden"
        unavailableKey="adminRevenue.funnel.state.unavailable"
        onRetry={() => void query.refetch()}
      />
    );
  } else if (query.data?.state === "ready") {
    const dto: RevenueFunnelDto = query.data.funnel;
    const self = dto.selfServe;
    if (self === null) {
      body = (
        <p role="status" className="m-0 text-sm text-muted-foreground">
          {t("adminRevenue.funnelTab.map.selfServeOff")}
        </p>
      );
    } else {
      const steps = revenueFunnelSteps(dto);
      const visitors = steps.find((step) => step.stage === "visitors") as RevenueFunnelStep;
      const ledger = steps.filter((step) => !step.separate);
      const bars: FunnelBarsStep[] = [];
      for (const step of ledger) {
        bars.push({
          key: step.stage,
          label: stepLabel(step.stage),
          value: step.value,
          rate: step.stage === "accounts" ? undefined : step.rate,
          stream: step.stream,
          benchmark: !full
            ? undefined
            : step.stage === "paywall"
              ? evaluateMetricValue("paywall_hit_rate", step.rate, phr.bench, {
                  n: self.activeAccounts,
                })
              : step.stage === "paid"
                ? evaluateMetricValue("checkout_conversion_rate", step.rate, ccr.bench, {
                    n: self.checkoutStarted,
                  })
                : undefined,
        });
        // Aktywacja zaraz po koncie: krok bez liczby i bez ilorazu (D-02).
        if (step.stage === "accounts") {
          bars.push({
            key: "activation",
            label: stepLabel("activation"),
            value: null,
            rate: null,
            stream: step.stream,
          });
        }
      }
      body = (
        <div className="space-y-3">
          <div
            data-testid="funnel-visitors"
            data-stream={visitors.stream}
            className="space-y-1 rounded-[6px] border border-dashed border-border p-2"
          >
            <div
              className={
                full
                  ? "flex items-baseline justify-between gap-3 text-sm"
                  : "flex items-baseline justify-between gap-3 text-xs"
              }
            >
              <span className="font-medium">{stepLabel("visitors")}</span>
              <span className="tabular-nums">
                {visitors.value === null ? "-" : number.format(visitors.value)}
              </span>
            </div>
            <p data-testid="funnel-cross-stream" className="m-0 text-[11px] text-muted-foreground">
              {t("adminRevenue.funnel.separateStream")}
            </p>
          </div>
          <FunnelBars
            steps={bars}
            variant={variant}
            labels={{
              list: t("adminRevenue.funnelTab.map.listLabel"),
              empty: t("adminRevenue.funnelTab.map.empty"),
              ofPrevious: (percent) => t("adminRevenue.funnelTab.map.ofPrevious", { percent }),
              crossStream: t("adminRevenue.funnel.separateStream"),
            }}
            formatValue={(value) => number.format(value)}
            formatRate={(rate) => formatMetricValue(rate, "ratio", lang)}
          />
          {full ? (
            <p data-testid="funnel-activation-note" className="m-0 text-xs text-muted-foreground">
              {t("adminRevenue.funnelTab.stage.activationNote")}
            </p>
          ) : null}
          {full ? (
            <p className="m-0 text-xs text-muted-foreground" data-testid="funnel-paid-amount">
              {dto.amountsVisible && self.paidAmount !== null ? (
                <>
                  <span>{t("adminRevenue.funnel.paidAmount.label")}: </span>
                  <MoneyByCurrencyText amounts={self.paidAmount} lang={lang} />
                </>
              ) : (
                t("adminRevenue.funnel.amountsHidden")
              )}
            </p>
          ) : null}
        </div>
      );
    }
  }

  return (
    <section
      aria-labelledby={headingId}
      data-testid="funnel-stage-map"
      data-variant={variant}
      className="min-w-0 space-y-2"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <h3 id={headingId} className="text-sm font-semibold">
            {t("adminRevenue.funnelTab.map.title")}
          </h3>
          {full ? (
            <p className="m-0 text-xs text-muted-foreground">
              {t("adminRevenue.funnelTab.map.description")}
            </p>
          ) : null}
        </div>
        {full ? null : (
          <Button asChild size="sm" variant="outline" className="h-7">
            <Link to="/admin/revenue/$tab" params={{ tab: "funnel" }}>
              {t("adminRevenue.funnelTab.map.openTab")}
            </Link>
          </Button>
        )}
      </div>
      {body}
    </section>
  );
}
