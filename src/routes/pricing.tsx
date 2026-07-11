import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, RefreshCcw, Zap } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { fetchActivePlans, fetchMySubscription } from "@/lib/billing/queries";
import { PlanCard } from "@/components/billing/PlanCard";
import "@/lib/i18n-profile";

export const Route = createFileRoute("/pricing")({
  component: PricingPage,
  head: () => ({
    meta: [
      { title: "Cennik - Plany subskrypcji" },
      {
        name: "description",
        content: "Wybierz plan dopasowany do Twoich potrzeb. Subskrypcje miesięczne i roczne.",
      },
    ],
  }),
});

function PricingPage() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const plans = useQuery({ queryKey: ["plans-active"], queryFn: fetchActivePlans });
  const mySub = useQuery({
    queryKey: ["my-subscription"],
    queryFn: fetchMySubscription,
    enabled: !!session,
  });
  const faq = t("pricing.faq", { returnObjects: true }) as { q: string; a: string }[];

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

      {!plans.data || plans.data.length === 0 ? (
        <p className="text-center text-muted-foreground">{t("pricing.empty")}</p>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {plans.data.map((p) => (
            <PlanCard key={p.id} plan={p} isCurrent={mySub.data?.plan_id === p.id} />
          ))}
        </div>
      )}

      {/* FAQ */}
      <section className="mx-auto mt-20 max-w-3xl">
        <h2 className="mb-6 text-center text-2xl font-bold tracking-tight">
          {t("pricing.faqTitle")}
        </h2>
        <dl className="divide-y divide-border rounded-xl border border-border">
          {faq.map((item, i) => (
            <div key={i} className="p-5">
              <dt className="font-medium">{item.q}</dt>
              <dd className="mt-1.5 text-sm text-muted-foreground">{item.a}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
