// Organizm: skąd przychodzą konta i jak pracują formularze zapisu (SPEC §2.2
// `funnel`: „źródła rejestracji; formularze i popupy").
//
// TABELA, NIE WYKRES. Kilkanaście źródeł z liczbą i udziałem to lista do
// przeczytania i porównania wierszami - tabela z `caption` i nagłówkami
// `scope` daje czytnikowi ekranu to samo co oku, bez opisywania kształtów.
// Udział liczony w obrębie TEJ SAMEJ populacji (nowe konta okna).
//
// „Nieznane źródło" zostaje w tabeli jako zwykły wiersz: jego udział jest
// miarą luki w atrybucji (reguła `funnel.signup_attribution_missing`).
//
// Formularze i okienka: wyświetlenia i zapisy z tego samego odczytu lejka;
// bez wyświetleń konwersja to „brak danych", nie 0 %.
import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { HubCardState } from "@/components/admin/revenue/overview/HubCardState";
import { cardStatusOf } from "@/components/admin/revenue/overview/hubWindow";
import { formatMetricValue } from "@/lib/analytics/semantic/format";
import { chartLangFrom, type ChartLang } from "@/lib/charts/format";
import { ensureI18n as ensureFunnelI18n } from "@/lib/i18n-admin-revenue-funnel";
import { ensureI18n } from "@/lib/i18n-admin-revenue-tabs";
import type { SignupSource } from "@/lib/revenue/funnel/funnelStages";
import { revenueFunnelQueryOptions } from "@/lib/revenue/funnel/queries";
import type { RevenueSegment, RevenueTrack } from "@/lib/revenue/search";
import type { RevenueRange } from "@/lib/revenue/window";
import { funnelFiltersOf } from "./funnelStageKeys";

const LOCALE: Readonly<Record<ChartLang, string>> = { pl: "pl-PL", en: "en-GB" };

const SOURCE_KEY: Readonly<Record<SignupSource, string>> = {
  auth_page: "adminRevenue.funnel.signupSource.auth_page",
  login_popup: "adminRevenue.funnel.signupSource.login_popup",
  popup: "adminRevenue.funnel.signupSource.popup",
  club_gate: "adminRevenue.funnel.signupSource.club_gate",
  register_widget: "adminRevenue.funnel.signupSource.register_widget",
  paywall: "adminRevenue.funnel.signupSource.paywall",
  pricing: "adminRevenue.funnel.signupSource.pricing",
  checkout: "adminRevenue.funnel.signupSource.checkout",
  club_apply: "adminRevenue.funnel.signupSource.club_apply",
  join_us_form: "adminRevenue.funnel.signupSource.join_us_form",
  unknown: "adminRevenue.funnel.signupSource.unknown",
};

export interface SignupSourcesCardProps {
  tenantId: string | null;
  range: RevenueRange;
  segment: RevenueSegment | null;
  track?: RevenueTrack;
}

export function SignupSourcesCard({
  tenantId,
  range,
  segment,
  track = "all",
}: SignupSourcesCardProps) {
  ensureFunnelI18n();
  ensureI18n();
  const { t, i18n } = useTranslation();
  const lang = chartLangFrom(i18n.language);
  const headingId = useId();
  const query = useQuery(
    revenueFunnelQueryOptions(tenantId, range, funnelFiltersOf(segment, track)),
  );
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
      const total = self.signupSources.reduce((sum, row) => sum + row.accounts, 0);
      const sources = [...self.signupSources].sort((a, b) => b.accounts - a.accounts);
      const formsRate =
        self.signupFormViews > 0 ? self.signupFormSubmits / self.signupFormViews : null;
      body = (
        <div className="space-y-3">
          {sources.length === 0 || total === 0 ? (
            <p className="m-0 text-sm text-muted-foreground">
              {t("adminRevenue.funnel.signupSources.empty")}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">{t("adminRevenue.funnelTab.sources.caption")}</caption>
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th scope="col" className="py-1 pr-3 font-medium">
                      {t("adminRevenue.funnelTab.sources.source")}
                    </th>
                    <th scope="col" className="py-1 pr-3 text-right font-medium">
                      {t("adminRevenue.funnelTab.sources.accounts")}
                    </th>
                    <th scope="col" className="py-1 text-right font-medium">
                      {t("adminRevenue.funnelTab.sources.share")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {sources.map((row) => (
                    <tr key={row.source} data-source={row.source}>
                      <th scope="row" className="py-1 pr-3 text-left font-normal">
                        {t(SOURCE_KEY[row.source])}
                      </th>
                      <td className="py-1 pr-3 text-right tabular-nums">
                        {number.format(row.accounts)}
                      </td>
                      <td className="py-1 text-right tabular-nums">
                        {formatMetricValue(row.accounts / total, "ratio", lang)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="space-y-1 border-t border-border pt-2">
            <h4 className="text-xs font-semibold">
              {t("adminRevenue.funnelTab.sources.formsTitle")}
            </h4>
            <dl className="m-0 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted-foreground">
                {t("adminRevenue.funnel.count.signupFormViews.label")}
              </dt>
              <dd className="m-0 text-right tabular-nums">{number.format(self.signupFormViews)}</dd>
              <dt className="text-muted-foreground">
                {t("adminRevenue.funnel.count.signupFormSubmits.label")}
              </dt>
              <dd className="m-0 text-right tabular-nums">
                {number.format(self.signupFormSubmits)}
              </dd>
            </dl>
            <p className="m-0 text-xs text-muted-foreground">
              {formsRate === null
                ? t("adminRevenue.funnelTab.sources.formsRateNone")
                : t("adminRevenue.funnelTab.sources.formsRate", {
                    value: formatMetricValue(formsRate, "ratio", lang),
                  })}
            </p>
          </div>
        </div>
      );
    }
  }

  return (
    <section
      aria-labelledby={headingId}
      data-testid="signup-sources"
      className="min-w-0 space-y-2 rounded-[6px] border border-border p-3"
    >
      <h3 id={headingId} className="text-sm font-semibold">
        {t("adminRevenue.funnelTab.sources.title")}
      </h3>
      {body}
    </section>
  );
}
