// Atom: kropka statusu reputacji + etykieta tekstowa.
//
// Kolor NIGDY nie jest jedynym nośnikiem informacji (WCAG 1.4.1): obok kropki
// zawsze stoi zlokalizowana etykieta, a title/aria niosą pełny opis.
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { ReputationStatus } from "@/lib/email/reputation";
import "@/lib/i18n-newsletter-deliverability";

const DOT: Record<ReputationStatus, string> = {
  healthy: "bg-emerald-500",
  watch: "bg-amber-500",
  critical: "bg-destructive",
  insufficient_data: "bg-muted-foreground/50",
};

const TEXT: Record<ReputationStatus, string> = {
  healthy: "text-emerald-600 dark:text-emerald-400",
  watch: "text-amber-600 dark:text-amber-400",
  critical: "text-destructive",
  insufficient_data: "text-muted-foreground",
};

interface ReputationStatusDotProps {
  status: ReputationStatus;
  /** false = sama kropka (np. w gęstej tabeli). */
  withLabel?: boolean;
  className?: string;
}

export function ReputationStatusDot({
  status,
  withLabel = true,
  className,
}: ReputationStatusDotProps) {
  const { t } = useTranslation();
  const label = t(`adminDeliverability.status.${status}`);
  return (
    <span className={cn("inline-flex items-center gap-1.5", TEXT[status], className)}>
      <span
        aria-hidden="true"
        className={cn("inline-block h-2 w-2 shrink-0 rounded-full", DOT[status])}
      />
      {withLabel ? (
        <span className="text-[11px] font-medium uppercase tracking-wider">{label}</span>
      ) : (
        <span className="sr-only">{label}</span>
      )}
    </span>
  );
}
