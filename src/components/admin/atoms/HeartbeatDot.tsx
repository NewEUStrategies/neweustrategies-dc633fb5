// Atom: kropka świeżości harmonogramu + zlokalizowana etykieta.
//
// Kolor NIGDY nie jest jedynym nośnikiem informacji (WCAG 1.4.1): obok kropki
// stoi etykieta tekstowa (albo sr-only, gdy wariant jest kompaktowy), a stan
// "zastój" pulsuje wyłącznie przy zgodzie na animację (prefers-reduced-motion).
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { SchedulerFreshness } from "@/lib/jobs/scheduler";
import { ensureI18n } from "@/lib/i18n-admin-scheduler";

ensureI18n();

const DOT: Record<SchedulerFreshness, string> = {
  fresh: "bg-emerald-500",
  lagging: "bg-amber-500",
  stale: "bg-destructive motion-safe:animate-pulse",
  never: "bg-muted-foreground/50",
};

const TEXT: Record<SchedulerFreshness, string> = {
  fresh: "text-emerald-600 dark:text-emerald-400",
  lagging: "text-amber-600 dark:text-amber-400",
  stale: "text-destructive",
  never: "text-muted-foreground",
};

interface HeartbeatDotProps {
  freshness: SchedulerFreshness;
  /** false = sama kropka (np. w gęstym wierszu tabeli). */
  withLabel?: boolean;
  className?: string;
}

export function HeartbeatDot({ freshness, withLabel = true, className }: HeartbeatDotProps) {
  const { t } = useTranslation();
  const label = t(`adminScheduler.freshness.${freshness}`);
  return (
    <span className={cn("inline-flex items-center gap-1.5", TEXT[freshness], className)}>
      <span
        aria-hidden="true"
        className={cn("inline-block h-2 w-2 shrink-0 rounded-full", DOT[freshness])}
      />
      {withLabel ? (
        <span className="text-[11px] font-medium uppercase tracking-wider">{label}</span>
      ) : (
        <span className="sr-only">{label}</span>
      )}
    </span>
  );
}
