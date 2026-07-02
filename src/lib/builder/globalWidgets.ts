// Global widgets - a widget saved once (builder_global_widgets) and referenced
// by many pages. An instance node embeds a full local snapshot (SSR/offline
// fallback) plus `globalId`; renderers overlay the live record via React Query
// so editing a global propagates to every page that references it.
//
// Data flow:
//   save:   context menu "Zapisz jako widget globalny" -> insert row, tag node
//   insert: WidgetLibrary palette (click / drag) -> makeGlobalInstance()
//   edit:   useGlobalWidgetSync (builder hook) pushes changed instance
//           snapshots to the row (optimistic cache write + debounced upsert)
//   render: useGlobalWidgetNode overlay in WidgetView
//   detach: delete node.globalId (snapshot stays, widget becomes local)
import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTenantId } from "@/lib/tenant";
import type { WidgetNode } from "./types";
import { newId, toJson } from "./types";
import { isKnownWidgetType } from "./schema";
import { emitWidgetCacheInvalidate } from "./widgetCacheInvalidation";

/** The synchronized part of a widget: everything except the instance id. */
export type GlobalWidgetData = Pick<WidgetNode, "type" | "content" | "style" | "advanced">;

export interface GlobalWidget {
  id: string;
  name: string;
  data: GlobalWidgetData;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

interface RawRow {
  id: string;
  name: string;
  data: unknown;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** Coerce arbitrary JSON into the synchronized widget payload (or null). */
export function parseGlobalWidgetData(raw: unknown): GlobalWidgetData | null {
  if (!isObject(raw)) return null;
  if (!isKnownWidgetType(raw.type)) return null;
  const data: GlobalWidgetData = {
    type: raw.type,
    content: isObject(raw.content) ? (raw.content as GlobalWidgetData["content"]) : {},
  };
  if (isObject(raw.style)) data.style = raw.style as GlobalWidgetData["style"];
  if (isObject(raw.advanced)) data.advanced = raw.advanced as GlobalWidgetData["advanced"];
  return data;
}

const toGlobalWidget = (r: RawRow): GlobalWidget | null => {
  const data = parseGlobalWidgetData(r.data);
  if (!data) return null;
  return {
    id: r.id,
    name: r.name,
    data,
    created_at: r.created_at,
    updated_at: r.updated_at,
    created_by: r.created_by,
  };
};

/** Extract the synchronized payload from an instance node (deep-cloned). */
export function widgetToGlobalData(w: WidgetNode): GlobalWidgetData {
  const data: GlobalWidgetData = { type: w.type, content: w.content ?? {} };
  if (w.style) data.style = w.style;
  if (w.advanced) data.advanced = w.advanced;
  return JSON.parse(JSON.stringify(data)) as GlobalWidgetData;
}

/** New instance node referencing a global widget (fresh id + snapshot). */
export function makeGlobalInstance(g: Pick<GlobalWidget, "id" | "data">): WidgetNode {
  const snapshot = JSON.parse(JSON.stringify(g.data)) as GlobalWidgetData;
  return { id: newId(), kind: "widget", ...snapshot, globalId: g.id };
}

/** Overlay the live global payload onto an instance (id + globalId stay). */
export function mergeGlobalIntoInstance(instance: WidgetNode, data: GlobalWidgetData): WidgetNode {
  return { ...data, id: instance.id, kind: "widget", globalId: instance.globalId };
}

// ---------- query keys (registered in WIDGET_LIVE_QUERY_PREFIXES) ----------

export const globalWidgetKey = (id: string) => ["global-widget", id] as const;
export const globalWidgetsListKey = (tenantId: string | null) =>
  ["global-widgets", tenantId ?? ""] as const;

// ---------- render-side resolution ----------

const GLOBAL_WIDGET_STALE = 60_000;
const GLOBAL_WIDGET_GC = 10 * 60_000;

/**
 * Live payload of a global widget for the render overlay. Returns null until
 * loaded (callers fall back to the instance snapshot) and when `globalId` is
 * absent, so it is safe to call unconditionally from WidgetView.
 */
export function useGlobalWidgetNode(globalId: string | undefined): GlobalWidgetData | null {
  const q = useQuery({
    queryKey: globalWidgetKey(globalId ?? ""),
    enabled: Boolean(globalId),
    staleTime: GLOBAL_WIDGET_STALE,
    gcTime: GLOBAL_WIDGET_GC,
    queryFn: async (): Promise<GlobalWidgetData | null> => {
      if (!globalId) return null;
      const { data, error } = await supabase
        .from("builder_global_widgets")
        .select("data")
        .eq("id", globalId)
        .maybeSingle();
      if (error) return null;
      return parseGlobalWidgetData(data?.data ?? null);
    },
  });
  return q.data ?? null;
}

/** Name + meta of a global widget (properties-panel banner). */
export function useGlobalWidgetMeta(globalId: string | undefined): { name: string } | null {
  const q = useQuery({
    queryKey: ["global-widget-meta", globalId ?? ""],
    enabled: Boolean(globalId),
    staleTime: GLOBAL_WIDGET_STALE,
    queryFn: async (): Promise<{ name: string } | null> => {
      if (!globalId) return null;
      const { data, error } = await supabase
        .from("builder_global_widgets")
        .select("name")
        .eq("id", globalId)
        .maybeSingle();
      if (error) return null;
      return data ? { name: data.name } : null;
    },
  });
  return q.data ?? null;
}

// ---------- admin CRUD (palette + builder ops) ----------

export function useGlobalWidgets() {
  const tenantId = useCurrentTenantId();
  const queryClient = useQueryClient();

  const q = useQuery({
    queryKey: globalWidgetsListKey(tenantId),
    enabled: Boolean(tenantId),
    staleTime: GLOBAL_WIDGET_STALE,
    queryFn: async (): Promise<GlobalWidget[]> => {
      const { data, error } = await supabase
        .from("builder_global_widgets")
        .select("id, name, data, created_at, updated_at, created_by")
        .eq("tenant_id", tenantId ?? "")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return ((data ?? []) as RawRow[])
        .map(toGlobalWidget)
        .filter((x): x is GlobalWidget => x !== null);
    },
  });

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["global-widgets"] });
    void queryClient.invalidateQueries({ queryKey: ["global-widget"] });
    void queryClient.invalidateQueries({ queryKey: ["global-widget-meta"] });
    emitWidgetCacheInvalidate();
  }, [queryClient]);

  const save = useCallback(
    async (name: string, widget: WidgetNode): Promise<string | null> => {
      const { data: u } = await supabase.auth.getUser();
      const payload = widgetToGlobalData(widget);
      const { data, error } = await supabase
        .from("builder_global_widgets")
        .insert({ name, data: toJson(payload), created_by: u.user?.id ?? null })
        .select("id")
        .single();
      if (error) return null;
      invalidate();
      return data.id;
    },
    [invalidate],
  );

  const rename = useCallback(
    async (id: string, name: string) => {
      await supabase.from("builder_global_widgets").update({ name }).eq("id", id);
      invalidate();
    },
    [invalidate],
  );

  const remove = useCallback(
    async (id: string) => {
      await supabase.from("builder_global_widgets").delete().eq("id", id);
      invalidate();
    },
    [invalidate],
  );

  return useMemo(
    () => ({
      items: q.data ?? [],
      loading: q.isLoading,
      save,
      rename,
      remove,
    }),
    [q.data, q.isLoading, save, rename, remove],
  );
}

/** Persist the synchronized payload of a global widget (builder auto-sync). */
export async function pushGlobalWidgetData(id: string, data: GlobalWidgetData): Promise<boolean> {
  const { error } = await supabase
    .from("builder_global_widgets")
    .update({ data: toJson(data) })
    .eq("id", id);
  if (!error) emitWidgetCacheInvalidate();
  return !error;
}
