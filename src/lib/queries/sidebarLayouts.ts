// Query options for fetching post sidebar layouts.
// Public/read uses the default layout for the current tenant unless a post
// supplies `sidebar_layout_id` override.
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  DEFAULT_READING_PANEL_SETTINGS,
  type SidebarLayout,
  type SidebarWidget,
} from "@/lib/sidebarBuilder/types";

interface RawRow {
  id: string;
  tenant_id: string;
  name: string;
  is_default: boolean;
  widgets: unknown;
  created_at: string;
  updated_at: string;
}

function parseWidgets(raw: unknown): SidebarWidget[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((w): w is Record<string, unknown> => !!w && typeof w === "object")
    .map((w) => ({
      id: String(w.id ?? crypto.randomUUID()),
      type: (w.type as SidebarWidget["type"]) ?? "reading-panel",
      hidden: Boolean(w.hidden),
      settings: (w.settings as Record<string, unknown>) ?? {},
    }));
}

function toLayout(row: RawRow): SidebarLayout {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    name: row.name,
    is_default: row.is_default,
    widgets: parseWidgets(row.widgets),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function defaultSidebarLayoutQueryOptions() {
  return queryOptions({
    queryKey: ["post-sidebar-layout", "default"],
    queryFn: async (): Promise<SidebarLayout | null> => {
      const { data, error } = await supabase
        .from("post_sidebar_layouts")
        .select("id, tenant_id, name, is_default, widgets, created_at, updated_at")
        .eq("is_default", true)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data ? toLayout(data as RawRow) : null;
    },
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });
}

export function sidebarLayoutByIdQueryOptions(id: string | null | undefined) {
  return queryOptions({
    queryKey: ["post-sidebar-layout", "by-id", id ?? null],
    enabled: !!id,
    queryFn: async (): Promise<SidebarLayout | null> => {
      if (!id) return null;
      const { data, error } = await supabase
        .from("post_sidebar_layouts")
        .select("id, tenant_id, name, is_default, widgets, created_at, updated_at")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data ? toLayout(data as RawRow) : null;
    },
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });
}

export function allSidebarLayoutsQueryOptions() {
  return queryOptions({
    queryKey: ["post-sidebar-layout", "all"],
    queryFn: async (): Promise<SidebarLayout[]> => {
      const { data, error } = await supabase
        .from("post_sidebar_layouts")
        .select("id, tenant_id, name, is_default, widgets, created_at, updated_at")
        .order("is_default", { ascending: false })
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((r) => toLayout(r as RawRow));
    },
    staleTime: 60_000,
  });
}

/** Fallback layout used when DB has nothing (e.g. fresh install). */
export function buildFallbackLayout(): SidebarLayout {
  return {
    id: "fallback",
    tenant_id: "",
    name: "fallback",
    is_default: true,
    widgets: [
      {
        id: "fallback-reading",
        type: "reading-panel",
        hidden: false,
        settings: { ...DEFAULT_READING_PANEL_SETTINGS },
      },
    ],
  };
}
