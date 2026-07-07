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
  | "field.select"
  | "field.mailing-lists"
  | "submit"
  | "success-message"
  | "social-proof"
  | "countdown";

export interface NlSelectOption {
  value: string;
  labelPl: string;
  labelEn: string;
}

export interface NlWidgetBase {
  id: string;
  type: NlWidgetType;
  /** Kolumna docelowa w split layoutach (0 = lewa, 1 = prawa). Undefined = single. */
  col?: 0 | 1;
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

export interface NlSelectWidget extends NlWidgetBase {
  type: "field.select";
  name: string; // stored in meta[name]
  label: NlI18n;
  placeholder: NlI18n;
  required?: boolean;
  options: NlSelectOption[];
}

export interface NlMailingListsWidget extends NlWidgetBase {
  type: "field.mailing-lists";
  label: NlI18n;
  /** UI mode: dropdown vs checkboxes. */
  display?: "select" | "checkboxes";
  required?: boolean;
  /** Optional: restrict to a subset of list IDs from newsletter_settings.popup_mailing_lists. */
  listIds?: string[];
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

export interface NlSocialProofWidget extends NlWidgetBase {
  type: "social-proof";
  text: NlI18n; // "{count}" placeholder is replaced at render
  /** Fallback minimum if we cannot read subscriber count. */
  fallbackCount?: number;
  align?: "left" | "center" | "right";
}

export interface NlCountdownWidget extends NlWidgetBase {
  type: "countdown";
  /** ISO 8601 UTC date-time (e.g. "2026-08-01T18:00:00Z"). */
  deadline: string;
  labelDays: NlI18n;
  labelHours: NlI18n;
  labelMinutes: NlI18n;
  labelSeconds: NlI18n;
  accent?: string | null;
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
  | NlSelectWidget
  | NlMailingListsWidget
  | NlSubmitWidget
  | NlSuccessMessageWidget
  | NlSocialProofWidget
  | NlCountdownWidget;

export interface NlSectionStyle {
  bg?: string | null;
  fg?: string | null;
  paddingY?: number; // px
  paddingX?: number; // px
  gap?: number; // px between widgets
  radius?: number;
  align?: "left" | "center";
}

/**
 * Layout sekcji:
 * - "single"  -> jedna kolumna (domyslnie)
 * - "1-2"     -> dwie kolumny 1/3 + 2/3
 * - "1-1"     -> dwie kolumny 1/2 + 1/2
 * - "2-1"     -> dwie kolumny 2/3 + 1/3
 */
export type NlSectionLayout = "single" | "1-2" | "1-1" | "2-1";

export interface NlSection {
  id: string;
  widgets: NlWidget[];
  style?: NlSectionStyle;
  layout?: NlSectionLayout;
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
