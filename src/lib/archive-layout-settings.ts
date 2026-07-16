// Archive layout settings - global config for category/tag archive pages.
// Read publicly (RLS SELECT true); admin-only writes go through Supabase RLS.
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type ArchiveType = "category" | "tag";
export type SidebarWidgetKey = "popular" | "related" | "newsletter" | "ads";
export type HeroBgStyle = "gradient" | "image" | "solid" | "pattern" | "mesh" | "minimal";
export type ListStyle = "grid" | "list" | "masonry";
export type SidebarPosition = "left" | "right";

export interface ArchiveLayoutSettings {
  id: string;
  archive_type: ArchiveType;
  layout_variant: 1 | 2 | 3 | 4 | 5 | 6;
  columns: 1 | 2 | 3 | 4;
  list_style: ListStyle;
  show_hero: boolean;
  show_description: boolean;
  show_follow: boolean;
  show_breadcrumbs: boolean;
  show_sidebar: boolean;
  sidebar_position: SidebarPosition;
  sidebar_widgets: SidebarWidgetKey[];
  show_featured_top: boolean;
  show_related_taxonomies: boolean;
  show_podcasts: boolean;
  hero_bg_style: HeroBgStyle;
  posts_per_page: number;
}

export const DEFAULT_ARCHIVE_LAYOUT: Omit<ArchiveLayoutSettings, "id" | "archive_type"> = {
  layout_variant: 2,
  columns: 3,
  list_style: "grid",
  show_hero: true,
  show_description: true,
  show_follow: true,
  show_breadcrumbs: true,
  show_sidebar: false,
  sidebar_position: "right",
  sidebar_widgets: ["popular", "related", "newsletter", "ads"],
  show_featured_top: true,
  show_related_taxonomies: false,
  show_podcasts: true,
  hero_bg_style: "gradient",
  posts_per_page: 60,
};

type Row = Database["public"]["Tables"]["archive_layout_settings"]["Row"];

function coerce(archiveType: ArchiveType, row: Row | null): ArchiveLayoutSettings {
  if (!row) {
    return {
      id: "",
      archive_type: archiveType,
      ...DEFAULT_ARCHIVE_LAYOUT,
    };
  }
  const widgets = Array.isArray(row.sidebar_widgets)
    ? (row.sidebar_widgets.filter(
        (w): w is SidebarWidgetKey =>
          w === "popular" || w === "related" || w === "newsletter" || w === "ads",
      ) as SidebarWidgetKey[])
    : DEFAULT_ARCHIVE_LAYOUT.sidebar_widgets;
  const variant = Math.max(1, Math.min(6, row.layout_variant)) as ArchiveLayoutSettings["layout_variant"];
  const columns = Math.max(1, Math.min(4, row.columns)) as ArchiveLayoutSettings["columns"];
  return {
    id: row.id,
    archive_type: (row.archive_type === "tag" ? "tag" : "category") as ArchiveType,
    layout_variant: variant,
    columns,
    list_style: (row.list_style as ListStyle) ?? "grid",
    show_hero: row.show_hero,
    show_description: row.show_description,
    show_follow: row.show_follow,
    show_breadcrumbs: row.show_breadcrumbs,
    show_sidebar: row.show_sidebar,
    sidebar_position: (row.sidebar_position as SidebarPosition) ?? "right",
    sidebar_widgets: widgets,
    show_featured_top: row.show_featured_top,
    show_related_taxonomies: row.show_related_taxonomies,
    show_podcasts: row.show_podcasts,
    hero_bg_style: (row.hero_bg_style as HeroBgStyle) ?? "gradient",
    posts_per_page: row.posts_per_page,
  };
}

export function archiveLayoutQueryOptions(archiveType: ArchiveType) {
  return queryOptions({
    queryKey: ["archive-layout-settings", archiveType] as const,
    queryFn: async (): Promise<ArchiveLayoutSettings> => {
      const { data, error } = await supabase
        .from("archive_layout_settings")
        .select("*")
        .eq("archive_type", archiveType)
        .maybeSingle();
      if (error) throw error;
      return coerce(archiveType, data);
    },
    staleTime: 5 * 60_000,
  });
}
