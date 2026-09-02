// Wykres kołowy / pierścieniowy (donut).
//
// Zasady (dataviz): wycinki oddziela 2px obrys w kolorze powierzchni (nigdy
// dodatkowa ramka), etykiety procentowe TYLKO w dużych wycinkach (>=8%),
// w kolorze dobranym kontrastem do wypełnienia (--chart-ink-N); nazwy niesie
// legenda, pełne wartości tooltip + tabela. Przełącznik "Etykiety wartości"
// (config.showValues) dokłada w tych samych wycinkach drugą linię z wartością.
// Donut pokazuje sumę w środku.
// Interakcja: hover/focus wycinka -> tooltip; wycinki są fokusowalne.
import { useMemo, useState } from "react";
import type { ChartConfig } from "@/lib/charts/types";
import { formatChartValue, formatPercent, type ChartLang } from "@/lib/charts/format";
import { useContainerWidth } from "@/hooks/useContainerWidth";
import { useRevealOnScroll, revealClassName } from "@/hooks/useRevealOnScroll";
import { ChartTooltip } from "./ChartTooltip";
import { pieModel } from "./pieModel";

const L = {
  pl: { total: "Suma" },
  en: { total: "Total" },
} as const;

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
  // Wysokość jest USTAWIENIEM autora (schemat: 160..640 px), nie sugestią -
  // wcześniejsze ciche przycięcie do 420 px sprawiało, że suwak wysokości
  // powyżej tej wartości nic nie robił. Średnicę i tak ogranicza szerokość
  // kontenera (rOuter poniżej), więc wyższa karta = więcej powietrza wokół.
  const height = config.height;

  // useMemo dla stałej tożsamości tablicy wycinków - hover renderuje przy
  // każdym ruchu wskaźnika, a config w tych renderach jest ten sam.
  const { slices, total } = useMemo(() => pieModel(config, lang), [config, lang]);

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
            {/* Etykiety %: tylko wycinki >=8% - wewnątrz wypełnienia. Gdy autor
                włączy "Etykiety wartości", pod udziałem ląduje sama wartość
                (druga linia), więc przełącznik działa tak samo jak w wykresach
                kartezjańskich - wcześniej był dla koła cichym no-opem. */}
            {slices.map((s, i) => {
              if (s.share < 0.08) return null;
              const mid = (s.startAngle + s.endAngle) / 2;
              const rLabel = donut ? (rOuter + rInner) / 2 : rOuter * 0.66;
              const [lx, ly] = polar(cx, cy, rLabel, mid);
              const dy = config.showValues ? -2 : 4;
              return (
                <g key={`t${i}`} pointerEvents="none">
                  <text
                    x={lx}
                    y={ly + dy}
                    textAnchor="middle"
                    fontSize={12}
                    fontWeight={600}
                    fill={`var(--chart-ink-${s.colorSlot})`}
                    className="tabular-nums"
                  >
                    {formatPercent(s.share, lang)}
                  </text>
                  {config.showValues && (
                    <text
                      x={lx}
                      y={ly + 11}
                      textAnchor="middle"
                      fontSize={11}
                      fontWeight={500}
                      fill={`var(--chart-ink-${s.colorSlot})`}
                      className="neh-pie-value tabular-nums"
                    >
                      {formatChartValue(s.value, lang, config.unit)}
                    </text>
                  )}
                </g>
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
