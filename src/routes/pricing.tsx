import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Minus, ShieldCheck, RefreshCcw, Zap, HandHeart } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { fetchActivePlans, fetchMySubscription } from "@/lib/billing/queries";
import { planFeatures, planName, type AccessPlan } from "@/lib/billing/types";
import {
  parseTierBenefits,
  tierName,
  useCurrentTier,
  useMembershipTiers,
} from "@/lib/billing/tiers";
import { PlanCard } from "@/components/billing/PlanCard";
import { activeLang } from "@/lib/seo/head";
import { getRequestUrl } from "@/lib/seo/request";
import "@/lib/i18n-profile";

export const Route = createFileRoute("/pricing")({
  component: PricingPage,
  head: () => {
    const lang = activeLang(getRequestUrl() || "/pricing");
    return {
      meta: [
        {
          title: lang === "en" ? "Pricing - Subscription plans" : "Cennik - Plany subskrypcji",
        },
        {
          name: "description",
          content:
            lang === "en"
              ? "Choose the plan that fits your needs. Monthly and yearly subscriptions."
              : "Wybierz plan dopasowany do Twoich potrzeb. Subskrypcje miesięczne i roczne.",
        },
      ],
    };
  },
});

function PricingPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { session } = useAuth();
  const plans = useQuery({ queryKey: ["plans-active"], queryFn: fetchActivePlans });
  const mySub = useQuery({
    queryKey: ["my-subscription"],
    queryFn: fetchMySubscription,
    enabled: !!session,
  });
  const tiers = useMembershipTiers();
  const currentTier = useCurrentTier();
  const faq = t("pricing.faq", { returnObjects: true }) as { q: string; a: string }[];

  // Przełącznik miesięcznie/rocznie: pokazywany tylko gdy w cenniku istnieją
  // OBA interwały (plany są w pełni CMS-owe). Plany nienawrotowe (one_time /
  // day / week) są zawsze widoczne pod spodem.
  const [interval, setInterval] = useState<"month" | "year">("month");
  const all = useMemo(() => plans.data ?? [], [plans.data]);
  const hasMonthly = all.some((p) => p.interval === "month");
  const hasYearly = all.some((p) => p.interval === "year");
  const showToggle = hasMonthly && hasYearly;
  const visible = useMemo(() => {
    if (!showToggle) return all;
    return all.filter(
      (p) => p.interval === interval || (p.interval !== "month" && p.interval !== "year"),
    );
  }, [all, showToggle, interval]);

  // Macierz porównania: unia list funkcji (wolny tekst per plan z CMS) ×
  // widoczne plany. Ma sens, gdy redakcja spójnie nazywa funkcje między
  // planami; przy rozjechanych nazwach degraduje do listy per plan.
  const comparison = useMemo(() => {
    const withFeatures = visible.filter((p) => planFeatures(p, lang).length > 0);
    if (withFeatures.length < 2) return null;
    const rows: string[] = [];
    for (const p of withFeatures) {
      for (const f of planFeatures(p, lang)) {
        if (!rows.includes(f)) rows.push(f);
      }
    }
    return { plans: withFeatures as AccessPlan[], rows };
  }, [visible, lang]);

  return (
    <div className="container mx-auto max-w-6xl px-4 py-12 md:py-16">
      <header className="text-center mb-8">
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight">{t("pricing.title")}</h1>
        <p className="mt-4 text-lg text-muted-foreground">{t("pricing.subtitle")}</p>
      </header>

      {/* Trust signals */}
      <ul className="mb-12 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-muted-foreground">
        <li className="inline-flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
          {t("pricing.trust.secure")}
        </li>
        <li className="inline-flex items-center gap-2">
          <RefreshCcw className="h-4 w-4 text-primary" aria-hidden="true" />
          {t("pricing.trust.cancel")}
        </li>
        <li className="inline-flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" aria-hidden="true" />
          {t("pricing.trust.instant")}
        </li>
      </ul>

      {/* Warstwy członkostwa: co daje każda warstwa, niezależnie od tego,
          którym planem (miesiąc/rok) się ją kupuje. */}
      {(tiers.data?.length ?? 0) > 0 && (
        <section aria-labelledby="tiers-heading" className="mb-12">
          <h2 id="tiers-heading" className="sr-only">
            {t("pricing.tiers.heading", {
              defaultValue: lang === "en" ? "Membership tiers" : "Warstwy członkostwa",
            })}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {tiers.data!.map((tier) => {
              const isCurrent = currentTier.data?.key === tier.key;
              const grantingPlans = (plans.data ?? []).filter((p) => p.tier_key === tier.key);
              return (
                <div
                  key={tier.id}
                  className={`rounded-lg border p-5 ${
                    isCurrent ? "border-primary bg-primary/5" : "border-border"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-lg font-semibold">{tierName(tier, lang)}</h3>
                    {isCurrent && (
                      <span className="rounded-full bg-primary px-2.5 py-0.5 text-xs font-medium text-primary-foreground">
                        {t("pricing.tiers.current", {
                          defaultValue: lang === "en" ? "Your tier" : "Twoja warstwa",
                        })}
                      </span>
                    )}
                  </div>
                  {(lang === "en" ? tier.description_en : tier.description_pl) && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {lang === "en" ? tier.description_en : tier.description_pl}
                    </p>
                  )}
                  <ul className="mt-3 space-y-1.5">
                    {parseTierBenefits(tier.benefits).map((b, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <Check
                          className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                          aria-hidden="true"
                        />
                        <span>{lang === "en" ? b.en : b.pl}</span>
                      </li>
                    ))}
                  </ul>
                  {grantingPlans.length > 0 && (
                    <p className="mt-3 text-xs text-muted-foreground">
                      {t("pricing.tiers.grantedBy", {
                        defaultValue: lang === "en" ? "Included in:" : "W ramach planów:",
                      })}{" "}
                      {grantingPlans.map((p) => planName(p, lang)).join(", ")}
                    </p>
                  )}
                  {!isCurrent && <TierCta tierKey={tier.key} plans={grantingPlans} lang={lang} />}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {showToggle && (
        <div className="mb-8 flex justify-center">
          <div
            role="group"
            aria-label={t("pricing.title")}
            className="inline-flex rounded-full border border-border bg-muted/40 p-1"
          >
            {(["month", "year"] as const).map((iv) => (
              <button
                key={iv}
                type="button"
                aria-pressed={interval === iv}
                onClick={() => setInterval(iv)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                  interval === iv
                    ? "bg-background text-foreground shadow"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {iv === "month" ? t("pricing.intervalMonthly") : t("pricing.intervalYearly")}
              </button>
            ))}
          </div>
        </div>
      )}

      {all.length === 0 ? (
        <p className="text-center text-muted-foreground">{t("pricing.empty")}</p>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {visible.map((p) => (
            <PlanCard key={p.id} plan={p} isCurrent={mySub.data?.plan_id === p.id} />
          ))}
        </div>
      )}

      {/* Plan comparison matrix */}
      {comparison && (
        <section className="mx-auto mt-16 max-w-4xl">
          <h2 className="mb-6 text-center text-2xl font-bold tracking-tight">
            {t("pricing.compareTitle")}
          </h2>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th scope="col" className="p-3 text-left font-medium">
                    {t("pricing.compareFeature")}
                  </th>
                  {comparison.plans.map((p) => (
                    <th scope="col" key={p.id} className="p-3 text-center font-semibold">
                      {planName(p, lang)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {comparison.rows.map((feature) => (
                  <tr key={feature}>
                    <th scope="row" className="p-3 text-left font-normal">
                      {feature}
                    </th>
                    {comparison.plans.map((p) => {
                      const has = planFeatures(p, lang).includes(feature);
                      return (
                        <td key={p.id} className="p-3 text-center">
                          {has ? (
                            <Check
                              className="mx-auto h-4 w-4 text-primary"
                              aria-label={t("common.yes", { defaultValue: "Tak" })}
                            />
                          ) : (
                            <Minus
                              className="mx-auto h-4 w-4 text-muted-foreground/40"
                              aria-label={t("common.no", { defaultValue: "Nie" })}
                            />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* FAQ */}
      <section className="mx-auto mt-20 max-w-3xl">
        <h2 className="mb-6 text-center text-2xl font-bold tracking-tight">
          {t("pricing.faqTitle")}
        </h2>
        <Accordion
          type="single"
          collapsible
          className="rounded-xl border border-border"
          defaultValue={faq[0] ? `faq-0` : undefined}
        >
          {faq.map((item, i) => (
            <AccordionItem
              key={i}
              value={`faq-${i}`}
              className="px-5 last:border-b-0"
            >
              <AccordionTrigger className="text-base font-medium">
                {item.q}
              </AccordionTrigger>
              <AccordionContent>{item.a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </section>
    </div>
  );
}

// CTA karty warstwy - data-driven i wielotenantowo bezpieczny:
//  - "supporter" -> darowizna (/support),
//  - warstwa z przypisanym planem -> checkout najtańszego planu,
//  - pozostałe (np. korporacyjny/partner sprzedawane offline) -> bez przycisku
//    (warstwa nadal prezentuje benefity; admin dodaje plan, by włączyć zakup).
function TierCta({ tierKey, plans, lang }: { tierKey: string; plans: AccessPlan[]; lang: string }) {
  const { t } = useTranslation();
  if (tierKey === "supporter") {
    return (
      <Button asChild size="sm" variant="outline" className="mt-3 w-full">
        <Link to="/support" search={{ status: undefined }}>
          <HandHeart className="mr-2 h-4 w-4" aria-hidden="true" />
          {t("pricing.tiers.supporterCta", {
            defaultValue: lang === "en" ? "Support the foundation" : "Wesprzyj fundację",
          })}
        </Link>
      </Button>
    );
  }
  if (plans.length > 0) {
    const cheapest = [...plans].sort((a, b) => a.price_cents - b.price_cents)[0];
    return (
      <Button asChild size="sm" className="mt-3 w-full">
        <Link to="/checkout/$planId" params={{ planId: cheapest.id }}>
          {t("pricing.tiers.joinCta", {
            defaultValue: lang === "en" ? "Join" : "Dołącz",
          })}
        </Link>
      </Button>
    );
  }
  return null;
}
