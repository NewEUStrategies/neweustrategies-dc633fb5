// Tooltip wykresów: wartość jest elementem wiodącym (mocny kontrast,
// tabular-nums), nazwa serii drugorzędna, klucz serii to krótka kreska w
// kolorze slotu. Pozycjonowany translate3d względem kontenera wykresu,
// z odbiciem przy prawej krawędzi. Czysto wizualny duplikat danych -
// pełne wartości zawsze niesie tabela w ChartFrame.
import type { CSSProperties } from "react";

export interface TooltipRow {
  name: string;
  value: string;
  /** null = wiersz bez klucza koloru (np. suma). */
  colorSlot: number | null;
}

interface ChartTooltipProps {
  visible: boolean;
  /** Pozycja kotwicy w px względem kontenera wykresu. */
  x: number;
  y: number;
  containerWidth: number;
  title: string;
  rows: TooltipRow[];
}

export function ChartTooltip({ visible, x, y, containerWidth, title, rows }: ChartTooltipProps) {
  if (!visible || rows.length === 0) return null;
  const flip = x > containerWidth * 0.6;
  const style: CSSProperties = {
    transform: `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0) translate(${
      flip ? "calc(-100% - 12px)" : "12px"
    }, -50%)`,
  };
  return (
    <div className="neh-tooltip" role="presentation" aria-hidden style={style}>
      {title && <div className="mb-1 font-medium text-muted-foreground">{title}</div>}
      <dl className="m-0 space-y-0.5">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center justify-between gap-3">
            <dt className="flex min-w-0 items-center gap-1.5">
              {row.colorSlot !== null && (
                <span
                  aria-hidden
                  className="h-[3px] w-3 shrink-0 rounded-full"
                  style={{ background: `var(--chart-${row.colorSlot})` }}
                />
              )}
              <span className="truncate text-muted-foreground">{row.name}</span>
            </dt>
            <dd className="m-0 shrink-0 font-semibold tabular-nums text-foreground">{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
