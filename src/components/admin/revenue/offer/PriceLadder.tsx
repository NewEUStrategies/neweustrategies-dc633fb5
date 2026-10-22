// Organizm: drabina cen - plany najemcy osobno dla każdej waluty, od
// najniższej warstwy (SPEC §2.2 `offer`, §6.1 `PriceLadder`).
//
// PER WALUTA, NIGDY RAZEM. Plan za 49 zł i plan za 12 EUR nie stoją na jednej
// drabinie: porównanie wymagałoby kursu z dnia odczytu, a ten zmieniałby
// kolejność przy każdym odświeżeniu. Każda waluta ma własną tabelę
// (`caption` z kodem waluty, nagłówki `scope`).
//
// DANE Z MACIERZY OFERTY S2 (`revenueOfferMatrixQueryOptions`) - ten sam
// odczyt co macierz plan × benefit obok (bez drugiego żądania). Problemy planu
// to kody `OFFER_PLAN_ISSUES` S2 z ich zdaniami; liczba płacących jest tylko
// dla administratora (redaktor: `null` = „-" z powodem, nie zero).
import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { HubCardState } from "@/components/admin/revenue/overview/HubCardState";
import { cardStatusOf } from "@/components/admin/revenue/overview/hubWindow";
import { formatMoneyMinor } from "@/lib/analytics/semantic/format";
import { chartLangFrom, type ChartLang } from "@/lib/charts/format";
import { ensureI18n as ensureFinanceI18n } from "@/lib/i18n-admin-revenue-finance";
import { ensureI18n } from "@/lib/i18n-admin-revenue-tabs";
import type { OfferMatrixPlan, OfferPlanIssue } from "@/lib/revenue/finance/dto";
import { revenueOfferMatrixQueryOptions } from "@/lib/revenue/finance/queries";
import { INTERVAL_KEY } from "./planBenefitMatrix";

const LOCALE: Readonly<Record<ChartLang, string>> = { pl: "pl-PL", en: "en-GB" };

const ISSUE_KEY: Readonly<Record<OfferPlanIssue, string>> = {
  no_catalog_pair: "adminRevenue.finance.offer.planIssue.no_catalog_pair",
  tier_missing: "adminRevenue.finance.offer.planIssue.tier_missing",
  tier_inactive: "adminRevenue.finance.offer.planIssue.tier_inactive",
  tier_hidden: "adminRevenue.finance.offer.planIssue.tier_hidden",
  inactive_for_sale: "adminRevenue.finance.offer.planIssue.inactive_for_sale",
};

/** Kolejność okresów na drabinie: od najkrótszego zobowiązania. */
const INTERVAL_ORDER: Readonly<Record<string, number>> = {
  two_weeks: 0,
  month: 1,
  quarter: 2,
  year: 3,
  one_time: 4,
};

export interface PriceLadderProps {
  tenantId: string | null;
}

/** Plany pogrupowane po walucie, w każdej grupie: ranga warstwy, okres, cena. */
function ladderByCurrency(
  plans: readonly OfferMatrixPlan[],
  rankOf: (tierKey: string | null) => number,
): [string, OfferMatrixPlan[]][] {
  const groups = new Map<string, OfferMatrixPlan[]>();
  for (const plan of plans) {
    const list = groups.get(plan.currency) ?? [];
    list.push(plan);
    groups.set(plan.currency, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, list]) => [
      currency,
      [...list].sort(
        (a, b) =>
          rankOf(a.tierKey) - rankOf(b.tierKey) ||
          (INTERVAL_ORDER[a.interval] ?? 9) - (INTERVAL_ORDER[b.interval] ?? 9) ||
          a.priceCents - b.priceCents,
      ),
    ]);
}

function saleKey(plan: OfferMatrixPlan): string {
  if (!plan.active) return "adminRevenue.offer.ladder.inactive";
  return plan.forSale
    ? "adminRevenue.offer.ladder.forSale"
    : "adminRevenue.offer.ladder.notForSale";
}

export function PriceLadder({ tenantId }: PriceLadderProps) {
  ensureFinanceI18n();
  ensureI18n();
  const { t, i18n } = useTranslation();
  const lang = chartLangFrom(i18n.language);
  const headingId = useId();
  const query = useQuery(revenueOfferMatrixQueryOptions(tenantId));
  const status = cardStatusOf(query, tenantId);
  const number = new Intl.NumberFormat(LOCALE[lang]);

  let body;
  if (status !== "ready") {
    body = (
      <HubCardState
        status={status}
        forbiddenKey="adminRevenue.finance.state.forbidden"
        unavailableKey="adminRevenue.finance.state.unavailable"
        onRetry={() => void query.refetch()}
      />
    );
  } else if (query.data?.state === "ready") {
    const { plans, tiers } = query.data.data;
    const ranks = new Map(tiers.map((tier) => [tier.key, tier.rank]));
    const rankOf = (key: string | null) =>
      key === null ? Number.MAX_SAFE_INTEGER : (ranks.get(key) ?? Number.MAX_SAFE_INTEGER - 1);
    const groups = ladderByCurrency(plans, rankOf);
    const subscriptionsHidden = plans.some((plan) => plan.activeSubscriptions === null);
    body =
      groups.length === 0 ? (
        <p className="m-0 text-sm text-muted-foreground">{t("adminRevenue.offer.ladder.empty")}</p>
      ) : (
        <div className="space-y-4">
          {subscriptionsHidden ? (
            <p className="m-0 text-xs text-muted-foreground">
              {t("adminRevenue.finance.offer.activeSubscriptionsAdminOnly")}
            </p>
          ) : null}
          {groups.map(([currency, list]) => (
            <div key={currency} data-currency={currency} className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="pb-1 text-left text-xs font-medium text-foreground">
                  {t("adminRevenue.offer.ladder.caption", { currency })}
                </caption>
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th scope="col" className="py-1 pr-3 font-medium">
                      {t("adminRevenue.offer.ladder.tier")}
                    </th>
                    <th scope="col" className="py-1 pr-3 font-medium">
                      {t("adminRevenue.offer.ladder.interval")}
                    </th>
                    <th scope="col" className="py-1 pr-3 text-right font-medium">
                      {t("adminRevenue.offer.ladder.price")}
                    </th>
                    <th scope="col" className="py-1 pr-3 font-medium">
                      {t("adminRevenue.offer.ladder.sale")}
                    </th>
                    <th scope="col" className="py-1 pr-3 font-medium">
                      {t("adminRevenue.offer.ladder.issues")}
                    </th>
                    <th scope="col" className="py-1 text-right font-medium">
                      {t("adminRevenue.offer.ladder.subscriptions")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {list.map((plan) => {
                    const interval = INTERVAL_KEY[plan.interval];
                    return (
                      <tr key={plan.planId} data-plan={plan.planId}>
                        <th scope="row" className="py-1 pr-3 text-left font-normal">
                          {plan.tierKey ?? t("adminRevenue.offer.ladder.noTier")}
                        </th>
                        <td className="py-1 pr-3">{interval ? t(interval) : plan.interval}</td>
                        <td className="py-1 pr-3 text-right tabular-nums">
                          {formatMoneyMinor(plan.priceCents, plan.currency, lang)}
                        </td>
                        <td className="py-1 pr-3">{t(saleKey(plan))}</td>
                        <td className="py-1 pr-3 text-xs">
                          {plan.issues.length === 0
                            ? t("adminRevenue.offer.ladder.noIssues")
                            : plan.issues.map((issue) => t(ISSUE_KEY[issue])).join("; ")}
                        </td>
                        <td className="py-1 text-right tabular-nums">
                          {plan.activeSubscriptions === null
                            ? "-"
                            : number.format(plan.activeSubscriptions)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      );
  }

  return (
    <section
      aria-labelledby={headingId}
      data-testid="price-ladder"
      className="min-w-0 space-y-2 rounded-[6px] border border-border p-3"
    >
      <div className="min-w-0 space-y-0.5">
        <h3 id={headingId} className="text-sm font-semibold">
          {t("adminRevenue.offer.ladder.title")}
        </h3>
        <p className="m-0 text-xs text-muted-foreground">
          {t("adminRevenue.offer.ladder.description")}
        </p>
      </div>
      {body}
    </section>
  );
}
