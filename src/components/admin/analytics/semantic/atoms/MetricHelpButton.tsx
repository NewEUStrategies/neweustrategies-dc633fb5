// Atom: ikona objaśnienia przy skrócie wskaźnika - wyzwalacz `MetricExplainer`
// (SPEC §6.1, §6.5).
//
// CEL 24 PX, IKONA 16 PX. Ikona stoi przy liczbach w gęstych kafelkach, ale
// cel dotyku i kliknięcia musi mieć co najmniej 24 × 24 px (WCAG 2.5.8) -
// stąd przycisk większy od ikony, z ujemnym marginesem, żeby nie rozpychał
// wiersza etykiety.
//
// NAZWA Z WSKAŹNIKIEM. Na pulpicie stoi kilkanaście takich ikon; „Objaśnienie”
// bez nazwy wskaźnika dałoby czytnikowi kilkanaście nieodróżnialnych
// przycisków. `aria-haspopup="dialog"` i `aria-expanded` mówią, że przycisk
// otwiera okienko i czy jest ono otwarte.
//
// WSTĘPNE POBRANIE NA HOVER I FOKUS. Treść benchmarku przychodzi z serwera;
// zaczynamy ją pobierać, gdy kursor albo fokus dotknie ikony - po kliknięciu
// objaśnienie zwykle jest już w cache i nie miga stanem ładowania.
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { useTranslation } from "react-i18next";
import { Info } from "lucide-react";
import type { MetricId } from "@/lib/analytics/semantic/metrics";
import type { ChartLang } from "@/lib/charts/format";
import { ensureI18n } from "@/lib/i18n-admin-revenue-shell";
import { cn } from "@/lib/utils";
import { usePrefetchBenchmark } from "../hooks/useBenchmark";

export interface MetricHelpButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "type" | "aria-expanded" | "aria-haspopup"
> {
  metricId?: MetricId;
  /** Wpis rejestru bez metryki (NPS, ACT) - wtedy `metricId` jest pusty. */
  benchKey?: string;
  lang: ChartLang;
  /** Skrót albo nazwa wskaźnika - wchodzi do dostępnej nazwy przycisku. */
  name: string;
  /** Czy objaśnienie jest otwarte. */
  expanded: boolean;
}

export const MetricHelpButton = forwardRef<HTMLButtonElement, MetricHelpButtonProps>(
  function MetricHelpButton(
    { metricId, benchKey, lang, name, expanded, className, onPointerEnter, onFocus, ...rest },
    ref,
  ) {
    ensureI18n();
    const { t } = useTranslation();
    const prefetch = usePrefetchBenchmark();
    const warm = (): void => prefetch({ metricId, benchKey, lang });
    return (
      <button
        ref={ref}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={expanded}
        aria-label={t("adminRevenue.benchmark.help.open", { name, lng: lang })}
        data-metric-help={metricId ?? benchKey}
        className={cn(
          "-m-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground",
          "transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
        onPointerEnter={(e) => {
          warm();
          onPointerEnter?.(e);
        }}
        onFocus={(e) => {
          warm();
          onFocus?.(e);
        }}
        {...rest}
      >
        <Info className="h-4 w-4" aria-hidden="true" />
      </button>
    );
  },
);
