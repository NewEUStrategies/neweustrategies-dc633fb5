// Karta warstwy członkostwa - serce Cennika 2.0. Cena zawsze uczciwa
// (framing miesięczny dla planów rocznych + realny % oszczędności), benefity
// w stylu NYT/FT, CTA zależne od danych: checkout, rejestracja (warstwa
// bezpłatna), wsparcie fundacji albo rozmowa z zespołem (oferty offline).
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { HandHeart, MessageCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { type AccessPlan } from "@/lib/billing/types";
import { formatApproxDisplayMoney, formatDisplayMoney } from "@/lib/billing/displayCurrency";

import { parseTierBenefits, tierName, type MembershipTierRow } from "@/lib/billing/tiers";
import {
  intervalPair,
  monthlyEquivalentCents,
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
    const monthlyEq = monthlyEquivalentCents(plan);
    const pair = intervalPair(plans);
    const savings = yearlySavingsPct(pair.month, pair.year);
    // Kotwica: czysta równowartość miesięczna („≈49 zł/mies") zamiast
    // przypadkowo wyglądającego ułamka („49,17 zł"). Dokładna cena roczna
    // zostaje w linii „rozliczane rocznie" niżej - nic nie jest zmyślone.
    return (
      <div className="pt-4">
        {fromPrefix}
        <span className="text-4xl font-bold tracking-tight">
          {monthlyEq !== null
            ? `≈${formatApproxDisplayMoney(monthlyEq, plan.currency, lang)}`
            : fmt(plan.price_cents, plan.currency, lang)}
        </span>
        <span className="ml-1 text-sm text-muted-foreground">
          {t("pricing.perMonth")}
          {perSeatSuffix}
        </span>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {t("pricing.billedYearly", {
            amount: fmt(plan.price_cents, plan.currency, lang),
          })}
          {savings !== null && (
            <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary">
              {t("pricing.savePct", { pct: savings })}
            </span>
          )}
        </p>
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
    <Button
      className={ctaClass}
      variant={variant}
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
          ? "border-brand ring-2 ring-brand/40 shadow-[0_10px_40px_-12px_color-mix(in_oklab,var(--brand)_35%,transparent)]"
          : "border-border/60",
        isCurrentTier && !tier.highlight && "border-brand bg-brand/5",
      )}
    >
      <CardHeader className="pb-3">
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
          <p className="mt-1 text-xs text-primary">
            {t("pricing.trial", { days: plan.trial_days })}
          </p>
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
