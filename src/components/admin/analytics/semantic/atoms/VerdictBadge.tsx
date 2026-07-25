/**
 * Atom: werdykt uzgodnienia metryki jako badge z kolorem semantycznym.
 *
 * Kolor niesie informację, na którą admin ma zareagować: bursztyn/czerwień to
 * rozjazd wymagający sprawdzenia konfiguracji, zieleń to zgodność, błękit to
 * stan neutralny (dryf oczekiwany, jedno źródło). Wyłącznie tokeny semantyczne -
 * bez sztywnych kolorów.
 */
import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-semantic";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ReconciliationVerdict } from "@/lib/analytics/semantic";

const VERDICT_CLASS: Record<ReconciliationVerdict, string> = {
  aligned: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  expected_drift: "bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30",
  single_source: "bg-muted text-muted-foreground border-border",
  incomparable: "bg-muted text-muted-foreground border-border",
  divergent: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  order_inverted: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
  unavailable: "bg-muted text-muted-foreground border-dashed border-border",
};

export function VerdictBadge({ verdict }: { verdict: ReconciliationVerdict }) {
  const { t } = useTranslation();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={`text-[10px] uppercase tracking-wide ${VERDICT_CLASS[verdict]}`}
        >
          {t(`adminAnalytics.semantic.verdict.${verdict}`)}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs leading-relaxed">
        {t(`adminAnalytics.semantic.verdictHint.${verdict}`)}
      </TooltipContent>
    </Tooltip>
  );
}
