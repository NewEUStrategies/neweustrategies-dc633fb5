import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import {
  cancelMySubscription,
  fetchMySubscription,
  resumeMySubscription,
} from "@/lib/billing/queries";
import { formatMoney, planName } from "@/lib/billing/types";
import { tierName, useCurrentTier } from "@/lib/billing/tiers";
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
    } catch {
      // Serwer nie oznacza anulowania, jeśli Stripe odmówił - komunikat musi
      // być czytelny, a nie surowy kod błędu.
      toast.error(t("profile.subscription.cancelFailed"));
    } finally {
      setBusy(false);
    }
  };

  const onResume = async () => {
    if (!data) return;
    setBusy(true);
    try {
      await resumeMySubscription(data.id);
      await qc.invalidateQueries({ queryKey: ["my-subscription"] });
      toast.success(t("profile.subscription.resumed"));
    } catch {
      toast.error(t("profile.subscription.resumeError"));
    } finally {
      setBusy(false);
    }
  };

  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(i18n.language === "en" ? "en-US" : "pl-PL") : "-";

  // Wznowienie ma sens tylko dopóki opłacony okres trwa - po jego końcu
  // subskrypcję trzeba kupić od nowa (nowy checkout).
  const periodStillRunning =
    !!data?.current_period_end && new Date(data.current_period_end).getTime() > Date.now();
  const canResume = !!data?.canceled_at && data.status === "active" && periodStillRunning;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span>{t("profile.subscription.title")}</span>
          <TierChip />
        </CardTitle>
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

            {canResume && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-[6px] border border-border/60 bg-muted/30 px-3 py-2.5">
                <p className="text-sm text-muted-foreground">
                  {t("profile.subscription.accessUntil", {
                    date: fmtDate(data.current_period_end),
                  })}
                </p>
                <Button size="sm" disabled={busy} onClick={onResume}>
                  {t("profile.subscription.resume")}
                </Button>
              </div>
            )}

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
                      <AlertDialogCancel>{t("profile.subscription.keep")}</AlertDialogCancel>
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

/** Warstwa członkostwa wołającego (RPC; dla braku subskrypcji: domyślna). */
function TierChip() {
  const { i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const tier = useCurrentTier();
  if (!tier.data) return null;
  return (
    <Badge variant="secondary" className="shrink-0">
      {tierName(tier.data, lang)}
    </Badge>
  );
}
