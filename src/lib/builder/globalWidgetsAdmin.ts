// Widgety globalne - część PANELU: lista palety, zapis, zmiana nazwy,
// usuwanie, synchronizacja payloadu z buildera i baner panelu właściwości.
// Model danych i nakładkę renderera opisuje nagłówek `globalWidgets.ts`.
//
// OSOBNY MODUŁ, CELOWO (chunk startowy, roadmapa ładowania §9.1 J3).
// `globalWidgets.ts` importuje ramka widgetu, więc siedzi w `app-initial`
// każdej strony; dopóki kod panelu mieszkał w nim, przeglądarka czytelnika
// pobierała go razem z nakładką (ok. 2 KB surowego kodu). Tu importuje wyłącznie
// edytor; `globalWidgets.ts` NIE importuje stąd niczego - także reeksportem.
import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTenantId } from "@/lib/tenant";
import type { WidgetNode } from "./types";
import { newId, toJson } from "./types";
import { emitWidgetCacheInvalidate } from "./widgetCacheInvalidation";
import { WIDGET_QUERY_ROOTS } from "./queryKeys";
import {
  GLOBAL_WIDGET_STALE,
  parseGlobalWidgetData,
  type GlobalWidget,
  type GlobalWidgetData,
} from "./globalWidgets";

interface RawRow {
  id: string;
  name: string;
  data: unknown;
  created_at: string;
  updated_at: string;
  created_by: string | null;
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

// ---------- query keys (registered in WIDGET_LIVE_QUERY_PREFIXES) ----------

const globalWidgetsListKey = (tenantId: string | null) =>
  [WIDGET_QUERY_ROOTS.globalWidgets, tenantId ?? ""] as const;

/** Name + meta of a global widget (properties-panel banner). */
export function useGlobalWidgetMeta(globalId: string | undefined): { name: string } | null {
  const q = useQuery({
    queryKey: [WIDGET_QUERY_ROOTS.globalWidgetMeta, globalId ?? ""],
    enabled: Boolean(globalId),
    staleTime: GLOBAL_WIDGET_STALE,
    queryFn: async (): Promise<{ name: string } | null> => {
      if (!globalId) return null;
      const { data, error } = await supabase
        .from("builder_global_widgets")
        .select("name")
        .eq("id", globalId)
        .maybeSingle();
      if (error) throw error;
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
    void queryClient.invalidateQueries({ queryKey: [WIDGET_QUERY_ROOTS.globalWidgets] });
    void queryClient.invalidateQueries({ queryKey: [WIDGET_QUERY_ROOTS.globalWidget] });
    void queryClient.invalidateQueries({ queryKey: [WIDGET_QUERY_ROOTS.globalWidgetMeta] });
    emitWidgetCacheInvalidate();
  }, [queryClient]);

  /**
   * Id nowego globala albo `null`. Najemca idzie jawnie z sesji - ten sam,
   * po którym filtruje lista - a przy nieznanym najemcy nic nie leci do bazy.
   */
  const save = useCallback(
    async (name: string, widget: WidgetNode): Promise<string | null> => {
      if (!tenantId) return null;
      const { data: s } = await supabase.auth.getSession();
      const payload = widgetToGlobalData(widget);
      const { data, error } = await supabase
        .from("builder_global_widgets")
        .insert({
          tenant_id: tenantId,
          name,
          data: toJson(payload),
          created_by: s.session?.user?.id ?? null,
        })
        .select("id")
        .single();
      if (error || !data) return null;
      invalidate();
      return data.id;
    },
    [invalidate, tenantId],
  );

  /** `true` przy powodzeniu; odmowa NIE unieważnia cache. */
  const rename = useCallback(
    async (id: string, name: string): Promise<boolean> => {
      if (!tenantId) return false;
      const { error } = await supabase
        .from("builder_global_widgets")
        .update({ name })
        .eq("id", id)
        .eq("tenant_id", tenantId);
      if (error) return false;
      invalidate();
      return true;
    },
    [invalidate, tenantId],
  );

  /** `true` przy powodzeniu; odmowa NIE unieważnia cache. */
  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      if (!tenantId) return false;
      const { error } = await supabase
        .from("builder_global_widgets")
        .delete()
        .eq("id", id)
        .eq("tenant_id", tenantId);
      if (error) return false;
      invalidate();
      return true;
    },
    [invalidate, tenantId],
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

/**
 * Persist the synchronized payload of a global widget (builder auto-sync).
 * `tenantId` pochodzi z sesji wołającego (`useCurrentTenantId`, jak lista);
 * bez niego zapis nie leci, a filtr domyka `tenant_id` obok `id`.
 */
export async function pushGlobalWidgetData(
  id: string,
  data: GlobalWidgetData,
  tenantId: string | null,
): Promise<boolean> {
  if (!tenantId) return false;
  const { error } = await supabase
    .from("builder_global_widgets")
    .update({ data: toJson(data) })
    .eq("id", id)
    .eq("tenant_id", tenantId);
  if (!error) emitWidgetCacheInvalidate();
  return !error;
}
