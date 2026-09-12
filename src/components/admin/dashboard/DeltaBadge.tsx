// ODZNAKA ZMIANY OKRES DO OKRESU.
//
// TRZY STANY, NIE DWA. Poza wzrostem i spadkiem istnieje BRAK ODNIESIENIA -
// poprzedni okres był pusty, więc procentu nie ma z czego policzyć. Odznaka
// mówi to wprost zamiast malować "+100%", bo tamta liczba byłaby wymyślona,
// a pulpit jest podstawą decyzji, nie ozdobą.
//
// KOLOR IDZIE Z BIEGUNOWOŚCI METRYKI, nie ze znaku różnicy. Wzrost wypisań
// z newslettera i wzrost zapisów mają tę samą strzałkę, a przeciwną wymowę -
// patrz `MetricPolarity` w `lib/admin/dashboard/compare.ts`.
import { useTranslation } from "react-i18next";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Minus } from "lucide-react";

import { cn } from "@/lib/utils";
import { chartLangFrom } from "@/lib/charts/format";
import { formatCount, formatDeltaPercent, type MetricDelta } from "@/lib/admin/dashboard/compare";

const TONE_CLASS = {
  // WARIANTY `-text`, NIE WYPEŁNIENIOWE. Arkusz trzyma dwie pary tokenów znaku:
  // `--chart-positive` jest barwą WYPEŁNIENIA (plama słupka, gdzie kontrast
  // liczy się wobec tła rysunku), a `--chart-positive-text` jest barwą PISMA,
  // przyciemnioną tak, żeby jedenastopunktowy napis spełniał kontrast tekstu.
  // Obie pary mają własne wartości w trybie ciemnym, więc odznaka nie
  // potrzebuje ani fallbacku, ani drugiej reguły pod `.dark`.
  positive: "text-[var(--chart-positive-text)]",
  negative: "text-[var(--chart-negative-text)]",
  flat: "text-muted-foreground",
  unknown: "text-muted-foreground",
} as const;

export interface DeltaBadgeProps {
  delta: MetricDelta;
  className?: string;
  /** Pokaż wartość odniesienia obok procentu (kafelki główne). */
  withBaseline?: boolean;
}

export function DeltaBadge({ delta, className, withBaseline = false }: DeltaBadgeProps) {
  const { t, i18n } = useTranslation();
  const lang = chartLangFrom(i18n.language);
  const percent = formatDeltaPercent(delta, lang);

  const Icon =
    delta.tone === "positive"
      ? ArrowUpRight
      : delta.tone === "negative"
        ? ArrowDownRight
        : delta.tone === "unknown"
          ? ArrowRight
          : Minus;

  // Strzałka jest POWTÓRZENIEM znaku, który stoi obok w tekście, więc dla
  // czytnika ekranu jest ozdobą - ogłoszona osobno kazałaby wysłuchać
  // "strzałka w górę plus dwanaście procent".
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11px] font-medium tabular-nums",
        TONE_CLASS[delta.tone],
        className,
      )}
      title={delta.ratio === null ? t("adminDashboard.delta.noBaselineHint") : undefined}
    >
      <Icon className="w-3 h-3 shrink-0" aria-hidden="true" />
      {percent ?? t("adminDashboard.delta.noBaseline")}
      {withBaseline && delta.ratio !== null ? (
        <span className="text-muted-foreground font-normal">
          {t("adminDashboard.delta.vsPrevious", { value: formatCount(delta.previous, lang) })}
        </span>
      ) : null}
    </span>
  );
}
