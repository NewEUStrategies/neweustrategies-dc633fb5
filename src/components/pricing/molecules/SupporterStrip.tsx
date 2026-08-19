// Warstwa "Wspierający" celowo NIE jest kartą w drabince cen (paradoks
// wyboru: trzy karty decyzyjne, wsparcie misji jako osobna, spokojna ścieżka).
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { HandHeart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { tierName, type MembershipTierRow } from "@/lib/billing/tiers";

export function SupporterStrip({ tier, lang }: { tier: MembershipTierRow; lang: string }) {
  const { t } = useTranslation();
  const description = lang === "en" ? tier.description_en : tier.description_pl;
  return (
    <div className="mt-6 flex flex-col items-center justify-between gap-4 rounded-xl border border-border bg-muted/20 p-5 sm:flex-row">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <HandHeart className="h-4 w-4 text-primary" aria-hidden="true" />
        </span>
        <div>
          <p className="font-semibold">{tierName(tier, lang)}</p>
          <p className="text-sm text-muted-foreground">
            {description || t("pricing.supporterStrip.body")}
          </p>
        </div>
      </div>
      <Button asChild size="sm" variant="outline" className="shrink-0">
        <Link to="/support" search={{ status: undefined }}>
          {t("pricing.tiers.supporterCta")}
        </Link>
      </Button>
    </div>
  );
}
