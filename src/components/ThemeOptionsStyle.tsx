// Injects CSS variables driven by site_settings.theme_options
// (Buttons + Text Fields tabs) so changes apply across the whole site.
import { useSiteSetting } from "@/lib/useSiteSetting";

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

type Cfg = { buttons?: ButtonsCfg; text_fields?: InputsCfg };

const DEFAULTS: Cfg = {};

export function ThemeOptionsStyle() {
  const cfg = useSiteSetting<Cfg>("theme_options", DEFAULTS);
  const b = cfg.buttons ?? {};
  const i = cfg.text_fields ?? {};

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

  const css = (buttonsCss + inputsCss).replace(/\s+/g, " ").trim();
  return <style data-theme-options dangerouslySetInnerHTML={{ __html: css }} />;
}
