// Sekcja zarządzania subskrypcją - jedno źródło prawdy dla /profile/subscription
// oraz /profile/membership. Pokazuje plan, status subskrypcji, datę odnowienia
// lub wygaśnięcia, status ostatniej płatności (payment_orders) oraz akcje:
// zmiana planu, wznowienie i anulowanie (przez przepływ retencyjny).
// Gdy subskrypcja pochodzi z bramki płatności, całą obsługę przejmuje karta
// dostawcy (portal klienta) - nie duplikujemy sprzecznych akcji.
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CreditCard } from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { billingKeys } from "@/lib/billing/keys";
import { formatDateShort } from "@/lib/i18n/format";
import {
  cancelMySubscription,
  fetchMyOrders,
  fetchMySubscription,
  resumeMySubscription,
} from "@/lib/billing/queries";
import { formatMoney, planName } from "@/lib/billing/types";
import { tierName, useCurrentTier } from "@/lib/billing/tiers";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChangePlanCard } from "@/components/billing/molecules/ChangePlanCard";
import {
  SubscriptionCard,
  useMySubscriptionProvider,
} from "@/components/billing/organisms/SubscriptionCard";
import { RetentionDialog } from "@/components/billing/organisms/RetentionDialog";
import { CustomerPortalButton } from "@/components/billing/molecules/CustomerPortalButton";
import { SyncBillingButton } from "@/components/billing/molecules/SyncBillingButton";
import { LifetimeAccessCard } from "@/components/billing/molecules/LifetimeAccessCard";
import { primaryGrant, useMyGrants } from "@/lib/billing/membership";

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

export function SubscriptionManagerSection() {
  const { t, i18n } = useTranslation();
  const { session } = useAuth();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [retentionOpen, setRetentionOpen] = useState(false);

  const { data } = useQuery({
    queryKey: billingKeys.mySubscription(session?.user?.id),
    queryFn: fetchMySubscription,
    enabled: !!session,
  });

  // Status płatności: najświeższe zamówienie użytkownika. Widoczny status
  // (np. „Nieudane" / „Oczekujące") tłumaczy, dlaczego dostęp może nie działać.
  const ordersQ = useQuery({
    queryKey: billingKeys.myOrders(session?.user?.id),
    queryFn: fetchMyOrders,
    enabled: !!session,
  });
  const lastOrder = ordersQ.data?.[0] ?? null;

  // Nadanie (dożywotni VIP eksperta) zastępuje komunikat „brak subskrypcji" -
  // użytkownik ma widzieć swój realny poziom dostępu, nie pustkę.
  const grantsQ = useMyGrants();
  // Reguła „które nadanie faktycznie daje dostęp" mieszka w lib/billing/membership
  // (jedna dla wszystkich ekranów) - tu była jej lokalna kopia.
  const activeGrant = primaryGrant(grantsQ.data ?? []);

  const providerSubQ = useMySubscriptionProvider();
  const providerSub = providerSubQ.data ?? null;

  // Rezygnacja. Błąd jest zgłaszany DALEJ (`throw`), a nie połykany w toaście:
  // wywołuje to dialog retencyjny, który po nieudanym anulowaniu MUSI zostać
  // otwarty z komunikatem. Wcześniej wyjątek kończył się tutaj, więc dialog
  // widział rozwiązany promise, zamykał się jak po sukcesie i klient dostawał
  // najmocniejszy możliwy sygnał „zrezygnowano" przy subskrypcji, która dalej
  // była obciążana.
  const onCancel = async () => {
    if (!data) return;
    setBusy(true);
    try {
      await cancelMySubscription(data.id);
      await qc.invalidateQueries({ queryKey: billingKeys.mySubscriptionAll() });
      toast.success(t("profile.subscription.canceled"));
    } catch (error) {
      toast.error(t("profile.subscription.cancelFailed"));
      throw error;
    } finally {
      setBusy(false);
    }
  };

  const onResume = async () => {
    if (!data) return;
    setBusy(true);
    try {
      await resumeMySubscription(data.id);
      await qc.invalidateQueries({ queryKey: billingKeys.mySubscriptionAll() });
      toast.success(t("profile.subscription.resumed"));
    } catch {
      toast.error(t("profile.subscription.resumeError"));
    } finally {
      setBusy(false);
    }
  };

  const fmtDate = (iso: string | null) => (iso ? formatDateShort(iso, i18n.language) || "-" : "-");

  // Wznowienie ma sens tylko dopóki opłacony okres trwa - po jego końcu
  // subskrypcję trzeba kupić od nowa (nowy checkout).
  const periodStillRunning =
    !!data?.current_period_end && new Date(data.current_period_end).getTime() > Date.now();
  const canResume = !!data?.canceled_at && data.status === "active" && periodStillRunning;

  const paymentBadge = lastOrder ? (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-[6px] border border-border/60 bg-muted/30 px-3 py-2.5">
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        <CreditCard className="h-4 w-4" aria-hidden="true" />
        {t("profile.subscription.paymentStatus")}
      </span>
      <span className="flex items-center gap-2">
        <Badge variant={lastOrder.status === "paid" ? "secondary" : "destructive"}>
          {t(`profile.status.${lastOrder.status}`)}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {formatMoney(lastOrder.amount_cents, lastOrder.currency, i18n.language)}
        </span>
      </span>
    </div>
  ) : null;

  if (providerSub) {
    return (
      <div className="space-y-6">
        <SubscriptionCard subscription={providerSub} />
        {paymentBadge}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2">
            <span>{t("profile.subscription.title")}</span>
            <TierChip />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!data?.plan && activeGrant ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  {activeGrant.tier_key.toUpperCase()}
                  <Badge variant="secondary">
                    {activeGrant.expires_at
                      ? fmtDate(activeGrant.expires_at)
                      : t("profile.planPage.grantLifetime")}
                  </Badge>
                </p>
                <p className="text-xs text-muted-foreground">
                  {t(`profile.planPage.grantSource.${activeGrant.source}`, {
                    defaultValue: t("profile.planPage.grantTitle"),
                  })}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <SyncBillingButton />
                <Button asChild variant="outline">
                  <Link to="/pricing">{t("profile.overview.seePlans")}</Link>
                </Button>
              </div>
            </div>
          ) : !data?.plan ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">{t("profile.subscription.none")}</p>
              <div className="flex flex-wrap gap-2">
                {/* Brak planu bywa artefaktem spóźnionego webhooka - pozwalamy
                    pobrać stan wprost od operatora zamiast czekać. */}
                <SyncBillingButton />
                <Button asChild>
                  <Link to="/pricing">{t("profile.overview.seePlans")}</Link>
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <div className="text-xs uppercase text-muted-foreground">
                    {t("profile.subscription.plan")}
                  </div>
                  <div className="text-lg font-semibold">{planName(data.plan, i18n.language)}</div>
                  <div className="text-sm text-muted-foreground">
                    {formatMoney(data.plan.price_cents, data.plan.currency, i18n.language)}
                  </div>
                  <Button asChild variant="link" className="h-auto p-0 text-xs">
                    <Link to="/plans/$planId" params={{ planId: data.plan.id }}>
                      {t("pricing.planDetails.cta")}
                    </Link>
                  </Button>
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

              {paymentBadge}

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

              <div className="flex flex-wrap gap-2 pt-4">
                <Button asChild variant="outline">
                  <Link to="/pricing">{t("profile.subscription.change")}</Link>
                </Button>
                {/* Portal operatora: zmiana planu/ceny, metoda płatności,
                    faktury i anulowanie bez opuszczania serwisu. */}
                <CustomerPortalButton size="default" />
                {/* Ratunek na spóźniony webhook: pobiera stan wprost od operatora. */}
                <SyncBillingButton size="default" />

                {!data.canceled_at && (
                  <>
                    {/* Przepływ retencyjny zamiast prostego potwierdzenia:
                        ankieta powodu + kontroferta, dopiero potem anulowanie. */}
                    <Button
                      variant="destructive"
                      disabled={busy}
                      onClick={() => setRetentionOpen(true)}
                    >
                      {t("profile.subscription.cancel")}
                    </Button>
                    <RetentionDialog
                      open={retentionOpen}
                      onOpenChange={setRetentionOpen}
                      subscriptionId={data.id}
                      onConfirmCancel={onCancel}
                    />
                  </>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Dostęp spoza planu (np. dożywotni VIP eksperta) - subskrypcji nie ma,
          a uprawnienia jak najbardziej. */}
      <LifetimeAccessCard />

      {/* Samoobsługowy upgrade/downgrade: tylko aktywna subskrypcja z
          trwającym okresem (po wygaśnięciu potrzebny nowy checkout). */}
      {data && data.status === "active" && periodStillRunning && (
        <ChangePlanCard subscription={data} />
      )}
    </div>
  );
}
