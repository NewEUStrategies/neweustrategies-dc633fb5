/**
 * Formatowanie wartości metryk kanonicznych - jedna implementacja dla całego
 * panelu, sterowana JEDNOSTKĄ ze słownika, nie zgadywaniem po nazwie metryki.
 *
 * Dotąd każdy dashboard formatował po swojemu: CLS bywał pokazywany z sufiksem
 * „ms” (jest bezwymiarowy), a wskaźniki raz jako ułamek, raz jako procent. Skoro
 * słownik metryk zna jednostkę, formatowanie może z niej wynikać.
 *
 * Kluczowa reguła: brak wartości (`null`) NIGDY nie renderuje się jako „0”.
 * „0 %” w raporcie zarządczym czyta się jako „nikt nie kliknął”, a nie jako
 * „nie mamy podstawy do wyliczenia” - to dwie różne informacje.
 */
import { type ChartLang, formatChartValue } from "@/lib/charts/format";
import type { MetricUnit } from "./metrics";

/** Wartość metryki w formacie właściwym dla jej jednostki. */
export function formatMetricValue(
  value: number | null,
  unit: MetricUnit,
  lang: ChartLang,
  fallback = "-",
): string {
  if (value === null || !Number.isFinite(value)) return fallback;
  switch (unit) {
    case "ratio":
      // Wskaźniki trzymamy jako ułamek [0,1] i pokazujemy jako procent.
      return `${formatChartValue(value * 100, lang)} %`;
    case "milliseconds":
      return `${Math.round(value).toLocaleString(lang === "en" ? "en-GB" : "pl-PL")} ms`;
    case "score":
      // CLS jest bezwymiarowy - trzy miejsca po przecinku, bez sufiksu.
      return value.toLocaleString(lang === "en" ? "en-GB" : "pl-PL", {
        minimumFractionDigits: 3,
        maximumFractionDigits: 3,
      });
    case "count":
    default:
      return Math.round(value).toLocaleString(lang === "en" ? "en-GB" : "pl-PL");
  }
}

/** Rozjazd między strumieniami jako procent ze znakiem (ułamek na wejściu). */
export function formatSpread(spread: number | null, lang: ChartLang, fallback = "-"): string {
  if (spread === null || !Number.isFinite(spread)) return fallback;
  return `${formatChartValue(Math.abs(spread) * 100, lang)} %`;
}

/** Odchylenie ze znakiem (ułamek na wejściu) - „+18,4 %” / „-3,1 %”. */
export function formatSignedPct(fraction: number | null, lang: ChartLang, fallback = "-"): string {
  if (fraction === null || !Number.isFinite(fraction)) return fallback;
  const sign = fraction > 0 ? "+" : fraction < 0 ? "-" : "";
  return `${sign}${formatChartValue(Math.abs(fraction) * 100, lang)} %`;
}

/** Zmiana wobec okna poprzedniego - wejście już w punktach procentowych. */
export function formatDeltaPct(deltaPct: number | null, lang: ChartLang, fallback = "-"): string {
  if (deltaPct === null || !Number.isFinite(deltaPct)) return fallback;
  return formatSignedPct(deltaPct / 100, lang, fallback);
}

/** Data z instantu ISO w formacie krótkim (`2026-07-14`) - bez strefy lokalnej. */
export function isoDateOnly(iso: string): string {
  return iso.slice(0, 10);
}

/** Język wykresów/formatowania z kodu i18n (`pl-PL`, `en`, `en-GB`...). */
export function chartLangOf(language: string | undefined): ChartLang {
  return language?.toLowerCase().startsWith("en") ? "en" : "pl";
}
