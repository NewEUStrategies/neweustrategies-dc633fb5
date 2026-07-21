/**
 * /admin/performance
 *
 * Centrum obserwowalności frontendowej w dwóch zakładkach:
 *  - "Web Vitals": pełny widok RUM w stylu BI - to samo źródło danych i te
 *    same wykresy co na zakładce "Web Vitals" w `/admin/analytics`
 *    (współdzielony `VitalsBiDashboard`, więc oba miejsca zawsze prezentują
 *    identyczny layout, wykresy i wnioski),
 *  - "Błędy przeglądarki": telemetria client_errors zgrupowana po
 *    znormalizowanym komunikacie (`ClientErrorsDashboard`) - domyka pętlę
 *    obserwowalności obok RUM.
 * Aktywna zakładka żyje w search params (?tab=errors), więc jest linkowalna.
 */
// UWAGA: bez side-effect importu "@/lib/i18n-admin-analytics" na poziomie
// trasy - config trasy (validateSearch/head) siedzi w EAGER grafie routera,
// więc taki import wciągnąłby cały słownik analityki do chunka wejściowego.
// Overlay rejestrują oba dashboardy (ten sam lazy chunk co komponent strony).
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Bug } from "lucide-react";
import { Gauge } from "@/lib/lucide-shim";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { VitalsBiDashboard } from "@/components/admin/analytics/VitalsBiDashboard";
import { ClientErrorsDashboard } from "@/components/admin/analytics/ClientErrorsDashboard";

const TABS = ["vitals", "errors"] as const;
type PerformanceTab = (typeof TABS)[number];

export const Route = createFileRoute("/admin/performance")({
  validateSearch: (s: Record<string, unknown>): { tab?: PerformanceTab } => ({
    tab: TABS.includes(s.tab as PerformanceTab) ? (s.tab as PerformanceTab) : undefined,
  }),
  component: PerformancePage,
});

function PerformancePage() {
  const { t } = useTranslation();
  const navigate = Route.useNavigate();
  const { tab = "vitals" } = Route.useSearch();

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
      <Tabs
        value={tab}
        onValueChange={(value) =>
          void navigate({
            search: { tab: value === "vitals" ? undefined : "errors" },
            replace: true,
          })
        }
      >
        <TabsList>
          <TabsTrigger value="vitals" className="gap-1.5">
            <Gauge className="h-3.5 w-3.5" aria-hidden />
            Web Vitals
          </TabsTrigger>
          <TabsTrigger value="errors" className="gap-1.5">
            <Bug className="h-3.5 w-3.5" aria-hidden />
            {t("adminAnalytics.clientErrors.title")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="vitals" className="mt-4">
          <VitalsBiDashboard />
        </TabsContent>
        <TabsContent value="errors" className="mt-4">
          <div className="space-y-3">
            <p className="max-w-2xl text-xs text-muted-foreground">
              {t("adminAnalytics.clientErrors.subtitle")}
            </p>
            <ClientErrorsDashboard />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
