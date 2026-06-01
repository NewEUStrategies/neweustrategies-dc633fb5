// Build a scoped :hover CSS block for a widget from its HoverStyle.
import type { CommonStyle, Device, HoverStyle, Mode } from "./types";
import { pickMode } from "./themed";

const escape = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "");

function pickFontSize(t: HoverStyle["typography"], device: Device): string | undefined {
  const fs = t?.fontSize;
  if (!fs) return undefined;
  return fs[device] ?? fs.desktop ?? fs.tablet ?? fs.mobile;
}

export function hoverCss(
  widgetId: string,
  style: CommonStyle | undefined,
  device: Device,
  mode: Mode = "light",
): string {
  const h = pickMode<HoverStyle>(style?.hover, mode);
  if (!h) return "";
  const id = escape(widgetId);
  if (!id) return "";

  const rules: string[] = [];
  if (h.bgColor) rules.push(`background: ${h.bgColor}`);
  if (h.textColor) rules.push(`color: ${h.textColor}`);
  if (h.borderRadius) rules.push(`border-radius: ${h.borderRadius}`);
  if (h.shadow) rules.push(`box-shadow: ${h.shadow}`);
  const transforms: string[] = [];
  if (h.translateY) transforms.push(`translateY(${h.translateY})`);
  if (typeof h.scale === "number" && h.scale !== 1) transforms.push(`scale(${h.scale})`);
  if (transforms.length) rules.push(`transform: ${transforms.join(" ")}`);

  const t = h.typography;
  if (t) {
    if (t.fontFamily) rules.push(`font-family: ${t.fontFamily}`);
    const size = pickFontSize(t, device);
    if (size) rules.push(`font-size: ${size}`);
    if (t.fontWeight) rules.push(`font-weight: ${t.fontWeight}`);
    if (t.fontStyle) rules.push(`font-style: ${t.fontStyle}`);
    if (t.lineHeight) rules.push(`line-height: ${t.lineHeight}`);
    if (t.letterSpacing) rules.push(`letter-spacing: ${t.letterSpacing}`);
    if (t.textTransform) rules.push(`text-transform: ${t.textTransform}`);
    if (t.textDecoration) rules.push(`text-decoration: ${t.textDecoration}`);
  }

  if (!rules.length) return "";

  const duration = h.transitionMs ?? 200;
  const sel = `[data-w-id="${id}"]`;
  return `${sel}{transition: all ${duration}ms ease-out}${sel}:hover{${rules.join("; ")}}`;
}
