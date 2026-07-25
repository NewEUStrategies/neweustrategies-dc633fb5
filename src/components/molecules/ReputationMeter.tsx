// Molekuła: kafel wskaźnika reputacji ze skalą progową.
//
// Sam procent nic nie mówi operatorowi - dopiero POZYCJA wobec progów
// (cel / twardy limit) tłumaczy, czy 0,12% to sukces czy alarm. Pasek jest
// skalowany do 1,5x limitu, więc przekroczenie zawsze widać jako wypełnienie
// przy prawej krawędzi, a znaczniki celu i limitu stoją w stałych miejscach.
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { ReputationStatusDot } from "@/components/atoms/ReputationStatusDot";
import { formatRate, type ReputationMetric } from "@/lib/email/reputation";
import "@/lib/i18n-newsletter-deliverability";

interface ReputationMeterProps {
  label: string;
  hint: string;
  metric: ReputationMetric;
  locale: string;
  className?: string;
}

const FILL: Record<ReputationMetric["status"], string> = {
  healthy: "bg-emerald-500",
  watch: "bg-amber-500",
  critical: "bg-destructive",
  insufficient_data: "bg-muted-foreground/40",
};

export function ReputationMeter({ label, hint, metric, locale, className }: ReputationMeterProps) {
  const { t } = useTranslation();
  const scale = Math.max(metric.limit * 1.5, Number.EPSILON);
  const pct = (value: number) => Math.min(100, Math.max(0, (value / scale) * 100));
  const fillPct = pct(metric.rate);

  return (
    <div className={cn("bg-card border border-border rounded-xl p-4 space-y-3", className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
          <div className="text-[11px] text-muted-foreground/80">{hint}</div>
        </div>
        <ReputationStatusDot status={metric.status} withLabel={false} />
      </div>

      <div className="flex items-baseline gap-2">
        <span className="font-display text-2xl tabular-nums">
          {formatRate(metric.rate, locale)}
        </span>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {metric.numerator.toLocaleString(locale)} / {metric.denominator.toLocaleString(locale)}
        </span>
      </div>

      <div
        className="relative h-2 w-full rounded-full bg-muted overflow-hidden"
        role="meter"
        aria-valuenow={Number((metric.rate * 100).toFixed(3))}
        aria-valuemin={0}
        aria-valuemax={Number((metric.limit * 1.5 * 100).toFixed(3))}
        aria-label={label}
      >
        <div
          className={cn("h-full rounded-full transition-all", FILL[metric.status])}
          style={{ width: `${fillPct}%` }}
        />
        <span
          aria-hidden="true"
          className="absolute top-0 h-full w-px bg-emerald-600/70"
          style={{ left: `${pct(metric.target)}%` }}
        />
        <span
          aria-hidden="true"
          className="absolute top-0 h-full w-px bg-destructive/70"
          style={{ left: `${pct(metric.limit)}%` }}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        <span>
          {t("adminDeliverability.kpi.target", { value: formatRate(metric.target, locale) })}
        </span>
        <span>
          {t("adminDeliverability.kpi.limit", { value: formatRate(metric.limit, locale) })}
        </span>
      </div>
    </div>
  );
}
