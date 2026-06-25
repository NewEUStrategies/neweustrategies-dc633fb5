// Drag-and-drop builder types - shared between editor and public renderer.
// Tree: Document -> Sections -> (InnerSections | Columns) -> Columns -> Widgets.

export type Device = "desktop" | "tablet" | "mobile";

export type Align = "left" | "center" | "right";

export interface ResponsiveValue<T> {
  desktop?: T;
  tablet?: T;
  mobile?: T;
}

// ---------- Light/Dark mode overrides ----------
// A widget style field may either hold a single value (applies to both modes,
// typically a semantic CSS token like `var(--gc-body-bg)` that already swaps
// itself), or a ThemedValue with separate `light`/`dark` overrides.
export type Mode = "light" | "dark";
export interface ThemedValue<T> {
  light?: T;
  dark?: T;
}
export type Themed<T> = T | ThemedValue<T>;


export interface WidgetTypography {
  fontFamily?: string;
  fontSize?: ResponsiveValue<string>;     // tytuł / nagłówki - e.g. "16px"
  descriptionFontSize?: ResponsiveValue<string>; // opisy / paragrafy
  titleDescriptionGapPx?: number;         // odstęp px między tytułem a opisem
  fontWeight?: string;                    // "400" | "700" | "bold" ...
  fontStyle?: "normal" | "italic";
  lineHeight?: string;                    // e.g. "1.4"
  letterSpacing?: string;                 // e.g. "0.02em"
  textTransform?: "none" | "uppercase" | "lowercase" | "capitalize";
  textDecoration?: "none" | "underline" | "line-through";
  textAlign?: "left" | "center" | "right" | "justify";
}

export interface HoverStyle {
  bgColor?: string;
  textColor?: string;
  borderRadius?: string;
  scale?: number;                    // 1 = none; e.g. 1.03
  translateY?: string;               // CSS length, e.g. "-2px"
  shadow?: string;                   // raw box-shadow, e.g. "0 8px 24px rgba(0,0,0,.18)"
  transitionMs?: number;             // duration; default 200
  typography?: WidgetTypography;
}

export interface CommonStyle {
  bgColor?: string;
  textColor?: string;
  padding?: ResponsiveValue<string>; // CSS shorthand e.g. "24px 16px"
  margin?: ResponsiveValue<string>;
  align?: ResponsiveValue<Align>;
  /** Vertical alignment of this item within its parent column/row (alignSelf). */
  selfAlign?: "auto" | "start" | "center" | "end" | "stretch";
  /** Horizontal alignment of this item within its column line (via auto margins). */
  selfJustify?: "auto" | "start" | "center" | "end";
  borderRadius?: string;
  maxWidth?: string;
  minHeight?: string;
  typography?: WidgetTypography;
  hover?: HoverStyle;
  // Border + shadow + opacity
  borderStyle?: "none" | "solid" | "dashed" | "dotted" | "double";
  borderWidth?: string;   // e.g. "1px" or "1px 2px"
  borderColor?: string;
  boxShadow?: string;     // raw css value
  opacity?: number;       // 0..1
}



export type MotionPreset =
  | "none" | "fade" | "slide-up" | "slide-down" | "slide-left" | "slide-right"
  | "zoom" | "zoom-out" | "bounce"
  | "flip-x" | "flip-y" | "rotate" | "skew" | "blur"
  | "reveal-up" | "reveal-down" | "tilt" | "swing" | "pulse" | "rubber";

export type MotionEasing =
  | "ease" | "ease-in" | "ease-out" | "ease-in-out" | "linear"
  | "spring" | "bounce";

export type WidgetSize = number | "auto";

export type AccessAuthMode = "any" | "guest" | "user";
export type AccessRole = "admin" | "editor" | "author";
export type AccessRolesMode = "any" | "all";

export interface AccessControlSettings {
  /**
   * Gate based on authentication status.
   *  - "any" (default): visible regardless of session
   *  - "guest": only for not-logged-in visitors
   *  - "user": only for logged-in visitors
   */
  auth?: AccessAuthMode;
  /** When set, visitor must have at least one (`any`) or all (`all`) of these roles. */
  roles?: AccessRole[];
  rolesMode?: AccessRolesMode;
}

export interface AdvancedSettings {
  cssClass?: string;
  customCss?: string;
  animation?: MotionPreset;
  animationDelay?: number;       // ms
  animationDuration?: number;    // ms
  animationOnce?: boolean;       // play only once on first view (default true)
  animationEasing?: MotionEasing;
  animationDistance?: number;    // px - for slide/reveal presets
  hideOn?: { desktop?: boolean; tablet?: boolean; mobile?: boolean };
  /** Gate widget by authentication state and roles. Public renderer only. */
  access?: AccessControlSettings;
  /**
   * Flow positioning relative to siblings in a column.
   *  - "block" (default): widget takes its own row, full width.
   *  - "inline": widget sits next to neighbouring inline widgets in the same row.
   */
  layout?: "block" | "inline";
  htmlId?: string;
  // Per-breakpoint widget frame size. `number` = px, "auto" = hug content.
  // Legacy projects may still use a flat number - read with `pickWidgetSize`.
  width?: ResponsiveValue<WidgetSize> | number;
  height?: ResponsiveValue<WidgetSize> | number;
}

// ---------- Section-specific settings (Elementor-style) ----------

export type ContentWidth = "boxed" | "full";
export type SectionHeight = "default" | "fit-screen" | "min-height" | "fixed";
export type VerticalAlign =
  | "default" | "top" | "middle" | "bottom"
  | "space-between" | "space-around" | "space-evenly";
export type ColumnsGap =
  | "default" | "no" | "narrow" | "extended" | "wide" | "wider" | "custom";
export type OverflowMode = "default" | "hidden";
export type HtmlTag =
  | "div" | "header" | "footer" | "main" | "article" | "aside" | "section" | "nav";

export interface SectionLayout {
  contentWidth?: ContentWidth;       // boxed (default) | full
  width?: number;                    // px; only meaningful when boxed (e.g. 1140)
  columnsGap?: ColumnsGap;
  columnsGapCustom?: number;         // px when columnsGap === "custom"
  height?: SectionHeight;
  heightValue?: number;              // vh for fit-screen, px for min-height / fixed
  marginTop?: number;                // px gap to previous element
  marginBottom?: number;             // px gap to next element
  verticalAlign?: VerticalAlign;
  overflow?: OverflowMode;
  stretch?: boolean;                 // stretch beyond container (100vw)
  htmlTag?: HtmlTag;
}

export type BackgroundType = "none" | "classic" | "gradient" | "video" | "slideshow";
export type BackgroundRepeat = "no-repeat" | "repeat" | "repeat-x" | "repeat-y";
export type BackgroundSize = "auto" | "cover" | "contain";
export type BackgroundPosition =
  | "center center" | "top center" | "top left" | "top right"
  | "center left" | "center right"
  | "bottom center" | "bottom left" | "bottom right";
export type BackgroundAttachment = "scroll" | "fixed";
export type GradientType = "linear" | "radial";

export interface BackgroundSettings {
  type?: BackgroundType;
  color?: string;
  // classic image
  imageUrl?: string;
  position?: BackgroundPosition;
  attachment?: BackgroundAttachment;
  repeat?: BackgroundRepeat;
  size?: BackgroundSize;
  // gradient
  gradientType?: GradientType;
  gradientColor?: string;
  gradientColor2?: string;
  gradientAngle?: number;       // 0..360 for linear
  gradientLocation?: number;    // 0..100
  gradientLocation2?: number;   // 0..100
  // video
  videoUrl?: string;
  videoFallbackColor?: string;
  // slideshow
  slideshowImages?: string[];
  slideshowDurationMs?: number;
}

export interface OverlaySettings extends BackgroundSettings {
  opacity?: number;             // 0..1
  blendMode?:
    | "normal" | "multiply" | "screen" | "overlay" | "darken" | "lighten"
    | "color-dodge" | "saturation" | "color" | "difference" | "exclusion"
    | "hue" | "luminosity";
}

export type BorderStyle = "none" | "solid" | "dashed" | "dotted" | "double" | "groove";
export interface BoxSides {
  top?: number; right?: number; bottom?: number; left?: number;
}
export interface BorderSettings {
  style?: BorderStyle;
  width?: BoxSides;
  color?: string;
  radius?: BoxSides;
  boxShadow?: string;           // raw css, e.g. "0 10px 30px rgba(0,0,0,.2)"
}

export type ShapeDividerType =
  | "none" | "mountains" | "drops" | "clouds" | "zigzag" | "pyramids"
  | "triangle" | "tilt" | "waves" | "curve" | "split" | "arrow" | "book";
export interface ShapeDividerSettings {
  type?: ShapeDividerType;
  color?: string;
  width?: number;       // %, 100..300
  height?: number;      // px
  flipH?: boolean;
  flipV?: boolean;      // (a.k.a. "invert")
  bringToFront?: boolean;
}

export interface TypographySettings {
  headingColor?: string;
  textColor?: string;
  linkColor?: string;
  linkHoverColor?: string;
  align?: ResponsiveValue<Align>;
}

export type WidgetType =
  // Basic
  | "heading" | "text" | "image" | "button" | "divider" | "spacer"
  // Media
  | "video" | "gallery" | "icon" | "map" | "tts"
  // Dynamic
  | "post-list" | "carousel" | "categories" | "tags"
  // Forms
  | "newsletter" | "contact" | "cta"
  // Navigation
  | "nav-link" | "mega-menu"
  // Site chrome (header/footer/menu)
  | "social-icons" | "lang-switcher" | "theme-toggle"
  | "account-link" | "search-button" | "copyright"
  // Rich blocks
  | "accordion" | "tabs" | "testimonial" | "pricing"
  // Home-page building blocks
  | "section-label" | "hot-topic-bar" | "rated-list" | "dark-featured-card"
  // Slider
  | "slider"
  // Animated heading
  | "animated-heading"
  // Advertising
  | "ad-slot"
  // News ticker
  | "news-ticker"
  // Podcast
  | "podcast-latest"
  // Web Stories
  | "web-stories-carousel"
  // Auth forms (structural - never raw HTML)
  | "login-form" | "register-form" | "lost-password-form" | "reset-password-form"
  // Dynamic tags (current-post / archive aware)
  | "post-title" | "post-meta" | "post-tags-dyn" | "post-categories-dyn"
  | "post-author-card" | "post-breadcrumbs" | "post-cover" | "post-excerpt"
  | "archive-title" | "search-form" | "contact-form";


// JSON-safe primitives that may live inside a widget's content map.
export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [key: string]: Json };

export type WidgetContent = { [key: string]: Json };

export interface WidgetNode {
  id: string;
  kind: "widget";
  type: WidgetType;
  content: WidgetContent;
  style?: CommonStyle;
  advanced?: AdvancedSettings;
}

export interface ColumnNode {
  id: string;
  kind: "column";
  span: ResponsiveValue<number>;
  style?: CommonStyle;
  advanced?: AdvancedSettings;
  /** Horizontal alignment of widgets in the wrap row. Default: "start". */
  contentAlign?: "start" | "center" | "end";
  /** Vertical alignment of widgets in the column. Default: "start". */
  verticalAlign?: "start" | "center" | "end" | "stretch";
  children: Array<WidgetNode>;

}

export interface InnerSectionNode {
  id: string;
  kind: "inner-section";
  layout?: SectionLayout;
  background?: BackgroundSettings;
  border?: BorderSettings;
  typography?: TypographySettings;
  style?: CommonStyle;
  advanced?: AdvancedSettings;
  columns: ColumnNode[];
}

export type SectionChild = ColumnNode | InnerSectionNode;

export interface SectionNode {
  id: string;
  kind: "section";
  layout?: SectionLayout;
  background?: BackgroundSettings;
  backgroundHover?: BackgroundSettings;
  overlay?: OverlaySettings;
  overlayHover?: OverlaySettings;
  border?: BorderSettings;
  borderHover?: BorderSettings;
  shapeDividerTop?: ShapeDividerSettings;
  shapeDividerBottom?: ShapeDividerSettings;
  typography?: TypographySettings;
  style?: CommonStyle;
  advanced?: AdvancedSettings;
  children: SectionChild[];
}

export interface BuilderDocument {
  version: 1;
  sections: SectionNode[];
}

export const emptyDocument = (): BuilderDocument => ({ version: 1, sections: [] });

export const newId = (): string => (typeof crypto !== "undefined" && "randomUUID" in crypto
  ? crypto.randomUUID()
  : Math.random().toString(36).slice(2) + Date.now().toString(36));
