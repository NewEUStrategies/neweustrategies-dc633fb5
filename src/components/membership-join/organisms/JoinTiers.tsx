// Organizm: poziomy członkostwa na stronie "Dołącz do nas".
// Odwzorowanie 1:1 sekcji z /pricing - te same dane (pricing_audiences,
// membership_tiers, access_plans), ten sam przełącznik segmentów, ten sam
// przełącznik cyklu, spotlight „Co wyróżnia ten plan" i pasek Supportera.
// Różnica jest wyłącznie nagłówkowa (tytuł sekcji + link do pełnego cennika),
// żeby oferta nigdy nie rozjeżdżała się między stronami.
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { billingKeys } from "@/lib/billing/keys";
import { fetchActivePlans, fetchMySubscription } from "@/lib/billing/queries";
import { parseTierBenefits, useCurrentTier, useMembershipTiers } from "@/lib/billing/tiers";
import type { MembershipTierRow, TierBenefit } from "@/lib/billing/tiers";
import { usePricingAudiences } from "@/lib/pricing/queries";
import {
  audienceTagline,
  audienceTrust,
  availableIntervals,
  distinguishingBenefits,
  maxYearlySavingsPct,
  plansByTierKey,
  sortTiers,
  tiersForAudience,
  type BillingInterval,
} from "@/lib/pricing/selectors";
import { AudienceSwitcher } from "@/components/pricing/molecules/AudienceSwitcher";
import { audiencePanelId, audienceTabId } from "@/components/pricing/audienceMeta";
import { IntervalToggle } from "@/components/pricing/molecules/IntervalToggle";
import { TierCard } from "@/components/pricing/organisms/TierCard";
import { SupporterStrip } from "@/components/pricing/molecules/SupporterStrip";
import { ContactSalesDialog } from "@/components/pricing/organisms/ContactSalesDialog";

export function JoinTiers({ isAuthenticated }: { isAuthenticated: boolean }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { session } = useAuth();

  const audiencesQ = usePricingAudiences();
  const tiersQ = useMembershipTiers();
  const plansQ = useQuery({ queryKey: billingKeys.plansActive(), queryFn: fetchActivePlans });
  const mySub = useQuery({
    queryKey: billingKeys.mySubscription(session?.user?.id),
    queryFn: fetchMySubscription,
    enabled: !!session,
  });
  const currentTier = useCurrentTier();

  const [interval, setIntervalValue] = useState<BillingInterval>("year");
  const [audienceKey, setAudienceKey] = useState<string | null>(null);
  const [contactTier, setContactTier] = useState<MembershipTierRow | null>(null);
  const [contactOpen, setContactOpen] = useState(false);

  const audiences = useMemo(() => audiencesQ.data ?? [], [audiencesQ.data]);
  const tiersAll = useMemo(() => tiersQ.data ?? [], [tiersQ.data]);
  const plansAll = useMemo(() => plansQ.data ?? [], [plansQ.data]);

  const defaultAudienceKey = audiences[0]?.key ?? null;
  const activeKey =
    audienceKey && audiences.some((a) => a.key === audienceKey) ? audienceKey : defaultAudienceKey;
  const activeAudience = audiences.find((a) => a.key === activeKey) ?? null;

  const activeTiers = useMemo(
    () =>
      audiences.length > 0 && activeKey
        ? tiersForAudience(tiersAll, audiences, activeKey)
        : sortTiers(tiersAll),
    [tiersAll, audiences, activeKey],
  );
  const cardTiers = useMemo(
    () => activeTiers.filter((tier) => tier.key !== "supporter"),
    [activeTiers],
  );
  const supporterTier = activeTiers.find((tier) => tier.key === "supporter") ?? null;

  // Ten sam spotlight co w cenniku: benefity wyróżniające kartę względem
  // bezpośrednio niższej warstwy w segmencie.
  const cardHighlights = useMemo(() => {
    const parsed = cardTiers.map((tier) => parseTierBenefits(tier.benefits));
    const map = new Map<string, TierBenefit[]>();
    cardTiers.forEach((tier, index) => {
      map.set(
        tier.id,
        index > 0 ? distinguishingBenefits(parsed[index], parsed[index - 1], lang, 3) : [],
      );
    });
    return map;
  }, [cardTiers, lang]);

  const plansMap = useMemo(() => plansByTierKey(plansAll), [plansAll]);
  const audiencePlans = useMemo(
    () => cardTiers.flatMap((tier) => plansMap.get(tier.key) ?? []),
    [cardTiers, plansMap],
  );
  const intervalOptions = useMemo(() => availableIntervals(audiencePlans), [audiencePlans]);
  const showToggle = intervalOptions.length > 1;
  const effectiveInterval: BillingInterval = intervalOptions.includes(interval)
    ? interval
    : (intervalOptions[intervalOptions.length - 1] ?? interval);

  const currentPlanId = mySub.data?.plan_id ?? null;
  const currentTierKey = currentTier.data?.key ?? null;

  const gridCls =
    cardTiers.length <= 1
      ? "mx-auto grid max-w-md gap-6"
      : cardTiers.length === 2
        ? "mx-auto grid max-w-3xl gap-6 sm:grid-cols-2"
        : cardTiers.length === 3
          ? "grid gap-6 md:grid-cols-2 lg:grid-cols-3"
          : "grid gap-6 md:grid-cols-2 xl:grid-cols-4";

  const isLoading = audiencesQ.isLoading || tiersQ.isLoading || plansQ.isLoading;

  return (
    <section aria-labelledby="join-tiers" className="mt-14">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4 sm:flex sm:flex-wrap sm:justify-between">
        <div className="min-w-0">
          <h2
            id="join-tiers"
            className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl"
          >
            {t("membershipJoin.tiers.title")}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            {t("membershipJoin.tiers.subtitle")}
          </p>
        </div>
      </div>

      {audiences.length > 1 && activeKey && (
        <div className="mt-6">
          <AudienceSwitcher
            audiences={audiences}
            value={activeKey}
            onChange={setAudienceKey}
            lang={lang}
            label={t("pricing.segmentsAria")}
          />
        </div>
      )}

      {isLoading ? (
        <div className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-96 animate-pulse rounded-xl border border-border bg-muted/30"
            />
          ))}
        </div>
      ) : (
        <div
          key={activeKey ?? "all"}
          role={audiences.length > 1 && activeKey ? "tabpanel" : undefined}
          id={activeKey ? audiencePanelId(activeKey) : undefined}
          aria-labelledby={audiences.length > 1 && activeKey ? audienceTabId(activeKey) : undefined}
          className="animate-in fade-in slide-in-from-bottom-2 duration-300"
        >
          {activeAudience && audienceTagline(activeAudience, lang) && (
            <p className="mx-auto mt-6 max-w-2xl text-center text-base text-muted-foreground">
              {audienceTagline(activeAudience, lang)}
            </p>
          )}

          {activeAudience && audienceTrust(activeAudience, lang) && (
            <p className="mx-auto mt-3 max-w-2xl text-center text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {audienceTrust(activeAudience, lang)}
            </p>
          )}

          {showToggle && (
            <div className="mt-8">
              <IntervalToggle
                value={effectiveInterval}
                onChange={setIntervalValue}
                savingsPct={maxYearlySavingsPct(audiencePlans)}
                options={intervalOptions}
              />
            </div>
          )}

          {cardTiers.length === 0 ? (
            <p className="mt-8 rounded-[6px] border border-dashed border-border/70 p-6 text-sm text-muted-foreground">
              {t("membershipJoin.tiers.empty")}
            </p>
          ) : (
            <div className={`mt-10 ${gridCls}`}>
              {cardTiers.map((tier) => (
                <TierCard
                  key={tier.id}
                  tier={tier}
                  plans={plansMap.get(tier.key) ?? []}
                  interval={effectiveInterval}
                  lang={lang}
                  isCurrentTier={currentTierKey === tier.key}
                  currentPlanId={currentPlanId}
                  isAuthenticated={isAuthenticated}
                  onContact={(target) => {
                    setContactTier(target);
                    setContactOpen(true);
                  }}
                  highlights={cardHighlights.get(tier.id) ?? []}
                />
              ))}
            </div>
          )}

          {supporterTier && <SupporterStrip tier={supporterTier} lang={lang} />}
        </div>
      )}

      <div className="mt-6">
        <Button asChild variant="outline" className="gap-2">
          <Link to="/pricing">
            {t("membershipJoin.tiers.allPlans")}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </Button>
      </div>

      <ContactSalesDialog
        open={contactOpen}
        onOpenChange={setContactOpen}
        tier={contactTier}
        lang={lang}
      />
    </section>
  );
}
