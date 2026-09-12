// ZAKŁADKI OKRESU - jedyny przełącznik całego pulpitu.
//
// Wszystkie sekcje czytają JEDEN okres. Filtr per sekcja wyglądałby na większą
// swobodę, a naprawdę pozwalałby zestawić przychód z września z ruchem z maja
// na jednym ekranie i odczytać z tego związek, którego nie ma.
//
// PODPIS OKRESU ODNIESIENIA STOI PRZY ZAKŁADKACH, nie przy każdym kafelku.
// Odznaka "+12%" bez informacji, wobec czego, jest liczbą bez jednostki;
// powtórzona przy trzydziestu kafelkach byłaby szumem. Raz, pod przełącznikiem,
// który tym okresem steruje - dokładnie tam, gdzie powstaje pytanie.
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import {
  DASHBOARD_PERIODS,
  comparisonLabelKey,
  periodLabelKey,
  type DashboardPeriodId,
} from "@/lib/admin/dashboard/period";

export interface DashboardPeriodTabsProps {
  value: DashboardPeriodId;
  onChange: (next: DashboardPeriodId) => void;
  className?: string;
}

export function DashboardPeriodTabs({ value, onChange, className }: DashboardPeriodTabsProps) {
  const { t } = useTranslation();

  return (
    <div className={cn("space-y-1", className)}>
      {/* `role="tablist"` bez paneli sterowanych `aria-controls` byłoby
          obietnicą nawigacji strzałkami, której ten pasek nie spełnia.
          To jest GRUPA PRZEŁĄCZNIKÓW - każdy z `aria-pressed` - więc czytnik
          ekranu ogłasza stan, a klawiatura chodzi Tabem, jak wszędzie indziej
          w panelu. */}
      <div
        role="group"
        aria-label={t("adminDashboard.period.label")}
        className="inline-flex flex-wrap gap-0.5 rounded-md border border-border bg-background p-0.5"
      >
        {DASHBOARD_PERIODS.map((period) => (
          <button
            key={period}
            type="button"
            onClick={() => onChange(period)}
            aria-pressed={value === period}
            className={cn(
              "px-2.5 h-7 text-xs font-medium rounded-sm transition-colors whitespace-nowrap",
              value === period
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted",
            )}
          >
            {t(periodLabelKey(period))}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">{t(comparisonLabelKey(value))}</p>
    </div>
  );
}
