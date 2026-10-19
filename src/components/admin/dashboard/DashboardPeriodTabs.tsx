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
//
// DWA ZESTAWY OKRESÓW, JEDEN PRZEŁĄCZNIK. Pulpit podaje sam `value`/`onChange`
// i dostaje swoje osiem okresów z etykietami `adminDashboard.*` - dokładnie
// jak dotąd. Hub „Przychód i lejek" (i każdy kolejny ekran z własną listą)
// podaje `periods` oraz `labelKey` (i opcjonalnie `comparisonKey`), a typ
// okresu wynika z listy. Wygląd, semantyka przycisków i podpis są wspólne, bo
// „Ten miesiąc" na pulpicie i w hubie to ta sama arytmetyka kalendarza
// (`resolveDashboardRange`) - inny przełącznik sugerowałby inne okno.
//
// DLACZEGO PRZECIĄŻENIE, A NIE JEDNA SYGNATURA Z DOMYŚLNYMI. Domyślne
// `DASHBOARD_PERIODS` nie są listą DOWOLNEGO typu okresu, więc „generyk
// z domyślną listą" wymagałby rzutowania. Dwie sygnatury mówią prawdę:
// albo okresy pulpitu z jego etykietami, albo własna lista z własnymi
// etykietami - kompilator nie przepuści listy huba z etykietami pulpitu.
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-dashboard";

import { cn } from "@/lib/utils";
import {
  DASHBOARD_PERIODS,
  comparisonLabelKey,
  periodLabelKey,
  type DashboardPeriodId,
} from "@/lib/admin/dashboard/period";

/** Pulpit admina: osiem okresów pulpitu i jego słownik (zachowanie domyślne). */
export interface DashboardPeriodTabsProps {
  value: DashboardPeriodId;
  onChange: (next: DashboardPeriodId) => void;
  className?: string;
  periods?: undefined;
  labelKey?: undefined;
  comparisonKey?: undefined;
}

/** Własna lista okresów (np. `REVENUE_PERIODS` huba) z własnymi kluczami etykiet. */
export interface PeriodTabsProps<P extends string> {
  value: P;
  onChange: (next: P) => void;
  className?: string;
  periods: readonly P[];
  /** Klucz i18n nazwy okresu - jawna mapa po stronie wołającego, nie sklejanie. */
  labelKey: (period: P) => string;
  /** Klucz podpisu okresu odniesienia; `null`/brak = bez podpisu. */
  comparisonKey?: (period: P) => string | null;
}

function PeriodTabsGroup<P extends string>({
  value,
  onChange,
  className,
  periods,
  labelKey,
  comparisonKey,
}: PeriodTabsProps<P>) {
  const { t } = useTranslation();
  const comparison = comparisonKey?.(value) ?? null;

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
        {periods.map((period) => (
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
            {t(labelKey(period))}
          </button>
        ))}
      </div>
      {comparison ? <p className="text-[11px] text-muted-foreground">{t(comparison)}</p> : null}
    </div>
  );
}

export function DashboardPeriodTabs(props: DashboardPeriodTabsProps): JSX.Element;
export function DashboardPeriodTabs<P extends string>(props: PeriodTabsProps<P>): JSX.Element;
export function DashboardPeriodTabs<P extends string>(
  props: DashboardPeriodTabsProps | PeriodTabsProps<P>,
): JSX.Element {
  if (props.periods !== undefined) return <PeriodTabsGroup {...props} />;
  return (
    <PeriodTabsGroup
      value={props.value}
      onChange={props.onChange}
      className={props.className}
      periods={DASHBOARD_PERIODS}
      labelKey={periodLabelKey}
      comparisonKey={comparisonLabelKey}
    />
  );
}
