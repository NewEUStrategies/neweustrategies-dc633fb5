// Molekuła: budżet kliknięć linku ("2 z 5 osób otworzyło ten artykuł").
//
// Sedno mechaniki widziane przez nadawcę: ile osób jeszcze przeczyta z tego
// linku. Wskaźnik to ten sam atom QuotaMeter, którym metering rysuje darmowe
// artykuły miesiąca - czytelnik zna już ten język wizualny, a przy limicie 5
// dostaje dosłownie pięć kresek. Liczby przychodzą z serwera (giftClickBudget),
// nigdy z lokalnego zgadywania.
import { useTranslation } from "react-i18next";
import { QuotaMeter } from "@/components/atoms/QuotaMeter";
import type { GiftClickBudget } from "@/lib/gifting/model";
import "@/lib/i18n-gifting";

interface GiftClickBudgetMeterProps {
  budget: GiftClickBudget;
  className?: string;
}

export function GiftClickBudgetMeter({ budget, className }: GiftClickBudgetMeterProps) {
  const { t } = useTranslation();

  if (budget.unlimited) {
    return (
      <p
        data-testid="gift-budget-unlimited"
        className={["text-[12px] font-semibold text-foreground", className ?? ""].join(" ")}
      >
        {t("gifting.budget.unlimited")}
      </p>
    );
  }

  const used = Math.min(budget.used, budget.limit);
  const remaining = budget.remaining ?? 0;

  return (
    <div data-testid="gift-budget" data-remaining={remaining} className={className}>
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <span className="text-[12px] font-semibold text-foreground">
          {budget.exhausted
            ? t("gifting.budget.exhaustedLabel")
            : t("gifting.budget.remaining", { count: remaining })}
        </span>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {t("gifting.budget.progressValue", { used, limit: budget.limit })}
        </span>
      </div>
      <QuotaMeter
        used={used}
        limit={budget.limit}
        label={t("gifting.budget.meterLabel")}
        valueText={t("gifting.budget.progressValue", { used, limit: budget.limit })}
      />
    </div>
  );
}
