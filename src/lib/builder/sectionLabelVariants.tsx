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
  | "centered-underline";

export const SECTION_LABEL_VARIANTS: { value: SectionLabelVariant; label: string }[] = [
  { value: "left-bar",            label: "01 — Pionowy pasek" },
  { value: "left-border",         label: "02 — Lewa krawędź" },
  { value: "small-corners",       label: "04 — Narożniki" },
  { value: "only-text",           label: "05 — Tylko tekst" },
  { value: "badge-filled",        label: "06 — Etykieta pełna" },
  { value: "centered-rule",       label: "07 — Wycentrowany z linią (np. Poznaj nasze raporty)" },
  { value: "centered-short-rule", label: "08 — Wycentrowany z krótkimi liniami (np. Materiały partnerów)" },
  { value: "filled-bar",          label: "09 — Pełny pasek (np. Najnowszy raport)" },
  { value: "centered-underline",  label: "10 — Wycentrowany z podkreśleniem (np. Poznaj nasze raporty)" },
];


// Resolve preset color names to CSS color values (also supports raw hex/oklch).
export function resolveAccentColor(color?: string): string {
  if (!color) return "hsl(var(--brand, 14 90% 53%))";
  if (color.startsWith("#") || color.startsWith("oklch") || color.startsWith("hsl") || color.startsWith("rgb")) {
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
    default:          return "hsl(var(--brand, 14 90% 53%))";
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
    ? "text-[9px] font-bold uppercase tracking-wider truncate"
    : "font-display text-sm font-bold uppercase tracking-wider";
  const actionCls = isSm
    ? "text-[8px] text-muted-foreground truncate"
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
      ? <a href={href} className={actionCls} style={{ color: actionColor || accent, ...actionStyle }}>{action} →</a>
      : <span className={actionCls} style={actionStyle}>{action} →</span>
  ) : null;

  const labelEl = <span className={textCls} style={labelStyle}>{label}</span>;
  const padY = isSm ? "py-1" : "py-2";


  switch (variant) {
    case "left-bar":
      return (
        <div className={`flex items-center justify-between ${wrapperBase} ${padY} border-b border-border`}>
          <span className="inline-flex items-center gap-2">
            <span className={isSm ? "inline-block w-[3px] h-3" : "inline-block w-1 h-5"} style={{ background: accent }} />
            {labelEl}
          </span>
          {ActionEl}
        </div>
      );
    case "left-border":
      return (
        <div className={`flex items-center justify-between ${wrapperBase} ${padY} pl-2`} style={{ borderLeft: `${isSm ? 3 : 5}px solid ${accent}` }}>
          {labelEl}{ActionEl}
        </div>
      );
    case "small-corners":
      return (
        <div className={`flex items-center justify-between ${wrapperBase} ${padY}`}>
          <span className={isSm ? "relative px-1.5 py-0.5" : "relative px-2 py-1"}>
            <Corners accent={accent} sm={isSm} />
            {labelEl}
          </span>
          {ActionEl}
        </div>
      );
    case "only-text":
      return (
        <div className={`flex items-center justify-between ${wrapperBase} ${padY}`}>
          <span style={{ color: accent }}>{labelEl}</span>
          {ActionEl}
        </div>
      );
    case "badge-filled":
      return (
        <div className={`flex items-center justify-between ${wrapperBase} ${padY}`}>
          <span
            className={isSm ? "px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider" : "px-3 py-1.5 text-sm font-bold uppercase tracking-wider"}
            style={{ background: accent, color: labelColor || contrastOn(accent), ...(labelSize && !isSm ? { fontSize: labelSize } : {}) }}
          >
            {label}
          </span>
          {ActionEl}
        </div>
      );
    case "centered-rule":
      return (
        <div className={`${wrapperBase} ${padY} text-center`}>
          <div className="flex items-center justify-center gap-3">
            <span className="flex-1 h-px bg-border" />
            <span className={isSm ? "text-[10px] font-semibold" : "font-display text-2xl font-semibold tracking-tight"} style={labelStyle}>{label}</span>
            <span className="flex-1 h-px bg-border" />
          </div>
          {ActionEl && <div className="mt-1">{ActionEl}</div>}
        </div>
      );
    case "centered-short-rule":
      return (
        <div className={`${wrapperBase} ${padY} text-center`}>
          <div className="flex items-center justify-center gap-3">
            <span className={isSm ? "inline-block h-[2px] w-4" : "inline-block h-[2px] w-10"} style={{ background: accent }} />
            <span className={isSm ? "text-[10px] font-semibold" : "font-display text-2xl font-semibold tracking-tight"} style={labelStyle}>{label}</span>
            <span className={isSm ? "inline-block h-[2px] w-4" : "inline-block h-[2px] w-10"} style={{ background: accent }} />
          </div>
          {ActionEl && <div className={isSm ? "mt-0.5 text-[8px] text-muted-foreground" : "mt-1 text-xs text-muted-foreground"} style={actionStyle}>{action}</div>}
        </div>
      );
    case "filled-bar": {
      // Full-width filled colored bar (e.g. "NAJNOWSZY RAPORT" w/ "Więcej →" on right)
      const fg = labelColor || contrastOn(accent);
      const padCls = isSm ? "px-2 py-1" : "px-4 py-3";
      const labelCls = isSm
        ? "text-[9px] font-bold uppercase tracking-wider"
        : "font-display text-base font-bold uppercase tracking-wider";
      const actCls = isSm
        ? "text-[8px] font-medium"
        : "text-xs font-medium hover:opacity-80 transition";
      return (
        <div className={`${wrapperBase} flex items-center justify-between ${padCls}`} style={{ background: accent, color: fg }}>
          <span className={labelCls} style={labelSize && !isSm ? { fontSize: labelSize } : undefined}>{label}</span>
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
        <div className={`${wrapperBase} ${padY} text-center border-b border-border`}>
          <span className={isSm ? "text-[10px] font-semibold" : "font-display text-xl font-semibold tracking-tight"} style={labelStyle}>{label}</span>
          {ActionEl && <div className={isSm ? "mt-0.5" : "mt-1"}>{ActionEl}</div>}
        </div>
      );
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
