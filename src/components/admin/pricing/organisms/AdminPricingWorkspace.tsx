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
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BadgePercent, Crown, LayoutDashboard, Lock, Megaphone } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AudiencesTab } from "@/components/admin/pricing/organisms/AudiencesTab";
import { FaqTab } from "@/components/admin/pricing/organisms/FaqTab";
import { RetentionTab } from "@/components/admin/pricing/organisms/RetentionTab";
import { TiersTab } from "@/components/admin/pricing/organisms/TiersTab";
import { supabase } from "@/integrations/supabase/client";
import { billingKeys } from "@/lib/billing/keys";
import type { MembershipTierRow } from "@/lib/billing/tiers";
import type { PricingAudienceRow, PricingFaqItemRow } from "@/lib/pricing/queries";

export function AdminPricingWorkspace() {
  const { t } = useTranslation();
  const ta = (k: string, opts?: Record<string, unknown>) => t(`adminPricing.${k}`, opts);

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
  const tiersQ = useQuery({
    queryKey: billingKeys.admin.membershipTiers(),
    queryFn: async (): Promise<MembershipTierRow[]> => {
      const { data, error } = await supabase
        .from("membership_tiers")
        .select("*")
        .order("rank", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
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
        {/* Cennik spina moduły monetyzacji - szybkie skoki do powiązanych paneli. */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">{ta("related.heading")}</span>
          <Button asChild size="sm" variant="outline" className="h-7">
            <Link to="/admin/coupons">
              <Megaphone className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              {ta("related.coupons")}
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline" className="h-7">
            <Link to="/admin/membership">
              <Crown className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              {ta("related.membership")}
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline" className="h-7">
            <Link to="/admin/paywall">
              <Lock className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              {ta("related.paywall")}
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline" className="h-7">
            <Link to="/admin/monetization">
              <LayoutDashboard className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              {ta("related.dashboard")}
            </Link>
          </Button>
        </div>
      </header>

      <Tabs defaultValue="audiences">
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
