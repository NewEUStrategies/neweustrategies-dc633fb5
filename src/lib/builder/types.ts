// Drag-and-drop builder types - shared between editor and public renderer.
// Tree: Document -> Sections -> (InnerSections | Columns) -> Columns -> Widgets.

export type Device = "desktop" | "tablet" | "mobile";

export type Align = "left" | "center" | "right";

export interface ResponsiveValue<T> {
  desktop?: T;
  tablet?: T;
  mobile?: T;
}

export interface CommonStyle {
  bgColor?: string;
  textColor?: string;
  padding?: ResponsiveValue<string>; // CSS shorthand e.g. "24px 16px"
  margin?: ResponsiveValue<string>;
  align?: ResponsiveValue<Align>;
  borderRadius?: string;
  maxWidth?: string;
}

export interface AdvancedSettings {
  cssClass?: string;
  customCss?: string;
  animation?: "none" | "fade" | "slide-up" | "zoom";
  hideOn?: { desktop?: boolean; tablet?: boolean; mobile?: boolean };
  htmlId?: string;
}

export type WidgetType =
  // Basic
  | "heading" | "text" | "image" | "button" | "divider" | "spacer"
  // Media
  | "video" | "gallery" | "icon" | "map"
  // Dynamic
  | "post-list" | "carousel" | "categories" | "tags"
  // Forms
  | "newsletter" | "contact" | "cta";

// JSON-safe primitives that may live inside a widget's content map.
// This is a discriminated, recursive JSON type - strictly stronger than
// `unknown` because every consumer must narrow via typeof/Array.isArray.
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
  // Bilingual content map. UI exposes one language tab at a time.
  content: WidgetContent;
  style?: CommonStyle;
  advanced?: AdvancedSettings;
}

export interface ColumnNode {
  id: string;
  kind: "column";
  // Width fraction 1..12 of parent row.
  span: ResponsiveValue<number>;
  style?: CommonStyle;
  advanced?: AdvancedSettings;
  children: Array<WidgetNode>;
}

export interface InnerSectionNode {
  id: string;
  kind: "inner-section";
  style?: CommonStyle;
  advanced?: AdvancedSettings;
  columns: ColumnNode[];
}

export type SectionChild = ColumnNode | InnerSectionNode;

export interface SectionNode {
  id: string;
  kind: "section";
  style?: CommonStyle;
  advanced?: AdvancedSettings;
  // A section is a row of columns; inner sections can be nested as siblings of columns
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
