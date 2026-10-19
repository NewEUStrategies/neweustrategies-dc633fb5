// Organizm: pasek liczników nagłówka /admin/paywall (reużywa go hub S7).
//
// CO NAPRAWIA (DIAGNOZA paywalla #5). Kafel licznika artykułów pokazywał
// STAŁE „Skonfigurowane" - także wtedy, gdy licznik był wyłączony albo
// najemca nigdy go nie zapisał (serwer bez wiersza `metering_settings` nie
// liczy niczego). Teraz kafel czyta stan serwera tym samym `queryOptions`
// co karta ustawień (`meteringSettingsQueryOptions`, klucz z fabryki, który
// odświeża szyna) i mówi jedno z trzech: włączony z limitem / wyłączony /
// brak konfiguracji. Błąd odczytu to osobny stan - nie „wyłączony".
//
// Liczby planów idą z `adminPlansAllQueryOptions()` (ten sam wpis cache co
// katalog planów), więc zapis w edytorze odświeża pasek bez drugiego zapytania.
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Activity, CreditCard, Gauge, Layers, ShoppingCart } from "lucide-react";

import { KpiTile } from "@/components/admin/membership/atoms/KpiTile";
import { meteringSettingsQueryOptions } from "@/lib/access/metering";
import { meteringServerState } from "@/lib/access/meteringQueries";
import { adminPlansAllQueryOptions } from "@/lib/billing/planQueries";
import { ensureI18n } from "@/lib/i18n-admin-paywall-sync";

export function PaywallKpiStrip() {
  ensureI18n();
  const { t } = useTranslation();
  const plansQ = useQuery(adminPlansAllQueryOptions());
  const meteringQ = useQuery(meteringSettingsQueryOptions());
  const plans = plansQ.data ?? [];
  // Przed pierwszą odpowiedzią liczby planów są nieznane - „-", nie „0".
  const count = (n: number) => (plansQ.data ? String(n) : "-");
  const currencies = Array.from(new Set(plans.map((p) => p.currency.toUpperCase())));

  let metering: string;
  if (meteringQ.isError) metering = t("adminPaywall.kpi.meteringUnknown");
  else if (meteringQ.data === undefined) metering = "-";
  else {
    const state = meteringServerState(meteringQ.data);
    metering =
      state.kind === "missing"
        ? t("adminPaywall.kpi.meteringMissing")
        : state.settings.enabled
          ? t("adminPaywall.kpi.meteringOn", { limit: state.settings.member_monthly_limit })
          : t("adminPaywall.kpi.meteringOff");
  }

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      <KpiTile icon={Layers} label={t("adminPaywall.kpi.plans")} value={count(plans.length)} />
      <KpiTile
        icon={Activity}
        label={t("adminPaywall.kpi.active")}
        value={count(plans.filter((p) => p.active).length)}
      />
      <KpiTile
        icon={ShoppingCart}
        label={t("adminPaywall.kpi.forSale")}
        value={count(plans.filter((p) => p.active && p.for_sale).length)}
      />
      <KpiTile
        icon={CreditCard}
        label={t("adminPaywall.kpi.currencies")}
        value={currencies.join(" / ") || "-"}
      />
      <KpiTile icon={Gauge} label={t("adminPaywall.kpi.metering")} value={metering} />
    </div>
  );
}
