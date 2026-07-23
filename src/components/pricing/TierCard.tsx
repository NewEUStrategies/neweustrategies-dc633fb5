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
  intervalPair,
  pickPlanForInterval,
  tierBadge,
  tierCtaMode,
  tierPriceNote,
  yearlySavingsPct,
  type BillingInterval,
} from "@/lib/pricing/selectors";
import { TierBenefitList } from "./TierBenefitList";
import { trackCta } from "@/lib/analytics/track";

function intervalSuffix(interval: AccessPlan["interval"], t: (key: string) => string): string {
  switch (interval) {
    case "day":
      return t("pricing.perDay");
    case "week":
      return t("pricing.perWeek");
    case "month":
      return t("pricing.perMonth");
    case "quarter":
      return t("pricing.perQuarter");
    case "year":
      return t("pricing.perYear");
    case "one_time":
      return t("pricing.perOnce");
  }
}

// Konwersja PLN -> EUR dla wersji EN żyje w shared helperze (displayCurrency),
// bo używa jej też checkout i panel admina - jedno źródło prawdy o parytecie.
function fmt(cents: number, currency: string, lang: string): string {
  return formatDisplayMoney(cents, currency, lang);
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
  const note = tierPriceNote(tier, lang);
  const noteLine = note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>;

  if (tier.is_default) {
    return (
      <div className="pt-4">
        <span className="text-4xl font-bold tracking-tight">{t("pricing.free")}</span>
        <p className="mt-1 text-xs text-muted-foreground">{note ?? t("pricing.freeNote")}</p>
      </div>
    );
  }

  const plan = pickPlanForInterval(plans, interval);
  if (!plan) {
    // Poziomy "tylko na zaproszenie" (cta_mode='none') nie maja ceny ani
    // zapytania ofertowego - wartosc lezy w niedostepnosci.
    if (tierCtaMode(tier) === "none") {
      return (
        <div className="pt-4">
          <span className="text-2xl font-semibold tracking-tight">
            {t("pricing.invitationOnly")}
          </span>
          {noteLine}
        </div>
      );
    }
    return (
      <div className="pt-4">
        <span className="text-2xl font-semibold tracking-tight">{t("pricing.onRequest")}</span>
        <p className="mt-1 text-xs text-muted-foreground">{note ?? t("pricing.onRequestNote")}</p>
      </div>
    );
  }

  // Ceny per miejsce (plan zespolowy): "od X / mies. za miejsce".
  const fromPrefix = tier.per_seat && (
    <span className="mr-1 text-base font-medium text-muted-foreground">
      {t("pricing.fromPrefix")}
    </span>
  );
  const perSeatSuffix = tier.per_seat ? ` ${t("pricing.perSeat")}` : "";

  if (plan.interval === "year") {
    const pair = intervalPair(plans);
    const savings = yearlySavingsPct(pair.month, pair.year);
    // Konkretna kwota - dokładnie ta, którą pobiera Stripe i widzi admin.
    // Bez „≈"/kotwic wprowadzających w błąd: cena roczna jest jedynym źródłem prawdy.
    return (
      <div className="pt-4">
        {fromPrefix}
        <span className="text-4xl font-bold tracking-tight">
          {fmt(plan.price_cents, plan.currency, lang)}
        </span>
        <span className="ml-1 text-sm text-muted-foreground">
          {t("pricing.perYear")}
          {perSeatSuffix}
        </span>
        {savings !== null && (
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary">
              {t("pricing.savePct", { pct: savings })}
            </span>
          </p>
        )}
        {noteLine}
      </div>
    );
  }

  return (
    <div className="pt-4">
      {fromPrefix}
      <span className="text-4xl font-bold tracking-tight">
        {fmt(plan.price_cents, plan.currency, lang)}
      </span>

      <span className="ml-1 text-sm text-muted-foreground">
        {intervalSuffix(plan.interval, t)}
        {perSeatSuffix}
      </span>
      {noteLine}
    </div>
  );
}

// Jeden wariant przycisku CTA dla całej karty warstwy - eliminuje "skakanie"
// stylu przy zmianie przełącznika miesięcznie/rocznie oraz między różnymi
// gałęziami (checkout / kontakt / rejestracja). Ciemny/jasny motyw obsługują
// tokeny (`default` = solid brand, `outline` = border + hover token) - nie
// hardkodujemy kolorów, więc dark/light zachowują się identycznie.
type CtaVariant = "default" | "outline";
function tierCtaVariant(tier: MembershipTierRow): CtaVariant {
  return tier.highlight ? "default" : "outline";
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
  const mode = tierCtaMode(tier);
  const variant = tierCtaVariant(tier);
  // Jednolita klasa dla wszystkich CTA - stała wysokość, pełna szerokość i
  // domyślny 6px rounding zgodnie z systemem projektowym. Dzięki temu każda
  // gałąź (checkout, kontakt, rejestracja, "obecny plan") wygląda identycznie
  // niezależnie od przełącznika miesięcznie/rocznie i trybu dark/light.
  const ctaClass = "w-full h-10 rounded-[6px] text-sm font-semibold";

  // "Tylko na zaproszenie" - swiadomie bez jakiegokolwiek przycisku.
  if (mode === "none") return null;

  if (tier.is_default) {
    if (isCurrentTier) {
      return (
        <Button className={ctaClass} disabled variant="outline">
          {t("pricing.currentTier")}
        </Button>
      );
    }
    if (!isAuthenticated) {
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
    }
    return null;
  }

  // Tryb 'contact': cena moze byc widoczna (np. per miejsce), ale zakup idzie
  // przez rozmowe - checkout pojedynczego miejsca bylby nieuczciwy.
  if (mode === "contact") {
    if (isCurrentTier) {
      return (
        <Button className={ctaClass} disabled variant="outline">
          {t("pricing.currentTier")}
        </Button>
      );
    }
    if (tier.contact_url) {
      return (
        <Button asChild className={ctaClass} variant={variant}>
          <a
            href={tier.contact_url}
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
    }
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
  }

  const plan = pickPlanForInterval(plans, interval);
  if (plan) {
    if (currentPlanId === plan.id || isCurrentTier) {
      return (
        <Button className={ctaClass} disabled variant="outline">
          {currentPlanId === plan.id ? t("pricing.current") : t("pricing.currentTier")}
        </Button>
      );
    }
    return (
      <Button asChild className={ctaClass} variant={variant}>
        <Link
          to="/checkout/$planId"
          params={{ planId: plan.id }}
          onClick={() =>
            trackCta("pricing_checkout_click", {
              tier_key: tier.key,
              tier_id: tier.id,
              plan_id: plan.id,
              interval,
              amount_cents: plan.price_cents,
              currency: plan.currency,
            })
          }
        >
          {t("pricing.choose")}
        </Link>
      </Button>
    );
  }

  // Warstwa bez planu w sprzedaży samoobsługowej.
  if (tier.key === "supporter") {
    return (
      <Button asChild className={ctaClass} variant="outline">
        <Link to="/support" search={{ status: undefined }}>
          <HandHeart className="mr-2 h-4 w-4" aria-hidden="true" />
          {t("pricing.tiers.supporterCta")}
        </Link>
      </Button>
    );
  }
  if (isCurrentTier) {
    return (
      <Button className={ctaClass} disabled variant="outline">
        {t("pricing.currentTier")}
      </Button>
    );
  }
  if (tier.contact_url) {
    return (
      <Button asChild className={ctaClass} variant={variant}>
        <a href={tier.contact_url}>
          <MessageCircle className="mr-2 h-4 w-4" aria-hidden="true" />
          {t("pricing.contactCta")}
        </a>
      </Button>
    );
  }
  return (
    <Button className={ctaClass} variant={variant} onClick={() => onContact(tier)}>
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

  // Eliminacja powielenia: benefity użyte w spotlight'cie "Co wyróżnia ten plan"
  // nie mogą ponownie pojawić się na pełnej liście - użytkownik widzi każdy
  // punkt dokładnie raz. Porównanie po znormalizowanym tekście w języku strony.
  const norm = (v: string): string => v.trim().toLowerCase();
  const highlightSet = new Set((highlights ?? []).map((b) => norm(benefitText(b, lang))));
  const restBenefits = allBenefits.filter((b) => !highlightSet.has(norm(benefitText(b, lang))));

  return (
    <Card
      className={cn(
        "relative flex flex-col rounded-[6px] transition-shadow",
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
        {description && (
          <p className="mt-1.5 text-sm leading-snug text-muted-foreground">{description}</p>
        )}
        <PriceBlock tier={tier} plans={plans} interval={interval} lang={lang} />
        {plan && plan.trial_days > 0 && (
          <p className="mt-1 text-xs text-primary">
            {t("pricing.trial", { days: plan.trial_days })}
          </p>
        )}
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
                <li key={i} className="flex items-start gap-2 text-[13px] font-medium text-foreground">
                  <span
                    className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand"
                    aria-hidden="true"
                  />
                  <span>{benefitText(benefit, lang)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <TierBenefitList benefits={restBenefits} lang={lang} />
      </CardContent>
    </Card>
  );
}
