// Shared variants for the "section-label" widget.
// Used by both the live renderer (WidgetView) and the visual picker (WidgetProperties).
import * as React from "react";

export type SectionLabelVariant =
  | "left-bar"
  | "left-border"
  | "small-corners"
  | "only-text"
  | "badge-filled"
  | "centered-rule"
  | "centered-short-rule"
  | "filled-bar"
  | "centered-underline"
  | "slanted-ribbon-rule"
  | "double-rule-centered";

export const SECTION_LABEL_VARIANTS: { value: SectionLabelVariant; label: string }[] = [
  { value: "left-bar",             label: "01 — Pionowy pasek" },
  { value: "left-border",          label: "02 — Lewa krawędź" },
  { value: "small-corners",        label: "04 — Narożniki" },
  { value: "only-text",            label: "05 — Tylko tekst" },
  { value: "badge-filled",         label: "06 — Etykieta pełna" },
  { value: "centered-rule",        label: "07 — Wycentrowany z linią (np. Poznaj nasze raporty)" },
  { value: "centered-short-rule",  label: "08 — Wycentrowany z krótkimi liniami (np. Materiały partnerów)" },
  { value: "filled-bar",           label: "09 — Pełny pasek (np. Najnowszy raport)" },
  { value: "centered-underline",   label: "10 — Wycentrowany z podkreśleniem (np. Poznaj nasze raporty)" },
  { value: "slanted-ribbon-rule",  label: "11 — Wstęga ze spadem i linią (np. Najnowszy raport)" },
  { value: "double-rule-centered", label: "12 — Subtelne linie (np. Wywiady | Podcasty)" },
];


// Resolve preset color names to CSS color values (also supports raw hex/oklch).
export function resolveAccentColor(color?: string): string {
  if (!color) return "#FA9346";
  if (color.startsWith("#") || color.startsWith("oklch") || color.startsWith("hsl") || color.startsWith("rgb") || color.startsWith("var(")) {
    return color;
  }
  switch (color) {
    case "military":  return "oklch(0.55 0.18 30)";
    case "finance":   return "oklch(0.55 0.18 140)";
    case "diplomacy": return "oklch(0.55 0.18 260)";
    case "transport": return "oklch(0.55 0.18 60)";
    case "cyber":     return "oklch(0.55 0.18 200)";
    case "neutral":   return "oklch(0.55 0 0)";
    case "brand":
    default:          return "#FA9346";
  }
}

interface RenderProps {
  label: string;
  action?: string;
  href?: string;
  accent: string;        // resolved CSS color
  variant: SectionLabelVariant;
  size?: "sm" | "md";    // sm = preview tile, md = real
  labelColor?: string;   // override label text color
  labelSize?: string;    // override label font-size (e.g. "14px", "1rem")
  actionColor?: string;  // override action ("więcej") color
  actionSize?: string;   // override action font-size
}

export function SectionLabelRender({ label, action, href, accent, variant, size = "md", labelColor, labelSize, actionColor, actionSize }: RenderProps) {
  const isSm = size === "sm";
  const textCls = isSm
    ? "text-[9px] font-bold uppercase tracking-wider"
    : "font-display text-[11px] sm:text-xs font-bold uppercase tracking-wider";
  const actionCls = isSm
    ? "text-[8px] text-muted-foreground"
    : "text-xs text-muted-foreground hover:opacity-80 transition";
  const wrapperBase = isSm ? "mb-1" : "mb-4";

  const labelStyle: React.CSSProperties = {};
  if (labelColor) labelStyle.color = labelColor;
  if (labelSize && !isSm) labelStyle.fontSize = labelSize;

  const actionStyle: React.CSSProperties = {};
  if (actionColor) actionStyle.color = actionColor;
  if (actionSize && !isSm) actionStyle.fontSize = actionSize;

  const ActionEl = action ? (
    href && !isSm
      ? <a href={href} className={`${actionCls} shrink-0`} style={{ color: actionColor || accent, ...actionStyle }}>{action} →</a>
      : <span className={`${actionCls} shrink-0`} style={actionStyle}>{action} →</span>
  ) : null;

  const labelEl = <span className={`${textCls} min-w-0`} style={labelStyle}>{label}</span>;
  const padY = isSm ? "py-1" : "py-2";

  // Common row wrapper — every variant must be width-fluid and never overflow.
  const rowBase = `flex items-center justify-between gap-2 w-full min-w-0 ${wrapperBase} ${padY}`;

  switch (variant) {
    case "left-bar":
      return (
        <div className={`${rowBase} border-b border-border`}>
          <span className="inline-flex items-center gap-2 min-w-0 flex-1">
            <span className={isSm ? "inline-block w-[3px] h-3 shrink-0" : "inline-block w-1 h-5 shrink-0"} style={{ background: accent }} />
            {labelEl}
          </span>
          {ActionEl}
        </div>
      );
    case "left-border":
      return (
        <div className={`${rowBase} pl-2`} style={{ borderLeft: `${isSm ? 3 : 5}px solid ${accent}` }}>
          {labelEl}{ActionEl}
        </div>
      );
    case "small-corners":
      return (
        <div className={rowBase}>
          <span className={`${isSm ? "relative px-1.5 py-0.5" : "relative px-2 py-1"} min-w-0 max-w-full`}>
            <Corners accent={accent} sm={isSm} />
            {labelEl}
          </span>
          {ActionEl}
        </div>
      );
    case "only-text":
      return (
        <div className={rowBase}>
          <span className="min-w-0 flex-1" style={{ color: accent }}>{labelEl}</span>
          {ActionEl}
        </div>
      );
    case "badge-filled": {
      const cutW = isSm ? 10 : 22;
      const padR = isSm ? 14 : 32;
      return (
        <div className={`flex items-stretch justify-between gap-2 w-full min-w-0 ${wrapperBase}`}>
          <span
            className={`${isSm ? "inline-flex items-center pl-2 py-0.5 text-[9px]" : "inline-flex items-center pl-4 py-2 font-display text-xs sm:text-sm"} font-bold uppercase tracking-wider min-w-0 max-w-[80%]`}
            style={{
              background: accent,
              color: labelColor || contrastOn(accent),
              clipPath: `polygon(0 0, 100% 0, calc(100% - ${cutW}px) 100%, 0 100%)`,
              paddingRight: `${padR}px`,
              ...(labelSize && !isSm ? { fontSize: labelSize } : {}),
            }}
          >
            <span className="break-words">{label}</span>
          </span>
          <span className="flex items-center min-w-0 shrink">{ActionEl}</span>
        </div>
      );
    }

    case "centered-rule":
      return (
        <div className={`${wrapperBase} ${padY} text-center w-full min-w-0`}>
          <div className="flex items-center justify-center gap-3 min-w-0">
            <span className="flex-1 h-px bg-border min-w-[12px]" />
            <span className={`${isSm ? "text-[10px]" : "font-display text-sm sm:text-lg"} font-semibold tracking-tight max-w-[70%]`} style={labelStyle}>{label}</span>
            <span className="flex-1 h-px bg-border min-w-[12px]" />
          </div>
          {ActionEl && <div className="mt-1">{ActionEl}</div>}
        </div>
      );
    case "centered-short-rule":
      return (
        <div className={`${wrapperBase} ${padY} text-center w-full min-w-0`}>
          <div className="flex items-center justify-center gap-3 min-w-0">
            <span className={`${isSm ? "inline-block h-[2px] w-4" : "inline-block h-[2px] w-6 sm:w-10"} shrink-0`} style={{ background: accent }} />
            <span className={`${isSm ? "text-[10px]" : "font-display text-sm sm:text-lg"} font-semibold tracking-tight max-w-[70%]`} style={labelStyle}>{label}</span>
            <span className={`${isSm ? "inline-block h-[2px] w-4" : "inline-block h-[2px] w-6 sm:w-10"} shrink-0`} style={{ background: accent }} />
          </div>
          {ActionEl && <div className={`${isSm ? "mt-0.5 text-[8px]" : "mt-1 text-xs"} text-muted-foreground`} style={actionStyle}>{action}</div>}
        </div>
      );
    case "filled-bar": {
      const fg = labelColor || contrastOn(accent);
      const padCls = isSm ? "px-2 py-1" : "px-3 sm:px-4 py-2 sm:py-3";
      const labelCls = isSm
        ? "text-[9px] font-bold uppercase tracking-wider"
        : "font-display text-[11px] sm:text-xs font-bold uppercase tracking-wider";
      const actCls = isSm
        ? "text-[8px] font-medium shrink-0"
        : "text-xs sm:text-sm font-medium hover:opacity-80 transition shrink-0";
      return (
        <div className={`${wrapperBase} flex items-center justify-between gap-2 w-full min-w-0 ${padCls}`} style={{ background: accent, color: fg }}>
          <span className={`${labelCls} min-w-0 flex-1`} style={labelSize && !isSm ? { fontSize: labelSize } : undefined}>{label}</span>
          {action && (
            href && !isSm
              ? <a href={href} className={actCls} style={{ color: actionColor || fg, ...(actionSize && !isSm ? { fontSize: actionSize } : {}) }}>{action} →</a>
              : <span className={actCls} style={{ color: actionColor || fg, ...(actionSize && !isSm ? { fontSize: actionSize } : {}) }}>{action} →</span>
          )}
        </div>
      );
    }
    case "centered-underline":
      return (
        <div className={`${wrapperBase} ${padY} text-center border-b border-border w-full min-w-0`}>
          <span className={`${isSm ? "text-[10px]" : "font-display text-sm sm:text-lg"} font-semibold tracking-tight inline-block max-w-full`} style={labelStyle}>{label}</span>
          {ActionEl && <div className={`${isSm ? "mt-0.5" : "mt-1"}`}>{ActionEl}</div>}
        </div>
      );
    case "slanted-ribbon-rule": {
      const fg = labelColor || contrastOn(accent);
      const cutW = isSm ? 10 : 28;
      const lineH = isSm ? 2 : 2;
      const ribbonPadX = isSm ? "pl-1.5" : "pl-3";
      const ribbonPadY = isSm ? "py-0.5" : "py-1";
      const labelCls = isSm
        ? "text-[9px] font-bold uppercase tracking-wider"
        : "font-display text-[11px] sm:text-xs font-bold uppercase tracking-wider";
      const actCls = isSm
        ? "text-[8px] font-medium text-foreground/80"
        : "text-[11px] sm:text-xs font-medium text-foreground/80 hover:opacity-80 transition";
      return (
        <div className={`${wrapperBase} relative flex items-end gap-2 w-full min-w-0 overflow-visible`}>
          <span
            aria-hidden
            className="absolute left-0 right-0 bottom-0 pointer-events-none z-0"
            style={{ height: `${lineH}px`, background: accent }}
          />
          <span
            className={`relative z-10 inline-flex items-center flex-none max-w-full ${ribbonPadX} ${ribbonPadY} ${labelCls}`}
            style={{
              background: accent,
              color: fg,
              clipPath: `polygon(0 0, calc(100% - ${cutW}px) 0, 100% 100%, 0 100%)`,
              paddingRight: `${cutW + (isSm ? 4 : 14)}px`,
              ...(labelSize && !isSm ? { fontSize: labelSize } : {}),
            }}
          >
            <span className="block break-words whitespace-normal">{label}</span>
          </span>
          {action && (
            <span
              className="relative z-10 ml-auto flex items-center min-w-0 shrink-0 bg-background"
              style={{ paddingLeft: isSm ? 4 : 12, paddingRight: isSm ? 4 : 8, paddingBottom: lineH + 2 }}
            >
              {href && !isSm
                ? <a href={href} className={actCls} style={{ color: actionColor, ...(actionSize && !isSm ? { fontSize: actionSize } : {}) }}>{action}</a>
                : <span className={actCls} style={{ color: actionColor, ...(actionSize && !isSm ? { fontSize: actionSize } : {}) }}>{action}</span>}
            </span>
          )}
        </div>
      );
    }
    case "double-rule-centered": {
      // Wycentrowany tytuł z dwiema subtelnymi liniami: cienka akcentowa nad,
      // jeszcze cieńsza neutralna pod. Inspirowane prasowymi nagłówkami.
      const titleCls = isSm
        ? "text-[10px] font-semibold tracking-tight"
        : "font-display text-sm sm:text-lg font-semibold tracking-tight inline-block max-w-full";
      const padBlock = isSm ? "py-1.5" : "py-3 sm:py-4";
      return (
        <div className={`${wrapperBase} w-full min-w-0 text-center`}>
          <span aria-hidden className="block w-full" style={{ height: 1, background: accent, opacity: 0.85 }} />
          <div className={`${padBlock} px-2`}>
            <span className={titleCls} style={labelStyle}>{label}</span>
            {ActionEl && <div className={`${isSm ? "mt-0.5" : "mt-1"}`}>{ActionEl}</div>}
          </div>
          <span aria-hidden className="block w-full" style={{ height: 1, background: accent, opacity: 0.85 }} />
        </div>
      );
    }
  }
}



function Corners({ accent, sm }: { accent: string; sm: boolean }) {
  const s = sm ? 4 : 8;
  const w = sm ? 1.5 : 2;
  const base: React.CSSProperties = { position: "absolute", width: s, height: s, borderColor: accent, borderStyle: "solid" };
  return (
    <>
      <span style={{ ...base, top: 0, left: 0, borderWidth: `${w}px 0 0 ${w}px` }} />
      <span style={{ ...base, top: 0, right: 0, borderWidth: `${w}px ${w}px 0 0` }} />
      <span style={{ ...base, bottom: 0, left: 0, borderWidth: `0 0 ${w}px ${w}px` }} />
      <span style={{ ...base, bottom: 0, right: 0, borderWidth: `0 ${w}px ${w}px 0` }} />
    </>
  );
}

function contrastOn(color: string): string {
  if (color.startsWith("#")) {
    const hex = color.slice(1);
    const full = hex.length === 3 ? hex.split("").map((ch) => ch + ch).join("") : hex;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    const yiq = (r * 299 + g * 587 + b * 114) / 1000;
    return yiq >= 160 ? "#0a0a0a" : "#ffffff";
  }
  return "#ffffff";
}
