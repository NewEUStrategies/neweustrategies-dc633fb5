// Karta statusu subskrypcji: czytelny stan (aktywna / próbny / anulowanie
// zaplanowane / zaległość / wstrzymana / anulowana), data kolejnego odnowienia
// albo wygaśnięcia oraz podgląd metody płatności pobranej od operatora.
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { CreditCard, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { billingKeys } from "@/lib/billing/keys";
import { formatDate } from "@/lib/i18n/format";
import { fetchMyStripeSubscription } from "@/lib/billing/subscriptionQueries";
import { deriveSubscriptionStatus, type SubscriptionTone } from "@/lib/billing/subscriptionStatus";
import type { UserSubscriptionRow } from "@/lib/billing/types";
import { getStripeEnvironmentSafe, isPaymentsConfigured } from "@/lib/stripe";
import { getMyPaymentMethod } from "@/utils/payments.functions";
import { useMyGrants } from "@/lib/billing/membership";
import { tierName, useCurrentTier } from "@/lib/billing/tiers";

const TONE_CLASS: Record<SubscriptionTone, string> = {
  success: "border-transparent bg-primary/10 text-primary",
  info: "border-transparent bg-secondary text-secondary-foreground",
  warning: "border-transparent bg-accent text-accent-foreground",
  danger: "border-transparent bg-destructive/10 text-destructive",
  muted: "border-transparent bg-muted text-muted-foreground",
};

interface Props {
  subscription: UserSubscriptionRow | null;
}

export function SubscriptionStatusCard({ subscription }: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { session } = useAuth();
  const uid = session?.user?.id;
  const env = getStripeEnvironmentSafe();

  const providerQ = useQuery({
    queryKey: billingKeys.myStripeSubscription(uid, env),
    queryFn: fetchMyStripeSubscription,
    enabled: !!session,
  });

  const methodQ = useQuery({
    queryKey: billingKeys.myPaymentMethod(uid, env),
    // Karta bywa nieskonfigurowana (dostęp z nadania) - to nie jest błąd,
    // więc brak metody zwracamy jako `null`, nie jako wyjątek.
    queryFn: async () => {
      const result = await getMyPaymentMethod({ data: { environment: env } });
      if ("error" in result && result.error) throw new Error(result.error);
      return "method" in result ? result.method : null;
    },
    enabled: !!session && isPaymentsConfigured(),
    staleTime: 5 * 60 * 1000,
  });

  // Dostęp z nadania (dożywotni VIP ekspertów NES) jest pełnoprawnym stanem -
  // bez niego karta pokazywałaby „brak subskrypcji" mimo aktywnych praw.
  const grantsQ = useMyGrants();
  const tierQ = useCurrentTier();

  const view = deriveSubscriptionStatus({
    local: subscription,
    provider: providerQ.data ?? null,
    grants: (grantsQ.data ?? [])
      .filter((g) => !g.revoked_at)
      .map((g) => ({ tierKey: g.tier_key, expiresAt: g.expires_at, source: g.source })),
  });

  // Formatowanie daty przez wspólny `formatDate`/`formatDateShort` - do
  // 19.08.2026 osiem miejsc w rozliczeniach liczyło ją własnym
  // `toLocaleDateString(lang === "en" ? "en-GB" : "pl-PL")`, bez zabezpieczenia
  // przed wartością niepoprawną (klient widział „Invalid Date" w miejscu daty).
  const fmtDate = (iso: string) => formatDate(iso, lang);

  const method = methodQ.data ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
          {t("profile.planPage.statusCard.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-3">
        <div>
          <p className="text-xs text-muted-foreground">{t("profile.planPage.statusCard.status")}</p>
          <p className="mt-1 flex flex-wrap items-center gap-2">
            <Badge className={TONE_CLASS[view.tone]}>
              {t(`profile.planPage.subStatus.${view.key}`)}
            </Badge>
            {view.grant && (
              <Badge variant="outline" className="font-semibold">
                {tierQ.data && tierQ.data.key === view.grant.tierKey
                  ? tierName(tierQ.data, lang === "en" ? "en" : "pl")
                  : view.grant.tierKey.toUpperCase()}
              </Badge>
            )}
          </p>
          {view.grant && (
            <p className="mt-1 text-xs text-muted-foreground">
              {t(`profile.planPage.grantSource.${view.grant.source}`, {
                defaultValue: t("profile.planPage.grantTitle"),
              })}
            </p>
          )}
        </div>

        <div>
          <p className="text-xs text-muted-foreground">
            {view.renewsAt
              ? t("profile.planPage.statusCard.renewsAt")
              : t("profile.planPage.statusCard.endsAt")}
          </p>
          <p className="mt-1 text-sm font-medium">
            {view.renewsAt || view.endsAt
              ? fmtDate((view.renewsAt ?? view.endsAt) as string)
              : view.key === "grantLifetime"
                ? t("profile.planPage.grantLifetime")
                : "-"}
          </p>
        </div>

        <div>
          <p className="text-xs text-muted-foreground">{t("profile.planPage.statusCard.method")}</p>
          {methodQ.isPending && isPaymentsConfigured() ? (
            <span className="mt-1 block h-5 w-28 animate-pulse rounded bg-muted" />
          ) : method ? (
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm font-medium">
              <CreditCard className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <span className="uppercase">{method.brand ?? method.type}</span>
              {method.last4 && <span>•••• {method.last4}</span>}
              {method.expMonth && method.expYear && (
                <span className="text-xs text-muted-foreground">
                  {t("profile.planPage.statusCard.expires", {
                    date: `${String(method.expMonth).padStart(2, "0")}/${String(method.expYear).slice(-2)}`,
                  })}
                </span>
              )}
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              {methodQ.isError
                ? t("profile.planPage.statusCard.methodError")
                : t("profile.planPage.statusCard.noMethod")}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
