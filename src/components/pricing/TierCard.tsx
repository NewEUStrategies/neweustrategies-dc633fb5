// Karta warstwy członkostwa - serce Cennika 2.0. Cena zawsze uczciwa
// (framing miesięczny dla planów rocznych + realny % oszczędności), benefity
// w stylu NYT/FT, CTA zależne od danych: checkout, rejestracja (warstwa
// bezpłatna), wsparcie fundacji albo rozmowa z zespołem (oferty offline).
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { HandHeart, MessageCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatMoney, type AccessPlan } from "@/lib/billing/types";
import { parseTierBenefits, tierName, type MembershipTierRow } from "@/lib/billing/tiers";
import {
  intervalPair,
  monthlyEquivalentCents,
  pickPlanForInterval,
  tierBadge,
  yearlySavingsPct,
  type BillingInterval,
} from "@/lib/pricing/selectors";
import { TierBenefitList } from "./TierBenefitList";

function intervalSuffix(interval: AccessPlan["interval"], t: (key: string) => string): string {
  switch (interval) {
    case "day":
      return t("pricing.perDay");
    case "week":
      return t("pricing.perWeek");
    case "month":
      return t("pricing.perMonth");
    case "year":
      return t("pricing.perYear");
    case "one_time":
      return t("pricing.perOnce");
  }
}

function PriceBlock({
  tier,
  plans,
  interval,
  lang,
}: {
  tier: MembershipTierRow;
  plans: AccessPlan[];
  interval: BillingInterval;
  lang: string;
}) {
  const { t } = useTranslation();

  if (tier.is_default) {
    return (
      <div className="pt-4">
        <span className="text-4xl font-bold tracking-tight">{t("pricing.free")}</span>
        <p className="mt-1 text-xs text-muted-foreground">{t("pricing.freeNote")}</p>
      </div>
    );
  }

  const plan = pickPlanForInterval(plans, interval);
  if (!plan) {
    return (
      <div className="pt-4">
        <span className="text-2xl font-semibold tracking-tight">{t("pricing.onRequest")}</span>
        <p className="mt-1 text-xs text-muted-foreground">{t("pricing.onRequestNote")}</p>
      </div>
    );
  }

  if (plan.interval === "year") {
    const monthlyEq = monthlyEquivalentCents(plan);
    const pair = intervalPair(plans);
    const savings = yearlySavingsPct(pair.month, pair.year);
    return (
      <div className="pt-4">
        <span className="text-4xl font-bold tracking-tight">
          {formatMoney(monthlyEq ?? plan.price_cents, plan.currency, lang)}
        </span>
        <span className="ml-1 text-sm text-muted-foreground">{t("pricing.perMonth")}</span>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {t("pricing.billedYearly", {
            amount: formatMoney(plan.price_cents, plan.currency, lang),
          })}
          {savings !== null && (
            <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary">
              {t("pricing.savePct", { pct: savings })}
            </span>
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="pt-4">
      <span className="text-4xl font-bold tracking-tight">
        {formatMoney(plan.price_cents, plan.currency, lang)}
      </span>
      <span className="ml-1 text-sm text-muted-foreground">{intervalSuffix(plan.interval, t)}</span>
    </div>
  );
}

function TierCardCta({
  tier,
  plans,
  interval,
  isCurrentTier,
  currentPlanId,
  isAuthenticated,
  onContact,
}: {
  tier: MembershipTierRow;
  plans: AccessPlan[];
  interval: BillingInterval;
  isCurrentTier: boolean;
  currentPlanId: string | null;
  isAuthenticated: boolean;
  onContact: (tier: MembershipTierRow) => void;
}) {
  const { t } = useTranslation();

  if (tier.is_default) {
    if (isCurrentTier) {
      return (
        <Button className="w-full" disabled variant="outline">
          {t("pricing.currentTier")}
        </Button>
      );
    }
    if (!isAuthenticated) {
      return (
        <Button asChild className="w-full" variant="outline">
          <Link to="/login">{t("pricing.signupCta")}</Link>
        </Button>
      );
    }
    return null;
  }

  const plan = pickPlanForInterval(plans, interval);
  if (plan) {
    if (currentPlanId === plan.id || isCurrentTier) {
      return (
        <Button className="w-full" disabled variant="outline">
          {currentPlanId === plan.id ? t("pricing.current") : t("pricing.currentTier")}
        </Button>
      );
    }
    return (
      <Button asChild className="w-full" variant={tier.highlight ? "default" : "outline"}>
        <Link to="/checkout/$planId" params={{ planId: plan.id }}>
          {t("pricing.choose")}
        </Link>
      </Button>
    );
  }

  // Warstwa bez planu w sprzedaży samoobsługowej.
  if (tier.key === "supporter") {
    return (
      <Button asChild className="w-full" variant="outline">
        <Link to="/support" search={{ status: undefined }}>
          <HandHeart className="mr-2 h-4 w-4" aria-hidden="true" />
          {t("pricing.tiers.supporterCta")}
        </Link>
      </Button>
    );
  }
  if (isCurrentTier) {
    return (
      <Button className="w-full" disabled variant="outline">
        {t("pricing.currentTier")}
      </Button>
    );
  }
  if (tier.contact_url) {
    return (
      <Button asChild className="w-full" variant={tier.highlight ? "default" : "outline"}>
        <a href={tier.contact_url}>
          <MessageCircle className="mr-2 h-4 w-4" aria-hidden="true" />
          {t("pricing.contactCta")}
        </a>
      </Button>
    );
  }
  return (
    <Button
      className="w-full"
      variant={tier.highlight ? "default" : "outline"}
      onClick={() => onContact(tier)}
    >
      <MessageCircle className="mr-2 h-4 w-4" aria-hidden="true" />
      {t("pricing.contactCta")}
    </Button>
  );
}

export function TierCard({
  tier,
  plans,
  interval,
  lang,
  isCurrentTier,
  currentPlanId,
  isAuthenticated,
  onContact,
}: {
  tier: MembershipTierRow;
  plans: AccessPlan[];
  interval: BillingInterval;
  lang: string;
  isCurrentTier: boolean;
  currentPlanId: string | null;
  isAuthenticated: boolean;
  onContact: (tier: MembershipTierRow) => void;
}) {
  const { t } = useTranslation();
  const badge = tierBadge(tier, lang);
  const benefits = parseTierBenefits(tier.benefits);
  const description = lang === "en" ? tier.description_en : tier.description_pl;
  const plan = pickPlanForInterval(plans, interval);

  return (
    <Card
      className={cn(
        "relative flex flex-col rounded-[6px] transition-shadow",
        tier.highlight
          ? "border-primary ring-2 ring-primary/40 shadow-[0_10px_40px_-12px_color-mix(in_oklab,var(--primary)_35%,transparent)]"
          : "border-border/60",
        isCurrentTier && !tier.highlight && "border-primary bg-primary/5",
      )}
    >
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <h3
            className={cn(
              "text-lg font-semibold tracking-tight",
              tier.highlight ? "text-primary" : "text-foreground",
            )}
          >
            {tierName(tier, lang)}
          </h3>
          {tier.highlight ? (
            <span className="inline-flex h-5 shrink-0 items-center justify-center rounded-[6px] bg-primary/10 px-2 text-[10px] font-semibold uppercase tracking-wide leading-none text-primary">
              {badge || t("pricing.popular")}
            </span>
          ) : isCurrentTier ? (
            <span className="inline-flex h-5 shrink-0 items-center justify-center rounded-[6px] bg-primary px-2 text-[10px] font-medium leading-none text-primary-foreground">
              {t("pricing.tiers.current")}
            </span>
          ) : badge ? (
            <span className="inline-flex h-5 shrink-0 items-center justify-center rounded-[6px] bg-muted px-2 text-[10px] font-medium uppercase tracking-wide leading-none text-muted-foreground">
              {badge}
            </span>
          ) : null}
        </div>
        {description && (
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
        )}
        <PriceBlock tier={tier} plans={plans} interval={interval} lang={lang} />
        {plan && plan.trial_days > 0 && (
          <p className="mt-1 text-xs text-primary">{t("pricing.trial", { days: plan.trial_days })}</p>
        )}
      </CardHeader>
      <CardFooter className="pb-4 pt-0">
        <TierCardCta
          tier={tier}
          plans={plans}
          interval={interval}
          isCurrentTier={isCurrentTier}
          currentPlanId={currentPlanId}
          isAuthenticated={isAuthenticated}
          onContact={onContact}
        />
      </CardFooter>
      <CardContent className="flex-1 border-t border-border/50 pt-5">
        <TierBenefitList benefits={benefits} lang={lang} />
      </CardContent>
    </Card>
  );
}
