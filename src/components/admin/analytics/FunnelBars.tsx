// Molekuła: lejek jako lista kroków z paskami (SPEC §6.1, §6.2; UX §15).
//
// DOSTĘPNOŚĆ ZAMIAST WYKRESU SVG. Kilka liczb w kolejności to lista, nie
// wykres: każdy krok ma etykietę, wartość i udział w poprzednim kroku jako
// TEKST, a pasek jest `aria-hidden` - czytnik ekranu dostaje to samo, co oko,
// bez opisywania kształtów. Lejek huba, lejek reklam wydarzenia i przejścia
// kroków ścieżki to ten sam organizm (bez nowego rodzaju wykresu).
//
// SZEROKOŚĆ PASKA JEST WZGLĘDEM PIERWSZEGO KROKU, nie względem poprzedniego -
// inaczej każdy pasek byłby „prawie pełny” i lejek przestałby się zwężać.
// Udział przy zerowym mianowniku to kreska, nie zero procent.
//
// TEKSTY I FORMATERY Z ZEWNĄTRZ. Komponent nie ma własnego słownika: lejek
// reklam mówi językiem modułu wydarzeń, hub - językiem huba. Dzięki temu
// `AdsFunnelBars` jest cienką nakładką, która odtwarza swój dotychczasowy DOM
// bajt w bajt (test poza manifestem przypina listę, tekst wiersza i paski).
//
// DWA STRUMIENIE = BEZ ILORAZU. Gdy sąsiednie kroki pochodzą z różnych
// strumieni (wizyty z analityki ze zgodą, rejestracje z księgi), udział
// między nimi dzieliłby dwie różne populacje - komponent pokazuje wtedy
// powód zamiast procentu (reguła `assertSameStreamRatio`).
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import type { BenchmarkEvaluation } from "@/lib/analytics/semantic/benchmarks/evaluate";
import type { StreamId } from "@/lib/analytics/semantic/streams";
import { cn } from "@/lib/utils";
import { BenchmarkTierBadge } from "./semantic/atoms/BenchmarkTierBadge";

export interface FunnelBarsStep {
  key: string;
  label: ReactNode;
  /** Liczba w kroku; `null` = brak danych (pasek pusty, liczba „-”). */
  value: number | null;
  /**
   * Udział w poprzednim kroku jako ułamek 0-1. Pominięty - liczony
   * z wartości; `null` - brak mianownika (kreska).
   */
  rate?: number | null;
  /** Ocena udziału względem benchmarku (np. konwersja checkoutu). */
  benchmark?: BenchmarkEvaluation;
  /** Szczegóły kroku (trasa routera). */
  href?: string;
  /** Strumień danych kroku - granica strumieni wyłącza iloraz. */
  stream?: StreamId;
}

export interface FunnelBarsLabels {
  /** Dostępna nazwa listy. */
  list: string;
  /** Stan pusty: same zera albo brak kroków. */
  empty: string;
  /** Napis udziału w poprzednim kroku z gotowym procentem. */
  ofPrevious: (percent: string) => string;
  /** Powód braku ilorazu między strumieniami; bez niego - sama kreska. */
  crossStream?: string;
}

export interface FunnelBarsProps {
  steps: readonly FunnelBarsStep[];
  labels: FunnelBarsLabels;
  orientation?: "vertical" | "horizontal";
  variant?: "full" | "compact";
  /** Format wartości kroku; domyślnie liczba bez separatorów (jak dotąd w lejku reklam). */
  formatValue?: (value: number) => string;
  /** Format udziału; `null` = brak mianownika. */
  formatRate?: (rate: number | null) => string;
  className?: string;
}

function defaultRate(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

/** Udział kroku: jawny z danych, inaczej z wartości; granica strumieni = brak ilorazu. */
function rateOf(step: FunnelBarsStep, previous: FunnelBarsStep): number | null {
  if (step.stream && previous.stream && step.stream !== previous.stream) return null;
  if (step.rate !== undefined) return step.rate;
  if (step.value === null || previous.value === null) return null;
  return previous.value > 0 ? step.value / previous.value : null;
}

export function FunnelBars({
  steps,
  labels,
  orientation = "vertical",
  variant = "full",
  formatValue = String,
  formatRate = defaultRate,
  className,
}: FunnelBarsProps) {
  const base = steps[0]?.value ?? 0;

  if (steps.every((step) => step.value === 0 || step.value === null)) {
    return <p className="text-sm text-muted-foreground">{labels.empty}</p>;
  }

  const compact = variant === "compact";
  const horizontal = orientation === "horizontal";

  return (
    <ol
      className={cn(
        horizontal
          ? "grid gap-3 sm:grid-flow-col sm:auto-cols-fr"
          : compact
            ? "space-y-2"
            : "space-y-3",
        className,
      )}
      aria-label={labels.list}
    >
      {steps.map((step, index) => {
        const previous = index === 0 ? null : (steps[index - 1] as FunnelBarsStep);
        const width =
          base !== null && base > 0 && step.value !== null
            ? Math.min(100, Math.round((step.value / base) * 100))
            : 0;
        const crossStream =
          previous !== null &&
          step.stream !== undefined &&
          previous.stream !== undefined &&
          step.stream !== previous.stream;
        return (
          <li
            key={step.key}
            className={horizontal ? "space-y-1 rounded-[6px] border p-2" : "space-y-1"}
            data-stream={step.stream}
          >
            <div
              className={
                compact
                  ? "flex items-baseline justify-between gap-3 text-xs"
                  : "flex items-baseline justify-between gap-3 text-sm"
              }
            >
              <span className="font-medium">
                {step.href ? (
                  <Link to={step.href} className="underline-offset-2 hover:underline">
                    {step.label}
                  </Link>
                ) : (
                  step.label
                )}
              </span>
              <span className="tabular-nums">
                {step.value === null ? "-" : formatValue(step.value)}
              </span>
            </div>
            {/* Klasy w tej kolejności co w dotychczasowym lejku reklam - wariant
                pełny daje identyczny znacznik (V18). */}
            <div
              aria-hidden="true"
              className={
                compact
                  ? "h-1.5 w-full rounded-[6px] bg-muted"
                  : "h-2 w-full rounded-[6px] bg-muted"
              }
            >
              <div
                className={compact ? "h-1.5 rounded-[6px] bg-brand" : "h-2 rounded-[6px] bg-brand"}
                style={{ width: `${width}%` }}
              />
            </div>
            {previous === null ? null : (
              <p className="text-[11px] text-muted-foreground">
                {crossStream && labels.crossStream
                  ? labels.crossStream
                  : labels.ofPrevious(formatRate(rateOf(step, previous)))}
              </p>
            )}
            {step.benchmark && !compact ? <BenchmarkTierBadge evaluation={step.benchmark} /> : null}
          </li>
        );
      })}
    </ol>
  );
}
