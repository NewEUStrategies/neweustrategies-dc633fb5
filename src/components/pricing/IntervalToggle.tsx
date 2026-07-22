// Przełącznik cyklu rozliczenia (miesięcznie/rocznie). Roczny wariant nosi
// badge z realną, wyliczoną z planów maksymalną oszczędnością - kotwica
// wyboru w stylu Netflix/Apple, nigdy wymyślona wartość.
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { BillingInterval } from "@/lib/pricing/selectors";

export function IntervalToggle({
  value,
  onChange,
  savingsPct,
}: {
  value: BillingInterval;
  onChange: (interval: BillingInterval) => void;
  savingsPct: number | null;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex justify-center">
      <div
        role="group"
        aria-label={t("pricing.intervalAria")}
        className="inline-flex rounded-full border border-border bg-muted/40 p-1"
      >
        {(["month", "year"] as const).map((interval) => (
          <button
            key={interval}
            type="button"
            aria-pressed={value === interval}
            onClick={() => onChange(interval)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
              value === interval
                ? "bg-background text-foreground shadow"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {interval === "month" ? t("pricing.intervalMonthly") : t("pricing.intervalYearly")}
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
