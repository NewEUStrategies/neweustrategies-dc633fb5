import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { fetchMySubscription } from "@/lib/billing/queries";
import { formatMoney, planName } from "@/lib/billing/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/profile/")({
  component: ProfileOverview,
});

function ProfileOverview() {
  const { t, i18n } = useTranslation();
  const { user, session, roles } = useAuth();
  const lang = i18n.language;

  const sub = useQuery({
    queryKey: ["my-subscription", user?.id],
    queryFn: fetchMySubscription,
    enabled: !!session,
  });

  const memberSince = user?.created_at
    ? new Date(user.created_at).toLocaleDateString(lang === "en" ? "en-US" : "pl-PL", {
        year: "numeric",
        month: "long",
      })
    : "-";

  const displayName = user?.user_metadata?.display_name || user?.email?.split("@")[0] || "";

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("profile.overview.welcome", { name: displayName })}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {t("profile.overview.memberSince", { date: memberSince })}
          </p>
          {roles.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-3">
              {roles.map((r) => (
                <Badge key={r} variant={r === "super_admin" || r === "admin" ? "default" : "secondary"}>
                  {t(`profile.role.${r}`)}
                </Badge>
              ))}
            </div>
          )}
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("profile.overview.planActive")}</CardTitle>
        </CardHeader>
        <CardContent>
          {sub.data?.plan ? (
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-semibold">{planName(sub.data.plan, lang)}</span>
                  <Badge variant="secondary">{t("profile.status.active")}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {formatMoney(sub.data.plan.price_cents, sub.data.plan.currency, lang)}
                </p>
              </div>
              <Button asChild variant="outline">
                <Link to="/profile/subscription">{t("profile.overview.manageBilling")}</Link>
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm text-muted-foreground">{t("profile.overview.planNone")}</p>
              <Button asChild>
                <Link to="/pricing">{t("profile.overview.seePlans")}</Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
