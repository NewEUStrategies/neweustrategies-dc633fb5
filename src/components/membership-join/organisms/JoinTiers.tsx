// Organizm: podgląd poziomów członkostwa. Dane pochodzą z tych samych
// zapytań co /pricing (membership_tiers + access_plans, oba scope'owane
// tenantem po stronie bazy), więc oferta nigdy się nie rozjeżdża między
// stroną "Dołącz do nas" a cennikiem.
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { billingKeys } from "@/lib/billing/keys";
import { fetchActivePlans } from "@/lib/billing/queries";
import { useCurrentTier, useMembershipTiers } from "@/lib/billing/tiers";
import type { MembershipTierRow } from "@/lib/billing/tiers";
import {
  availableIntervals,
  maxYearlySavingsPct,
  plansByTierKey,
  sortTiers,
  type BillingInterval,
} from "@/lib/pricing/selectors";
import { IntervalToggle } from "@/components/pricing/IntervalToggle";
import { TierCard } from "@/components/pricing/TierCard";
import { ContactSalesDialog } from "@/components/pricing/ContactSalesDialog";

/** Ile kart pokazujemy na tej stronie - reszta oferty żyje w cenniku. */
const MAX_CARDS = 3;

export function JoinTiers({ isAuthenticated }: { isAuthenticated: boolean }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;

  const tiersQ = useMembershipTiers();
  const plansQ = useQuery({ queryKey: billingKeys.plansActive(), queryFn: fetchActivePlans });
  const currentTier = useCurrentTier();

  const [interval, setIntervalValue] = useState<BillingInterval>("year");
  const [contactTier, setContactTier] = useState<MembershipTierRow | null>(null);
  const [contactOpen, setContactOpen] = useState(false);

  const plansAll = useMemo(() => plansQ.data ?? [], [plansQ.data]);
  const tiers = useMemo(
    () =>
      sortTiers(tiersQ.data ?? [])
        .filter((tier) => tier.key !== "supporter")
        .slice(0, MAX_CARDS),
    [tiersQ.data],
  );
  const plansMap = useMemo(() => plansByTierKey(plansAll), [plansAll]);
  const shownPlans = useMemo(
    () => tiers.flatMap((tier) => plansMap.get(tier.key) ?? []),
    [tiers, plansMap],
  );
  const intervalOptions = useMemo(() => availableIntervals(shownPlans), [shownPlans]);
  const effectiveInterval: BillingInterval = intervalOptions.includes(interval)
    ? interval
    : (intervalOptions[intervalOptions.length - 1] ?? interval);

  const gridCls =
    tiers.length <= 1
      ? "mx-auto grid max-w-md gap-6"
      : tiers.length === 2
        ? "mx-auto grid max-w-3xl gap-6 sm:grid-cols-2"
        : "grid gap-6 md:grid-cols-2 lg:grid-cols-3";

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
        {intervalOptions.length > 1 ? (
          <IntervalToggle
            value={effectiveInterval}
            onChange={setIntervalValue}
            savingsPct={maxYearlySavingsPct(shownPlans)}
            options={intervalOptions}
          />
        ) : null}
      </div>

      {tiers.length === 0 ? (
        <p className="mt-6 rounded-[6px] border border-dashed border-border/70 p-6 text-sm text-muted-foreground">
          {t("membershipJoin.tiers.empty")}
        </p>
      ) : (
        <div className={`mt-6 ${gridCls}`}>
          {tiers.map((tier) => (
            <TierCard
              key={tier.id}
              tier={tier}
              plans={plansMap.get(tier.key) ?? []}
              interval={effectiveInterval}
              lang={lang}
              isCurrentTier={currentTier.data?.key === tier.key}
              currentPlanId={null}
              isAuthenticated={isAuthenticated}
              onContact={(target) => {
                setContactTier(target);
                setContactOpen(true);
              }}
            />
          ))}
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
