// Zakładka „Dostęp" huba - ZAŚLEPKA wycinka I0; właściciel po scaleniu: S7.
//
// Montuje ją leniwie `RevenueTabOutlet` (mapa `tab -> lazy`), więc kod zakładki
// trafia do własnego chunku dopiero po wejściu na `/admin/revenue/access`.
//
// I9a (2026-10-20, zmiana integratorska): hub stoi już w nawigacji panelu,
// więc zamiast jednego zdania zakładka pokazuje stan „w przygotowaniu" -
// co tu będzie, etap i odnośniki do modułów, które trzymają te dane dziś
// (`RevenueTabPreparing`, dane w `lib/admin/revenue/tabPreparing.ts`).
// S7 podmienia tę treść i usuwa wpis zakładki z `TAB_PREPARING`.
import { RevenueTabPreparing } from "@/components/admin/revenue/molecules/RevenueTabPreparing";

export function RevenueAccessTab() {
  return (
    <div data-testid="revenue-tab-access">
      <RevenueTabPreparing tab="access" />
    </div>
  );
}
