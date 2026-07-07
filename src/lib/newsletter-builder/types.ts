// Newsletter builder document model (Elementor-style, headless).
//
// Two audiences read this file:
// - Admin builder UI ("/admin/newsletter/inline" and "/popup") edits `NlDoc`
//   trees via drag & drop.
// - Runtime renderer (`NewsletterDocRenderer`) walks the same tree on the
//   public site to render either the inline form or the popup contents.
//
// All widgets carry a stable `id` (crypto.randomUUID) so React reconciliation
// and undo/redo work correctly across moves and property edits. Any new
// widget type must be added here AND in `registry.ts`, `schema.ts`, defaults
// and both the admin `WidgetView` switch and runtime renderer switch.

export type NlLang = "pl" | "en";

export interface NlI18n {
  pl: string;
  en: string;
}

export type NlWidgetType =
  | "heading"
  | "paragraph"
  | "image"
  | "divider"
  | "spacer"
  | "field.email"
  | "field.text"
  | "field.checkbox"
  | "submit"
  | "success-message";

export interface NlWidgetBase {
  id: string;
  type: NlWidgetType;
}

export interface NlHeadingWidget extends NlWidgetBase {
  type: "heading";
  level: 1 | 2 | 3 | 4;
  text: NlI18n;
  align?: "left" | "center" | "right";
  color?: string | null;
}

export interface NlParagraphWidget extends NlWidgetBase {
  type: "paragraph";
  html: NlI18n; // sanitized on render
  size?: "sm" | "md" | "lg";
  color?: string | null;
}

export interface NlImageWidget extends NlWidgetBase {
  type: "image";
  url: string | null;
  alt?: string;
  aspect?: "16/7" | "16/9" | "1/1" | "4/3" | "auto";
  rounded?: boolean;
}

export interface NlDividerWidget extends NlWidgetBase {
  type: "divider";
  thickness?: number; // px
  color?: string | null;
}

export interface NlSpacerWidget extends NlWidgetBase {
  type: "spacer";
  size: number; // px
}

export interface NlEmailFieldWidget extends NlWidgetBase {
  type: "field.email";
  label: NlI18n;
  placeholder: NlI18n;
  required?: true;
}

export interface NlTextFieldWidget extends NlWidgetBase {
  type: "field.text";
  name: "firstName" | "lastName" | "company" | "position" | "phone" | "linkedin";
  label: NlI18n;
  placeholder: NlI18n;
  required?: boolean;
}

export interface NlCheckboxWidget extends NlWidgetBase {
  type: "field.checkbox";
  key: string; // consent key, e.g. "terms"
  html: NlI18n; // sanitized on render
  required?: boolean;
}

export interface NlSubmitWidget extends NlWidgetBase {
  type: "submit";
  label: NlI18n;
  fullWidth?: boolean;
  bg?: string | null;
  fg?: string | null;
}

export interface NlSuccessMessageWidget extends NlWidgetBase {
  type: "success-message";
  text: NlI18n;
}

export type NlWidget =
  | NlHeadingWidget
  | NlParagraphWidget
  | NlImageWidget
  | NlDividerWidget
  | NlSpacerWidget
  | NlEmailFieldWidget
  | NlTextFieldWidget
  | NlCheckboxWidget
  | NlSubmitWidget
  | NlSuccessMessageWidget;

export interface NlSectionStyle {
  bg?: string | null;
  fg?: string | null;
  paddingY?: number; // px
  paddingX?: number; // px
  gap?: number; // px between widgets
  radius?: number;
  align?: "left" | "center";
}

export interface NlSection {
  id: string;
  widgets: NlWidget[];
  style?: NlSectionStyle;
}

export interface NlDoc {
  version: 1;
  variant: "inline" | "popup";
  sections: NlSection[];
  /** Popup-only style tokens (background, accent, overlay). */
  popup?: {
    bg?: string;
    fg?: string;
    muted?: string;
    accent?: string;
    accentFg?: string;
    overlay?: string;
    radius?: number;
    layout?: "stacked" | "split";
    sideImage?: string | null;
  };
}
