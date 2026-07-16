// Wspólne typy i schematy Zod dla menedżera menu (klient + serwer).
// Trzymane poza `.functions.ts` / `.server.ts`, żeby były bezpiecznie
// importowalne przez builder i admin UI.
import { z } from "zod";

export const MENU_ITEM_TYPES = ["page", "post", "category", "tag", "custom"] as const;
export type MenuItemType = (typeof MENU_ITEM_TYPES)[number];

export const megaColumnLinkSchema = z.object({
  label_pl: z.string().max(200).default(""),
  label_en: z.string().max(200).default(""),
  href: z.string().max(1000).default(""),
  icon: z.string().max(64).default(""),
});
export type MegaColumnLink = z.infer<typeof megaColumnLinkSchema>;

export const megaColumnSchema = z.object({
  title_pl: z.string().max(200).default(""),
  title_en: z.string().max(200).default(""),
  href: z.string().max(1000).default(""),
  links: z.array(megaColumnLinkSchema).max(30).default([]),
});
export type MegaColumn = z.infer<typeof megaColumnSchema>;

export const megaConfigSchema = z.object({
  columns_per_row: z.number().int().min(1).max(6).default(4),
  width: z.enum(["container", "full"]).default("container"),
  columns: z.array(megaColumnSchema).max(12).default([]),
  featured_post_id: z.string().uuid().nullable().default(null),
});
export type MegaConfig = z.infer<typeof megaConfigSchema>;

export const DEFAULT_MEGA_CONFIG: MegaConfig = {
  columns_per_row: 4,
  width: "container",
  columns: [],
  featured_post_id: null,
};

export const menuItemInputSchema = z.object({
  // Klientowe `local_id` służy tylko do zbudowania hierarchii po stronie serwera
  // przed insertem (parent_local_id -> nowo wygenerowane UUID).
  local_id: z.string().min(1).max(64),
  parent_local_id: z.string().min(1).max(64).nullable(),
  position: z.number().int().min(0).max(9999),
  item_type: z.enum(MENU_ITEM_TYPES),
  ref_id: z.string().uuid().nullable(),
  label_pl: z.string().trim().min(1).max(200),
  label_en: z.string().trim().max(200).default(""),
  href: z.string().trim().max(1000).default(""),
  target: z.enum(["_self", "_blank"]).default("_self"),
  css_class: z.string().trim().max(200).default(""),
  icon: z.string().trim().max(64).default(""),
  mega_enabled: z.boolean().default(false),
  mega_config: megaConfigSchema.default(DEFAULT_MEGA_CONFIG),
});
export type MenuItemInput = z.infer<typeof menuItemInputSchema>;

export const saveMenuInputSchema = z.object({
  menu_key: z.string().min(1).max(64),
  items: z.array(menuItemInputSchema).max(500),
});
export type SaveMenuInput = z.infer<typeof saveMenuInputSchema>;

export interface MenuItemRow {
  id: string;
  menu_id: string;
  parent_id: string | null;
  position: number;
  item_type: MenuItemType;
  ref_id: string | null;
  label_pl: string;
  label_en: string;
  href: string;
  target: string;
  css_class: string;
  mega_enabled: boolean;
  mega_config: MegaConfig;
}

export interface MenuWithItems {
  id: string;
  key: string;
  name: string;
  items: MenuItemRow[];
}

// Parsowanie luźne - uszkodzony rekord nie może wywalić SSR-a.
export function parseMegaConfig(input: unknown): MegaConfig {
  const parsed = megaConfigSchema.safeParse(input);
  return parsed.success ? parsed.data : DEFAULT_MEGA_CONFIG;
}
