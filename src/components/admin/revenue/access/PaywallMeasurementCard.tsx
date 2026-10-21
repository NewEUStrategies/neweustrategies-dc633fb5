// Organizm: pomiar paywalla na zakładce Dostęp (SPEC §2.2 `access`: „pomiar
// paywalla") - uderzenia z ostatnich 30 dni według powodu i data, od której
// pomiar w ogóle istnieje.
//
// Uderzenia zapisuje serwer (`record_paywall_hit`, P18) - także bez zgody
// analitycznej, więc to jedyna pełna liczba odmów dostępu. Okres sprzed
// `paywallDataSince` nie ma pomiaru: karta mówi od kiedy liczymy, żeby pusty
// miesiąc sprzed wdrożenia nie czytał się jak „nikt nie trafił na ścianę".
// Data pomiaru z TEGO SAMEGO odczytu lejka co zakładka Lejek (ten sam klucz).
import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { funnelFiltersOf } from "@/components/admin/revenue/funnel/funnelStageKeys";
import { chartLangFrom, type ChartLang } from "@/lib/charts/format";
import { ensureI18n as ensureFunnelI18n } from "@/lib/i18n-admin-revenue-funnel";
import { ensureI18n } from "@/lib/i18n-admin-revenue-tabs";
import type { PaywallHitReason } from "@/lib/revenue/limits";
import type { AccessInventoryDto } from "@/lib/revenue/access/dto";
import { revenueFunnelQueryOptions } from "@/lib/revenue/funnel/queries";
import type { RevenueSegment } from "@/lib/revenue/search";
import type { RevenueRange } from "@/lib/revenue/window";

const LOCALE: Readonly<Record<ChartLang, string>> = { pl: "pl-PL", en: "en-GB" };

const REASON_KEY: Readonly<Record<PaywallHitReason, string>> = {
  members: "adminRevenue.funnel.paywallReason.members",
  paid: "adminRevenue.funnel.paywallReason.paid",
  tier_rank: "adminRevenue.funnel.paywallReason.tier_rank",
  password: "adminRevenue.funnel.paywallReason.password",
  quota: "adminRevenue.funnel.paywallReason.quota",
  registration: "adminRevenue.funnel.paywallReason.registration",
};

export interface PaywallMeasurementCardProps {
  tenantId: string | null;
  inventory: AccessInventoryDto;
  range: RevenueRange;
  segment: RevenueSegment | null;
}

export function PaywallMeasurementCard({
  tenantId,
  inventory,
  range,
  segment,
}: PaywallMeasurementCardProps) {
  ensureFunnelI18n();
  ensureI18n();
  const { t, i18n } = useTranslation();
  const lang = chartLangFrom(i18n.language);
  const headingId = useId();
  const number = new Intl.NumberFormat(LOCALE[lang]);
  const funnel = useQuery(revenueFunnelQueryOptions(tenantId, range, funnelFiltersOf(segment)));
  const since =
    funnel.data?.state === "ready"
      ? (funnel.data.funnel.selfServe?.paywallDataSince ?? null)
      : undefined;
  const day = new Intl.DateTimeFormat(LOCALE[lang], { dateStyle: "long" });

  return (
    <section
      aria-labelledby={headingId}
      data-testid="paywall-measurement"
      className="min-w-0 space-y-2 rounded-[6px] border border-border p-3"
    >
      <div className="min-w-0 space-y-0.5">
        <h3 id={headingId} className="text-sm font-semibold">
          {t("adminRevenue.accessTab.measurement.title")}
        </h3>
        <p className="m-0 text-xs text-muted-foreground">
          {t("adminRevenue.accessTab.measurement.description")}
        </p>
      </div>
      {since === undefined ? null : (
        <p className="m-0 text-xs text-muted-foreground" data-testid="measurement-since">
          {since
            ? t("adminRevenue.funnel.paywallDataSince", {
                date: day.format(new Date(since)),
              })
            : t("adminRevenue.funnel.paywallDataEmpty")}
        </p>
      )}
      {inventory.hits30d.length === 0 ? (
        <p className="m-0 text-sm text-muted-foreground">
          {t("adminRevenue.access.hits30d.empty")}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{t("adminRevenue.accessTab.measurement.caption")}</caption>
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th scope="col" className="py-1 pr-3 font-medium">
                  {t("adminRevenue.accessTab.measurement.reason")}
                </th>
                <th scope="col" className="py-1 pr-3 text-right font-medium">
                  {t("adminRevenue.accessTab.measurement.accounts")}
                </th>
                <th scope="col" className="py-1 pr-3 text-right font-medium">
                  {t("adminRevenue.accessTab.measurement.visitors")}
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  {t("adminRevenue.accessTab.measurement.hits")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {inventory.hits30d.map((row) => (
                <tr key={row.reason} data-reason={row.reason}>
                  <th scope="row" className="py-1 pr-3 text-left font-normal">
                    {t(REASON_KEY[row.reason])}
                  </th>
                  <td className="py-1 pr-3 text-right tabular-nums">
                    {number.format(row.accounts)}
                  </td>
                  <td className="py-1 pr-3 text-right tabular-nums">
                    {number.format(row.visitors)}
                  </td>
                  <td className="py-1 text-right tabular-nums">{number.format(row.hits)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
