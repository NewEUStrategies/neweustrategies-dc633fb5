// Molekula: lejek jako lista krokow z paskami.
//
// DOSTEPNOSC ZAMIAST WYKRESU SVG. Piec liczb w kolejnosci to lista, nie
// wykres: kazdy krok ma etykiete, wartosc i udzial w poprzednim kroku jako
// TEKST, a pasek jest `aria-hidden` - czytnik ekranu dostaje to samo, co oko,
// bez opisywania ksztaltow. Pelne liczby per kampania sa w tabeli obok.
//
// SZEROKOSC PASKA JEST WZGLEDEM PIERWSZEGO KROKU, nie wzgledem poprzedniego -
// inaczej kazdy pasek bylby "prawie pelny" i lejek przestalby sie zwezac.
// Udzial zerowego mianownika to kreska, nie zero procent.
import { useTranslation } from "react-i18next";

import { stepRate } from "@/lib/events/adsFunnel";
import { ensureAdsFunnelI18n } from "@/lib/i18n-admin-event-ads-funnel";

export interface AdsFunnelBarStep {
  key: string;
  label: string;
  value: number;
}

function percentText(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

export function AdsFunnelBars({ steps }: { steps: readonly AdsFunnelBarStep[] }) {
  ensureAdsFunnelI18n();
  const { t } = useTranslation();
  const base = steps[0]?.value ?? 0;

  if (steps.every((step) => step.value === 0)) {
    return <p className="text-sm text-muted-foreground">{t("adminEventAdsFunnel.funnel.empty")}</p>;
  }

  return (
    <ol className="space-y-3" aria-label={t("adminEventAdsFunnel.funnel.ariaLabel")}>
      {steps.map((step, index) => {
        const previous = index === 0 ? null : (steps[index - 1] as AdsFunnelBarStep);
        const width = base > 0 ? Math.min(100, Math.round((step.value / base) * 100)) : 0;
        return (
          <li key={step.key} className="space-y-1">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium">{step.label}</span>
              <span className="tabular-nums">{step.value}</span>
            </div>
            <div aria-hidden="true" className="h-2 w-full rounded-[6px] bg-muted">
              <div className="h-2 rounded-[6px] bg-brand" style={{ width: `${width}%` }} />
            </div>
            {previous === null ? null : (
              <p className="text-[11px] text-muted-foreground">
                {t("adminEventAdsFunnel.funnel.ofPrevious", {
                  percent: percentText(stepRate(step.value, previous.value)),
                })}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
