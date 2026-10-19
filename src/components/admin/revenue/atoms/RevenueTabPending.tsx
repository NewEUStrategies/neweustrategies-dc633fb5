// Atom: „sekcja huba się wczytuje" - jeden wygląd dla trzech chwil, w których
// hub nie ma jeszcze czego pokazać: render przed hydratacją (układ), chunk
// zakładki w drodze (granica `Suspense` w `RevenueTabOutlet`) i edytor ścieżki
// przed hydratacją.
//
// DLACZEGO `role="status"` + `aria-live="polite"`. Zakładki huba ładują się
// leniwie, więc po kliknięciu w pasek treść pojawia się z opóźnieniem. Czytnik
// ekranu bez regionu na żywo nie usłyszałby, że coś się dzieje - a po
// podmianie na treść zakładki usłyszy nową zawartość, nie ciszę.
//
// KLASY SKOPIOWANE Z `AdminCatalogListState` (stan wczytywania katalogu), a nie
// nowe: arkusz CSS panelu ma zapas ułamka kilobajta, a ten sam stan wygląda
// wtedy tak samo w każdym miejscu panelu.
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ensureI18n } from "@/lib/i18n-admin-revenue";

export function RevenueTabPending() {
  ensureI18n();
  const { t } = useTranslation();
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 text-sm text-muted-foreground"
    >
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      {t("adminRevenue.common.loading")}
    </div>
  );
}
