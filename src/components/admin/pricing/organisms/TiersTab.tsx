// Organizm: zakładka „Warstwy i benefity" panelu Cennika 2.0.
//
// Marketing warstw (`membership_tiers`) pogrupowany po segmencie: cztery
// liczniki na górze, karta na warstwę, a na końcu koszyk „nieprzypisane".
// Ten ostatni jest tu najważniejszy - warstwa wskazująca segment, którego nie
// ma w katalogu, NIE POKAZUJE SIĘ klientowi w żadnej zakładce cennika, więc
// panel musi ją wyświetlić osobno, zamiast po cichu pominąć.
//
// ZAPIS (S1 def. 11). Cennik jest JEDYNYM pisarzem kolumn marketingu warstwy
// (`TIER_MARKETING_COLUMNS`: nazwy, opisy, benefity, badge, CTA…), Członkostwo
// pisze rdzeń (klucz, ranga, bramki). Zapis idzie przez `useSaveTierMarketing`:
// patch WYŁĄCZNIE zmienionych kolumn i token `updated_at` wiersza, na którym
// redakcja zaczęła edycję. Dawny UPDATE pełnym marketingiem bez tokenu cofał
// zmiany z drugiej karty; teraz to jawny konflikt `40001` z akcją „Wczytaj
// aktualne", która nakłada szkic na świeży wiersz.
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Crown, Layers, ListChecks, Sparkles, Star, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PricingKpi } from "@/components/admin/pricing/atoms/PricingKpi";
import { TierMarketingCard } from "@/components/admin/pricing/molecules/TierMarketingCard";
import { showSaveError } from "@/components/admin/pricing/saveErrorToast";
import {
  marketingDraftFromTier,
  marketingDraftValid,
  marketingPatch,
  rebaseMarketingDraft,
  type TierMarketingEditorDraft,
} from "@/components/admin/pricing/tierMarketingDraft";
import { adminMembershipTiersQueryOptions } from "@/components/admin/membership/membershipQueries";
import { audienceIcon } from "@/components/pricing/audienceMeta";
import type { MembershipTierRow } from "@/lib/billing/tiers";
import { useSaveTierMarketing } from "@/lib/billing/tierMutations";
import { ensureI18n as ensurePaywallSyncI18n } from "@/lib/i18n-admin-paywall-sync";
import type { PricingAudienceRow } from "@/lib/pricing/queries";
import { groupTiersByAudience } from "@/lib/admin/tierGroups";
import { toastError } from "@/lib/toastError";

/**
 * Szkic jednej warstwy razem z wierszem, na którym redakcja zaczęła edycję.
 * Baza jest zamrożona w szkicu: odświeżenie katalogu (szyna, druga karta) NIE
 * podmienia tokenu pod niezapisanymi zmianami - inaczej zapis przeszedłby bez
 * konfliktu i nadpisał cudzą zmianę, której redakcja nie widziała.
 */
interface TierEdit {
  base: MembershipTierRow;
  draft: TierMarketingEditorDraft;
}

export function TiersTab({
  audiences,
  tiers,
}: {
  audiences: PricingAudienceRow[];
  tiers: MembershipTierRow[];
}) {
  ensurePaywallSyncI18n();
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const ta = (k: string, opts?: Record<string, unknown>) => t(`adminPricing.${k}`, opts);
  const qc = useQueryClient();
  const [edits, setEdits] = useState<Record<string, TierEdit>>({});
  const saveTier = useSaveTierMarketing();

  const dropEdit = (id: string) =>
    setEdits((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });

  // „Wczytaj aktualne" po konflikcie: świeży wiersz staje się nową bazą
  // (nowy token), a pola zmienione przez redakcję są nakładane na niego -
  // cudza zmiana innych pól zostaje, nasza nie ginie. `fetchQuery` ze
  // `staleTime: 0` czyta bazę TERAZ i tym samym wpisem odświeża katalog obu
  // paneli (Cennik i Członkostwo).
  const reload = async (id: string) => {
    try {
      const rows = await qc.fetchQuery({ ...adminMembershipTiersQueryOptions(), staleTime: 0 });
      const fresh = rows.find((tier) => tier.id === id);
      if (!fresh) {
        dropEdit(id);
        toast.error(ta("tiers.tierGone"));
        return;
      }
      setEdits((current) => {
        const edit = current[id];
        if (!edit) return current;
        return {
          ...current,
          [id]: { base: fresh, draft: rebaseMarketingDraft(edit.draft, edit.base, fresh) },
        };
      });
      toast.info(t("adminPaywall.sync.reloaded"));
    } catch (err) {
      toastError(err, "load");
    }
  };

  const save = async (edit: TierEdit) => {
    const patch = marketingPatch(edit.draft, edit.base);
    if (Object.keys(patch).length === 0) return;
    try {
      await saveTier.mutateAsync({
        id: edit.base.id,
        expectedUpdatedAt: edit.base.updated_at,
        patch,
      });
      toast.success(ta("toast.tierSaved"));
      dropEdit(edit.base.id);
    } catch (err) {
      showSaveError(err, t, () => void reload(edit.base.id));
    }
  };

  const knownKeys = useMemo(() => new Set(audiences.map((a) => a.key)), [audiences]);
  const groups = useMemo(() => groupTiersByAudience(tiers, knownKeys), [tiers, knownKeys]);

  const renderTierCard = (tier: MembershipTierRow) => {
    const edit = edits[tier.id] ?? { base: tier, draft: marketingDraftFromTier(tier) };
    const dirty = Object.keys(marketingPatch(edit.draft, edit.base)).length > 0;
    return (
      <TierMarketingCard
        key={tier.id}
        tier={tier}
        draft={edit.draft}
        audiences={audiences}
        saving={saveTier.isPending}
        canSave={dirty && marketingDraftValid(edit.draft)}
        onChange={(patch) =>
          setEdits((current) => {
            const prev = current[tier.id] ?? edit;
            return { ...current, [tier.id]: { ...prev, draft: { ...prev.draft, ...patch } } };
          })
        }
        onSave={() => void save(edit)}
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
