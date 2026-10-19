// Zakładka „Lejek" huba - ZAŚLEPKA wycinka I0; właściciel po scaleniu: S7.
//
// Montuje ją leniwie `RevenueTabOutlet` (mapa `tab -> lazy`), więc kod zakładki
// trafia do własnego chunku dopiero po wejściu na `/admin/revenue/funnel`.
// Słownik rejestruje układ huba (`RevenueHubLayout`), który renderuje się
// przed każdą zakładką.
import { useTranslation } from "react-i18next";

export function RevenueFunnelTab() {
  const { t } = useTranslation();
  return (
    <p data-testid="revenue-tab-funnel" className="text-sm text-muted-foreground">
      {t("adminRevenue.common.pending")}
    </p>
  );
}
