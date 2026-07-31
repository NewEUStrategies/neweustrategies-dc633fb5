// Atom: etykieta powodu wykluczenia adresu (twarde odbicie, skarga, ...).
//
// Kolor niesie informację o tym, czy blokada jest odwracalna: czerwony =
// trwała szkoda dla reputacji (skarga), pomarańczowy = adres martwy, żółty =
// problem chwilowy, szary = decyzja operatora.
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { SuppressionReason, SuppressionScope } from "@/lib/email/suppressionPolicy";
import "@/lib/i18n-newsletter-deliverability";

const TONE: Record<SuppressionReason, string> = {
  complaint: "bg-destructive/10 text-destructive border-destructive/30",
  hard_bounce: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/30",
  blocked: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/30",
  invalid: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/30",
  soft_bounce: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
  unsubscribe: "bg-muted text-muted-foreground border-border",
  manual: "bg-muted text-muted-foreground border-border",
};

interface SuppressionReasonBadgeProps {
  reason: SuppressionReason;
  scope?: SuppressionScope;
  className?: string;
}

export function SuppressionReasonBadge({ reason, scope, className }: SuppressionReasonBadgeProps) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
        TONE[reason],
        className,
      )}
      title={t(`adminDeliverability.reasonHint.${reason}`)}
    >
      {t(`adminDeliverability.reason.${reason}`)}
      {scope === "transient" && (
        <span className="opacity-70">· {t("adminDeliverability.scope.transient")}</span>
      )}
    </span>
  );
}
