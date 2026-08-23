import { createFileRoute } from "@tanstack/react-router";
import { AdminShell } from "@/components/admin/AdminShell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTranslation } from "react-i18next";
import { ensureI18n as ensureAdsAdminI18n } from "@/lib/i18n-ads-admin";
import { AdPlacementsPanel } from "@/components/admin/ads/organisms/AdPlacementsPanel";
import { AdSlotsPanel } from "@/components/admin/ads/organisms/AdSlotsPanel";
import { AdStatsPanel } from "@/components/admin/ads/organisms/AdStatsPanel";

// Panel reklam: sloty, ich rozmieszczenie i statystyki emisji.
//
// Trasa jest KOMPOZYCJĄ - cała treść mieszka w `components/admin/ads/**`
// (atomy / molekuły / organizmy), bo panel miał 807 linii i 71 funkcji w jednym
// pliku przy zerowym pokryciu: dowód "co ten panel wysyła do bazy" nie miał jak
// stanąć taniej niż render całej trasy. Nagłówek `robots: noindex` NIE jest
// deklarowany tutaj - przychodzi z `routes/admin.tsx` i scala się w dół po
// dopasowanym łańcuchu tras (jedno miejsce dla wszystkich tras panelu).
export const Route = createFileRoute("/admin/ads")({ component: AdsAdmin });

function AdsAdmin() {
  // Rejestracja słowników w chunku trasy (nie w entry) - patrz lib/i18n-*.
  ensureAdsAdminI18n();
  const { t } = useTranslation();
  return (
    <AdminShell hideSidebar>
      <div className="space-y-6">
        <header>
          <h1 className="font-display text-2xl font-bold">{t("adsAdmin.title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("adsAdmin.subtitle")}</p>
        </header>
        <Tabs defaultValue="slots">
          <TabsList>
            <TabsTrigger value="slots">{t("adsAdmin.tabs.slots")}</TabsTrigger>
            <TabsTrigger value="placements">{t("adsAdmin.tabs.placements")}</TabsTrigger>
            <TabsTrigger value="stats">{t("adsAdmin.tabs.stats")}</TabsTrigger>
          </TabsList>
          <TabsContent value="slots" className="mt-4">
            <AdSlotsPanel />
          </TabsContent>
          <TabsContent value="placements" className="mt-4">
            <AdPlacementsPanel />
          </TabsContent>
          <TabsContent value="stats" className="mt-4">
            <AdStatsPanel />
          </TabsContent>
        </Tabs>
      </div>
    </AdminShell>
  );
}
