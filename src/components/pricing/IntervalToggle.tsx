// Przełącznik cyklu rozliczenia. Opcje są wyprowadzane z planów segmentu
// (availableIntervals): oferta indywidualna pokazuje miesięcznie/rocznie,
// oferta biznesowa - 2 tygodnie/miesięcznie/kwartalnie. Roczny wariant nosi
// badge z realną, wyliczoną z planów maksymalną oszczędnością - kotwica
// wyboru w stylu Netflix/Apple, nigdy wymyślona wartość.
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { BillingInterval } from "@/lib/pricing/selectors";
import { trackCta } from "@/lib/analytics/track";

const INTERVAL_LABEL_KEY: Record<BillingInterval, string> = {
  two_weeks: "pricing.intervalTwoWeeks",
  month: "pricing.intervalMonthly",
  quarter: "pricing.intervalQuarterly",
  year: "pricing.intervalYearly",
};

export function IntervalToggle({
  value,
  onChange,
  savingsPct,
  options = ["month", "year"],
}: {
  value: BillingInterval;
  onChange: (interval: BillingInterval) => void;
  savingsPct: number | null;
  options?: BillingInterval[];
}) {
  const { t } = useTranslation();
  return (
    <div className="flex justify-center">
      <div
        role="group"
        aria-label={t("pricing.intervalAria")}
        className="inline-flex rounded-full border border-border bg-muted/40 p-1"
      >
        {options.map((interval) => (
          <button
            key={interval}
            type="button"
            aria-pressed={value === interval}
            onClick={() => {
              if (value !== interval) {
                trackCta("pricing_interval_change", { interval, previous: value });
              }
              onChange(interval);
            }}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
              value === interval
                ? "bg-background text-foreground shadow"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(INTERVAL_LABEL_KEY[interval])}
            {interval === "year" && savingsPct !== null && (
              <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary">
                {t("pricing.saveUpTo", { pct: savingsPct })}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
