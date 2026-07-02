// Live preview of the "Numeracja list" styling in both light and dark themes.
// Shown directly under the color controls in PostListEditor so authors see the
// impact of `indexColor` / `indexColorDark` / `indexOpacity` / `indexSizePx` /
// `indexWeight` BEFORE saving. Empty color fields correctly fall through to
// the Theme Design tokens (`--td-li-light` / `--td-li-dark` / `--td-li-opacity`),
// mirroring the runtime cascade in PostListView.
import type { CSSProperties } from "react";

interface Props {
  /** Widget-level override (light mode). Empty → Theme Design fallback. */
  indexColor: string;
  /** Widget-level override (dark mode). Empty → Theme Design fallback. */
  indexColorDark: string;
  /** 0..1, or negative to signal "use --td-li-opacity". */
  indexOpacity: number;
  /** Font size (px) of the numeral. */
  indexSizePx: number;
  /** CSS font-weight. */
  indexWeight: string;
}

const Sample = ({
  mode,
  label,
  color,
  opacity,
  size,
  weight,
}: {
  mode: "light" | "dark";
  label: string;
  color: string;
  opacity: string | number;
  size: number;
  weight: string;
}) => {
  const wrapperStyle: CSSProperties =
    mode === "dark"
      ? {
          background: "#0f0f11",
          color: "#f8f6f4",
          borderColor: "rgba(255,255,255,0.08)",
        }
      : {
          background: "#ffffff",
          color: "#231f20",
          borderColor: "rgba(0,0,0,0.08)",
        };
  const numeralStyle: CSSProperties = {
    color,
    opacity,
    fontSize: `${Math.max(24, Math.min(72, Math.round(size * 0.7)))}px`,
    fontWeight: weight as CSSProperties["fontWeight"],
    lineHeight: 0.85,
    letterSpacing: 0,
    fontVariantNumeric: "tabular-nums",
  };
  return (
    <div
      className="relative overflow-hidden rounded border px-2.5 py-2 flex items-center gap-2 min-h-[52px]"
      style={wrapperStyle}
      aria-label={`Podgląd numeracji - tryb ${label}`}
    >
      <span
        aria-hidden
        className="font-display select-none pointer-events-none shrink-0"
        style={numeralStyle}
      >
        01
      </span>
      <span className="flex flex-col leading-tight min-w-0">
        <span className="text-[11px] uppercase tracking-wider opacity-60">{label}</span>
        <span className="text-[12px] font-medium truncate">Przykładowy tytuł</span>
      </span>
    </div>
  );
};

export function IndexColorPreview({
  indexColor,
  indexColorDark,
  indexOpacity,
  indexSizePx,
  indexWeight,
}: Props) {
  // Mirror runtime cascade: empty widget value → Theme Design token fallback.
  const lightColor = indexColor || "var(--td-li-light, rgb(35,31,32))";
  const darkColor = indexColorDark || "var(--td-li-dark, rgb(250,147,70))";
  const opacity: string | number =
    indexOpacity < 0 ? "var(--td-li-opacity, 0.18)" : Math.max(0, Math.min(1, indexOpacity));
  const weight = indexWeight || "var(--td-li-weight, 800)";
  const size = indexSizePx > 0 ? indexSizePx : 52;

  return (
    <div className="mt-3 space-y-1.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        Podgląd (light / dark)
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Sample
          mode="light"
          label="Jasny"
          color={lightColor}
          opacity={opacity}
          size={size}
          weight={weight}
        />
        <Sample
          mode="dark"
          label="Ciemny"
          color={darkColor}
          opacity={opacity}
          size={size}
          weight={weight}
        />
      </div>
      <p className="text-[10px] text-muted-foreground">
        Puste pole = kolor z Theme Design → „Numeracja list" (`--td-li-*`).
      </p>
    </div>
  );
}
