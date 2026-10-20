// Zakładka „Wskaźniki" huba - ZAŚLEPKA wycinka I0; właściciel po scaleniu: S7.
//
// Montuje ją leniwie `RevenueTabOutlet` (mapa `tab -> lazy`), więc kod zakładki
// trafia do własnego chunku dopiero po wejściu na `/admin/revenue/metrics`.
//
// I9a (2026-10-20, zmiana integratorska): hub stoi już w nawigacji panelu.
// Słownik wskaźników S6 (`MetricDictionary`) jest gotowym organizmem bez
// wymaganych danych wejściowych (definicje z rejestru w kodzie, benchmarki
// z server fn z bramką admin/redaktor - ta sama poprzeczka co hub), więc
// zakładka pokazuje go już teraz, a stan „w przygotowaniu" mówi tylko o tym,
// czego brakuje: bieżących wartości z oceną i kontekstu z adresu
// (`?metric=&ctx=`) - to S7, który podmienia tę treść.
//
// SŁOWNIK LENIWIE. `MetricDictionary` ciągnie rejestr wskaźników, indeks
// benchmarków i arkusz objaśnień; jako osobny chunk (ten sam, który ładuje
// sekcja BI) nie dokłada się do chunku zakładki, a stan „w przygotowaniu"
// maluje się bez czekania na niego.
import { Suspense, lazy } from "react";

import { RevenueTabPending } from "@/components/admin/revenue/atoms/RevenueTabPending";
import { RevenueTabPreparing } from "@/components/admin/revenue/molecules/RevenueTabPreparing";

const MetricDictionary = lazy(() =>
  import("@/components/admin/analytics/semantic/organisms/MetricDictionary").then((m) => ({
    default: m.MetricDictionary,
  })),
);

export function RevenueMetricsTab() {
  return (
    <div data-testid="revenue-tab-metrics" className="space-y-4">
      <RevenueTabPreparing tab="metrics" />
      <Suspense fallback={<RevenueTabPending />}>
        <MetricDictionary />
      </Suspense>
    </div>
  );
}
