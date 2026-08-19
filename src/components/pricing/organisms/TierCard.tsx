// Karta warstwy członkostwa - serce Cennika 2.0. Cena zawsze uczciwa
// (framing miesięczny dla planów rocznych + realny % oszczędności), benefity
// w stylu NYT/FT, CTA zależne od danych: checkout, rejestracja (warstwa
// bezpłatna), wsparcie fundacji albo rozmowa z zespołem (oferty offline).
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { Check, HandHeart, MessageCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { type AccessPlan } from "@/lib/billing/types";
import { formatDisplayMoney } from "@/lib/billing/displayCurrency";

import {
  parseTierBenefits,
  tierName,
  type MembershipTierRow,
  type TierBenefit,
} from "@/lib/billing/tiers";
import {
  benefitText,
  pickPlanForInterval,
  tierBadge,
  type BillingInterval,
} from "@/lib/pricing/selectors";
import {
  ctaDescriptor,
  ctaVariant,
  priceDisplay,
  splitBenefits,
} from "@/lib/pricing/tierCardModel";
import { TierBenefitList } from "@/components/pricing/atoms/TierBenefitList";
import { trackCta } from "@/lib/analytics/track";

// Konwersja PLN -> EUR dla wersji EN żyje w shared helperze (displayCurrency),
// bo używa jej też checkout i panel admina - jedno źródło prawdy o parytecie.
function fmt(cents: number, currency: string, lang: string): string {
  return formatDisplayMoney(cents, currency, lang);
}

/**
 * Blok ceny. Decyzję „co pokazać" podejmuje reguła (`priceDisplay`) - tu zostaje
 * wyłącznie sposób pokazania. Wysokość bloku jest stała po stronie karty, żeby
 * przycisk zakupu startował na tej samej linii we wszystkich kartach.
 */
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
  const display = priceDisplay(tier, plans, interval, lang);
  const noteLine = display.note && (
    <p className="mt-1 text-xs text-muted-foreground">{display.note}</p>
  );

  if (display.kind === "free") {
    return (
      <div className="pt-4">
        <span className="text-4xl font-bold tracking-tight">{t("pricing.free")}</span>
        <p className="mt-1 text-xs text-muted-foreground">
          {display.note ?? t("pricing.freeNote")}
        </p>
      </div>
    );
  }

  if (display.kind === "invitationOnly") {
    return (
      <div className="pt-4">
        <span className="text-2xl font-semibold tracking-tight">{t("pricing.invitationOnly")}</span>
        {noteLine}
      </div>
    );
  }

  if (display.kind === "onRequest") {
    return (
      <div className="pt-4">
        <span className="text-2xl font-semibold tracking-tight">{t("pricing.onRequest")}</span>
        <p className="mt-1 text-xs text-muted-foreground">
          {display.note ?? t("pricing.onRequestNote")}
        </p>
      </div>
    );
  }

  return (
    <div className="pt-4">
      {display.fromPrefix && (
        <span className="mr-1 text-base font-medium text-muted-foreground">
          {t("pricing.fromPrefix")}
        </span>
      )}
      <span className="text-4xl font-bold tracking-tight">
        {fmt(display.cents, display.currency, lang)}
      </span>
      <span className="ml-1 text-sm text-muted-foreground">
        {t(display.intervalKey)}
        {display.perSeat ? ` ${t("pricing.perSeat")}` : ""}
      </span>
      {display.savingsPct !== null && (
        <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary">
            {t("pricing.savePct", { pct: display.savingsPct })}
          </span>
        </p>
      )}
      {noteLine}
    </div>
  );
}

/**
 * Przycisk zakupu. Decyzję „który przycisk" podejmuje reguła
 * (`ctaDescriptor`) - tu zostaje wygląd i zdarzenie analityczne. Jednolita klasa
 * dla wszystkich gałęzi: stała wysokość, pełna szerokość, 6px rounding, żeby
 * przełącznik miesięcznie/rocznie ani tryb ciemny nie zmieniały wyglądu.
 * Kolory idą z tokenów (`default` = solid brand, `outline` = obramowanie).
 */
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
  const cta = ctaDescriptor({
    tier,
    plans,
    interval,
    isCurrentTier,
    currentPlanId,
    isAuthenticated,
  });
  const variant = ctaVariant(tier);
  const ctaClass = "w-full h-10 rounded-[6px] text-sm font-semibold";

  switch (cta.kind) {
    case "none":
      return null;

    case "currentPlan":
      return (
        <Button className={ctaClass} disabled variant="outline">
          {t("pricing.current")}
        </Button>
      );

    case "currentTier":
      return (
        <Button className={ctaClass} disabled variant="outline">
          {t("pricing.currentTier")}
        </Button>
      );

    case "signup":
      return (
        <Button asChild className={ctaClass} variant={variant}>
          <Link
            to="/login"
            onClick={() =>
              trackCta("pricing_signup_click", {
                tier_key: tier.key,
                tier_id: tier.id,
                interval,
              })
            }
          >
            {t("pricing.signupCta")}
          </Link>
        </Button>
      );

    case "contactLink":
      return (
        <Button asChild className={ctaClass} variant={variant}>
          <a
            href={cta.href}
            onClick={() =>
              trackCta("pricing_contact_click", {
                tier_key: tier.key,
                tier_id: tier.id,
                interval,
                target: "external",
              })
            }
          >
            <MessageCircle className="mr-2 h-4 w-4" aria-hidden="true" />
            {t("pricing.contactCta")}
          </a>
        </Button>
      );

    case "contactDialog":
      return (
        <Button
          className={ctaClass}
          variant={variant}
          onClick={() => {
            trackCta("pricing_contact_click", {
              tier_key: tier.key,
              tier_id: tier.id,
              interval,
              target: "dialog",
            });
            onContact(tier);
          }}
        >
          <MessageCircle className="mr-2 h-4 w-4" aria-hidden="true" />
          {t("pricing.contactCta")}
        </Button>
      );

    case "supporter":
      return (
        <Button asChild className={ctaClass} variant="outline">
          <Link to="/support" search={{ status: undefined }}>
            <HandHeart className="mr-2 h-4 w-4" aria-hidden="true" />
            {t("pricing.tiers.supporterCta")}
          </Link>
        </Button>
      );

    case "checkout":
      return (
        <div className="space-y-1.5">
          <Button asChild className={ctaClass} variant={variant}>
            <Link
              to="/checkout/$planId"
              params={{ planId: cta.planId }}
              onClick={() =>
                trackCta("pricing_checkout_click", {
                  tier_key: tier.key,
                  tier_id: tier.id,
                  plan_id: cta.planId,
                  interval,
                  amount_cents: cta.priceCents,
                  currency: cta.currency,
                })
              }
            >
              {t("pricing.choose")}
            </Link>
          </Button>
          {/* Skrót do pełnych szczegółów planu (benefity, limity, porównanie). */}
          <Button asChild variant="link" size="sm" className="h-auto w-full p-0 text-xs">
            <Link to="/plans/$planId" params={{ planId: cta.planId }}>
              {t("pricing.planDetails.cta")}
            </Link>
          </Button>
        </div>
      );
  }
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
  highlights,
}: {
  tier: MembershipTierRow;
  plans: AccessPlan[];
  interval: BillingInterval;
  lang: string;
  isCurrentTier: boolean;
  currentPlanId: string | null;
  isAuthenticated: boolean;
  onContact: (tier: MembershipTierRow) => void;
  /** Benefity wyróżniające ten próg względem progu niżej - spotlight u góry. */
  highlights?: TierBenefit[];
}) {
  const { t } = useTranslation();
  const badge = tierBadge(tier, lang);
  const allBenefits = parseTierBenefits(tier.benefits);
  const description = lang === "en" ? tier.description_en : tier.description_pl;
  const plan = pickPlanForInterval(plans, interval);

  // Podział na spotlight i pozostałe (bez powtórzeń, z limitem) jest regułą -
  // patrz `splitBenefits`. Klient widzi każdą obietnicę dokładnie raz.
  const split = splitBenefits(allBenefits, highlights, lang);

  return (
    <Card
      className={cn(
        "relative flex h-full flex-col rounded-[6px] transition-shadow",
        tier.highlight
          ? "border-brand ring-2 ring-brand/40 shadow-[0_10px_40px_-12px_color-mix(in_oklab,var(--brand)_35%,transparent)]"
          : "border-border/60",
        isCurrentTier && !tier.highlight && "border-brand bg-brand/5",
      )}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <h3
            className={cn(
              "text-lg font-semibold tracking-tight",
              tier.highlight ? "text-brand" : "text-foreground",
            )}
          >
            {tierName(tier, lang)}
          </h3>
          {tier.highlight ? (
            <span className="inline-flex h-5 shrink-0 items-center justify-center rounded-[6px] bg-brand/10 px-2 text-[10px] font-semibold uppercase tracking-wide leading-none text-brand">
              {badge || t("pricing.popular")}
            </span>
          ) : isCurrentTier ? (
            <span className="inline-flex h-5 shrink-0 items-center justify-center rounded-[6px] border border-brand-ink bg-brand/15 px-2 text-[10px] font-semibold uppercase tracking-wide leading-none text-brand-ink">
              {t("pricing.tiers.current")}
            </span>
          ) : badge ? (
            <span className="inline-flex h-5 shrink-0 items-center justify-center rounded-[6px] bg-muted px-2 text-[10px] font-medium uppercase tracking-wide leading-none text-muted-foreground">
              {badge}
            </span>
          ) : null}
        </div>
        {/* min-h wyrównuje opis między kartami, żeby cena zaczynała się na tej
            samej wysokości niezależnie od długości podpisu warstwy. */}
        <div className="min-h-[3.25rem]">
          {description && (
            <p className="mt-1.5 text-sm leading-snug text-muted-foreground">{description}</p>
          )}
        </div>
        {/* Stała wysokość bloku ceny -> CTA startuje na tej samej linii we
            wszystkich kartach (Bezpłatnie / kwota / Oferta na zapytanie). */}
        <div className="min-h-[6rem]">
          <PriceBlock tier={tier} plans={plans} interval={interval} lang={lang} />
          {plan && plan.trial_days > 0 && (
            <p className="mt-1 text-xs text-primary">
              {t("pricing.trial", { count: plan.trial_days })}
            </p>
          )}
        </div>
      </CardHeader>
      <CardFooter className="pb-3 pt-0">
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
      <CardContent className="flex-1 border-t border-border/50 pt-3">
        {highlights && highlights.length > 0 && (
          <div className="mb-3 rounded-[6px] border border-brand/25 bg-brand/5 p-2.5">
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-brand-ink">
              {t("pricing.highlightsHeading")}
            </p>
            <ul className="space-y-1">
              {highlights.map((benefit, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 text-[13px] font-medium text-foreground"
                >
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" aria-hidden="true" />
                  <span>{benefitText(benefit, lang)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <TierBenefitList benefits={split.rest} lang={lang} />
      </CardContent>
    </Card>
  );
}
