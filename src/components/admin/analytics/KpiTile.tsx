/**
 * BI KPI tile: label + big value + delta chip vs previous period + sparkline
 * (+ opcjonalna skala przedziału), według systemu wykresów 2026-10:
 * zmiana jako ▲ ▼ ■ i procent w kolorze zależnym od KIERUNKU wskaźnika
 * (wzrost kosztu jest zły, więc ▲ przy koszcie ma kolor ujemny), iskra
 * 2 px w akcencie z kropką ostatniego punktu i pasmem optimum w tle.
 *
 * ISKRA JEST GLIFEM, NIE WYKRESEM, i dlatego nie idzie przez `<Chart>`.
 * Rysunek o wysokości czterdziestu pikseli nie ma osi, podziałek, legendy,
 * podpisu ani tabeli danych - a rama silnika dokłada je wszystkie, bo tak ma
 * wyglądać wykres. Iskra ma pokazać KSZTAŁT szeregu obok liczby, którą i tak
 * widać w kafelku; liczby są w tabeli panelu, do którego kafelek prowadzi.
 *
 * Geometrię i kolor bierze jednak Z SILNIKA: `pathFromPoints` daje tę samą
 * krzywą, co linia na dużym wykresie, a wypełnienie i obrys idą tokenem
 * palety. Iskra rysowana własną matematyką i własnym kolorem rozjechałaby się
 * z wykresem, który opisuje ten sam szereg.
 */
import { Card } from "@/components/ui/card";
import { Sparkline } from "@/components/charts/Sparkline";
import { RangeScale } from "@/components/charts/RangeScale";
import { changeTone, changeToneColor } from "@/lib/charts/status";
import type { ChartLang } from "@/lib/charts/format";
import { safeSourceUrl, type ChartSource } from "@/lib/charts/sources";
import { ROLE } from "@/lib/charts/roles";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-charts";

export interface KpiTileProps {
  label: string;
  value: string;
  /** Numeric current value for delta computation (optional). */
  current?: number;
  /** Numeric previous-period value for delta computation. */
  previous?: number;
  /** Series for the sparkline (chronological). */
  series?: number[];
  /** When true (default), higher = green. Set false for metrics like SERP position or CLS. */
  higherIsBetter?: boolean;
  /** Optional small icon shown next to the label. */
  icon?: React.ReactNode;
  /** Suffix appended to delta text (e.g. "pp" for percentage points). */
  deltaSuffix?: string;
  /** Force delta rendering to be absolute rather than percentage. */
  absoluteDelta?: boolean;
  /**
   * Pasmo optimum (przedział oceny ZE ŹRÓDŁEM) w jednostkach `current` - tło
   * iskry i skala przedziału pod nią.
   */
  band?: { min: number; max: number } | null;
  /** Pokaż skalę przedziału; bez pasma pokazuje „brak benchmarku". */
  showScale?: boolean;
  /** Jednostka do podpowiedzi skali („ms", „%"). */
  unit?: string;
  lang?: ChartLang;
  /** Źródło przedziału - bez niego pasmo nie powinno być podane. */
  bandSource?: ChartSource | null;
}

function formatDelta(
  current: number,
  previous: number,
  absolute: boolean,
  suffix?: string,
): string {
  if (absolute) {
    const d = current - previous;
    const sign = d > 0 ? "+" : "";
    return `${sign}${d.toLocaleString("pl-PL", { maximumFractionDigits: 2 })}${suffix ?? ""}`;
  }
  if (previous === 0) return current === 0 ? "0%" : "+∞";
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

export function KpiTile({
  label,
  value,
  current,
  previous,
  series,
  higherIsBetter = true,
  icon,
  deltaSuffix,
  absoluteDelta,
  band = null,
  showScale = false,
  unit = "",
  lang = "pl",
  bandSource = null,
}: KpiTileProps) {
  const { t } = useTranslation("translation", { keyPrefix: "charts" });
  const sourceUrl = bandSource ? safeSourceUrl(bandSource.url) : null;
  const hasDelta =
    typeof current === "number" &&
    typeof previous === "number" &&
    Number.isFinite(current) &&
    Number.isFinite(previous);
  const dir = hasDelta ? Math.sign(current - previous) : 0;
  // Strzałka koduje KIERUNEK (znak delty), kolor koduje OCENĘ. Rozdzielenie
  // kanałów jest konieczne przy `higherIsBetter: false` (pozycja w SERP-ach,
  // CLS, LCP): tam wzrost jest zły, ale nadal jest wzrostem.
  const tone = changeTone(dir === 0 ? 0 : dir, higherIsBetter ? "higher" : "lower");
  const arrow = dir === 0 ? "■" : dir > 0 ? "▲" : "▼";

  return (
    <Card className="p-3 relative overflow-hidden">
      <div className="flex items-start justify-between gap-2">
        {/* PARA ETYKIETA-WARTOŚĆ, nie dwa luźne napisy. `role="term"` i
            `role="definition"` wiążą je w drzewie dostępności (WCAG 1.3.1):
            na pulpicie z sześcioma kafelkami czytnik ekranu ogłasza sześć par,
            a nie dwanaście niepowiązanych węzłów tekstowych. Role są dołożone
            OBOK istniejących `<div>`-ów i klas układu (`min-w-0` plus kolejność
            dzieci), bo na nich wisi kilkadziesiąt asercji KPI w pulpitach. */}
        <div className="min-w-0">
          <div
            role="term"
            className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1"
          >
            {icon}
            <span className="truncate">{label}</span>
          </div>
          <div role="definition" className="text-xl font-semibold tabular-nums mt-1 leading-tight">
            {value}
          </div>
        </div>
        {hasDelta ? (
          <div
            className="inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-md bg-muted/60 tabular-nums"
            style={{ color: changeToneColor(tone) }}
            data-tone={tone}
          >
            <span aria-hidden data-arrow={arrow}>
              {arrow}
            </span>
            <span data-role="delta-value">
              {formatDelta(current, previous, Boolean(absoluteDelta), deltaSuffix)}
            </span>
          </div>
        ) : null}
      </div>
      {series && series.length >= 2 ? (
        <div className="mt-2">
          <Sparkline values={series} band={band} />
        </div>
      ) : null}
      {showScale ? (
        <RangeScale
          value={typeof current === "number" && Number.isFinite(current) ? current : null}
          band={band}
          direction={higherIsBetter ? "higher" : "lower"}
          unit={unit}
          lang={lang}
        />
      ) : null}
      {showScale && band && bandSource ? (
        <p className="mt-1.5 mb-0 text-[11px] leading-snug" style={{ color: ROLE.ink3 }}>
          {t("kpi.bandSource", { lng: lang })}:{" "}
          {sourceUrl ? (
            <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">
              {bandSource.title}
            </a>
          ) : (
            bandSource.title
          )}
          {bandSource.container ? `, ${bandSource.container}` : ""}
          {bandSource.reliability ? ` (${bandSource.reliability})` : ""}
        </p>
      ) : null}
    </Card>
  );
}
