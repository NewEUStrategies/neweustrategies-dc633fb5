// Zakładka „Dane wejściowe" huba - ZAŚLEPKA wycinka I0; właściciel po scaleniu: S7.
//
// Montuje ją leniwie `RevenueTabOutlet` (mapa `tab -> lazy`), więc kod zakładki
// trafia do własnego chunku dopiero po wejściu na `/admin/revenue/inputs`.
// Słownik rejestruje układ huba (`RevenueHubLayout`), który renderuje się
// przed każdą zakładką.
import { useTranslation } from "react-i18next";

export function RevenueInputsTab() {
  const { t } = useTranslation();
  return (
    <p data-testid="revenue-tab-inputs" className="text-sm text-muted-foreground">
      {t("adminRevenue.common.pending")}
    </p>
  );
}
