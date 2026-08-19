// Karta dostępu przyznanego poza subskrypcją (membership_grants). Dla
// ekspertów New European Strategies to dożywotni VIP nadawany automatycznie
// wraz z odznaką eksperta - nie ma tu ceny ani odnowienia, więc plan
// „subskrypcyjny" nie potrafiłby tego pokazać.
import { useTranslation } from "react-i18next";
import { ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { activeGrants, isLifetimeGrant, useMyGrants } from "@/lib/billing/membership";
import { formatDateShort } from "@/lib/i18n/format";
import { useCurrentTier } from "@/lib/billing/tiers";

export function LifetimeAccessCard() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const grantsQ = useMyGrants();
  const tierQ = useCurrentTier();

  // Wspólna reguła zamiast lokalnej kopii - patrz komentarz przy `activeGrants`.
  const grants = activeGrants(grantsQ.data ?? []);
  if (grants.length === 0) return null;

  const tier = tierQ.data ?? null;
  const tierName = tier ? (lang === "en" ? tier.name_en : tier.name_pl) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
          {t("profile.planPage.grantTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {grants.map((grant) => (
          <div key={grant.id} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">
              {grant.tier_key === tier?.key && tierName ? tierName : grant.tier_key.toUpperCase()}
            </span>
            <Badge variant="secondary">
              {isLifetimeGrant(grant)
                ? t("profile.planPage.grantLifetime")
                : formatDateShort(grant.expires_at as string, lang)}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {grant.source === "expert"
                ? t("profile.planPage.grantExpert")
                : (grant.note ?? t(`profile.planPage.grantSource.${grant.source}`, grant.source))}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
