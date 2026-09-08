// Injects CSS variables driven by site_settings.theme_options
// (Buttons + Text Fields tabs) so changes apply across the whole site.
import { useSiteSetting } from "@/lib/useSiteSetting";
import { hardenStyleCss } from "@/lib/sanitizePure";

type ButtonsCfg = {
  default_variant?: "solid" | "outline" | "ghost" | "pill";
  radius?: number;
  padding_x?: number;
  padding_y?: number;
  font_weight?: number;
  uppercase?: boolean;
  letter_spacing?: number;
};

type InputsCfg = {
  style?: "filled" | "outline" | "underline";
  radius?: number;
  height?: number;
  border_width?: number;
  focus_ring?: "none" | "brand" | "border";
  focus_ring_width?: number;
};

type TogglesCfg = {
  width?: number;
  height?: number;
  radius?: number;
  on_color?: string;
  off_color?: string;
  thumb_color?: string;
  label_size?: number;
  label_weight?: number;
};

type Cfg = { buttons?: ButtonsCfg; text_fields?: InputsCfg; toggles?: TogglesCfg };

const DEFAULTS: Cfg = {};

export function ThemeOptionsStyle() {
  const cfg = useSiteSetting<Cfg>("theme_options", DEFAULTS);
  const b = cfg.buttons ?? {};
  const i = cfg.text_fields ?? {};
  const tg = cfg.toggles ?? {};

  const btnRadius = b.default_variant === "pill" ? 999 : (b.radius ?? 8);
  const buttonsCss = `
    :root {
      --to-btn-radius: ${btnRadius}px;
      --to-btn-px: ${b.padding_x ?? 16}px;
      --to-btn-py: ${b.padding_y ?? 10}px;
      --to-btn-weight: ${b.font_weight ?? 600};
      --to-btn-tt: ${b.uppercase ? "uppercase" : "none"};
      --to-btn-ls: ${b.letter_spacing ?? 0}px;
    }
    :where(.btn, button.btn-primary, .btn-primary, button[data-themed-btn]) {
      border-radius: var(--to-btn-radius);
      padding: var(--to-btn-py) var(--to-btn-px);
      font-weight: var(--to-btn-weight);
      text-transform: var(--to-btn-tt);
      letter-spacing: var(--to-btn-ls);
    }
  `;

  const isUnderline = i.style === "underline";
  const isFilled = i.style === "filled";
  const radius = isUnderline ? 0 : (i.radius ?? 6);
  const bw = i.border_width ?? 1;
  const ringWidth = i.focus_ring_width ?? 2;
  const ringColor =
    i.focus_ring === "none"
      ? "transparent"
      : i.focus_ring === "border"
        ? "var(--gc-input-border, currentColor)"
        : "var(--gc-input-focus-border, var(--gc-highlight, currentColor))";

  const inputsCss = `
    :root {
      --to-input-radius: ${radius}px;
      --to-input-height: ${i.height ?? 40}px;
      --to-input-bw: ${bw}px;
      --to-input-ring-w: ${ringWidth}px;
    }
    :where(input:not([type="color"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="submit"]):not([type="button"]):not([type="reset"]), textarea, select) {
      border-radius: var(--to-input-radius);
      ${
        isUnderline
          ? `border-width: 0; border-bottom-width: max(1px, var(--to-input-bw));`
          : `border-width: var(--to-input-bw);`
      }
      border-style: solid;
      ${isFilled ? "" : ""}
    }
    :where(input:not([type="color"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="submit"]):not([type="button"]):not([type="reset"]), select) {
      height: var(--to-input-height);
    }
    :where(input:not([type="color"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="submit"]):not([type="button"]):not([type="reset"]):focus, input:not([type="color"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="submit"]):not([type="button"]):not([type="reset"]):focus-visible, textarea:focus, textarea:focus-visible, select:focus, select:focus-visible) {
      outline: var(--to-input-ring-w) solid ${ringColor};
      outline-offset: 0;
    }
  `;

  const tgW = tg.width ?? 44;
  const tgH = tg.height ?? 24;
  const tgR = tg.radius ?? 999;
  const thumb = Math.max(8, tgH - 4);
  const thumbRadius = tgR >= 999 ? 999 : Math.max(0, tgR - 2);
  const togglesCss = `
    :root {
      --to-toggle-w: ${tgW}px;
      --to-toggle-h: ${tgH}px;
      --to-toggle-radius: ${tgR}px;
      --to-toggle-on: ${tg.on_color ?? "var(--primary)"};
      --to-toggle-off: ${tg.off_color ?? "var(--input)"};
      --to-toggle-thumb: ${tg.thumb_color ?? "var(--background)"};
      --to-toggle-label-size: ${tg.label_size ?? 14}px;
      --to-toggle-label-weight: ${tg.label_weight ?? 500};
    }
    button[role="switch"] {
      width: var(--to-toggle-w);
      height: var(--to-toggle-h);
      border-radius: var(--to-toggle-radius);
      display: inline-flex;
      align-items: center;
      padding: 2px;
      border-width: 0;
    }
    button[role="switch"][data-state="unchecked"] {
      background: var(--to-toggle-off);
      justify-content: flex-start;
    }
    button[role="switch"][data-state="checked"] {
      background: var(--to-toggle-on);
      justify-content: flex-end;
    }
    button[role="switch"][data-state] > span {
      width: ${thumb}px;
      height: ${thumb}px;
      border-radius: ${thumbRadius}px;
      background: var(--to-toggle-thumb);
      transform: none;
    }
    label:has(+ button[role="switch"]),
    button[role="switch"] + label,
    [data-toggle-label] {
      font-size: var(--to-toggle-label-size);
      font-weight: var(--to-toggle-label-weight);
    }
  `;

  const css = (buttonsCss + inputsCss + togglesCss).replace(/\s+/g, " ").trim();
  return <style data-theme-options dangerouslySetInnerHTML={{ __html: hardenStyleCss(css) }} />;
}
