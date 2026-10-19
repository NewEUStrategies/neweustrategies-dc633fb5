// Atom: ocena wartości względem benchmarku - pięć kropek i słowo (SPEC §6.1,
// AD-20, K-08).
//
// TRZY NOŚNIKI, KOLOR OSTATNI. Ranga (1 krytyczny … 5 optymalny) rysuje się
// liczbą wypełnionych kropek, obok stoi słowo oceny, a kolor jest dopiero
// trzecim kanałem. Kropki są `aria-hidden` - czytnik dostaje słowo, a nie
// „pięć grafik”. Osoba nierozróżniająca czerwieni i zieleni czyta ocenę
// z liczby kropek i ze słowa.
//
// „BRAK OCENY” NIE MA KROPEK. Stan `none` (mała próba, inna waluta, brak
// benchmarku…) to informacja, dlaczego oceny nie ma - szare kropki
// wyglądałyby jak najniższy poziom i czytelnik uznałby wynik za krytyczny.
// Dlatego stan ma inny kształt (przerywana ramka) i słowo powodu.
//
// GEOMETRIA WSPÓLNA DLA MOTYWÓW. Rozmiary, odstępy i ramki są stałe; motyw
// zmienia wyłącznie wartości tokenów ról (`tierColor`, `tierTextColor`,
// `ROLE.line`) - zero hex (AGENTS).
import { useTranslation } from "react-i18next";
import type {
  BenchmarkEvaluation,
  BenchmarkNoneReason,
} from "@/lib/analytics/semantic/benchmarks/evaluate";
import type { Tier } from "@/lib/analytics/semantic/benchmarks/types";
import type { ChartLang } from "@/lib/charts/format";
import { ROLE } from "@/lib/charts/roles";
import { tierColor, tierOrder, tierRank, tierTextColor } from "@/lib/charts/benchmarkTier";
import { ensureI18n } from "@/lib/i18n-admin-revenue-shell";
import { cn } from "@/lib/utils";

/** Klucze jawne (bramka dryfu kluczy widzi pełne ścieżki, nie sklejki). */
const TIER_KEY: Readonly<Record<Tier, string>> = {
  critical: "adminRevenue.benchmark.tier.critical",
  weak: "adminRevenue.benchmark.tier.weak",
  normal: "adminRevenue.benchmark.tier.normal",
  good: "adminRevenue.benchmark.tier.good",
  optimal: "adminRevenue.benchmark.tier.optimal",
};

const NONE_REASON_KEY: Readonly<Record<BenchmarkNoneReason, string>> = {
  no_value: "adminRevenue.benchmark.state.no_value",
  no_benchmark: "adminRevenue.benchmark.state.no_benchmark",
  no_context: "adminRevenue.benchmark.state.no_context",
  measure_mismatch: "adminRevenue.benchmark.state.measure_mismatch",
  currency_mismatch: "adminRevenue.benchmark.state.currency_mismatch",
  vat_mismatch: "adminRevenue.benchmark.state.vat_mismatch",
  unit_mismatch: "adminRevenue.benchmark.state.unit_mismatch",
  small_sample: "adminRevenue.benchmark.state.small_sample",
  no_data: "adminRevenue.benchmark.state.no_data",
  incomparable: "adminRevenue.benchmark.state.incomparable",
};

/** Klucz słowa oceny - wspólny dla odznaki, skali i słownika. */
export function tierKey(tier: Tier): string {
  return TIER_KEY[tier];
}

export interface BenchmarkTierBadgeProps {
  evaluation: BenchmarkEvaluation;
  /** Język napisu; domyślnie język interfejsu. */
  lang?: ChartLang;
  size?: "sm" | "md";
  className?: string;
}

export function BenchmarkTierBadge({
  evaluation,
  lang,
  size = "sm",
  className,
}: BenchmarkTierBadgeProps) {
  ensureI18n();
  const { t } = useTranslation();
  const opts = lang ? { lng: lang } : undefined;
  const text = size === "md" ? "text-xs" : "text-[11px]";
  const dot = size === "md" ? "h-2 w-2" : "h-1.5 w-1.5";

  if (evaluation.tier === "none") {
    return (
      <span
        data-tier="none"
        data-why={evaluation.why}
        className={cn(
          "inline-flex items-center rounded-[6px] border border-dashed px-1.5 py-0.5 font-medium leading-4 text-muted-foreground",
          text,
          className,
        )}
      >
        {t(NONE_REASON_KEY[evaluation.why], opts)}
      </span>
    );
  }

  const rank = tierRank(evaluation.tier);
  return (
    <span
      data-tier={evaluation.tier}
      data-basis={evaluation.basis}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[6px] border px-1.5 py-0.5 font-semibold leading-4",
        text,
        className,
      )}
      style={{ borderColor: ROLE.line }}
    >
      <span aria-hidden="true" className="inline-flex items-center gap-0.5">
        {tierOrder().map((tier, i) => (
          <span
            key={tier}
            data-dot={i < rank ? "on" : "off"}
            className={cn("inline-block rounded-full", dot)}
            style={
              i < rank
                ? { backgroundColor: tierColor(evaluation.tier) }
                : { boxShadow: `inset 0 0 0 1px ${ROLE.line2}` }
            }
          />
        ))}
      </span>
      <span style={{ color: tierTextColor(evaluation.tier) }}>
        {t(TIER_KEY[evaluation.tier], opts)}
      </span>
    </span>
  );
}
