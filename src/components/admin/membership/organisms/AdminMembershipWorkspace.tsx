// Organizm: cały panel warstw członkostwa.
//
// Cztery obszary w zakładkach:
//   Katalog warstw    nazwy, opisy, ranga, benefity i możliwości maszynowe,
//   Mapowanie planów  `access_plans.tier_key` - co klient dostaje za zakup,
//   Nadania           członkostwo poza planem (darowizna, faktura, import),
//   Organizacje       skok do panelu organizacji i uzgodnienie z Confluence.
//
// Marketing warstw (badge, wyróżnienie, segment, benefity na stronie cennika)
// należy do `/admin/pricing` - tutaj go NIE MA świadomie, żeby dwa panele nie
// zapisywały tych samych kolumn.
//
// Tu mieszkają WYŁĄCZNIE trzy zapytania wspólne dla zakładek, mutacje katalogu
// i kompozycja; zawartość zakładek to osobne molekuły i organizmy.
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Crown, Gift, Landmark, Layers, ShieldCheck, Tag } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { KpiTile } from "@/components/admin/membership/atoms/KpiTile";
import { SectionCard } from "@/components/admin/membership/atoms/SectionCard";
import { NewTierDialog } from "@/components/admin/membership/molecules/NewTierDialog";
import { PlanTierMappingList } from "@/components/admin/membership/molecules/PlanTierMappingList";
import { TierEditorCard } from "@/components/admin/membership/molecules/TierEditorCard";
import { GrantsSection } from "@/components/admin/membership/organisms/GrantsSection";
import { ConfluenceReconciliationCard } from "@/components/admin/pricing/ConfluenceReconciliationCard";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { fetchMembershipGrants } from "@/lib/admin/membership-admin";
import {
  draftFromTier,
  parseFeaturesJson,
  InvalidFeaturesJsonError,
  type TierDraft,
} from "@/lib/admin/membershipDrafts";
import { billingKeys } from "@/lib/billing/keys";
import { fetchActivePlans } from "@/lib/billing/queries";
import { serializeTierBenefits } from "@/lib/billing/tiers";
import { toJson } from "@/lib/builder/types";

export function AdminMembershipWorkspace() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const tm = (k: string, opts?: Record<string, unknown>) => t(`adminMembership.${k}`, opts);
  const qc = useQueryClient();

  const tiersQ = useQuery({
    queryKey: billingKeys.admin.membershipTiers(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("membership_tiers")
        .select("*")
        .order("rank", { ascending: true });
      if (error) throw error;
      return data;
    },
  });
  const plansQ = useQuery({ queryKey: billingKeys.admin.plans(), queryFn: fetchActivePlans });
  const grantsPreviewQ = useQuery({
    queryKey: billingKeys.admin.membershipGrants(),
    queryFn: fetchMembershipGrants,
  });

  const [drafts, setDrafts] = useState<Record<string, TierDraft>>({});
  const tierOptions = useMemo(
    () => (tiersQ.data ?? []).filter((tier) => tier.active),
    [tiersQ.data],
  );

  const tiers = tiersQ.data ?? [];
  const activeTiersCount = tiers.filter((tt) => tt.active).length;
  const defaultTier = tiers.find((tt) => tt.is_default);
  const mappedPlansCount = (plansQ.data ?? []).filter((p) => p.tier_key).length;
  const activeGrantsCount = (grantsPreviewQ.data ?? []).filter((g) => !g.revoked_at).length;

  const saveTier = useMutation({
    mutationFn: async ({ id, draft }: { id: string; draft: TierDraft }) => {
      // Niepoprawny JSON PRZERYWA zapis - reguła rzuca, tu tylko tłumaczymy
      // komunikat na język panelu.
      let features: Json;
      try {
        features = parseFeaturesJson(draft.features);
      } catch (err) {
        if (err instanceof InvalidFeaturesJsonError) throw new Error(tm("toast.featuresInvalid"));
        throw err;
      }
      const { error } = await supabase
        .from("membership_tiers")
        .update({
          name_pl: draft.name_pl.trim(),
          name_en: draft.name_en.trim(),
          description_pl: draft.description_pl.trim() || null,
          description_en: draft.description_en.trim() || null,
          rank: draft.rank,
          benefits: serializeTierBenefits(draft.benefits),
          features,
          active: draft.active,
          is_default: draft.is_default,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(tm("toast.tierSaved"));
      void qc.invalidateQueries({ queryKey: billingKeys.admin.membershipTiers() });
      void qc.invalidateQueries({ queryKey: billingKeys.membershipTiers() });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteTier = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("membership_tiers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(tm("toast.tierDeleted"));
      void qc.invalidateQueries({ queryKey: billingKeys.admin.membershipTiers() });
      void qc.invalidateQueries({ queryKey: billingKeys.membershipTiers() });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const createTier = useMutation({
    mutationFn: async (input: { key: string; rank: number; name_pl: string; name_en: string }) => {
      // tenant_id wymuszony przez politykę RLS - pobierz z istniejącej warstwy
      const existing = tiersQ.data?.[0];
      if (!existing) throw new Error(tm("toast.noTenant"));
      const { error } = await supabase.from("membership_tiers").insert({
        tenant_id: existing.tenant_id,
        key: input.key.trim(),
        rank: input.rank,
        name_pl: input.name_pl.trim(),
        name_en: input.name_en.trim(),
        benefits: toJson([]),
        features: {} as Json,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(tm("toast.tierCreated"));
      void qc.invalidateQueries({ queryKey: billingKeys.admin.membershipTiers() });
      void qc.invalidateQueries({ queryKey: billingKeys.membershipTiers() });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const savePlanTier = useMutation({
    mutationFn: async ({ planId, tierKey }: { planId: string; tierKey: string | null }) => {
      const { error } = await supabase
        .from("access_plans")
        .update({ tier_key: tierKey })
        .eq("id", planId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(tm("toast.planMappingSaved"));
      void qc.invalidateQueries({ queryKey: billingKeys.admin.plans() });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="space-y-6 p-6">
      {/* Header + KPI: szybki podgląd stanu katalogu warstw. */}
      <header className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 font-display text-2xl font-bold">
              <Crown className="h-6 w-6" aria-hidden="true" />
              {tm("title")}
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{tm("subtitle")}</p>
          </div>
          <NewTierDialog
            existingKeys={tiers.map((tt) => tt.key)}
            suggestedRank={(tiers.at(-1)?.rank ?? 0) + 10}
            onCreate={(v) => createTier.mutate(v)}
            isPending={createTier.isPending}
          />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <KpiTile
            icon={Layers}
            label={tm("kpi.tiers")}
            value={`${activeTiersCount} / ${tiers.length}`}
          />
          <KpiTile
            icon={ShieldCheck}
            label={tm("kpi.default")}
            value={defaultTier ? (lang === "pl" ? defaultTier.name_pl : defaultTier.name_en) : "-"}
          />
          <KpiTile
            icon={Tag}
            label={tm("kpi.mappedPlans")}
            value={`${mappedPlansCount} / ${(plansQ.data ?? []).length}`}
          />
          <KpiTile icon={Gift} label={tm("kpi.activeGrants")} value={String(activeGrantsCount)} />
        </div>
      </header>

      {/* Tabs porządkują 4 obszary: katalog warstw | mapowanie planów | nadania | organizacje. */}
      <Tabs defaultValue="tiers" className="w-full">
        <TabsList className="grid w-full grid-cols-2 gap-2 rounded-[6px] border border-border/60 bg-muted/50 p-1.5 shadow-sm sm:inline-flex sm:h-11 sm:w-auto sm:grid-cols-none sm:gap-1">
          <TabsTrigger
            value="tiers"
            className="h-10 gap-2 whitespace-nowrap rounded-[6px] px-3 text-xs font-medium text-muted-foreground transition-all hover:bg-muted/60 hover:text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm sm:h-8"
          >
            <Layers className="h-4 w-4 shrink-0" aria-hidden />
            <span className="truncate">{tm("tabs.tiers")}</span>
            <span className="ml-0.5 rounded-[4px] bg-muted px-1.5 py-0 text-[10px] font-semibold tabular-nums">
              {tiers.length}
            </span>
          </TabsTrigger>
          <TabsTrigger
            value="mapping"
            className="h-10 gap-2 whitespace-nowrap rounded-[6px] px-3 text-xs font-medium text-muted-foreground transition-all hover:bg-muted/60 hover:text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm sm:h-8"
          >
            <Tag className="h-4 w-4 shrink-0" aria-hidden />
            <span className="truncate">{tm("tabs.mapping")}</span>
          </TabsTrigger>
          <TabsTrigger
            value="grants"
            className="h-10 gap-2 whitespace-nowrap rounded-[6px] px-3 text-xs font-medium text-muted-foreground transition-all hover:bg-muted/60 hover:text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm sm:h-8"
          >
            <Gift className="h-4 w-4 shrink-0" aria-hidden />
            <span className="truncate">{tm("tabs.grants")}</span>
            <span className="ml-0.5 rounded-[4px] bg-muted px-1.5 py-0 text-[10px] font-semibold tabular-nums">
              {activeGrantsCount}
            </span>
          </TabsTrigger>
          <TabsTrigger
            value="orgs"
            className="h-10 gap-2 whitespace-nowrap rounded-[6px] px-3 text-xs font-medium text-muted-foreground transition-all hover:bg-muted/60 hover:text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm sm:h-8"
          >
            <Landmark className="h-4 w-4 shrink-0" aria-hidden />
            <span className="truncate">{tm("tabs.orgs")}</span>
          </TabsTrigger>
        </TabsList>

        {/* ————— WARSTWY ————— */}
        <TabsContent value="tiers" className="mt-4 space-y-4">
          <SectionCard
            icon={Layers}
            title={tm("sections.tiersTitle")}
            description={tm("sections.tiersDesc")}
            padded={false}
          >
            <div className="grid gap-4 p-5 lg:grid-cols-2">
              {tiers.map((tier) => {
                const draft = drafts[tier.id] ?? draftFromTier(tier);
                return (
                  <TierEditorCard
                    key={tier.id}
                    tier={tier}
                    draft={draft}
                    saving={saveTier.isPending}
                    deleting={deleteTier.isPending}
                    onChange={(patch) =>
                      setDrafts((d) => ({ ...d, [tier.id]: { ...draft, ...patch } }))
                    }
                    onSave={() => saveTier.mutate({ id: tier.id, draft })}
                    onDelete={() => deleteTier.mutate(tier.id)}
                  />
                );
              })}
            </div>
          </SectionCard>
        </TabsContent>

        {/* ————— MAPOWANIE PLANÓW ————— */}
        <TabsContent value="mapping" className="mt-4 space-y-4">
          <SectionCard icon={Tag} title={tm("mapping.heading")} description={tm("mapping.hint")}>
            <PlanTierMappingList
              plans={plansQ.data ?? []}
              tierOptions={tierOptions}
              lang={lang}
              saving={savePlanTier.isPending}
              onAssign={(planId, tierKey) => savePlanTier.mutate({ planId, tierKey })}
            />
          </SectionCard>
        </TabsContent>

        {/* ————— NADANIA ————— */}
        <TabsContent value="grants" className="mt-4 space-y-4">
          <GrantsSection lang={lang} tierOptions={tierOptions} />
        </TabsContent>

        {/* ————— ORGANIZACJE + CONFLUENCE ————— */}
        <TabsContent value="orgs" className="mt-4 space-y-4">
          <SectionCard icon={Landmark} title={tm("org.heading")} description={tm("org.hint")}>
            <Button asChild variant="outline" size="sm">
              <Link to="/admin/organizations">
                <Landmark className="mr-1.5 h-4 w-4" aria-hidden="true" />
                {tm("org.open")}
              </Link>
            </Button>
          </SectionCard>
          {/* Referencja tylko dla zespołu: uzgodnienie z modelem Confluence. */}
          <ConfluenceReconciliationCard lang={lang} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
