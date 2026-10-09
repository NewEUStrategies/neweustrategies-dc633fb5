// ISKRA (sparkline) karty KPI - glif, nie wykres: bez osi, podziałek
// i legendy, bo liczbę czytelnik ma obok, w karcie.
//
// Według specyfikacji: linia 2 px w akcencie, ostatni punkt jako kropka
// 2,6 px, w tle pasmo optimum w akcencie (14%). Skala pionowa rozpięta na
// zakresie SZEREGU, a pasmo jest do niej przycinane: iskra pokazuje kształt,
// a pasmo rozciągające domenę (np. norma od zera) spłaszczyłoby ją do prostej.
// Przycięte pasmo nadal mówi to, co ma mówić - które punkty leżą w normie.
//
// KROPKA JEST ELEMENTEM HTML, NIE `<circle>`: glif rozciąga się do szerokości
// karty (`preserveAspectRatio="none"`), więc koło narysowane w SVG stałoby
// się elipsą. Kropka stoi na tej samej pozycji wyrażonej w procentach.
import { useMemo } from "react";
import { pathFromPoints, type Point } from "@/lib/charts/smooth";
import { ROLE } from "@/lib/charts/roles";

interface SparklineProps {
  values: readonly (number | null)[];
  /** Pasmo optimum w jednostkach szeregu; null = brak benchmarku. */
  band?: { min: number; max: number } | null;
  height?: number;
}

const W = 100;
const H = 40;

export function Sparkline({ values, band = null, height = 40 }: SparklineProps) {
  const geometry = useMemo(() => {
    const finite = values.filter((v): v is number => v !== null && Number.isFinite(v));
    if (finite.length < 2) return null;
    const lo = Math.min(...finite);
    const hi = Math.max(...finite);
    const span = hi - lo;
    const y = (v: number): number => (span === 0 ? H / 2 : H - 3 - ((v - lo) / span) * (H - 6));
    const x = (i: number): number => (i / Math.max(1, values.length - 1)) * W;
    // Ciągi bez luk - luka przerywa linię, tak jak na dużym wykresie.
    const runs: Point[][] = [];
    let current: Point[] = [];
    values.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) {
        if (current.length) runs.push(current);
        current = [];
        return;
      }
      current.push([x(i), y(v)]);
    });
    if (current.length) runs.push(current);
    let last = -1;
    for (let i = values.length - 1; i >= 0; i--) {
      const v = values[i];
      if (v !== null && Number.isFinite(v)) {
        last = i;
        break;
      }
    }
    return {
      d: runs
        .map((run) => pathFromPoints(run))
        .filter(Boolean)
        .join(" "),
      dot: last >= 0 ? { x: x(last), y: y(values[last] as number) } : null,
      band: band
        ? {
            top: Math.max(0, Math.min(H, y(band.max))),
            bottom: Math.max(0, Math.min(H, y(band.min))),
          }
        : null,
    };
  }, [values, band]);

  if (geometry === null) return null;
  return (
    <div className="relative" style={{ height }}>
      {/* `aria-hidden`: iskra nie niesie liczby, której nie ma w karcie. */}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        height={height}
        className="block w-full overflow-visible"
        aria-hidden="true"
        data-role="sparkline"
      >
        {geometry.band && geometry.band.bottom - geometry.band.top > 0 && (
          <rect
            x={0}
            width={W}
            y={geometry.band.top}
            height={Math.max(0.5, geometry.band.bottom - geometry.band.top)}
            fill={ROLE.acc}
            style={{ fillOpacity: 0.14 }}
            data-role="sparkline-band"
          />
        )}
        <path
          d={geometry.d}
          fill="none"
          stroke={ROLE.acc}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {geometry.dot && (
        <span
          aria-hidden
          data-role="sparkline-last"
          className="pointer-events-none absolute rounded-full"
          style={{
            left: `${geometry.dot.x}%`,
            top: `${(geometry.dot.y / H) * 100}%`,
            width: 5.2,
            height: 5.2,
            transform: "translate(-50%, -50%)",
            background: ROLE.acc,
          }}
        />
      )}
    </div>
  );
}
