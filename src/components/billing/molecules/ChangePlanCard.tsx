// Samoobsługowa zmiana planu subskrypcji (upgrade/downgrade). Lista celów:
// ta sama reguła, którą serwer sprawdza przy zmianie (`switchTargets` ->
// `planSwitchRefusal`: aktywny plan cykliczny ze ścisłym odpowiednikiem
// w katalogu, ten sam model rozliczenia, poza bieżącym); wykonanie przez
// server fn changeSubscriptionPlan (Stripe-first, prorata rozliczana od razu,
// nieudana dopłata nie zmienia planu - klient dostaje fakturę do opłacenia).
// Po sukcesie inwalidacja wszystkich kluczy uprawnień - warstwa, paywall
// i dokumenty odświeżają się bez przeładowania; zdarzenie
// subscription.updated.v1 z szyny domyka pozostałe karty.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRightLeft, Loader2 } from "lucide-react";
import { billingKeys } from "@/lib/billing/keys";
import { catalogPriceForPlan } from "@/lib/billing/catalog";
import { toastSubscriptionFailure } from "@/lib/billing/paymentOutcomeToast";
import { switchTargets } from "@/lib/billing/planSwitch";
import { changeMySubscriptionPlan, fetchActivePlans } from "@/lib/billing/queries";
import {
  formatMoney,
  planName,
  type AccessPlan,
  type UserSubscriptionRow,
} from "@/lib/billing/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function intervalSuffix(interval: AccessPlan["interval"], t: (key: string) => string): string {
  switch (interval) {
    case "two_weeks":
      return t("pricing.perTwoWeeks");
    case "quarter":
      return t("pricing.perQuarter");
    case "year":
      return t("pricing.perYear");
    default:
      return t("pricing.perMonth");
  }
}

export function ChangePlanCard({ subscription }: { subscription: UserSubscriptionRow }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const qc = useQueryClient();
  const [selectedPlanId, setSelectedPlanId] = useState<string>("");

  const plansQ = useQuery({ queryKey: billingKeys.plansActive(), queryFn: fetchActivePlans });
  const currentEntry = subscription.plan ? catalogPriceForPlan(subscription.plan) : null;
  const targets = useMemo(
    () =>
      switchTargets(plansQ.data ?? [], currentEntry)
        .map((option) => option.plan)
        .filter((plan) => plan.id !== subscription.plan_id),
    [plansQ.data, currentEntry, subscription.plan_id],
  );

  const changePlan = useMutation({
    mutationFn: (newPlanId: string) => changeMySubscriptionPlan(subscription.id, newPlanId),
    onSuccess: (result) => {
      // Downgrade wchodzi od nowego okresu - bieżący plan zostaje do jego końca.
      toast.success(
        result?.effect === "scheduled"
          ? t("profile.subscription.portal.downgradeScheduled")
          : t("profile.subscription.changePlan.success"),
      );
      setSelectedPlanId("");
      void qc.invalidateQueries({ queryKey: billingKeys.mySubscriptionAll() });
      void qc.invalidateQueries({ queryKey: billingKeys.currentTierAll() });
      void qc.invalidateQueries({ queryKey: billingKeys.myOrdersAll() });
      void qc.invalidateQueries({ queryKey: billingKeys.myBillingDocumentsAll() });
      void qc.invalidateQueries({ queryKey: ["public", "resolved"] });
      void qc.invalidateQueries({ queryKey: ["unlocked-body"] });
    },
    onError: (error) => {
      toastSubscriptionFailure(t, error, "profile.subscription.changePlan.error");
    },
  });

  if (targets.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ArrowRightLeft className="h-4 w-4 text-primary" aria-hidden="true" />
          {t("profile.subscription.changePlan.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{t("profile.subscription.changePlan.hint")}</p>
        {subscription.canceled_at && (
          <p className="text-xs text-muted-foreground">
            {t("profile.subscription.changePlan.cancelNote")}
          </p>
        )}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Select value={selectedPlanId || undefined} onValueChange={setSelectedPlanId}>
            <SelectTrigger
              className="sm:max-w-sm"
              aria-label={t("profile.subscription.changePlan.placeholder")}
            >
              <SelectValue placeholder={t("profile.subscription.changePlan.placeholder")} />
            </SelectTrigger>
            <SelectContent>
              {targets.map((plan) => (
                <SelectItem key={plan.id} value={plan.id}>
                  {planName(plan, lang)} - {formatMoney(plan.price_cents, plan.currency, lang)}{" "}
                  {intervalSuffix(plan.interval, t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            disabled={!selectedPlanId || changePlan.isPending}
            onClick={() => selectedPlanId && changePlan.mutate(selectedPlanId)}
            className="shrink-0"
          >
            {changePlan.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            )}
            {t("profile.subscription.changePlan.cta")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
