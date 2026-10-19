// Zakładka „Kokpit" huba - ZAŚLEPKA wycinka I0; właściciel po scaleniu: S7.
//
// Montuje ją trasa indeksu `/admin/revenue/` (`admin.revenue.index.tsx`) - splitter
// tras wynosi ją do własnego chunku.
// Słownik rejestruje układ huba (`RevenueHubLayout`), który renderuje się
// przed każdą zakładką.
import { useTranslation } from "react-i18next";

export function RevenueOverviewTab() {
  const { t } = useTranslation();
  return (
    <p data-testid="revenue-tab-overview" className="text-sm text-muted-foreground">
      {t("adminRevenue.common.pending")}
    </p>
  );
}
