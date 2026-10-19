// Wybór zakładki huba po parametrze `$tab` - jedna mapa `tab -> lazy(...)`.
//
// DLACZEGO MAPA LENIWYCH ZAKŁADEK, A NIE DZIESIĘĆ PLIKÓW TRAS. Trasa
// `/admin/revenue/$tab` jest jedna: nagłówek (`HEADS`) i odmowa nieznanej
// zakładki (`beforeLoad` -> `notFound()`) stoją w jej powłoce, a treść każdej
// zakładki jedzie w osobnym chunku pobieranym dopiero po wejściu na nią.
// Admin, który otwiera Lejek, nie płaci za kod Retencji ani Wskaźników
// (D-08 wariant B: leniwe karty zamiast podnoszenia budżetu bundla).
//
// `overview` NIE MA TU WPISU. Kokpit to indeks huba (`/admin/revenue/`), a jego
// adres z parametrem (`/admin/revenue/overview`) trasa odrzuca jako 404, żeby
// jeden ekran nie miał dwóch adresów.
//
// `Record` po typie zakładek, a nie zwykły obiekt: dopisanie zakładki do
// `REVENUE_TABS` (`lib/revenue/search.ts`) bez wpisu tutaj nie skompiluje się,
// zamiast dać pustą stronę pod poprawnym adresem.
import { Suspense, lazy, type ComponentType, type LazyExoticComponent } from "react";

import { RevenueTabPending } from "@/components/admin/revenue/atoms/RevenueTabPending";
import type { RevenueTabId } from "@/lib/revenue/search";

/** Zakładki montowane przez `/admin/revenue/$tab` (bez kokpitu - to indeks). */
export type RevenueHubTabId = Exclude<RevenueTabId, "overview">;

const TABS: Record<RevenueHubTabId, LazyExoticComponent<ComponentType>> = {
  mrr: lazy(() => import("./RevenueMrrTab").then((m) => ({ default: m.RevenueMrrTab }))),
  funnel: lazy(() => import("./RevenueFunnelTab").then((m) => ({ default: m.RevenueFunnelTab }))),
  retention: lazy(() =>
    import("./RevenueRetentionTab").then((m) => ({ default: m.RevenueRetentionTab })),
  ),
  community: lazy(() =>
    import("./RevenueCommunityTab").then((m) => ({ default: m.RevenueCommunityTab })),
  ),
  diagnostics: lazy(() =>
    import("./RevenueDiagnosticsTab").then((m) => ({ default: m.RevenueDiagnosticsTab })),
  ),
  offer: lazy(() => import("./RevenueOfferTab").then((m) => ({ default: m.RevenueOfferTab }))),
  access: lazy(() => import("./RevenueAccessTab").then((m) => ({ default: m.RevenueAccessTab }))),
  journeys: lazy(() =>
    import("./RevenueJourneysTab").then((m) => ({ default: m.RevenueJourneysTab })),
  ),
  metrics: lazy(() =>
    import("./RevenueMetricsTab").then((m) => ({ default: m.RevenueMetricsTab })),
  ),
  // „Dane wejściowe" to podwidok Wskaźników (SPEC §2.2), ale z własnym adresem
  // - ⌘K prowadzi do siatki planu wprost (SPEC §2.4), nie przez Wskaźniki.
  inputs: lazy(() => import("./RevenueInputsTab").then((m) => ({ default: m.RevenueInputsTab }))),
};

export function RevenueTabOutlet({ tab }: { tab: RevenueHubTabId }) {
  const Tab = TABS[tab];
  return (
    <Suspense fallback={<RevenueTabPending />}>
      <Tab />
    </Suspense>
  );
}
