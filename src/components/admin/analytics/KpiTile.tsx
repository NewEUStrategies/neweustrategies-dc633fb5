/**
 * BI KPI tile: label + big value + delta chip vs previous period + sparkline.
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
import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { pathFromPoints } from "@/lib/charts/smooth";

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
}

function formatDelta(
  current: number,
  previous: number,
  absolute: boolean,
  suffix?: string,
): string {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return "-";
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
}: KpiTileProps) {
  const hasDelta =
    typeof current === "number" &&
    typeof previous === "number" &&
    Number.isFinite(current) &&
    Number.isFinite(previous);
  const dir = hasDelta ? Math.sign((current ?? 0) - (previous ?? 0)) : 0;
  const good = higherIsBetter ? dir > 0 : dir < 0;
  const neutral = dir === 0;
  const deltaColor = neutral
    ? "text-muted-foreground"
    : good
      ? "text-emerald-600"
      : "text-destructive";
  // Strzałka koduje KIERUNEK (znak delty), kolor koduje OCENĘ. Rozdzielenie
  // kanałów jest konieczne przy `higherIsBetter: false` (pozycja w SERP-ach,
  // CLS, LCP): tam wzrost jest zły, ale nadal jest wzrostem, a strzałka stoi
  // bezpośrednio przy liczbie ze znakiem - „+42,9%" ze strzałką w dół mówiłoby
  // dwie sprzeczne rzeczy naraz.
  const DeltaIcon = neutral ? Minus : dir > 0 ? ArrowUpRight : ArrowDownRight;

  /**
   * Ścieżka iskry w układzie 100x40.
   *
   * Skala pionowa jest ROZPIĘTA NA ZAKRESIE SZEREGU, nie od zera - iskra
   * pokazuje kształt, a nie poziom, i zero domknięte na szeregu wokół dużej
   * liczby spłaszczyłoby ją do prostej. Ucięcie osi jest tu więc poprawne
   * i nie wymaga oznaczenia, bo iskra nie ma osi, z której dałoby się cokolwiek
   * odczytać - liczbę czytelnik ma obok, w kafelku.
   */
  const spark = useMemo<string | null>(() => {
    if (!series || series.length < 2) return null;
    const skonczone = series.filter((v) => Number.isFinite(v));
    if (skonczone.length < 2) return null;
    const min = Math.min(...skonczone);
    const max = Math.max(...skonczone);
    const rozpietosc = max - min;
    const punkty = series.map((v, i): [number, number] => {
      const x = (i / Math.max(1, series.length - 1)) * 100;
      // Szereg płaski dzieliłby przez zero - wtedy linia idzie środkiem.
      const y = rozpietosc === 0 ? 20 : 36 - ((v - min) / rozpietosc) * 32;
      return [x, Number.isFinite(y) ? y : 20];
    });
    return pathFromPoints(punkty);
  }, [series]);

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
            className={
              "inline-flex items-center gap-0.5 text-[11px] font-medium px-1.5 py-0.5 rounded-md bg-muted/60 " +
              deltaColor
            }
          >
            <DeltaIcon className="w-3 h-3" />
            {formatDelta(current ?? 0, previous ?? 0, Boolean(absoluteDelta), deltaSuffix)}
          </div>
        ) : null}
      </div>
      {spark === null ? null : (
        <div className="mt-2 -mx-1">
          {/* `aria-hidden`, bo iskra nie niesie ani jednej liczby, której nie
              ma już w kafelku - ogłoszona przez czytnik ekranu byłaby drugim
              głosem o tym samym. */}
          <svg
            viewBox="0 0 100 40"
            height={40}
            className="block w-full"
            aria-hidden="true"
            data-role="sparkline"
          >
            <path
              d={spark}
              fill="none"
              stroke="var(--chart-1)"
              strokeWidth={1.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        </div>
      )}
    </Card>
  );
}
