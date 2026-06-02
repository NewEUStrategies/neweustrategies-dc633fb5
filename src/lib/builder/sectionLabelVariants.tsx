// Shared variants for the "section-label" widget.
// Used by both the live renderer (WidgetView) and the visual picker (WidgetProperties).
import * as React from "react";

export type SectionLabelVariant =
  | "left-bar"
  | "left-border"
  | "half-bg"
  | "small-corners"
  | "only-text"
  | "big-tagline"
  | "mixed-underline"
  | "rect-bg"
  | "top-solid"
  | "top-bottom-solid"
  | "mixed-bg"
  | "centered-solid"
  | "centered-dotted"
  | "line-break"
  | "right-slashes"
  | "parallelogram"
  | "two-slashes"
  | "underline"
  | "bold-underline"
  | "top-line"
  | "elegant-lines"
  | "tagline-overlay"
  | "badge-filled"
  | "centered-rule"
  | "centered-short-rule";

export const SECTION_LABEL_VARIANTS: { value: SectionLabelVariant; label: string }[] = [
  { value: "left-bar",            label: "01 — Pionowy pasek" },
  { value: "left-border",         label: "02 — Lewa krawędź" },
  { value: "half-bg",             label: "03 — Półtło" },
  { value: "small-corners",       label: "04 — Narożniki" },
  { value: "only-text",           label: "05 — Tylko tekst" },
  { value: "big-tagline",         label: "06 — Duża etykieta" },
  { value: "mixed-underline",     label: "07 — Mieszane podkreślenie" },
  { value: "rect-bg",             label: "08 — Tło prostokątne" },
  { value: "top-solid",           label: "09 — Górna linia" },
  { value: "top-bottom-solid",    label: "10 — Górna + dolna" },
  { value: "mixed-bg",            label: "11 — Mieszane tło" },
  { value: "centered-solid",      label: "12 — Wycentrowany — linia" },
  { value: "centered-dotted",     label: "13 — Wycentrowany — kropki" },
  { value: "line-break",          label: "14 — Łamanie linii" },
  { value: "right-slashes",       label: "15 — Ukośniki" },
  { value: "parallelogram",       label: "16 — Równoległobok" },
  { value: "two-slashes",         label: "17 — Dwa ukośniki //" },
  { value: "underline",           label: "18 — Podkreślenie" },
  { value: "bold-underline",      label: "19 — Pogrubione podkreślenie" },
  { value: "top-line",            label: "20 — Cienka linia u góry" },
  { value: "elegant-lines",       label: "21 — Eleganckie linie" },
  { value: "tagline-overlay",     label: "22 — Tagline overlay" },
  { value: "badge-filled",        label: "23 — Etykieta pełna (np. Najnowszy raport)" },
  { value: "centered-rule",       label: "24 — Wycentrowany z linią (np. Poznaj nasze raporty)" },
  { value: "centered-short-rule", label: "25 — Wycentrowany z krótkimi liniami (np. Materiały partnerów)" },
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
}

export function SectionLabelRender({ label, action, href, accent, variant, size = "md" }: RenderProps) {
  const isSm = size === "sm";
  const textCls = isSm
    ? "text-[9px] font-bold uppercase tracking-wider truncate"
    : "font-display text-sm font-bold uppercase tracking-wider";
  const actionCls = isSm
    ? "text-[8px] text-muted-foreground truncate"
    : "text-xs text-muted-foreground hover:opacity-80 transition";
  const wrapperBase = isSm ? "mb-1" : "mb-4";

  const ActionEl = action ? (
    href && !isSm
      ? <a href={href} className={actionCls} style={{ color: accent }}>{action} →</a>
      : <span className={actionCls}>{action} →</span>
  ) : null;

  const labelEl = <span className={textCls}>{label}</span>;
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
    case "half-bg":
      return (
        <div className={`flex items-center justify-between ${wrapperBase} ${padY} border-b border-border`}>
          <span className={isSm ? "px-1 py-0.5" : "px-2 py-1"} style={{ background: `linear-gradient(to bottom, transparent 50%, ${withAlpha(accent, 0.25)} 50%)` }}>
            {labelEl}
          </span>
          {ActionEl}
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
    case "big-tagline":
      return (
        <div className={`${wrapperBase} ${padY}`}>
          <div className="flex items-center justify-between">
            <span style={{ color: accent }} className={isSm ? "text-[11px] font-extrabold uppercase tracking-wider" : "font-display text-2xl font-extrabold uppercase tracking-tight"}>{label}</span>
            {ActionEl}
          </div>
          <div className="h-px w-full mt-1" style={{ background: accent }} />
        </div>
      );
    case "mixed-underline":
      return (
        <div className={`flex items-center justify-between ${wrapperBase} ${padY}`}>
          <span className={textCls} style={{ borderBottom: `${isSm ? 2 : 3}px solid ${accent}`, paddingBottom: isSm ? 1 : 2 }}>{label}</span>
          {ActionEl}
        </div>
      );
    case "rect-bg":
      return (
        <div className={`flex items-center justify-between ${wrapperBase} ${padY}`}>
          <span className={isSm ? "px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider" : "px-3 py-1.5 text-sm font-bold uppercase tracking-wider"} style={{ background: accent, color: contrastOn(accent) }}>{label}</span>
          {ActionEl}
        </div>
      );
    case "top-solid":
      return (
        <div className={`${wrapperBase} ${padY}`} style={{ borderTop: `${isSm ? 2 : 4}px solid ${accent}` }}>
          <div className={`flex items-center justify-between ${isSm ? "pt-0.5" : "pt-2"}`}>{labelEl}{ActionEl}</div>
        </div>
      );
    case "top-bottom-solid":
      return (
        <div className={`${wrapperBase} ${padY}`} style={{ borderTop: `${isSm ? 2 : 3}px solid ${accent}`, borderBottom: `${isSm ? 2 : 3}px solid ${accent}` }}>
          <div className={`flex items-center justify-between ${isSm ? "py-0.5" : "py-2"}`}>{labelEl}{ActionEl}</div>
        </div>
      );
    case "mixed-bg":
      return (
        <div className={`${wrapperBase} ${padY} flex items-center justify-between ${isSm ? "px-1" : "px-3 py-2"}`} style={{ background: `linear-gradient(90deg, ${withAlpha(accent, 0.18)}, transparent)` }}>
          <span className="inline-flex items-center gap-2">
            <span className={isSm ? "inline-block w-[3px] h-3" : "inline-block w-1 h-5"} style={{ background: accent }} />
            {labelEl}
          </span>
          {ActionEl}
        </div>
      );
    case "centered-solid":
      return (
        <div className={`${wrapperBase} ${padY} text-center`}>
          <div className="flex items-center justify-center gap-2">
            <span className="flex-1 h-px" style={{ background: accent }} />
            {labelEl}
            <span className="flex-1 h-px" style={{ background: accent }} />
          </div>
          {ActionEl && <div className="mt-0.5">{ActionEl}</div>}
        </div>
      );
    case "centered-dotted":
      return (
        <div className={`${wrapperBase} ${padY} text-center`}>
          <div className="flex items-center justify-center gap-2">
            <span className="flex-1" style={{ borderTop: `${isSm ? 1 : 2}px dotted ${accent}` }} />
            {labelEl}
            <span className="flex-1" style={{ borderTop: `${isSm ? 1 : 2}px dotted ${accent}` }} />
          </div>
        </div>
      );
    case "line-break":
      return (
        <div className={`${wrapperBase} ${padY}`}>
          <div className={textCls}>{label}</div>
          <div className={isSm ? "h-[2px] w-6 mt-0.5" : "h-[3px] w-12 mt-1"} style={{ background: accent }} />
          {ActionEl && <div className="mt-0.5">{ActionEl}</div>}
        </div>
      );
    case "right-slashes":
      return (
        <div className={`flex items-center justify-between ${wrapperBase} ${padY}`}>
          <span className="inline-flex items-center gap-1">
            {labelEl}
            <span style={{ color: accent }} className={isSm ? "text-[9px] font-bold" : "text-sm font-black"}>///</span>
          </span>
          {ActionEl}
        </div>
      );
    case "parallelogram":
      return (
        <div className={`flex items-center justify-between ${wrapperBase} ${padY}`}>
          <span className={isSm ? "px-2 py-0.5" : "px-3 py-1"} style={{ background: accent, color: contrastOn(accent), transform: "skewX(-12deg)" }}>
            <span style={{ display: "inline-block", transform: "skewX(12deg)" }} className={textCls}>{label}</span>
          </span>
          {ActionEl}
        </div>
      );
    case "two-slashes":
      return (
        <div className={`flex items-center justify-between ${wrapperBase} ${padY}`}>
          <span className="inline-flex items-center gap-1">
            <span style={{ color: accent }} className={isSm ? "text-[10px] font-black" : "text-base font-black"}>//</span>
            {labelEl}
          </span>
          {ActionEl}
        </div>
      );
    case "underline":
      return (
        <div className={`flex items-center justify-between ${wrapperBase} ${padY}`}>
          <span className={textCls} style={{ borderBottom: `1px solid ${accent}`, paddingBottom: 1 }}>{label}</span>
          {ActionEl}
        </div>
      );
    case "bold-underline":
      return (
        <div className={`flex items-center justify-between ${wrapperBase} ${padY}`}>
          <span className={textCls} style={{ borderBottom: `${isSm ? 3 : 4}px solid ${accent}`, paddingBottom: isSm ? 1 : 3 }}>{label}</span>
          {ActionEl}
        </div>
      );
    case "top-line":
      return (
        <div className={`${wrapperBase} ${padY}`} style={{ borderTop: `1px solid ${accent}` }}>
          <div className={`flex items-center justify-between ${isSm ? "pt-0.5" : "pt-2"}`}>{labelEl}{ActionEl}</div>
        </div>
      );
    case "elegant-lines":
      return (
        <div className={`${wrapperBase} ${padY} text-center`}>
          <div className="h-px w-full" style={{ background: accent, opacity: 0.6 }} />
          <div className={isSm ? "py-0.5" : "py-2"}>{labelEl}</div>
          <div className="h-px w-full" style={{ background: accent, opacity: 0.6 }} />
          {ActionEl && <div className="mt-0.5">{ActionEl}</div>}
        </div>
      );
    case "tagline-overlay":
      return (
        <div className={`${wrapperBase} ${padY} relative overflow-hidden`}>
          <span aria-hidden className={isSm ? "absolute -top-1 left-0 text-[18px] font-black uppercase opacity-10 select-none leading-none" : "absolute -top-2 left-0 text-5xl font-black uppercase opacity-10 select-none leading-none"} style={{ color: accent }}>{label}</span>
          <div className="relative flex items-center justify-between">
            {labelEl}{ActionEl}
          </div>
        </div>
      );
    case "badge-filled":
      return (
        <div className={`flex items-center justify-between ${wrapperBase} ${padY}`}>
          <span
            className={isSm ? "px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider" : "px-3 py-1.5 text-sm font-bold uppercase tracking-wider"}
            style={{ background: accent, color: contrastOn(accent) }}
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
            <span className={isSm ? "text-[10px] font-semibold" : "font-display text-2xl font-semibold tracking-tight"}>{label}</span>
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
            <span className={isSm ? "text-[10px] font-semibold" : "font-display text-2xl font-semibold tracking-tight"}>{label}</span>
            <span className={isSm ? "inline-block h-[2px] w-4" : "inline-block h-[2px] w-10"} style={{ background: accent }} />
          </div>
          {ActionEl && <div className={isSm ? "mt-0.5 text-[8px] text-muted-foreground" : "mt-1 text-xs text-muted-foreground"}>{action}</div>}
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

function withAlpha(color: string, a: number): string {
  if (color.startsWith("#")) {
    const hex = color.slice(1);
    const full = hex.length === 3 ? hex.split("").map((ch) => ch + ch).join("") : hex;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  if (color.startsWith("oklch(")) return color.replace(/\)$/, ` / ${a})`);
  if (color.startsWith("hsl(")) return color.replace("hsl(", "hsla(").replace(/\)$/, ` / ${a})`);
  return color;
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
