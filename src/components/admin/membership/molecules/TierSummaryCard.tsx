// Molekuła: KOMPAKTOWY kafel jednej warstwy członkostwa w katalogu.
//
// Wcześniej katalog renderował pełne edytory jeden pod drugim - strona miała
// kilka ekranów przewijania i nie dało się porównać warstw. Teraz katalog to
// siatka kafli (nazwa, ranga, statusy, liczby benefitów i uprawnień), a cała
// edycja mieszka w oknie otwieranym kliknięciem kafla.
import { useTranslation } from "react-i18next";
import { BadgeCheck, ChevronRight, Gift, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { MembershipTierRow } from "@/lib/billing/tiers";

export function TierSummaryCard({
  tier,
  lang,
  name,
  description,
  benefitsCount,
  enabledCount,
  enforcedCount,
  onOpen,
}: {
  tier: MembershipTierRow;
  lang: "pl" | "en";
  name: string;
  description: string;
  benefitsCount: number;
  enabledCount: number;
  enforcedCount: number;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const tm = (k: string, opts?: Record<string, unknown>) => t(`adminMembership.${k}`, opts);
  void lang;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group flex w-full flex-col gap-2 rounded-[6px] border border-border bg-card p-4 text-left font-sans",
        "transition-[transform,border-color] duration-200 ease-out hover:-translate-y-0.5 hover:border-primary/50",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
      aria-label={tm("summary.open", { name })}
    >
      <span className="flex items-center gap-2">
        <BadgeCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-sm font-bold">{name}</span>
        <ChevronRight
          className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </span>

      <span className="flex flex-wrap items-center gap-1.5">
        <Badge variant="secondary" className="rounded-[6px] text-[10px]">
          {tm("rankBadge")} {tier.rank}
        </Badge>
        <span className="rounded-[6px] bg-muted px-1.5 py-0.5 text-[10px] font-semibold">
          {tier.key}
        </span>
        {tier.is_default && (
          <Badge className="rounded-[6px] bg-primary/10 text-[10px] text-primary hover:bg-primary/10">
            {tm("defaultBadge")}
          </Badge>
        )}
        {!tier.active && (
          <Badge variant="outline" className="rounded-[6px] text-[10px]">
            {tm("inactiveBadge")}
          </Badge>
        )}
      </span>

      {description && (
        <span className="line-clamp-2 text-xs leading-snug text-muted-foreground">
          {description}
        </span>
      )}

      <span className="mt-auto flex flex-wrap gap-1.5 pt-1 text-[11px] font-semibold">
        <span className="inline-flex items-center gap-1 rounded-[6px] bg-muted px-2 py-0.5 tabular-nums">
          <Gift className="h-3 w-3" aria-hidden="true" />
          {tm("summary.benefits", { count: benefitsCount })}
        </span>
        <span className="inline-flex items-center gap-1 rounded-[6px] bg-muted px-2 py-0.5 tabular-nums">
          {tm("summary.capabilities", { count: enabledCount })}
        </span>
        <span className="inline-flex items-center gap-1 rounded-[6px] bg-primary/10 px-2 py-0.5 text-primary tabular-nums">
          <ShieldCheck className="h-3 w-3" aria-hidden="true" />
          {tm("summary.enforced", { count: enforcedCount })}
        </span>
      </span>
    </button>
  );
}
