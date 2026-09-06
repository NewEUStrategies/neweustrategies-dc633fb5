// /admin/analytics/bi - JEDNO miejsce z kompletem dashboardów modułu 17.
//
// Przegląd (/admin/analytics) trzyma zakładki i status źródeł; ten ekran
// układa wszystkie dashboardy BI jeden pod drugim, żeby dało się je czytać
// i eksportować bez przeklikiwania tabów. Każdy dashboard jest ładowany
// leniwie - ECharts nigdy nie wchodzi do grafu SSR.
import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { BarChart3, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { ensureI18n as ensureAnalyticsI18n } from "@/lib/i18n-admin-analytics";
import { ensureI18n as ensureExtrasI18n } from "@/lib/i18n-admin-extras";
import { getAnalyticsStatus } from "@/lib/analytics/status.functions";

const VitalsBiDashboard = lazy(() =>
  import("@/components/admin/analytics/VitalsBiDashboard").then((m) => ({
    default: m.VitalsBiDashboard,
  })),
);
const AudienceSegmentsDashboard = lazy(() =>
  import("@/components/admin/analytics/AudienceSegmentsDashboard").then((m) => ({
    default: m.AudienceSegmentsDashboard,
  })),
);
const ClientErrorsDashboard = lazy(() =>
  import("@/components/admin/analytics/ClientErrorsDashboard").then((m) => ({
    default: m.ClientErrorsDashboard,
  })),
);
const GscBiDashboard = lazy(() =>
  import("@/components/admin/analytics/GscBiDashboard").then((m) => ({
    default: m.GscBiDashboard,
  })),
);
const Ga4BiDashboard = lazy(() =>
  import("@/components/admin/analytics/Ga4BiDashboard").then((m) => ({
    default: m.Ga4BiDashboard,
  })),
);
const FooterAnalyticsPanel = lazy(() =>
  import("@/components/admin/analytics/FooterAnalyticsPanel").then((m) => ({
    default: m.FooterAnalyticsPanel,
  })),
);

export const Route = createFileRoute("/admin/analytics/bi")({
  head: () => ({
    meta: [
      { title: "BI - wszystkie dashboardy | Admin" },
      {
        name: "description",
        content:
          "Web Vitals, audytorium, błędy przeglądarki, Search Console, GA4 i stopka - komplet dashboardów BI.",
      },
    ],
  }),
  component: AnalyticsBiPage,
});

function Fallback() {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-center py-10 text-muted-foreground text-sm">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      {t("adminAnalytics.common.loadingData")}
    </div>
  );
}

function AnalyticsBiPage() {
  ensureAnalyticsI18n();
  ensureExtrasI18n();
  const { t } = useTranslation();
  const fetchStatus = useServerFn(getAnalyticsStatus);
  const statusQ = useQuery({
    queryKey: ["analytics-status"],
    queryFn: () => fetchStatus(),
    staleTime: 30_000,
  });

  return (
    <div className="p-4 md:p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <BarChart3 className="w-6 h-6" />
          {t("adminAnalytics.bi.title")}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{t("adminAnalytics.bi.subtitle")}</p>
      </header>

      <Suspense fallback={<Fallback />}>
        <VitalsBiDashboard />
      </Suspense>

      <Suspense fallback={<Fallback />}>
        <ClientErrorsDashboard />
      </Suspense>

      <Suspense fallback={<Fallback />}>
        <AudienceSegmentsDashboard />
      </Suspense>

      <Suspense fallback={<Fallback />}>
        <GscBiDashboard configured={statusQ.data?.gsc.configured ?? false} />
      </Suspense>

      <Suspense fallback={<Fallback />}>
        <Ga4BiDashboard
          configured={statusQ.data?.ga4.configured ?? false}
          activeMode={statusQ.data?.ga4.activeMode ?? undefined}
        />
      </Suspense>

      <Suspense fallback={<Fallback />}>
        <FooterAnalyticsPanel />
      </Suspense>
    </div>
  );
}
