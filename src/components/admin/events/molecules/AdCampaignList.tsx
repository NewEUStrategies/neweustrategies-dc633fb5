// Molekula: lista zmapowanych kampanii z akcjami (koszty, edycja, usuniecie).
//
// Prezentacja bez zapytan - organizm podaje liste i reaguje na akcje. Kazdy
// przycisk ma nazwe z etykieta kampanii (`aria-label`), bo trzy "Edytuj" pod
// soba nie mowia czytnikowi ekranu, ktora kampanie edytuja.
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pencil, Target, Trash2 } from "@/lib/lucide-shim";
import type { AdCampaign, AdCampaignMatchKind } from "@/lib/events/adsFunnelApi";
import { microsToCents } from "@/lib/events/adsFunnel";
import { formatAmounts } from "@/lib/events/adsFunnelFormat";
import { ensureAdsFunnelI18n } from "@/lib/i18n-admin-event-ads-funnel";

const MATCH_KIND_LABEL_KEYS: Record<AdCampaignMatchKind, string> = {
  utm_campaign: "adminEventAdsFunnel.matchKinds.utm_campaign",
  google_ads_campaign_id: "adminEventAdsFunnel.matchKinds.google_ads_campaign_id",
};

function costSummary(campaign: AdCampaign, lang: string): { amount: string; days: number } | null {
  const amount = formatAmounts(
    campaign.costs.map((cost) => ({
      currency: cost.currency,
      cents: microsToCents(cost.costMicros),
    })),
    lang,
  );
  if (amount === null) return null;
  return { amount, days: campaign.costs.reduce((sum, cost) => sum + cost.days, 0) };
}

export function AdCampaignList({
  campaigns,
  lang,
  disabled,
  onEdit,
  onDelete,
  onCosts,
}: {
  campaigns: readonly AdCampaign[];
  lang: string;
  disabled: boolean;
  onEdit: (campaign: AdCampaign) => void;
  onDelete: (campaign: AdCampaign) => void;
  onCosts: (campaign: AdCampaign) => void;
}) {
  ensureAdsFunnelI18n();
  const { t } = useTranslation();

  return (
    <ul className="divide-y divide-border rounded-[6px] border border-border">
      {campaigns.map((campaign) => {
        const summary = costSummary(campaign, lang);
        return (
          <li
            key={campaign.id}
            className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm"
          >
            <div className="min-w-0 space-y-1">
              <p className="font-medium">{campaign.label}</p>
              {/* `div`, nie `p`: Badge rysuje `div`, a `div` w `p` psuje HTML i hydratacje. */}
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">{t(MATCH_KIND_LABEL_KEYS[campaign.matchKind])}</Badge>
                <span className="font-mono">{campaign.matchValue}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {summary === null
                  ? t("adminEventAdsFunnel.campaigns.noCosts")
                  : t("adminEventAdsFunnel.campaigns.costsSummary", {
                      amount: summary.amount,
                      count: summary.days,
                    })}
                {" · "}
                {campaign.conversionActionName === null
                  ? t("adminEventAdsFunnel.campaigns.noConversion")
                  : t("adminEventAdsFunnel.campaigns.conversion", {
                      name: campaign.conversionActionName,
                    })}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="outline"
                onClick={() => onCosts(campaign)}
                disabled={disabled}
                aria-label={`${t("adminEventAdsFunnel.campaigns.costs")}: ${campaign.label}`}
              >
                <Target className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                {t("adminEventAdsFunnel.campaigns.costs")}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => onEdit(campaign)}
                disabled={disabled}
                aria-label={`${t("adminEventAdsFunnel.campaigns.edit")}: ${campaign.label}`}
              >
                <Pencil className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => onDelete(campaign)}
                disabled={disabled}
                aria-label={`${t("adminEventAdsFunnel.campaigns.delete")}: ${campaign.label}`}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
