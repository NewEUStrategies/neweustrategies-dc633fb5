// Typy domeny dla buildera sidebara wpisu.
// Layout = nazwany zestaw widgetów per tenant. Widget = jeden blok w sidebarze.
import { z } from "zod";

export type SidebarWidgetType =
  | "reading-panel"
  | "tags"
  | "author-card"
  | "related-posts"
  | "newsletter"
  | "ad-slot";

export const SOCIAL_KEYS = [
  "x",
  "facebook",
  "linkedin",
  "mail",
  "copy",
  "whatsapp",
  "telegram",
  "reddit",
] as const;
export type SocialKey = (typeof SOCIAL_KEYS)[number];

export interface ReadingPanelSettings {
  showToc: boolean;
  showProgress: boolean;
  showSaveLater: boolean;
  showPrint: boolean;
  showPdf: boolean;
  social: Record<SocialKey, boolean>;
}

type WidgetSettings = ReadingPanelSettings | Record<string, unknown>;

export interface SidebarWidget {
  id: string;
  type: SidebarWidgetType;
  hidden?: boolean;
  settings: WidgetSettings;
}

export interface SidebarLayout {
  id: string;
  tenant_id: string;
  name: string;
  is_default: boolean;
  widgets: SidebarWidget[];
  created_at?: string;
  updated_at?: string;
}

// Zod schemas - walidacja przed zapisem do bazy.
const widgetSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["reading-panel", "tags", "author-card", "related-posts", "newsletter", "ad-slot"]),
  hidden: z.boolean().optional(),
  settings: z.record(z.unknown()).default({}),
});

export const widgetsArraySchema = z.array(widgetSchema).max(40);

export const DEFAULT_READING_PANEL_SETTINGS: ReadingPanelSettings = {
  showToc: true,
  showProgress: true,
  showSaveLater: true,
  showPrint: true,
  showPdf: true,
  social: {
    x: true,
    facebook: true,
    linkedin: true,
    mail: true,
    copy: true,
    whatsapp: false,
    telegram: false,
    reddit: false,
  },
};
