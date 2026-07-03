import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { cancelMySubscription, fetchMySubscription } from "@/lib/billing/queries";
import { formatMoney, planName } from "@/lib/billing/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/profile/subscription")({
  component: SubscriptionPage,
});

function SubscriptionPage() {
  const { t, i18n } = useTranslation();
  const { session } = useAuth();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const { data } = useQuery({
    queryKey: ["my-subscription"],
    queryFn: fetchMySubscription,
    enabled: !!session,
  });

  const onCancel = async () => {
    if (!data) return;
    setBusy(true);
    try {
      await cancelMySubscription(data.id);
      await qc.invalidateQueries({ queryKey: ["my-subscription"] });
      toast.success(t("profile.subscription.canceled"));
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(i18n.language === "en" ? "en-US" : "pl-PL") : "-";

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("profile.subscription.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!data?.plan ? (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">{t("profile.subscription.none")}</p>
            <Button asChild>
              <Link to="/pricing">{t("profile.overview.seePlans")}</Link>
            </Button>
          </div>
        ) : (
          <>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <div className="text-xs uppercase text-muted-foreground">
                  {t("profile.subscription.plan")}
                </div>
                <div className="text-lg font-semibold">{planName(data.plan, i18n.language)}</div>
                <div className="text-sm text-muted-foreground">
                  {formatMoney(data.plan.price_cents, data.plan.currency, i18n.language)}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground">
                  {t("profile.subscription.status")}
                </div>
                <Badge>{t(`profile.status.${data.status}`)}</Badge>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground">
                  {t("profile.subscription.startedAt")}
                </div>
                <div>{fmtDate(data.started_at)}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground">
                  {data.canceled_at
                    ? t("profile.subscription.cancelsAt")
                    : t("profile.subscription.renewsAt")}
                </div>
                <div>{fmtDate(data.current_period_end)}</div>
              </div>
            </div>

            <div className="flex gap-2 pt-4">
              <Button asChild variant="outline">
                <Link to="/pricing">{t("profile.subscription.change")}</Link>
              </Button>
              {!data.canceled_at && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" disabled={busy}>
                      {t("profile.subscription.cancel")}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t("profile.subscription.cancel")}</AlertDialogTitle>
                      <AlertDialogDescription>
                        {t("profile.subscription.cancelConfirm")}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{t("auth.required")}</AlertDialogCancel>
                      <AlertDialogAction onClick={onCancel}>
                        {t("profile.subscription.cancel")}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
