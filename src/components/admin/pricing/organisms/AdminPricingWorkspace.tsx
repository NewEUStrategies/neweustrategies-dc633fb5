// Organizm: cały panel Cennika 2.0 - PREZENTACJA oferty na /pricing.
//
//   Segmenty            katalog odbiorców (pricing_audiences): nazwy, tagline,
//                       ikona, kolejność, aktywność, CRUD,
//   Warstwy i benefity  marketing warstw per segment (membership_tiers):
//                       przypisanie do segmentu, badge, wyróżnienie-kotwica,
//                       link kontaktowy i benefity NYT/FT (wspólny edytor
//                       z panelem Członkostwo - zero rozjazdów formatu),
//   FAQ                 pytania cennika (pricing_faq_items), globalne lub
//                       per segment, z kolejnością i aktywnością,
//   Retencja            kontroferta dla odchodzących i powody rezygnacji.
//
// Rangi, features (bramki) i mapowanie planów pozostają w /admin/membership.
//
// Tu mieszkają WYŁĄCZNIE trzy zapytania wspólne dla zakładek i kompozycja -
// każda zakładka jest osobnym organizmem, testowanym bez pozostałych.
//
// ZAKŁADKA Z ADRESU (SPEC §2.6). Trasa podaje `tab` z `?tab=` i zapisuje
// wybór z powrotem (`onTabChange`) - link z huba do `?tab=retention`
// i odświeżenie strony lądują na tej samej zakładce. Bez propsów (test
// organizmu, osadzenie bez routera) zakładka żyje w stanie komponentu.
//
// POWIĄZANE MODUŁY = WSPÓLNA MOLEKUŁA HUBA (I9, SPEC §2.7). Dawny lokalny pasek
// (przyciski z ikonami) zastępuje `RelatedModulesBar` - ten sam wzorzec skoków
// między modułami monetyzacji co w hubie „Przychód i lejek", z odnośnikiem do
// huba dla roli, która go widzi (`useRevenueHubTab`). Pod paskiem sygnał
// Diagnostyki obszarów cennika (lekkie opakowanie, leniwa treść).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { BadgePercent } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RelatedModulesBar } from "@/components/admin/revenue/molecules/RelatedModulesBar";
import { RevenueSignalChip } from "@/components/admin/revenue/molecules/RevenueSignalChip";
import { useRevenueHubTab } from "@/components/admin/revenue/molecules/useRevenueHubTab";
import { AudiencesTab } from "@/components/admin/pricing/organisms/AudiencesTab";
import { FaqTab } from "@/components/admin/pricing/organisms/FaqTab";
import { RetentionTab } from "@/components/admin/pricing/organisms/RetentionTab";
import { TiersTab } from "@/components/admin/pricing/organisms/TiersTab";
import { adminMembershipTiersQueryOptions } from "@/components/admin/membership/membershipQueries";
import { supabase } from "@/integrations/supabase/client";
import { billingKeys } from "@/lib/billing/keys";
import type { PricingAudienceRow, PricingFaqItemRow } from "@/lib/pricing/queries";
import { isPricingTab, type PricingTabId } from "@/lib/admin/pricingTabs";
import type { RelatedModule } from "@/lib/admin/revenue/hubTabs";

/** Moduły, które cennik spina - kolejność dawnego paska (kupony, członkostwo, paywall, pulpit). */
const PRICING_RELATED: readonly RelatedModule[] = [
  { to: "/admin/coupons", labelKey: "adminRevenue.related.coupons" },
  { to: "/admin/membership", labelKey: "adminRevenue.related.membership" },
  { to: "/admin/paywall", labelKey: "adminRevenue.related.paywall" },
  { to: "/admin/monetization", labelKey: "adminRevenue.related.dashboard" },
];
const HUB_RELATED: RelatedModule = { to: "/admin/revenue", labelKey: "adminRevenue.related.hub" };

export function AdminPricingWorkspace({
  tab,
  onTabChange,
}: {
  /** Zakładka z `?tab=`; brak = stan lokalny (domyślnie „Segmenty"). */
  tab?: PricingTabId;
  onTabChange?: (tab: PricingTabId) => void;
} = {}) {
  const { t } = useTranslation();
  const ta = (k: string, opts?: Record<string, unknown>) => t(`adminPricing.${k}`, opts);
  const hubVisible = useRevenueHubTab("overview");

  const audiencesQ = useQuery({
    queryKey: billingKeys.admin.pricingAudiences(),
    queryFn: async (): Promise<PricingAudienceRow[]> => {
      const { data, error } = await supabase
        .from("pricing_audiences")
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
  // Ten sam odczyt katalogu warstw co panel Członkostwa (jedno `queryOptions`).
  const tiersQ = useQuery(adminMembershipTiersQueryOptions());
  const faqQ = useQuery({
    queryKey: billingKeys.admin.pricingFaq(),
    queryFn: async (): Promise<PricingFaqItemRow[]> => {
      const { data, error } = await supabase
        .from("pricing_faq_items")
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const [localTab, setLocalTab] = useState<PricingTabId>("audiences");
  const activeTab = tab ?? localTab;
  const selectTab = (next: string) => {
    if (!isPricingTab(next)) return;
    setLocalTab(next);
    onTabChange?.(next);
  };

  const audiences = audiencesQ.data ?? [];
  const tiers = tiersQ.data ?? [];
  const faqItems = faqQ.data ?? [];

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <BadgePercent className="h-6 w-6" aria-hidden="true" />
          {ta("title")}
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{ta("subtitle")}</p>
        <RelatedModulesBar
          items={hubVisible ? [...PRICING_RELATED, HUB_RELATED] : PRICING_RELATED}
          className="mt-3"
        />
        <RevenueSignalChip surface="pricing" variant="bar" className="mt-3" />
      </header>

      <Tabs value={activeTab} onValueChange={selectTab}>
        <TabsList>
          <TabsTrigger value="audiences">{ta("tabs.audiences")}</TabsTrigger>
          <TabsTrigger value="tiers">{ta("tabs.tiers")}</TabsTrigger>
          <TabsTrigger value="faq">{ta("tabs.faq")}</TabsTrigger>
          <TabsTrigger value="retention">{ta("tabs.retention")}</TabsTrigger>
        </TabsList>
        <TabsContent value="audiences" className="mt-4">
          <AudiencesTab audiences={audiences} tiers={tiers} />
        </TabsContent>
        <TabsContent value="tiers" className="mt-4">
          <TiersTab audiences={audiences} tiers={tiers} />
        </TabsContent>
        <TabsContent value="faq" className="mt-4">
          <FaqTab audiences={audiences} items={faqItems} />
        </TabsContent>
        <TabsContent value="retention" className="mt-4">
          <RetentionTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
