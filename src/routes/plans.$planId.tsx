// Szczegóły pojedynczego planu (/plans/:planId) - rozwinięcie karty z /pricing:
// pełny opis, cena w cyklu, okres próbny, benefity (własne planu lub warstwy),
// limity wynikające z realnych `features` warstwy oraz porównanie z resztą
// segmentu (ta sama matryca co na cenniku). Dane są prefetchowane w loaderze,
// więc strona jest w pełni SSR-owalna i linkowalna (SEO + udostępnianie).
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check, ShieldCheck } from "lucide-react";

import { billingKeys } from "@/lib/billing/keys";
import { fetchActivePlans } from "@/lib/billing/queries";
import { fetchMembershipTiers, parseTierBenefits, useCurrentTier } from "@/lib/billing/tiers";
import type { AccessPlan } from "@/lib/billing/types";
import {
  formatMoney,
  planBadge,
  planDescription,
  planFeatures,
  planName,
} from "@/lib/billing/types";
import { intervalLabel } from "@/lib/billing/intervalLabel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PricingComparisonMatrix } from "@/components/pricing/organisms/PricingComparisonMatrix";
import { activeLang } from "@/lib/seo/head";
import { ensureI18n as ensureProfileI18n } from "@/lib/i18n-profile";
import { ensureI18n as ensurePricingI18n } from "@/lib/i18n-pricing";

export const Route = createFileRoute("/plans/$planId")({
  component: PlanDetailsPage,
  loader: async ({ context, params }) => {
    const qc = context.queryClient;
    const [plans] = await Promise.all([
      qc
        .ensureQueryData({ queryKey: billingKeys.plansActive(), queryFn: fetchActivePlans })
        .catch(() => null),
      qc
        .ensureQueryData({ queryKey: billingKeys.membershipTiers(), queryFn: fetchMembershipTiers })
        .catch(() => null),
    ]);
    const plan = (plans ?? []).find((p) => p.id === params.planId) ?? null;
    if (!plan) throw notFound();
    return { plan };
  },
  head: ({ loaderData }) => {
    const lang = activeLang();
    if (!loaderData) {
      return {
        meta: [
          { title: lang === "en" ? "Plan unavailable" : "Plan niedostępny" },
          { name: "robots", content: "noindex" },
        ],
      };
    }
    const plan = loaderData.plan;
    const title = `${planName(plan, lang)} - ${lang === "en" ? "plan details" : "szczegóły planu"}`;
    const description =
      planDescription(plan, lang) ||
      (lang === "en"
        ? `Benefits, limits and pricing of the ${planName(plan, "en")} plan.`
        : `Zakres, limity i cena planu ${planName(plan, "pl")}.`);
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary" },
      ],
    };
  },
});

function PlanDetailsPage() {
  ensureProfileI18n();
  ensurePricingI18n();
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const { planId } = Route.useParams();

  const plansQ = useQuery({ queryKey: billingKeys.plansActive(), queryFn: fetchActivePlans });
  const tiersQ = useQuery({
    queryKey: billingKeys.membershipTiers(),
    queryFn: fetchMembershipTiers,
  });
  const currentTier = useCurrentTier();

  const plan: AccessPlan | null = (plansQ.data ?? []).find((p) => p.id === planId) ?? null;
  const tiers = tiersQ.data ?? [];
  const tier = plan?.tier_key ? (tiers.find((x) => x.key === plan.tier_key) ?? null) : null;

  // Benefity: własne planu mają pierwszeństwo, w razie braku - benefity warstwy
  // (plan podpięty pod tier nigdy nie świeci pustą listą).
  const ownFeatures = plan ? planFeatures(plan, lang) : [];
  const tierBenefits = tier ? parseTierBenefits(tier.benefits) : [];
  const benefits =
    ownFeatures.length > 0 ? ownFeatures : tierBenefits.map((b) => (lang === "en" ? b.en : b.pl));

  const audienceKey = tier?.audience_key ?? "individual";
  const segmentTiers = tiers
    .filter((x) => (x.audience_key ?? "individual") === audienceKey && x.key !== "supporter")
    .sort((a, b) => a.rank - b.rank || a.sort_order - b.sort_order);

  if (!plan) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-16">
        <p className="text-muted-foreground">{t("pricing.planDetails.notFound")}</p>
        <Button asChild variant="outline" className="mt-4">
          <Link to="/pricing">{t("pricing.planDetails.backToPricing")}</Link>
        </Button>
      </div>
    );
  }

  const badge = planBadge(plan, lang);
  const description = planDescription(plan, lang);

  return (
    <div className="container mx-auto max-w-5xl space-y-8 px-4 py-10">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/pricing">
          <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
          {t("pricing.planDetails.backToPricing")}
        </Link>
      </Button>

      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-bold tracking-tight">{planName(plan, lang)}</h1>
          {badge && <Badge>{badge}</Badge>}
        </div>
        {description && <p className="max-w-2xl text-muted-foreground">{description}</p>}
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-4xl font-bold tracking-tight">
            {formatMoney(plan.price_cents, plan.currency, lang)}
          </span>
          <span className="text-sm text-muted-foreground">{intervalLabel(plan.interval, t)}</span>
        </div>
        {plan.trial_days > 0 && (
          <p className="text-sm text-primary">{t("pricing.trial", { days: plan.trial_days })}</p>
        )}
        <div className="flex flex-wrap gap-2 pt-2">
          <Button asChild size="lg">
            <Link to="/checkout/$planId" params={{ planId: plan.id }}>
              {t("pricing.choose")}
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link to="/pricing">{t("pricing.compareAll")}</Link>
          </Button>
        </div>
      </header>

      {benefits.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t("pricing.planDetails.benefits")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2 sm:grid-cols-2">
              {benefits.map((b, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Limity i zakres liczony z realnych `features` warstw tenanta - ta sama
          matryca co na /pricing, z podświetloną kolumną planu użytkownika. */}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">{t("pricing.planDetails.limits")}</h2>
        <PricingComparisonMatrix
          tiers={segmentTiers}
          lang={lang}
          currentTierKey={currentTier.data?.key ?? null}
        />
      </section>

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="h-4 w-4" aria-hidden="true" />
        {t("pricing.planDetails.guarantee")}
      </p>
    </div>
  );
}
