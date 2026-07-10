// Formatowanie liczb wykresów - Intl per język (pl-PL / en-US), spójne z
// istniejącym StatsCounterView. Czyste funkcje, testowalne jednostkowo.

export type ChartLang = "pl" | "en";

function localeOf(lang: ChartLang): string {
  return lang === "en" ? "en-US" : "pl-PL";
}

/** Pełny format wartości (tooltip, tabela, etykiety bezpośrednie). */
export function formatChartValue(value: number, lang: ChartLang, unit = ""): string {
  const formatted = value.toLocaleString(localeOf(lang), {
    maximumFractionDigits: Math.abs(value) < 10 ? 2 : 1,
  });
  return unit ? `${formatted}${unit.startsWith(" ") ? unit : `${unit}`}` : formatted;
}

/** Zwięzły format osi (12 345 678 -> "12,3 mln" / "12.3M"). */
export function formatAxisTick(value: number, lang: ChartLang): string {
  const abs = Math.abs(value);
  if (abs >= 10_000) {
    return value.toLocaleString(localeOf(lang), {
      notation: "compact",
      maximumFractionDigits: 1,
    });
  }
  return value.toLocaleString(localeOf(lang), { maximumFractionDigits: 2 });
}

/** Udział procentowy (wykres kołowy). */
export function formatPercent(share: number, lang: ChartLang): string {
  return share.toLocaleString(localeOf(lang), {
    style: "percent",
    maximumFractionDigits: share < 0.1 ? 1 : 0,
  });
}
