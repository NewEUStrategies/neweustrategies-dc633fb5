// Schematy współdzielone między klientem a serwerem dla konfiguracji
// mobilnego drawera. Trzymamy je poza `.functions.ts` / `.server.ts`, żeby
// builder klienta mógł je bezpiecznie importować (Zod + typy).
import { z } from "zod";

// Kanoniczne bloki drawera - kolejność ustawiana per tenant.
export const DRAWER_SECTIONS = ["top_tools", "account", "nav", "builder"] as const;
export type DrawerSection = (typeof DRAWER_SECTIONS)[number];

// Zamknięta lista ikon (używamy tylko podzbioru lucide-react, żeby uniknąć
// dowolnych stringów przekazywanych do renderera).
export const NAV_ICONS = [
  "home",
  "newspaper",
  "tag",
  "mic",
  "mail",
  "dollar-sign",
  "book-open",
  "briefcase",
  "calendar",
  "file-text",
  "info",
  "layout-grid",
  "star",
  "user",
  "users",
  "shield",
  "phone",
  "map-pin",
  "link",
] as const;
export type NavIcon = (typeof NAV_ICONS)[number];

export const navItemSchema = z.object({
  id: z.string().min(1).max(64),
  label_pl: z.string().trim().min(1).max(80),
  label_en: z.string().trim().min(1).max(80),
  href: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .refine(
      (v) => v.startsWith("/") || /^https?:\/\//.test(v),
      "href musi być ścieżką (/) lub pełnym URL-em (http/https)",
    ),
  icon: z.enum(NAV_ICONS).default("link"),
  enabled: z.boolean().default(true),
});
export type NavItem = z.infer<typeof navItemSchema>;

export const topToolsSchema = z.object({
  search: z.boolean().default(true),
  theme: z.boolean().default(true),
  language: z.boolean().default(true),
});
export type TopTools = z.infer<typeof topToolsSchema>;

export const sectionOrderSchema = z
  .array(z.enum(DRAWER_SECTIONS))
  .min(1)
  .max(DRAWER_SECTIONS.length)
  .refine(
    (arr) => new Set(arr).size === arr.length,
    "section_order nie może zawierać duplikatów",
  );

export const drawerConfigSchema = z.object({
  section_order: sectionOrderSchema,
  top_tools: topToolsSchema,
  nav_items: z.array(navItemSchema).max(20),
});
export type DrawerConfig = z.infer<typeof drawerConfigSchema>;

export const DEFAULT_DRAWER_CONFIG: DrawerConfig = {
  section_order: [...DRAWER_SECTIONS],
  top_tools: { search: true, theme: true, language: true },
  nav_items: [],
};

// Rozluźniony parser wejścia z bazy - brakujące pola dostają wartości domyślne,
// żeby uszkodzony rekord nie wywalał SSR-a.
export function parseDrawerConfig(input: unknown): DrawerConfig {
  const parsed = drawerConfigSchema.safeParse(input);
  if (parsed.success) return parsed.data;
  return DEFAULT_DRAWER_CONFIG;
}
