// Wykres kołowy / pierścieniowy (donut).
//
// Zasady (dataviz): wycinki oddziela 2px obrys w kolorze powierzchni (nigdy
// dodatkowa ramka), etykiety procentowe TYLKO w dużych wycinkach (>=8%),
// w kolorze dobranym kontrastem do wypełnienia (--chart-ink-N); nazwy niesie
// legenda, pełne wartości tooltip + tabela. Donut pokazuje sumę w środku.
// Interakcja: hover/focus wycinka -> tooltip; wycinki są fokusowalne.
import { useMemo, useState } from "react";
import type { ChartConfig } from "@/lib/charts/types";
import { MAX_SERIES } from "@/lib/charts/types";
import { formatChartValue, formatPercent, type ChartLang } from "@/lib/charts/format";
import { useContainerWidth } from "@/hooks/useContainerWidth";
import { useRevealOnScroll, revealClassName } from "@/hooks/useRevealOnScroll";
import { ChartTooltip } from "./ChartTooltip";

const L = {
  pl: { total: "Suma" },
  en: { total: "Total" },
} as const;

interface Slice {
  label: string;
  value: number;
  share: number;
  colorSlot: number;
  startAngle: number;
  endAngle: number;
}

interface PieChartProps {
  config: ChartConfig;
  lang: ChartLang;
}

function polar(cx: number, cy: number, r: number, angle: number): [number, number] {
  return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
}

function slicePath(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  a0: number,
  a1: number,
): string {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = polar(cx, cy, rOuter, a0);
  const [x1, y1] = polar(cx, cy, rOuter, a1);
  if (rInner <= 0) {
    return `M${cx} ${cy} L${x0} ${y0} A${rOuter} ${rOuter} 0 ${large} 1 ${x1} ${y1} Z`;
  }
  const [x2, y2] = polar(cx, cy, rInner, a1);
  const [x3, y3] = polar(cx, cy, rInner, a0);
  return `M${x0} ${y0} A${rOuter} ${rOuter} 0 ${large} 1 ${x1} ${y1} L${x2} ${y2} A${rInner} ${rInner} 0 ${large} 0 ${x3} ${y3} Z`;
}

export function PieChart({ config, lang }: PieChartProps) {
  const { ref: widthRef, width } = useContainerWidth<HTMLDivElement>(720);
  const { ref: revealRef, state: revealState } = useRevealOnScroll<HTMLDivElement>(config.animate);
  const [active, setActive] = useState<number | null>(null);
  const t = L[lang];

  const donut = config.kind === "donut";
  const height = Math.min(config.height, 420);

  const { slices, total } = useMemo(() => {
    const first = config.series[0];
    const raw = config.categories
      .map((label, i) => ({
        label,
        value: first?.values[i] ?? null,
        colorSlot: (i % MAX_SERIES) + 1,
      }))
      .filter(
        (d): d is { label: string; value: number; colorSlot: number } =>
          d.value !== null && d.value > 0,
      );
    const sum = raw.reduce((a, d) => a + d.value, 0);
    let angle = -Math.PI / 2;
    const computed: Slice[] = raw.map((d) => {
      const share = sum > 0 ? d.value / sum : 0;
      const startAngle = angle;
      angle += share * Math.PI * 2;
      return { ...d, share, startAngle, endAngle: angle };
    });
    return { slices: computed, total: sum };
  }, [config.categories, config.series]);

  if (slices.length === 0) return null;

  const cx = width / 2;
  const cy = height / 2;
  const rOuter = Math.max(40, Math.min(width, height) / 2 - 12);
  const rInner = donut ? rOuter * 0.62 : 0;
  const activeSlice = active !== null ? slices[active] : null;
  const tooltipAnchor: [number, number] = activeSlice
    ? polar(cx, cy, (rOuter + rInner) / 2, (activeSlice.startAngle + activeSlice.endAngle) / 2)
    : [0, 0];

  return (
    <div ref={revealRef} className={revealClassName(revealState)}>
      <div
        ref={widthRef}
        className="relative w-full select-none"
        style={{ height }}
        // group (nie img): wycinki w środku są fokusowalne - rola img
        // czyniłaby je prezentacyjnymi dla czytników ekranu.
        role="group"
        aria-label={config.title || undefined}
      >
        <svg width={width} height={height} className="block">
          <g className="neh-pie-group">
            {slices.map((s, i) => {
              const mid = (s.startAngle + s.endAngle) / 2;
              const lift = active === i ? 4 : 0;
              const [dx, dy] = lift ? polar(0, 0, lift, mid) : [0, 0];
              return (
                <path
                  key={i}
                  d={slicePath(cx + dx, cy + dy, rOuter, rInner, s.startAngle, s.endAngle)}
                  fill={`var(--chart-${s.colorSlot})`}
                  stroke="var(--card)"
                  strokeWidth={2}
                  strokeLinejoin="round"
                  tabIndex={0}
                  role="img"
                  aria-label={`${s.label}: ${formatChartValue(s.value, lang, config.unit)} (${formatPercent(s.share, lang)})`}
                  className="cursor-pointer outline-none"
                  onPointerEnter={() => setActive(i)}
                  onPointerLeave={() => setActive(null)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                />
              );
            })}
            {/* Etykiety %: tylko wycinki >=8% - wewnątrz wypełnienia. */}
            {slices.map((s, i) => {
              if (s.share < 0.08) return null;
              const mid = (s.startAngle + s.endAngle) / 2;
              const rLabel = donut ? (rOuter + rInner) / 2 : rOuter * 0.66;
              const [lx, ly] = polar(cx, cy, rLabel, mid);
              return (
                <text
                  key={`t${i}`}
                  x={lx}
                  y={ly + 4}
                  textAnchor="middle"
                  fontSize={12}
                  fontWeight={600}
                  fill={`var(--chart-ink-${s.colorSlot})`}
                  pointerEvents="none"
                  className="tabular-nums"
                >
                  {formatPercent(s.share, lang)}
                </text>
              );
            })}
          </g>
          {/* Suma w środku pierścienia. */}
          {donut && (
            <g pointerEvents="none" className="neh-fade">
              <text
                x={cx}
                y={cy - 4}
                textAnchor="middle"
                fontSize={22}
                fontWeight={700}
                fill="var(--foreground)"
              >
                {formatChartValue(total, lang, config.unit)}
              </text>
              <text
                x={cx}
                y={cy + 16}
                textAnchor="middle"
                fontSize={11}
                fill="var(--muted-foreground)"
              >
                {t.total}
              </text>
            </g>
          )}
        </svg>

        <ChartTooltip
          visible={activeSlice !== null}
          x={tooltipAnchor[0]}
          y={tooltipAnchor[1]}
          containerWidth={width}
          title={activeSlice?.label ?? ""}
          rows={
            activeSlice
              ? [
                  {
                    name: formatPercent(activeSlice.share, lang),
                    colorSlot: activeSlice.colorSlot,
                    value: formatChartValue(activeSlice.value, lang, config.unit),
                  },
                ]
              : []
          }
        />
      </div>
    </div>
  );
}
