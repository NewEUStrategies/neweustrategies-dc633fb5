// Wykres kartezjański (line / area / bar / bar-horizontal, plus stacked).
//
// Specyfikacja znaczników (dataviz):
//  - kolumny/słupki <=24px, zaokrąglony 4px TYLKO koniec z danymi, prosta baza,
//  - 2px odstęp w kolorze powierzchni między stykającymi się znacznikami,
//  - linie 2px round join/cap, punkty >=8px z 2px ringiem powierzchni,
//  - pola: odcień serii ~10-12% krycia,
//  - siatka: 1px, solid, recesywna; tekst osi w tokenach tekstu (nigdy w
//    kolorze serii),
//  - etykiety bezpośrednie selektywnie (koniec linii / szczyt kolumny).
//
// Interakcja: crosshair przyciąga do najbliższej kategorii, jeden tooltip
// z wartościami WSZYSTKICH serii; słupki mają hit-target = cała kolumna
// kategorii. Klawiatura: strzałki przesuwają aktywną kategorię, Escape czyści.
// SSR: pełny, statyczny SVG w HTML (interakcja dogrywa się po hydracji).
import { useMemo, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { ChartConfig, ChartSeries } from "@/lib/charts/types";
import { linearScale, niceScale, seriesExtent, stackSeries } from "@/lib/charts/scale";
import { formatAxisTick, formatChartValue, type ChartLang } from "@/lib/charts/format";
import { useContainerWidth } from "@/hooks/useContainerWidth";
import { useRevealOnScroll, revealClassName } from "@/hooks/useRevealOnScroll";
import { ChartTooltip, type TooltipRow } from "./ChartTooltip";

const FONT_AXIS = 11;
const BAR_MAX = 24;
const BAR_GAP = 2;

interface CartesianChartProps {
  config: ChartConfig;
  lang: ChartLang;
}

interface ActivePoint {
  index: number;
  /** Pozycja kotwicy tooltipa w px kontenera. */
  x: number;
  y: number;
}

function seriesColor(s: ChartSeries): string {
  return `var(--chart-${s.colorSlot})`;
}

/** Prostokąt z zaokrąglonym wyłącznie końcem danych. */
function barPath(
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  roundedEnd: "top" | "bottom" | "left" | "right" | "none",
): string {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  if (r === 0 || roundedEnd === "none") {
    return `M${x} ${y}h${w}v${h}h${-w}Z`;
  }
  switch (roundedEnd) {
    case "top":
      return `M${x} ${y + h}v${-(h - r)}q0 ${-r} ${r} ${-r}h${w - 2 * r}q${r} 0 ${r} ${r}v${h - r}Z`;
    case "bottom":
      return `M${x} ${y}v${h - r}q0 ${r} ${r} ${r}h${w - 2 * r}q${r} 0 ${r} ${-r}v${-(h - r)}Z`;
    case "right":
      return `M${x} ${y}h${w - r}q${r} 0 ${r} ${r}v${h - 2 * r}q0 ${r} ${-r} ${r}h${-(w - r)}Z`;
    case "left":
      return `M${x + w} ${y}v${h}h${-(w - r)}q${-r} 0 ${-r} ${-r}v${-(h - 2 * r)}q0 ${-r} ${r} ${-r}Z`;
  }
}

export function CartesianChart({ config, lang }: CartesianChartProps) {
  const { ref: widthRef, width } = useContainerWidth<HTMLDivElement>(720);
  const { ref: revealRef, state: revealState } = useRevealOnScroll<HTMLDivElement>(config.animate);
  const [active, setActive] = useState<ActivePoint | null>(null);

  const horizontal = config.kind === "bar-horizontal";
  const isLine = config.kind === "line" || config.kind === "area";
  const n = config.categories.length;
  // useMemo: stała tożsamość tablicy - bez niej geometry przeliczałoby się
  // przy KAŻDYM renderze (a pointermove renderuje przy każdym ruchu myszy).
  const series = useMemo(
    () => config.series.filter((s) => s.values.some((v) => v !== null)),
    [config.series],
  );
  const stacked = config.stacked && !isLine && series.length > 1;

  const height = config.height;

  const geometry = useMemo(() => {
    const extent = seriesExtent(series, n, {
      stacked,
      includeZero: !isLine,
    });
    const scaleInfo = niceScale(
      extent.min,
      extent.max,
      horizontal ? 5 : Math.max(3, Math.round(height / 70)),
    );

    // Marginesy: oś wartości mierzona z najdłuższej podziałki, oś kategorii
    // z najdłuższej etykiety (tylko poziome słupki).
    const tickLabels = scaleInfo.ticks.map((t) => formatAxisTick(t, lang));
    const maxTickChars = Math.max(1, ...tickLabels.map((t) => t.length));
    const maxCatChars = Math.max(1, ...config.categories.map((c) => c.length));
    const charW = FONT_AXIS * 0.62;

    // Etykiety bezpośrednie nie mogą wypadać poza rysunek: koniec linii i
    // szczyt poziomego słupka dostają dodatkowy prawy margines, kolumny -
    // górny (zamiast przycinania, którego spec zakazuje).
    const maxValueChars = config.showValues
      ? Math.max(
          1,
          ...series.flatMap((s) =>
            s.values.map((v) => (v === null ? 0 : formatChartValue(v, lang, config.unit).length)),
          ),
        )
      : 0;
    const valueLabelW = maxValueChars * charW + 10;

    const padTop = !isLine && !horizontal && config.showValues ? 24 : 10;
    const padRight = config.showValues && (isLine || horizontal) ? Math.max(12, valueLabelW) : 12;
    const padBottom = 26;
    const padLeft = horizontal
      ? Math.min(180, Math.max(48, maxCatChars * charW + 12))
      : Math.max(34, maxTickChars * charW + 10);

    const innerW = Math.max(40, width - padLeft - padRight);
    const innerH = Math.max(40, height - padTop - padBottom);

    // Skala wartości: pion (bar/line) lub poziom (bar-horizontal).
    const value = horizontal
      ? linearScale(scaleInfo.min, scaleInfo.max, padLeft, padLeft + innerW)
      : linearScale(scaleInfo.min, scaleInfo.max, padTop + innerH, padTop);

    // Skala kategorii: band (bary) / punkty (linie).
    const catSpan = horizontal ? innerH : innerW;
    const catStart = horizontal ? padTop : padLeft;
    const band = n > 0 ? catSpan / n : catSpan;
    const catCenter = (i: number) =>
      isLine && n > 1 ? catStart + (catSpan * i) / (n - 1) : catStart + band * (i + 0.5);

    const stacks = stacked ? stackSeries(series, n) : null;
    return {
      scaleInfo,
      padTop,
      padLeft,
      padBottom,
      padRight,
      innerW,
      innerH,
      value,
      band,
      catCenter,
      stacks,
    };
  }, [
    series,
    n,
    stacked,
    isLine,
    horizontal,
    height,
    width,
    lang,
    config.categories,
    config.showValues,
    config.unit,
  ]);

  if (n === 0 || series.length === 0) return null;

  const { scaleInfo, padTop, padLeft, innerW, innerH, value, band, catCenter, stacks } = geometry;
  const zeroPos = value(Math.max(scaleInfo.min, Math.min(0, scaleInfo.max)));

  // ---- Interakcja: wspólny "najbliższy indeks kategorii". ----
  const indexFromPointer = (e: PointerEvent<SVGRectElement>): number => {
    const rect = e.currentTarget.getBoundingClientRect();
    const alongAxis = horizontal
      ? ((e.clientY - rect.top) / rect.height) * innerH
      : ((e.clientX - rect.left) / rect.width) * innerW;
    if (isLine && n > 1) {
      const step = (horizontal ? innerH : innerW) / (n - 1);
      return Math.max(0, Math.min(n - 1, Math.round(alongAxis / step)));
    }
    return Math.max(0, Math.min(n - 1, Math.floor(alongAxis / band)));
  };

  const anchorFor = (index: number): ActivePoint => {
    const c = catCenter(index);
    const positions = series
      .map((s) => s.values[index])
      .filter((v): v is number => v !== null)
      .map((v) => value(v));
    if (horizontal) {
      return { index, x: positions.length ? Math.max(...positions) : zeroPos, y: c };
    }
    const yTop = positions.length ? Math.min(...positions) : padTop;
    return { index, x: c, y: Math.max(padTop, yTop) };
  };

  const setActiveIndex = (index: number | null) => {
    setActive(index === null ? null : anchorFor(index));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const forwardKey = horizontal ? "ArrowDown" : "ArrowRight";
    const backKey = horizontal ? "ArrowUp" : "ArrowLeft";
    if (e.key === forwardKey || e.key === backKey) {
      e.preventDefault();
      const delta = e.key === forwardKey ? 1 : -1;
      const next = active === null ? 0 : Math.max(0, Math.min(n - 1, active.index + delta));
      setActiveIndex(next);
    } else if (e.key === "Escape" || e.key === "Tab") {
      setActive(null);
    }
  };

  // Etykiety końców linii z prostym rozsuwaniem kolizji: zbieżne serie nie
  // mogą nakładać etykiet (spec: nigdy nie przycinaj, nie nakładaj).
  const endLabelYBySeries = new Map<number, number>();
  if (isLine && config.showValues) {
    const raw = series
      .map((s, si) => {
        const idx = lastNonNullIndex(s.values);
        return idx >= 0 ? { si, y: value(s.values[idx] as number) } : null;
      })
      .filter((x): x is { si: number; y: number } => x !== null)
      .sort((a, b) => a.y - b.y);
    const MIN_GAP = 13;
    for (let i = 0; i < raw.length; i++) {
      if (i > 0 && raw[i].y < raw[i - 1].y + MIN_GAP)
        raw[i] = { ...raw[i], y: raw[i - 1].y + MIN_GAP };
    }
    for (const item of raw) endLabelYBySeries.set(item.si, item.y);
  }

  const tooltipRows: TooltipRow[] =
    active === null
      ? []
      : series
          .map((s) => ({
            name: s.name,
            colorSlot: s.colorSlot as number | null,
            raw: s.values[active.index],
          }))
          .filter((r) => r.raw !== null)
          .map((r) => ({
            name: r.name,
            colorSlot: r.colorSlot,
            value: formatChartValue(r.raw as number, lang, config.unit),
          }));

  // ---- Etykiety osi kategorii: próbkowane, żeby się nie zderzały. ----
  const labelEvery = horizontal ? 1 : Math.max(1, Math.ceil((n * 64) / Math.max(64, innerW)));

  const barRadius = 4;
  const groupCount = stacked ? 1 : series.length;
  const slotW = Math.max(2, (band * 0.72) / groupCount);
  const barW = Math.min(BAR_MAX, slotW - (groupCount > 1 ? BAR_GAP : 0));

  return (
    <div ref={revealRef} className={revealClassName(revealState)}>
      <div
        ref={widthRef}
        className="relative w-full select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card rounded-lg"
        style={{ height }}
        tabIndex={0}
        role="img"
        aria-label={config.title || undefined}
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
      >
        <svg width={width} height={height} className="block overflow-visible">
          {/* Siatka + podziałki osi wartości */}
          {config.showGrid &&
            scaleInfo.ticks.map((t) => {
              const p = value(t);
              return horizontal ? (
                <line
                  key={t}
                  x1={p}
                  x2={p}
                  y1={padTop}
                  y2={padTop + innerH}
                  stroke="var(--chart-grid)"
                  strokeWidth={1}
                />
              ) : (
                <line
                  key={t}
                  x1={padLeft}
                  x2={padLeft + innerW}
                  y1={p}
                  y2={p}
                  stroke="var(--chart-grid)"
                  strokeWidth={1}
                />
              );
            })}

          {/* Etykiety osi wartości */}
          {scaleInfo.ticks.map((t) => {
            const p = value(t);
            return horizontal ? (
              <text
                key={t}
                x={p}
                y={padTop + innerH + 16}
                textAnchor="middle"
                fontSize={FONT_AXIS}
                fill="var(--muted-foreground)"
                className="tabular-nums"
              >
                {formatAxisTick(t, lang)}
              </text>
            ) : (
              <text
                key={t}
                x={padLeft - 8}
                y={p + 3.5}
                textAnchor="end"
                fontSize={FONT_AXIS}
                fill="var(--muted-foreground)"
                className="tabular-nums"
              >
                {formatAxisTick(t, lang)}
              </text>
            );
          })}

          {/* Oś bazowa (zero) */}
          {horizontal ? (
            <line
              x1={zeroPos}
              x2={zeroPos}
              y1={padTop}
              y2={padTop + innerH}
              stroke="var(--chart-axis)"
              strokeWidth={1}
            />
          ) : (
            <line
              x1={padLeft}
              x2={padLeft + innerW}
              y1={zeroPos}
              y2={zeroPos}
              stroke="var(--chart-axis)"
              strokeWidth={1}
            />
          )}

          {/* Etykiety kategorii */}
          {config.categories.map((cat, i) => {
            if (i % labelEvery !== 0) return null;
            const c = catCenter(i);
            return horizontal ? (
              <text
                key={i}
                x={padLeft - 8}
                y={c + 3.5}
                textAnchor="end"
                fontSize={FONT_AXIS}
                fill="var(--muted-foreground)"
              >
                {cat.length > 24 ? `${cat.slice(0, 23)}…` : cat}
              </text>
            ) : (
              <text
                key={i}
                x={c}
                y={padTop + innerH + 16}
                textAnchor="middle"
                fontSize={FONT_AXIS}
                fill="var(--muted-foreground)"
              >
                {cat.length > 12 ? `${cat.slice(0, 11)}…` : cat}
              </text>
            );
          })}

          {/* ===== Znaczniki ===== */}
          {isLine
            ? series.map((s, si) => {
                const segments: string[] = [];
                let current: string[] = [];
                s.values.forEach((v, i) => {
                  if (v === null) {
                    if (current.length) segments.push(current.join(" "));
                    current = [];
                    return;
                  }
                  const x = catCenter(i);
                  const y = value(v);
                  current.push(
                    `${current.length === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`,
                  );
                });
                if (current.length) segments.push(current.join(" "));
                const d = segments.join(" ");
                const areaD =
                  config.kind === "area" && d
                    ? segments
                        .map((seg) => {
                          const first = /M([\d.]+) /.exec(seg);
                          const lastMatch = seg.match(/L?([\d.]+) ([\d.]+)$/);
                          const firstX = first ? Number(first[1]) : padLeft;
                          const lastX = lastMatch ? Number(lastMatch[1]) : padLeft + innerW;
                          return `${seg} L${lastX} ${zeroPos} L${firstX} ${zeroPos} Z`;
                        })
                        .join(" ")
                    : "";
                const showDots = n <= 24;
                const lastIdx = lastNonNullIndex(s.values);
                return (
                  <g key={s.colorSlot + s.name}>
                    {areaD && (
                      <path
                        d={areaD}
                        fill={seriesColor(s)}
                        fillOpacity={0.12}
                        className="neh-fade"
                      />
                    )}
                    <path
                      d={d}
                      fill="none"
                      stroke={seriesColor(s)}
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      pathLength={1}
                      className="neh-line"
                    />
                    {showDots &&
                      s.values.map((v, i) =>
                        v === null ? null : (
                          <circle
                            key={i}
                            cx={catCenter(i)}
                            cy={value(v)}
                            r={active?.index === i ? 5 : 4}
                            fill={seriesColor(s)}
                            stroke="var(--card)"
                            strokeWidth={2}
                            className="neh-fade"
                          />
                        ),
                      )}
                    {/* Etykieta bezpośrednia: wartość na końcu linii
                        (y po rozsunięciu kolizji zbieżnych serii). */}
                    {config.showValues && lastIdx >= 0 && (
                      <text
                        x={catCenter(lastIdx) + 8}
                        y={(endLabelYBySeries.get(si) ?? value(s.values[lastIdx] as number)) + 3.5}
                        fontSize={FONT_AXIS}
                        fontWeight={600}
                        fill="var(--foreground)"
                        className="neh-fade tabular-nums"
                      >
                        {formatChartValue(s.values[lastIdx] as number, lang, config.unit)}
                      </text>
                    )}
                  </g>
                );
              })
            : /* Słupki / kolumny */
              series.map((s, si) => (
                <g key={s.colorSlot + s.name}>
                  {s.values.map((v, i) => {
                    const cell = stacks ? stacks[si][i] : null;
                    const from = cell ? cell.from : 0;
                    const to = cell ? cell.to : (v ?? 0);
                    if (v === null || (v === 0 && stacked)) return null;
                    const a = value(from);
                    const b = value(to);
                    // Zaokrąglony koniec tylko dla segmentu domykajacego pas
                    // danych (ostatnia seria stacka lub słupek pojedynczy).
                    const isDataEnd = !stacked || si === lastStackIndexFor(series, stacks, i);
                    const center = catCenter(i);
                    const offset = stacked
                      ? -barW / 2
                      : -((series.length * slotW) / 2) + si * slotW + (slotW - barW) / 2;
                    if (horizontal) {
                      const y = center + offset;
                      const x0 = Math.min(a, b);
                      const w = Math.abs(b - a);
                      return (
                        <path
                          key={i}
                          d={barPath(
                            x0,
                            y,
                            Math.max(w, 0.5),
                            barW,
                            isDataEnd ? barRadius : 0,
                            v >= 0 ? "right" : "left",
                          )}
                          fill={seriesColor(s)}
                          stroke="var(--card)"
                          strokeWidth={stacked ? BAR_GAP / 2 : 0}
                          className="neh-bar-h neh-bar"
                          style={{ ["--neh-i" as string]: i }}
                        />
                      );
                    }
                    const x = center + offset;
                    const y0 = Math.min(a, b);
                    const h = Math.abs(b - a);
                    return (
                      <path
                        key={i}
                        d={barPath(
                          x,
                          y0,
                          barW,
                          Math.max(h, 0.5),
                          isDataEnd ? barRadius : 0,
                          v >= 0 ? "top" : "bottom",
                        )}
                        fill={seriesColor(s)}
                        stroke="var(--card)"
                        strokeWidth={stacked ? BAR_GAP / 2 : 0}
                        className="neh-bar"
                        style={{ ["--neh-i" as string]: i }}
                      />
                    );
                  })}
                  {/* Etykiety na szczycie kolumn - tylko pojedyncza seria,
                      inaczej robi się ściana liczb (dataviz: selektywnie). */}
                  {config.showValues &&
                    !stacked &&
                    series.length === 1 &&
                    s.values.map((v, i) =>
                      v === null ? null : horizontal ? (
                        <text
                          key={`l${i}`}
                          x={value(v) + (v >= 0 ? 6 : -6)}
                          y={catCenter(i) + 3.5}
                          textAnchor={v >= 0 ? "start" : "end"}
                          fontSize={FONT_AXIS}
                          fontWeight={600}
                          fill="var(--foreground)"
                          className="neh-fade tabular-nums"
                        >
                          {formatChartValue(v, lang, config.unit)}
                        </text>
                      ) : (
                        <text
                          key={`l${i}`}
                          x={catCenter(i)}
                          y={value(v) + (v >= 0 ? -6 : 14)}
                          textAnchor="middle"
                          fontSize={FONT_AXIS}
                          fontWeight={600}
                          fill="var(--foreground)"
                          className="neh-fade tabular-nums"
                        >
                          {formatChartValue(v, lang, config.unit)}
                        </text>
                      ),
                    )}
                </g>
              ))}

          {/* Crosshair (linie/pola) lub podświetlenie pasa kategorii. */}
          {active !== null &&
            (isLine ? (
              <line
                className="neh-crosshair"
                x1={horizontal ? padLeft : catCenter(active.index)}
                x2={horizontal ? padLeft + innerW : catCenter(active.index)}
                y1={horizontal ? catCenter(active.index) : padTop}
                y2={horizontal ? catCenter(active.index) : padTop + innerH}
              />
            ) : horizontal ? (
              <rect
                x={padLeft}
                y={catCenter(active.index) - band / 2}
                width={innerW}
                height={band}
                fill="var(--foreground)"
                fillOpacity={0.05}
                pointerEvents="none"
              />
            ) : (
              <rect
                x={catCenter(active.index) - band / 2}
                y={padTop}
                width={band}
                height={innerH}
                fill="var(--foreground)"
                fillOpacity={0.05}
                pointerEvents="none"
              />
            ))}

          {/* Warstwa trafień: cały obszar rysunku, przyciąga do kategorii.
              fill jako ATRYBUT (nie tylko CSS) - rect nie może stać się
              czarny, gdy arkusz z .neh-hit jeszcze nie dotarł. */}
          <rect
            x={padLeft}
            y={padTop}
            width={innerW}
            height={innerH}
            fill="transparent"
            className="neh-hit"
            onPointerMove={(e) => setActiveIndex(indexFromPointer(e))}
            onPointerLeave={() => setActive(null)}
          />
        </svg>

        <ChartTooltip
          visible={active !== null}
          x={active?.x ?? 0}
          y={active?.y ?? 0}
          containerWidth={width}
          title={active !== null ? config.categories[active.index] : ""}
          rows={tooltipRows}
        />
      </div>
    </div>
  );
}

function lastNonNullIndex(values: readonly (number | null)[]): number {
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i] !== null) return i;
  }
  return -1;
}

/** Indeks serii domykającej pas dodatni stacka w danej kategorii. */
function lastStackIndexFor(
  series: readonly ChartSeries[],
  stacks: ReturnType<typeof stackSeries> | null,
  categoryIndex: number,
): number {
  if (!stacks) return series.length - 1;
  let last = -1;
  for (let si = 0; si < series.length; si++) {
    const v = stacks[si][categoryIndex].value;
    if (v !== null && v > 0) last = si;
  }
  return last === -1 ? series.length - 1 : last;
}
