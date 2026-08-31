// Organizm: cala strona panelu reklam (naglowek + zakladki). Trasa
// `src/routes/admin.ads.tsx` jest juz tylko cienkim opakowaniem.
import { useTranslation } from "react-i18next";
import { AdminShell } from "@/components/admin/AdminShell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ensureI18n as ensureAdsAdminI18n } from "@/lib/i18n-ads-admin";
import { PlacementsPanel } from "./PlacementsPanel";
import { SlotsPanel } from "./SlotsPanel";
import { StatsPanel } from "./StatsPanel";

export function AdsAdmin() {
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
            <SlotsPanel />
          </TabsContent>
          <TabsContent value="placements" className="mt-4">
            <PlacementsPanel />
          </TabsContent>
          <TabsContent value="stats" className="mt-4">
            <StatsPanel />
          </TabsContent>
        </Tabs>
      </div>
    </AdminShell>
  );
}
