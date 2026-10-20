// „Mój plan" - jedno miejsce, w którym użytkownik widzi aktywny plan (wraz z
// lookup_key ceny u operatora), skróconą historię płatności oraz ścieżki
// zmiany planu w górę/w dół wyprowadzone z rangi katalogu (lib/billing/
// planSwitch). Pełny rejestr faktur pozostaje na /profile/orders.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CreditCard, Loader2, RotateCcw } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { billingKeys } from "@/lib/billing/keys";
import { fetchMySubscription, resumeMySubscription } from "@/lib/billing/queries";
import {
  canResumeStripeSubscription,
  fetchMyStripeSubscription,
} from "@/lib/billing/subscriptionQueries";
import { unwrapProviderResult } from "@/lib/billing/providerResult";
import { toastSubscriptionFailure } from "@/lib/billing/paymentOutcomeToast";
import { formatDateShort } from "@/lib/i18n/format";
import { catalogPriceForPlan } from "@/lib/billing/catalog";
import { isRepriceLookupKey } from "@/lib/billing/subscriptionRepricing";
import { isLivePlanSubscriptionStatus } from "@/lib/billing/planSubscriptionGuard";
import { formatMoney, planName } from "@/lib/billing/types";
import { getStripeEnvironmentSafe } from "@/lib/stripe";
import { getStripeRenewalCharge, resumeStripeSubscription } from "@/utils/payments.functions";
import { PlanSwitchBoard } from "@/components/billing/molecules/PlanSwitchBoard";
import { CustomerPortalButton } from "@/components/billing/molecules/CustomerPortalButton";
import { SyncBillingButton } from "@/components/billing/molecules/SyncBillingButton";
import { LifetimeAccessCard } from "@/components/billing/molecules/LifetimeAccessCard";
import { SubscriptionStatusCard } from "@/components/billing/organisms/SubscriptionStatusCard";
import { PaymentHistoryCard } from "@/components/billing/organisms/PaymentHistoryCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useMyGrants } from "@/lib/billing/membership";
import { tierName, useCurrentTier } from "@/lib/billing/tiers";

export const Route = createFileRoute("/profile/plan")({
  component: PlanPage,
});

function PlanPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { session, isAdmin } = useAuth();
  const uid = session?.user?.id;

  const subQ = useQuery({
    queryKey: billingKeys.mySubscription(uid),
    queryFn: fetchMySubscription,
    enabled: !!session,
  });

  // Dostęp z nadania (dożywotni VIP eksperta) jest „aktywnym planem" z punktu
  // widzenia użytkownika, choć nie ma ceny ani odnowienia.
  const grantsQ = useMyGrants();
  const tierQ = useCurrentTier();
  const activeGrant =
    (grantsQ.data ?? []).find(
      (g) => !g.revoked_at && (!g.expires_at || new Date(g.expires_at).getTime() > Date.now()),
    ) ?? null;

  const subscription = subQ.data ?? null;
  const plan = subscription?.plan ?? null;
  const lookupKey = plan ? (catalogPriceForPlan(plan)?.priceId ?? null) : null;

  // „CENA" = KWOTA ODNOWIENIA U OPERATORA, ta sama reguła co karta
  // subskrypcji (`SubscriptionCard`). `plan.price_cents` to cena NOWEGO
  // zakupu: po v6.2 Członek, Członek Pro i Zespół mają ją niższą (39 zł),
  // a trwająca subskrypcja odnawia się po swojej starej cenie (59 zł), dopóki
  // admin jej nie przeniesie - pominięte przez akcję na stałe. Ta strona jest
  // celem CTA przypomnienia o odnowieniu i maila o niższej cenie, więc
  // „Cena: 39 zł" obok daty, w której operator pobierze 59 zł, to błędna
  // informacja o kwocie. Dla tych kluczy kwota wyłącznie z odczytu operatora,
  // a bez niego - brak kwoty; dla pozostałych katalog jest bezpiecznym zapasem.
  //
  // Plan jest z `user_subscriptions`, kwota z najnowszego wiersza lustra
  // `subscriptions` - to nie zawsze ta sama subskrypcja (porzucony 3DS
  // osobnego zakupu zostawia nowszy wiersz `incomplete`). Kwota tylko przy
  // ZGODNEJ cenie (`lookup_key` planu) i żywym statusie; inaczej brak kwoty.
  const catalogPriceTrusted = !isRepriceLookupKey(lookupKey);
  const environment = getStripeEnvironmentSafe();
  const chargeQ = useQuery({
    queryKey: billingKeys.myRenewalCharge(uid, environment, subscription?.id, lookupKey),
    queryFn: () => getStripeRenewalCharge({ data: { environment } }),
    enabled: !!session && !!plan && !catalogPriceTrusted,
    staleTime: 60_000,
    retry: false,
  });
  const liveCharge =
    !catalogPriceTrusted &&
    chargeQ.data &&
    chargeQ.data.priceId === lookupKey &&
    isLivePlanSubscriptionStatus(chargeQ.data.status) &&
    chargeQ.data.amountCents !== null &&
    chargeQ.data.currency
      ? { amountCents: chargeQ.data.amountCents, currency: chargeQ.data.currency }
      : null;
  const priceText = !plan
    ? null
    : catalogPriceTrusted
      ? formatMoney(plan.price_cents, plan.currency, lang)
      : liveCharge
        ? formatMoney(liveCharge.amountCents, liveCharge.currency, lang)
        : null;

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(lang === "en" ? "en-GB" : "pl-PL", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

  return (
    <div className="space-y-6">
      <SubscriptionStatusCard subscription={subscription} />

      <ResumeSubscriptionAction
        userId={uid}
        localSubscription={
          subscription
            ? {
                id: subscription.id,
                status: subscription.status,
                canceledAt: subscription.canceled_at ?? null,
                periodEnd: subscription.current_period_end ?? null,
              }
            : null
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CreditCard className="h-4 w-4 text-primary" aria-hidden="true" />
            {t("profile.planPage.activeTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!plan && activeGrant ? (
            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">{t("profile.subscription.plan")}</dt>
                <dd className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  {tierQ.data && tierQ.data.key === activeGrant.tier_key
                    ? tierName(tierQ.data, lang === "en" ? "en" : "pl")
                    : activeGrant.tier_key.toUpperCase()}
                  <Badge variant="secondary">
                    {t(`profile.planPage.grantSource.${activeGrant.source}`, {
                      defaultValue: t("profile.planPage.grantTitle"),
                    })}
                  </Badge>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">
                  {t("profile.planPage.statusCard.endsAt")}
                </dt>
                <dd className="text-sm">
                  {activeGrant.expires_at
                    ? fmtDate(activeGrant.expires_at)
                    : t("profile.planPage.grantLifetime")}
                </dd>
              </div>
            </dl>
          ) : !plan ? (
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
                  {/* `lookup_key` to identyfikator techniczny - tylko dla adminów. */}
                  {isAdmin && lookupKey && (
                    <Badge variant="outline" className="text-[11px]">
                      {lookupKey}
                    </Badge>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">
                  {t("profile.subscription.status")}
                </dt>
                <dd className="text-sm">
                  {t(`profile.status.${subscription?.status ?? "active"}`)}
                </dd>
              </div>
              {priceText ? (
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {t("profile.planPage.priceLabel")}
                  </dt>
                  <dd className="text-sm">{priceText}</dd>
                </div>
              ) : null}
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

/**
 * Wznowienie z „Mojego planu" (P12). Mail o rezygnacji prowadzi tu („wznów
 * przed końcem okresu"), a strona dawniej nie miała przycisku wznowienia -
 * klient z maila trafiał na pustą obietnicę. O tym, czy jest co wznawiać,
 * rozstrzyga STAN OPERATORA (lustro `subscriptions`: zaplanowany koniec albo
 * pauza - ta sama reguła co karta operatora), a bez lustra - lokalne
 * `canceled_at` przy trwającym okresie (ta sama reguła co sekcja subskrypcji).
 * Serwer i tak pyta operatora o żywy stan, więc przycisk nie obiecuje
 * niczego, czego operator nie wykona.
 */
function ResumeSubscriptionAction({
  userId,
  localSubscription,
}: {
  userId: string | undefined;
  localSubscription: {
    id: string;
    status: string;
    canceledAt: string | null;
    periodEnd: string | null;
  } | null;
}) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const environment = getStripeEnvironmentSafe();
  const providerQ = useQuery({
    queryKey: billingKeys.myStripeSubscription(userId, environment),
    queryFn: fetchMyStripeSubscription,
    enabled: !!userId,
  });
  const provider = providerQ.data ?? null;

  const localRunning =
    !!localSubscription?.periodEnd && Date.parse(localSubscription.periodEnd) > Date.now();
  const canResume = provider
    ? canResumeStripeSubscription(provider)
    : !!localSubscription?.canceledAt && localSubscription.status === "active" && localRunning;
  const endsAt = provider ? provider.current_period_end : (localSubscription?.periodEnd ?? null);

  const resume = useMutation({
    mutationFn: async () => {
      if (provider) {
        await resumeStripeSubscription({ data: { environment } }).then(unwrapProviderResult);
        return;
      }
      if (localSubscription) await resumeMySubscription(localSubscription.id);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: billingKeys.myStripeSubscriptionAll() });
      void qc.invalidateQueries({ queryKey: billingKeys.mySubscriptionAll() });
      void qc.invalidateQueries({ queryKey: billingKeys.currentTierAll() });
      toast.success(t("profile.subscription.resumed"));
    },
    onError: (error) => toastSubscriptionFailure(t, error, "profile.subscription.resumeError"),
  });

  if (!canResume) return null;
  const date = endsAt ? formatDateShort(endsAt, i18n.language) || "-" : "-";

  return (
    <Card data-testid="plan-resume">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
        <div className="space-y-1">
          <p className="text-sm font-semibold">{t("profile.planPage.resume.title", { date })}</p>
          <p className="text-xs text-muted-foreground">{t("profile.planPage.resume.hint")}</p>
        </div>
        <Button size="sm" disabled={resume.isPending} onClick={() => resume.mutate()}>
          {resume.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
          )}
          {t("profile.planPage.resume.cta")}
        </Button>
      </CardContent>
    </Card>
  );
}
