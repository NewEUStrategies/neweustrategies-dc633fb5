// RUCH WŁASNY I POCHODZENIE GEOGRAFICZNE - dashboard dla /admin/analytics.
//
// PO CO TO TU, SKORO JEST NA PULPICIE. Bo zakładka-matka nie miała tego wcale.
// Warsztat BI mierzył dotąd SZYBKOŚĆ strony (Web Vitals), JEJ AWARIE (błędy
// przeglądarki), WIDOCZNOŚĆ w wyszukiwarce (GSC) i ruch WIDZIANY PRZEZ GA4 -
// ale nie miał ani jednego widoku ruchu z POMIARU WŁASNEGO, ani mapy krajów.
// Pulpit, który by je pokazywał, a warsztat nie, tworzyłby liczbę bez drugiego
// miejsca do sprawdzenia; stąd ten dashboard, złożony z TYCH SAMYCH paneli, co
// sekcja pulpitu, i czytający TĘ SAMĄ funkcję serwerową. Rozjazd między nimi
// jest więc niewyrażalny.
//
// RÓŻNICA WOBEC GA4 JEST CELOWA I WARTO JĄ WIDZIEĆ OBOK. GA4 mierzy populację
// ze zgodą marketingową i własnym modelem sesji; ten pomiar - populację ze
// zgodą analityczną i naszym modelem. Dwie liczby ruchu, które się nie zgadzają,
// są normalne; zaskoczeniem byłoby, gdyby się zgadzały co do sesji.
import { useState } from "react";
import { useTranslation } from "react-i18next";

import "@/lib/i18n-admin-dashboard";
import { DashboardPeriodTabs } from "@/components/admin/dashboard/DashboardPeriodTabs";
import { DashboardSection } from "@/components/admin/dashboard/DashboardSection";
import { TrafficPanel } from "@/components/admin/dashboard/TrafficPanel";
import { GeoPanel } from "@/components/admin/dashboard/GeoPanel";
import {
  useCrmQuery,
  useDashboardRange,
  useTrafficQuery,
} from "@/components/admin/dashboard/useDashboardData";
import type { DashboardPeriodId } from "@/lib/admin/dashboard/period";

export function TrafficGeoDashboard() {
  const { t } = useTranslation();
  // Warsztat startuje od MIESIĄCA, tak jak pulpit: to jest najkrótsze okno,
  // w którym szereg dzienny ma kształt, a nie kilka słupków.
  const [period, setPeriod] = useState<DashboardPeriodId>("month");
  const range = useDashboardRange(period);
  const traffic = useTrafficQuery(range);
  // Kontakty CRM są tu WYŁĄCZNIE dla drugiej warstwy mapy ("skąd są ludzie",
  // obok "skąd nas czytają"). Lejka i zadań ten ekran nie pokazuje - od tego
  // jest /admin/crm.
  const crm = useCrmQuery(range);

  return (
    <div className="space-y-4">
      <DashboardPeriodTabs value={period} onChange={setPeriod} />

      <DashboardSection
        title={t("adminDashboard.traffic.title")}
        subtitle={t("adminDashboard.traffic.subtitle")}
        isPending={traffic.isPending}
        isError={traffic.isError}
        onRetry={() => void traffic.refetch()}
        unavailable={traffic.data?.available === false}
      >
        {traffic.data ? <TrafficPanel report={traffic.data.report} range={range} /> : null}
      </DashboardSection>

      <DashboardSection
        title={t("adminDashboard.geo.title")}
        subtitle={t("adminDashboard.geo.subtitle")}
        isPending={traffic.isPending || crm.isPending}
        isError={traffic.isError}
        onRetry={() => void traffic.refetch()}
      >
        <GeoPanel
          traffic={traffic.data?.report.countries ?? []}
          leads={crm.data?.report.countries ?? []}
        />
      </DashboardSection>
    </div>
  );
}
