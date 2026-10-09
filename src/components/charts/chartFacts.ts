// Wiersze klucz-wartość tooltipa i linia źródła - wspólne dla rysunków, okna
// punktu i karty KPI. Jedno miejsce, bo „Zmiana", „Status" i „Znaczenie"
// muszą znaczyć to samo w dymku, w oknie szczegółów i na karcie.
import type { ChartConfig } from "@/lib/charts/types";
import { formatSignedPercent, type ChartLang } from "@/lib/charts/format";
import {
  changeTone,
  changeToneColor,
  meaningKey,
  percentChange,
  rangeStatus,
  STATUS_KEYS,
  statusSymbol,
  statusTextColor,
  type ChartBand,
  type MetricDirection,
} from "@/lib/charts/status";
import type { TooltipFact } from "./ChartTooltip";

export type ChartT = (key: string, values?: Record<string, string | number>) => string;

/**
 * Klucze słownika (prefiks `charts.`) w mapie, nie w literałach wywołań: `t`
 * przychodzi tu z zewnątrz już z prefiksem, a bramka rozjazdu kod-słownik
 * czyta literał bez prefiksu jako klucz globalny. Wartości mapy pilnuje
 * `chartDictionaryKeys.test.ts`.
 */
export const FACT_KEYS = {
  change: "tip.change",
  status: "tip.status",
  meaning: "tip.meaning",
  source: "tip.source",
  sourceUser: "tip.sourceUser",
  sourceDemo: "tip.sourceDemo",
} as const;

/** Czy wykres jest WSKAŹNIKIEM (ma kierunek albo przedział) - wtedy dymek ocenia. */
export function isIndicator(config: Pick<ChartConfig, "direction" | "band">): boolean {
  return config.direction !== null || config.band !== null;
}

/** Status i jego zapis słowny z symbolem: „▼ poniżej przedziału". */
export function statusFact(
  t: ChartT,
  value: number | null,
  band: ChartBand | null,
  direction: MetricDirection | null,
): TooltipFact {
  const status = rangeStatus(value, band, direction);
  return {
    label: t(FACT_KEYS.status),
    value: `${statusSymbol(status, value, band)} ${t(STATUS_KEYS[status])}`,
    // „W normie" nie dostaje koloru: na wykresie to stan tła, a łupek, którym
    // jest malowany, nie ma kontrastu na ciemnym tooltipie. Słowo i symbol ✓
    // wystarczają; kolor niesie wyłącznie odchylenie.
    color: status === "within" ? undefined : statusTextColor(status),
  };
}

/**
 * Wiersze oceny wartości: zmiana względem poprzedniego punktu (gdy oś jest
 * uporządkowana albo wskaźnik ma kierunek), status i znaczenie (gdy wykres
 * jest wskaźnikiem). Wiersz bez wartości nie powstaje.
 */
export function valueFacts(
  t: ChartT,
  lang: ChartLang,
  opts: {
    value: number | null;
    previous: number | null;
    band: ChartBand | null;
    direction: MetricDirection | null;
    indicator: boolean;
    showChange: boolean;
  },
): TooltipFact[] {
  const out: TooltipFact[] = [];
  const change = opts.showChange ? percentChange(opts.previous, opts.value) : null;
  if (change !== null) {
    out.push({
      label: t(FACT_KEYS.change),
      value: formatSignedPercent(change, lang),
      color: changeToneColor(changeTone(change, opts.direction)),
    });
  }
  if (opts.indicator && opts.value !== null) {
    out.push(statusFact(t, opts.value, opts.band, opts.direction));
    const status = rangeStatus(opts.value, opts.band, opts.direction);
    out.push({
      label: t(FACT_KEYS.meaning),
      value: t(meaningKey(status, opts.direction)),
      wide: true,
    });
  }
  return out;
}

/** Usuwa wiodące „Źródło:" / „Source:", żeby linia nie powtarzała słowa. */
function bareSource(raw: string): string {
  return raw.replace(/^\s*(źródło|zrodlo|source|sources|źródła)\s*:\s*/i, "").trim();
}

/**
 * Linia źródła na dole dymka: dane demonstracyjne, dane użytkownika albo
 * nazwa raportu z konfiguracji. `null`, gdy wykres nie podaje źródła.
 */
export function sourceLine(
  t: ChartT,
  config: Pick<ChartConfig, "demo" | "provenance" | "source">,
): string | null {
  if (config.demo) return t(FACT_KEYS.sourceDemo);
  const named = bareSource(config.source);
  if (named !== "") return t(FACT_KEYS.source, { source: named });
  if (config.provenance === "D") return t(FACT_KEYS.sourceUser);
  return null;
}
