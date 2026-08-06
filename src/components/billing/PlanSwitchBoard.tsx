// Tablica zmiany planu sterowana `lookup_key` (czytelnym identyfikatorem ceny
// u operatora), a nie kwotą z bazy: ranga katalogu jest stabilna między
// sandboxem a produkcją, więc „wyżej/niżej" w UI odpowiada dokładnie proracji
// liczonej przy zmianie subskrypcji.
//
// Bez aktywnej subskrypcji karta jest listą wejścia (link do szczegółów planu),
// z subskrypcją - samoobsługową zmianą przez changeMySubscriptionPlan.
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDownRight, ArrowUpRight, Loader2 } from "lucide-react";
import { billingKeys } from "@/lib/billing/keys";
import { useAuth } from "@/hooks/useAuth";
import { changeMySubscriptionPlan, fetchActivePlans } from "@/lib/billing/queries";
import { buildPlanSwitchBoard, type PlanSwitchOption } from "@/lib/billing/planSwitch";
import {
  formatMoney,
  planName,
  type AccessPlan,
  type UserSubscriptionRow,
} from "@/lib/billing/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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

interface PlanSwitchBoardProps {
  subscription: UserSubscriptionRow | null;
}

export function PlanSwitchBoard({ subscription }: PlanSwitchBoardProps) {
  const { t, i18n } = useTranslation();
  const { isAdmin } = useAuth();
  const lang = i18n.language;
  const qc = useQueryClient();

  const plansQ = useQuery({ queryKey: billingKeys.plansActive(), queryFn: fetchActivePlans });
  const board = useMemo(
    () => buildPlanSwitchBoard(plansQ.data ?? [], subscription?.plan ?? null),
    [plansQ.data, subscription?.plan],
  );

  const changePlan = useMutation({
    mutationFn: (planId: string) => {
      if (!subscription) throw new Error("no-subscription");
      return changeMySubscriptionPlan(subscription.id, planId);
    },
    onSuccess: () => {
      toast.success(t("profile.subscription.changePlan.success"));
      void qc.invalidateQueries({ queryKey: billingKeys.mySubscriptionAll() });
      void qc.invalidateQueries({ queryKey: billingKeys.currentTierAll() });
      void qc.invalidateQueries({ queryKey: billingKeys.myOrdersAll() });
      void qc.invalidateQueries({ queryKey: billingKeys.myBillingDocumentsAll() });
      void qc.invalidateQueries({ queryKey: ["public", "resolved"] });
      void qc.invalidateQueries({ queryKey: ["unlocked-body"] });
    },
    onError: () => toast.error(t("profile.subscription.changePlan.error")),
  });

  const renderRow = (option: PlanSwitchOption) => {
    const Icon = option.direction === "upgrade" ? ArrowUpRight : ArrowDownRight;
    return (
      <li
        key={option.lookupKey}
        className="flex flex-col gap-2 rounded-[6px] border border-border/70 bg-background p-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Icon
              className={
                option.direction === "upgrade"
                  ? "h-4 w-4 shrink-0 text-primary"
                  : "h-4 w-4 shrink-0 text-muted-foreground"
              }
              aria-hidden="true"
            />
            <span className="truncate text-sm font-semibold">{planName(option.plan, lang)}</span>
            {/* Techniczny `lookup_key` katalogu widzą wyłącznie admin/super_admin. */}
            {isAdmin && (
              <Badge variant="outline" className="text-[11px]">
                {option.lookupKey}
              </Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatMoney(option.plan.price_cents, option.plan.currency, lang)}{" "}
            {intervalSuffix(option.plan.interval, t)} -{" "}
            {option.direction === "upgrade"
              ? t("profile.planPage.upgradeNote")
              : t("profile.planPage.downgradeNote")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link to="/plans/$planId" params={{ planId: option.plan.id }}>
              {t("profile.planPage.details")}
            </Link>
          </Button>
          {subscription ? (
            <Button
              size="sm"
              variant={option.direction === "upgrade" ? "default" : "outline"}
              disabled={changePlan.isPending}
              onClick={() => changePlan.mutate(option.plan.id)}
            >
              {changePlan.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              {option.direction === "upgrade"
                ? t("profile.planPage.upgradeCta")
                : t("profile.planPage.downgradeCta")}
            </Button>
          ) : (
            <Button asChild size="sm">
              <Link to="/pricing">{t("profile.planPage.chooseCta")}</Link>
            </Button>
          )}
        </div>
      </li>
    );
  };

  if (board.upgrades.length === 0 && board.downgrades.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("profile.planPage.switchTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-muted-foreground">{t("profile.planPage.switchHint")}</p>
        {board.upgrades.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("profile.planPage.upgradesTitle")}
            </h3>
            <ul className="space-y-2">{board.upgrades.map(renderRow)}</ul>
          </section>
        )}
        {board.downgrades.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("profile.planPage.downgradesTitle")}
            </h3>
            <ul className="space-y-2">{board.downgrades.map(renderRow)}</ul>
          </section>
        )}
      </CardContent>
    </Card>
  );
}
