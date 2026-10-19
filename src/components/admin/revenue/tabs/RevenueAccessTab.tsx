// Zakładka „Dostęp" huba - ZAŚLEPKA wycinka I0; właściciel po scaleniu: S7.
//
// Montuje ją leniwie `RevenueTabOutlet` (mapa `tab -> lazy`), więc kod zakładki
// trafia do własnego chunku dopiero po wejściu na `/admin/revenue/access`.
// Słownik rejestruje układ huba (`RevenueHubLayout`), który renderuje się
// przed każdą zakładką.
import { useTranslation } from "react-i18next";

export function RevenueAccessTab() {
  const { t } = useTranslation();
  return (
    <p data-testid="revenue-tab-access" className="text-sm text-muted-foreground">
      {t("adminRevenue.common.pending")}
    </p>
  );
}
