import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
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

  return (
    <div className="container mx-auto max-w-6xl px-4 py-12 md:py-16">
      <header className="text-center mb-12">
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight">{t("pricing.title")}</h1>
        <p className="mt-4 text-lg text-muted-foreground">{t("pricing.subtitle")}</p>
      </header>
      {!plans.data || plans.data.length === 0 ? (
        <p className="text-center text-muted-foreground">{t("pricing.empty")}</p>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {plans.data.map((p) => (
            <PlanCard key={p.id} plan={p} isCurrent={mySub.data?.plan_id === p.id} />
          ))}
        </div>
      )}
    </div>
  );
}
