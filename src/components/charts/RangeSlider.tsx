// SUWAK ZAKRESU pod wykresem o ponad 30 punktach na osi.
//
// 18 px wysokości, wyrównany do obszaru kreślenia (nie do karty), żeby
// położenie okna na suwaku odpowiadało położeniu kategorii nad nim. Tło danych
// w łupku drugim, wypełnienie zaznaczenia w akcencie (12%), uchwyty w kolorze
// płyty z obwódką w tuszu trzecim.
//
// KLAWIATURA, nie tylko mysz: uchwyty są suwakami ARIA (strzałki o jedną
// kategorię, PageUp/PageDown o dziesięć, Home/End do krawędzi), okno
// przesuwa się strzałkami jako całość. Bez tego zakres byłby dostępny wyłącznie
// wskaźnikiem.
import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { SLIDER_HEIGHT } from "@/lib/charts/geometry";
import { clampZoom, panBy, type ZoomRange } from "@/lib/charts/zoom";
import { ROLE } from "@/lib/charts/roles";

interface RangeSliderProps {
  /** Lewa krawędź i szerokość obszaru kreślenia w px kontenera. */
  x: number;
  width: number;
  /** Szerokość całego kontenera (szerokość SVG). */
  containerWidth: number;
  total: number;
  range: ZoomRange;
  onChange: (range: ZoomRange) => void;
  /** Wartości serii głównej na CAŁEJ osi - tło danych suwaka. */
  overview: readonly (number | null)[];
  labels: { group: string; start: string; end: string; window: string };
  categories: readonly string[];
}

const HANDLE_W = 8;

type Drag = { kind: "start" | "end" | "window"; originIndex: number; origin: ZoomRange } | null;

export function RangeSlider({
  x,
  width,
  containerWidth,
  total,
  range,
  onChange,
  overview,
  labels,
  categories,
}: RangeSliderProps) {
  const drag = useRef<Drag>(null);
  const last = Math.max(1, total - 1);
  const px = (index: number): number => x + (index / last) * width;
  const indexAt = (clientX: number, rect: DOMRect): number => {
    const scale = rect.width > 0 ? containerWidth / rect.width : 1;
    const local = (clientX - rect.left) * scale - x;
    return Math.round((local / Math.max(1, width)) * last);
  };

  const finite = overview.filter((v): v is number => v !== null && Number.isFinite(v));
  const lo = finite.length ? Math.min(...finite) : 0;
  const hi = finite.length ? Math.max(...finite) : 1;
  const span = hi - lo || 1;
  const areaPoints = overview
    .map((v, i) =>
      v === null
        ? null
        : `${px(i).toFixed(1)},${(SLIDER_HEIGHT - 2 - ((v - lo) / span) * (SLIDER_HEIGHT - 5)).toFixed(1)}`,
    )
    .filter((p): p is string => p !== null);
  const areaD =
    areaPoints.length > 1
      ? `M${px(0).toFixed(1)},${SLIDER_HEIGHT} L${areaPoints.join(" L")} L${px(last).toFixed(1)},${SLIDER_HEIGHT} Z`
      : "";

  const begin = (kind: "start" | "end" | "window") => (e: PointerEvent<SVGElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const svg = e.currentTarget.ownerSVGElement ?? (e.currentTarget as unknown as SVGSVGElement);
    drag.current = {
      kind,
      originIndex: indexAt(e.clientX, svg.getBoundingClientRect()),
      origin: range,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const move = (e: PointerEvent<SVGElement>) => {
    const d = drag.current;
    if (d === null) return;
    const svg = e.currentTarget.ownerSVGElement ?? (e.currentTarget as unknown as SVGSVGElement);
    const index = indexAt(e.clientX, svg.getBoundingClientRect());
    if (d.kind === "window") onChange(panBy(d.origin, total, index - d.originIndex));
    else if (d.kind === "start") onChange(clampZoom({ start: index, end: d.origin.end }, total));
    else onChange(clampZoom({ start: d.origin.start, end: index }, total));
  };
  const end = () => {
    drag.current = null;
  };

  const keyFor =
    (which: "start" | "end" | "window") =>
    (e: KeyboardEvent<SVGElement>): void => {
      const step =
        e.key === "ArrowRight" || e.key === "ArrowUp"
          ? 1
          : e.key === "ArrowLeft" || e.key === "ArrowDown"
            ? -1
            : e.key === "PageUp"
              ? 10
              : e.key === "PageDown"
                ? -10
                : 0;
      let next: ZoomRange | null = null;
      if (step !== 0) {
        next =
          which === "window"
            ? panBy(range, total, step)
            : which === "start"
              ? clampZoom({ start: range.start + step, end: range.end }, total)
              : clampZoom({ start: range.start, end: range.end + step }, total);
      } else if (e.key === "Home") {
        next =
          which === "end"
            ? clampZoom({ start: range.start, end: range.start }, total)
            : panBy(range, total, -total);
      } else if (e.key === "End") {
        next =
          which === "start"
            ? clampZoom({ start: range.end, end: range.end }, total)
            : panBy(range, total, total);
      }
      if (next !== null) {
        e.preventDefault();
        onChange(next);
      }
    };

  const x0 = px(range.start);
  const x1 = px(range.end);
  return (
    <svg
      width={containerWidth}
      height={SLIDER_HEIGHT + 2}
      className="neh-slider"
      role="group"
      aria-label={labels.group}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <rect
        x={x}
        y={0.5}
        width={width}
        height={SLIDER_HEIGHT}
        rx={4}
        fill="none"
        stroke={ROLE.line}
      />
      {areaD && (
        <path
          d={areaD}
          fill={ROLE.sAlt}
          stroke={ROLE.sAlt}
          strokeWidth={1}
          style={{ fillOpacity: 0.28 }}
          pointerEvents="none"
        />
      )}
      <rect
        className="neh-slider-window"
        x={x0}
        y={0.5}
        width={Math.max(1, x1 - x0)}
        height={SLIDER_HEIGHT}
        fill={ROLE.acc}
        style={{ fillOpacity: 0.12 }}
        tabIndex={0}
        role="slider"
        aria-label={labels.window}
        aria-valuemin={0}
        aria-valuemax={Math.max(0, total - 1 - (range.end - range.start))}
        aria-valuenow={range.start}
        aria-valuetext={`${categories[range.start] ?? ""} - ${categories[range.end] ?? ""}`}
        onPointerDown={begin("window")}
        onKeyDown={keyFor("window")}
      />
      {(["start", "end"] as const).map((which) => {
        const cx = which === "start" ? x0 : x1;
        const index = which === "start" ? range.start : range.end;
        return (
          <rect
            key={which}
            className="neh-slider-handle"
            x={cx - HANDLE_W / 2}
            y={0.5}
            width={HANDLE_W}
            height={SLIDER_HEIGHT}
            rx={2}
            fill={ROLE.panel}
            stroke={ROLE.ink3}
            strokeWidth={1}
            tabIndex={0}
            role="slider"
            aria-label={which === "start" ? labels.start : labels.end}
            aria-valuemin={0}
            aria-valuemax={total - 1}
            aria-valuenow={index}
            aria-valuetext={categories[index] ?? String(index + 1)}
            onPointerDown={begin(which)}
            onKeyDown={keyFor(which)}
          />
        );
      })}
    </svg>
  );
}
