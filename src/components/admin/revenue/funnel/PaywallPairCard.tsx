// Organizm: para wskaźników paywalla - zasięg (PHR) i konwersja (PSCR)
// zawsze razem (SPEC §2.2 `funnel`, §6.2; `PAYWALL_PAIR_METRICS` S3).
//
// DLACZEGO PARA. Sam wysoki zasięg nie mówi, czy ściana sprzedaje, a sama
// konwersja - na jak małej próbie stoi. Dwa kafle obok siebie, każdy
// z własną skalą i własną oceną benchmarku (small multiples), a NIE jeden
// wykres z dwiema osiami Y: dwie osie zachęcają do porównywania wysokości
// linii, które nie mają wspólnej jednostki (zakaz SPEC §6.2).
//
// TEN SAM ODCZYT CO MAPA LEJKA (`revenueFunnelQueryOptions` z filtrami
// `funnelFiltersOf`) - karta nie dokłada żądania. Liczności pod kaflami
// (konta z uderzeniem, aktywne konta, kupujący) to mianowniki ilorazów -
// czytelnik widzi, z jak dużej próby jest procent; ocena benchmarku dostaje
// `n` i przy małej próbie mówi „za mała próba", a nie werdykt.
//
// Pomiar paywalla zaczyna się w dniu wdrożenia (`paywallDataSince`) -
// karta podaje tę datę, żeby pusty okres sprzed pomiaru nie czytał się jak
// „nikt nie trafił na ścianę".
import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { KpiTile } from "@/components/admin/analytics/KpiTile";
import {
  evaluateMetricValue,
  useBenchmark,
} from "@/components/admin/analytics/semantic/hooks/useBenchmark";
import { HubCardState } from "@/components/admin/revenue/overview/HubCardState";
import { cardStatusOf } from "@/components/admin/revenue/overview/hubWindow";
import { bi } from "@/lib/analytics/semantic/benchmarks/adapter";
import { formatMetricValue } from "@/lib/analytics/semantic/format";
import { metricById } from "@/lib/analytics/semantic/metrics";
import { chartLangFrom, type ChartLang } from "@/lib/charts/format";
import { ensureI18n as ensureFunnelI18n } from "@/lib/i18n-admin-revenue-funnel";
import { ensureI18n } from "@/lib/i18n-admin-revenue-tabs";
import { PAYWALL_PAIR_METRICS } from "@/lib/revenue/funnel/funnelStages";
import { revenueFunnelQueryOptions } from "@/lib/revenue/funnel/queries";
import type { RevenueSegment, RevenueTrack } from "@/lib/revenue/search";
import type { RevenueRange } from "@/lib/revenue/window";
import { funnelFiltersOf } from "./funnelStageKeys";

const LOCALE: Readonly<Record<ChartLang, string>> = { pl: "pl-PL", en: "en-GB" };

export interface PaywallPairCardProps {
  tenantId: string | null;
  range: RevenueRange;
  segment: RevenueSegment | null;
  track?: RevenueTrack;
}

/** `YYYY-MM-DD…` jako lokalny dzień (bez przesunięcia strefy napisu ISO). */
function localDayOf(iso: string): Date {
  const at = new Date(iso);
  return new Date(at.getFullYear(), at.getMonth(), at.getDate());
}

export function PaywallPairCard({ tenantId, range, segment, track = "all" }: PaywallPairCardProps) {
  ensureFunnelI18n();
  ensureI18n();
  const { t, i18n } = useTranslation();
  const lang = chartLangFrom(i18n.language);
  const headingId = useId();
  const query = useQuery(
    revenueFunnelQueryOptions(tenantId, range, funnelFiltersOf(segment, track)),
  );
  const [phrId, pscrId] = PAYWALL_PAIR_METRICS;
  const phr = useBenchmark({ metricId: phrId, lang });
  const pscr = useBenchmark({ metricId: pscrId, lang });
  const status = cardStatusOf(query, tenantId);
  const number = new Intl.NumberFormat(LOCALE[lang]);

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
    const self = query.data.funnel.selfServe;
    if (self === null) {
      body = (
        <p role="status" className="m-0 text-sm text-muted-foreground">
          {t("adminRevenue.funnelTab.map.selfServeOff")}
        </p>
      );
    } else {
      const label = (id: typeof phrId | typeof pscrId) => {
        const def = metricById(id);
        return bi({ pl: def.labelPl, en: def.labelEn }, lang);
      };
      const day = new Intl.DateTimeFormat(LOCALE[lang], { dateStyle: "long" });
      body = (
        <div className="space-y-2">
          <div role="group" aria-labelledby={headingId} className="grid gap-3 sm:grid-cols-2">
            <div data-tile={phrId}>
              <KpiTile
                label={label(phrId)}
                value={formatMetricValue(self.rates.paywallHit, "ratio", lang)}
                current={self.rates.paywallHit ?? undefined}
                metricId={phrId}
                lang={lang}
                n={self.activeAccounts}
                benchmark={evaluateMetricValue(phrId, self.rates.paywallHit, phr.bench, {
                  n: self.activeAccounts,
                })}
                annotation={
                  <p className="m-0 text-[11px] text-muted-foreground">
                    {t("adminRevenue.funnelTab.pair.hits", {
                      hit: number.format(self.paywallHitAccounts),
                      active: number.format(self.activeAccounts),
                    })}
                  </p>
                }
              />
            </div>
            <div data-tile={pscrId}>
              <KpiTile
                label={label(pscrId)}
                value={formatMetricValue(self.rates.paywallConversion, "ratio", lang)}
                current={self.rates.paywallConversion ?? undefined}
                metricId={pscrId}
                lang={lang}
                n={self.paywallHitAccounts}
                benchmark={evaluateMetricValue(pscrId, self.rates.paywallConversion, pscr.bench, {
                  n: self.paywallHitAccounts,
                })}
                annotation={
                  <p className="m-0 text-[11px] text-muted-foreground">
                    {t("adminRevenue.funnelTab.pair.converted", {
                      converted: number.format(self.paywallConvertedAccounts),
                      hit: number.format(self.paywallHitAccounts),
                    })}
                  </p>
                }
              />
            </div>
          </div>
          <p className="m-0 text-xs text-muted-foreground">
            {t("adminRevenue.funnelTab.pair.guests", {
              count: number.format(self.paywallHitVisitors),
            })}
          </p>
          <p className="m-0 text-xs text-muted-foreground" data-testid="paywall-data-since">
            {self.paywallDataSince
              ? t("adminRevenue.funnel.paywallDataSince", {
                  date: day.format(localDayOf(self.paywallDataSince)),
                })
              : t("adminRevenue.funnel.paywallDataEmpty")}
          </p>
        </div>
      );
    }
  }

  return (
    <section
      aria-labelledby={headingId}
      data-testid="paywall-pair"
      className="min-w-0 space-y-2 rounded-[6px] border border-border p-3"
    >
      <div className="min-w-0 space-y-0.5">
        <h3 id={headingId} className="text-sm font-semibold">
          {t("adminRevenue.funnelTab.pair.title")}
        </h3>
        <p className="m-0 text-xs text-muted-foreground">
          {t("adminRevenue.funnelTab.pair.description")}
        </p>
      </div>
      {body}
    </section>
  );
}
