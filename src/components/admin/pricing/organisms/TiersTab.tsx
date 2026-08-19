// Organizm: zakładka „Warstwy i benefity" panelu Cennika 2.0.
//
// Marketing warstw (`membership_tiers`) pogrupowany po segmencie: cztery
// liczniki na górze, karta na warstwę, a na końcu koszyk „nieprzypisane".
// Ten ostatni jest tu najważniejszy - warstwa wskazująca segment, którego nie
// ma w katalogu, NIE POKAZUJE SIĘ klientowi w żadnej zakładce cennika, więc
// panel musi ją wyświetlić osobno, zamiast po cichu pominąć.
//
// Wyniesione z pliku trasy `/admin/pricing` (1821 linii) bez zmiany zachowania.
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Crown, Layers, ListChecks, Sparkles, Star, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PricingKpi } from "@/components/admin/pricing/atoms/PricingKpi";
import { TierMarketingCard } from "@/components/admin/pricing/molecules/TierMarketingCard";
import { audienceIcon } from "@/components/pricing/audienceMeta";
import { supabase } from "@/integrations/supabase/client";
import { billingKeys } from "@/lib/billing/keys";
import { serializeTierBenefits, type MembershipTierRow } from "@/lib/billing/tiers";
import type { PricingAudienceRow } from "@/lib/pricing/queries";
import { NO_AUDIENCE, draftFromTier, type TierMarketingDraft } from "@/lib/admin/pricingDrafts";
import { groupTiersByAudience } from "@/lib/admin/tierGroups";

export function TiersTab({
  audiences,
  tiers,
}: {
  audiences: PricingAudienceRow[];
  tiers: MembershipTierRow[];
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const ta = (k: string, opts?: Record<string, unknown>) => t(`adminPricing.${k}`, opts);
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, TierMarketingDraft>>({});

  const saveTier = useMutation({
    mutationFn: async ({ id, draft }: { id: string; draft: TierMarketingDraft }) => {
      const { error } = await supabase
        .from("membership_tiers")
        .update({
          audience_key: draft.audience_key === NO_AUDIENCE ? null : draft.audience_key,
          badge_pl: draft.badge_pl.trim() || null,
          badge_en: draft.badge_en.trim() || null,
          highlight: draft.highlight,
          contact_url: draft.contact_url.trim() || null,
          cta_mode: draft.cta_mode,
          per_seat: draft.per_seat,
          price_note_pl: draft.price_note_pl.trim() || null,
          price_note_en: draft.price_note_en.trim() || null,
          benefits: serializeTierBenefits(draft.benefits),
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(ta("toast.tierSaved"));
      void qc.invalidateQueries({ queryKey: billingKeys.admin.membershipTiers() });
      void qc.invalidateQueries({ queryKey: billingKeys.membershipTiers() });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const knownKeys = useMemo(() => new Set(audiences.map((a) => a.key)), [audiences]);
  const groups = useMemo(() => groupTiersByAudience(tiers, knownKeys), [tiers, knownKeys]);

  const renderTierCard = (tier: MembershipTierRow) => {
    const draft = drafts[tier.id] ?? draftFromTier(tier);
    return (
      <TierMarketingCard
        key={tier.id}
        tier={tier}
        draft={draft}
        audiences={audiences}
        saving={saveTier.isPending}
        onChange={(patch) => setDrafts((d) => ({ ...d, [tier.id]: { ...draft, ...patch } }))}
        onSave={() => saveTier.mutate({ id: tier.id, draft })}
      />
    );
  };

  const totalTiers = tiers.length;
  const highlighted = tiers.filter((tier) => tier.highlight).length;
  const assignedTiers = tiers.filter(
    (tier) => tier.audience_key && knownKeys.has(tier.audience_key),
  ).length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <PricingKpi icon={Layers} label={ta("tabs.tiers")} value={totalTiers} tone="primary" />
        <PricingKpi icon={Users} label={ta("tabs.audiences")} value={audiences.length} tone="sky" />
        <PricingKpi icon={Star} label={ta("tiers.highlight")} value={highlighted} tone="amber" />
        <PricingKpi
          icon={ListChecks}
          label={ta("tiers.assigned")}
          value={`${assignedTiers}/${totalTiers}`}
          tone="emerald"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 bg-gradient-to-r from-primary/5 via-transparent to-transparent px-3 py-2.5">
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
          {ta("tiers.coreHint")}
        </p>
        <Button asChild size="sm" variant="outline" className="h-8">
          <Link to="/admin/membership">
            <Crown className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {ta("tiers.openMembership")}
          </Link>
        </Button>
      </div>

      {audiences.map((audience) => {
        const list = groups.byAudience.get(audience.key) ?? [];
        if (list.length === 0) return null;
        const Icon = audienceIcon(audience.icon);
        return (
          <section key={audience.key} className="space-y-3">
            <div className="flex items-center gap-3 rounded-md border border-border/60 bg-card px-3 py-2.5">
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"
                aria-hidden="true"
              >
                <Icon className="h-[18px] w-[18px]" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-sm font-semibold text-foreground">
                  {lang === "en" ? audience.name_en : audience.name_pl}
                </h2>
                <p className="truncate font-mono text-[11px] text-muted-foreground">
                  {audience.key}
                </p>
              </div>
              <span className="inline-flex items-center gap-1 rounded-[6px] bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                <Layers className="h-3 w-3" aria-hidden="true" />
                {list.length}
              </span>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">{list.map(renderTierCard)}</div>
          </section>
        );
      })}

      {groups.unassigned.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-3 rounded-md border border-dashed border-border/70 bg-muted/30 px-3 py-2.5">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
              aria-hidden="true"
            >
              <Layers className="h-[18px] w-[18px]" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-sm font-semibold text-foreground">
                {ta("tiers.unassigned")}
              </h2>
              <p className="truncate text-[11px] text-muted-foreground">
                {ta("tiers.unassignedHint")}
              </p>
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">{groups.unassigned.map(renderTierCard)}</div>
        </section>
      )}
    </div>
  );
}
