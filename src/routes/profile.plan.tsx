// „Mój plan" - jedno miejsce, w którym użytkownik widzi aktywny plan (wraz z
// lookup_key ceny u operatora), skróconą historię płatności oraz ścieżki
// zmiany planu w górę/w dół wyprowadzone z rangi katalogu (lib/billing/
// planSwitch). Pełny rejestr faktur pozostaje na /profile/orders.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { CreditCard } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { billingKeys } from "@/lib/billing/keys";
import { fetchMyOrders, fetchMySubscription } from "@/lib/billing/queries";
import { catalogPriceForPlan } from "@/lib/billing/catalog";
import { formatMoney, planName } from "@/lib/billing/types";
import { PlanSwitchBoard } from "@/components/billing/PlanSwitchBoard";
import { CustomerPortalButton } from "@/components/billing/CustomerPortalButton";
import { SyncBillingButton } from "@/components/billing/SyncBillingButton";
import { LifetimeAccessCard } from "@/components/billing/LifetimeAccessCard";
import { SubscriptionStatusCard } from "@/components/billing/SubscriptionStatusCard";
import { PaymentHistoryCard } from "@/components/billing/PaymentHistoryCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/profile/plan")({
  component: PlanPage,
});

function statusVariant(s: string): "default" | "secondary" | "destructive" | "outline" {
  if (s === "paid") return "default";
  if (s === "failed" || s === "refunded" || s === "canceled") return "destructive";
  return "secondary";
}

function PlanPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { session } = useAuth();
  const uid = session?.user?.id;

  const subQ = useQuery({
    queryKey: billingKeys.mySubscription(uid),
    queryFn: fetchMySubscription,
    enabled: !!session,
  });
  const ordersQ = useQuery({
    queryKey: billingKeys.myOrders(uid),
    queryFn: fetchMyOrders,
    enabled: !!session,
  });

  const subscription = subQ.data ?? null;
  const plan = subscription?.plan ?? null;
  const lookupKey = plan ? (catalogPriceForPlan(plan)?.priceId ?? null) : null;
  const orders = (ordersQ.data ?? []).slice(0, 10);

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(lang === "en" ? "en-GB" : "pl-PL", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

  return (
    <div className="space-y-6">
      <SubscriptionStatusCard subscription={subscription} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CreditCard className="h-4 w-4 text-primary" aria-hidden="true" />
            {t("profile.planPage.activeTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!plan ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">{t("profile.planPage.noPlan")}</p>
              <Button asChild size="sm">
                <Link to="/pricing">{t("profile.planPage.chooseCta")}</Link>
              </Button>
            </div>
          ) : (
            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">{t("profile.subscription.plan")}</dt>
                <dd className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  {planName(plan, lang)}
                  {lookupKey && (
                    <Badge variant="outline" className="font-mono text-[11px]">
                      {lookupKey}
                    </Badge>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">
                  {t("profile.subscription.status")}
                </dt>
                <dd className="text-sm">{t(`profile.status.${subscription?.status ?? "active"}`)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">
                  {t("profile.planPage.priceLabel")}
                </dt>
                <dd className="text-sm">{formatMoney(plan.price_cents, plan.currency, lang)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">
                  {subscription?.canceled_at
                    ? t("profile.subscription.cancelsAt")
                    : t("profile.subscription.renewsAt")}
                </dt>
                <dd className="text-sm">
                  {subscription?.current_period_end
                    ? fmtDate(subscription.current_period_end)
                    : "-"}
                </dd>
              </div>
            </dl>
          )}

          {/* Pełne zarządzanie planem, ceną i anulowaniem po stronie operatora. */}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <CustomerPortalButton returnPath="/profile/plan" />
            <SyncBillingButton />
            <p className="text-xs text-muted-foreground">
              {t("profile.subscription.portal.manageHint")}
            </p>
          </div>
        </CardContent>
      </Card>

      <LifetimeAccessCard />

      <PlanSwitchBoard subscription={subscription} />


      <PaymentHistoryCard limit={10} showAllLink />
    </div>
  );
}
