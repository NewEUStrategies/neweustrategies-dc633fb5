/**
 * /admin/performance
 *
 * Pełny widok RUM w stylu BI: to samo źródło danych i te same wykresy co
 * na zakładce "Web Vitals" w `/admin/analytics`, z dodaną sekcją
 * interpretacji i rekomendacji. Trzymane w jednym komponencie
 * `VitalsBiDashboard`, żeby oba miejsca w panelu zawsze prezentowały
 * dokładnie ten sam layout, wykresy i wnioski.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Gauge } from "@/lib/lucide-shim";
import { VitalsBiDashboard } from "@/components/admin/analytics/VitalsBiDashboard";

export const Route = createFileRoute("/admin/performance")({
  component: PerformancePage,
});

function PerformancePage() {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-xl font-bold flex items-center gap-2">
          <Gauge className="w-5 h-5" />
          {t("admin.performance.title")}
        </h1>
        <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
          {t("admin.performance.subtitle")}
        </p>
      </div>
      <VitalsBiDashboard />
    </div>
  );
}
