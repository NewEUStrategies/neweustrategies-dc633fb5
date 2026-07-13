// Karta wskaźnika (KPI) - duża wartość, etykieta, zmiana (delta) ze strzałką
// i tonem, opcjonalny sparkline i podpis źródła. Kompaktowa karta w stylistyce
// platformy; klikalna, gdy podano href. Sparkline to czyste SVG bez zależności.
import { useMemo } from "react";
import { ArrowRight, Minus } from "@/lib/lucide-shim";
import type { IndicatorCardConfig } from "@/lib/features/types";
import { AppLink } from "@/components/atoms/AppLink";
import { safeUrl } from "@/lib/sanitize";

interface Props {
  config: IndicatorCardConfig;
  className?: string;
}

/** Ścieżka sparkline znormalizowana do viewBoxu 100x28. */
function sparkPath(values: number[]): { line: string; area: string } | null {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const W = 100;
  const H = 28;
  const step = W / (values.length - 1);
  const pts = values.map((v, i) => {
    const x = i * step;
    const y = H - ((v - min) / span) * (H - 4) - 2;
    return [x, y] as const;
  });
  const line = pts
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join("");
  const area = `${line}L${W} ${H}L0 ${H}Z`;
  return { line, area };
}

export function IndicatorCard({ config, className }: Props) {
  const spark = useMemo(() => sparkPath(config.spark), [config.spark]);
  const toneColor =
    config.deltaTone === "positive"
      ? "var(--chart-2)"
      : config.deltaTone === "negative"
        ? "var(--chart-6)"
        : "var(--muted-foreground)";
  // Shim nie eksportuje strzałek ukośnych - obracamy ArrowRight (↑ / ↓).
  const DeltaIcon = config.deltaArrow === "none" ? Minus : ArrowRight;
  const deltaIconCls =
    config.deltaArrow === "up" ? "-rotate-90" : config.deltaArrow === "down" ? "rotate-90" : "";
  const href = config.href ? safeUrl(config.href) : "";

  const inner = (
    <div className="flex h-full flex-col">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {config.label}
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="font-display text-3xl font-bold leading-none tabular-nums text-foreground">
          {config.value}
        </span>
        {config.unit && <span className="text-sm text-muted-foreground">{config.unit}</span>}
      </div>
      {(config.delta || config.deltaLabel) && (
        <div className="mt-2 flex items-center gap-1.5 text-sm">
          {config.delta && (
            <span
              className="inline-flex items-center gap-0.5 font-semibold tabular-nums"
              style={{ color: toneColor }}
            >
              <DeltaIcon className={`h-3.5 w-3.5 ${deltaIconCls}`} aria-hidden />
              {config.delta}
            </span>
          )}
          {config.deltaLabel && <span className="text-muted-foreground">{config.deltaLabel}</span>}
        </div>
      )}
      {spark && (
        <svg
          viewBox="0 0 100 28"
          preserveAspectRatio="none"
          className="mt-3 h-8 w-full"
          aria-hidden
        >
          <path d={spark.area} fill={toneColor} opacity={0.12} />
          <path
            d={spark.line}
            fill="none"
            stroke={toneColor}
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      )}
      {config.source && (
        <div className="mt-auto pt-3 text-xs text-muted-foreground">{config.source}</div>
      )}
    </div>
  );

  const cardCls = `nes-feature not-prose my-6 block rounded-2xl border border-border bg-card p-5 ${
    href ? "transition-colors hover:border-brand/60" : ""
  } ${className ?? ""}`;

  return href ? (
    <AppLink href={href} className={cardCls}>
      {inner}
    </AppLink>
  ) : (
    <div className={cardCls}>{inner}</div>
  );
}
