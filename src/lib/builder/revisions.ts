// Historia wersji elementów buildera (widgety globalne i popupy). Migawki
// zapisuje wyzwalacz bazy przy każdej zmianie treści; tutaj tylko odczyt i
// przywracanie wybranej wersji na rekord źródłowy.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { emitWidgetCacheInvalidate } from "./widgetCacheInvalidation";
import { parseGlobalWidgetData, type GlobalWidgetData } from "@/lib/builder/globalWidgets";
import { parsePopupSettings, type PopupSettings } from "@/lib/builder/popups";
import { safeParseBuilderDoc } from "@/lib/builder/schema";
import type { BuilderDocument } from "@/lib/builder/types";
import { WIDGET_QUERY_ROOTS } from "./queryKeys";
import { toJson } from "@/lib/builder/types";

export type BuilderEntityType = "global_widget" | "popup";

export interface BuilderRevision {
  id: string;
  entity_type: BuilderEntityType;
  entity_id: string;
  name: string;
  data: unknown;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export interface PopupRevisionPayload {
  builder_data: BuilderDocument;
  settings: PopupSettings;
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** Migawka popupu -> znormalizowany dokument + ustawienia. */
export function parsePopupRevision(raw: unknown): PopupRevisionPayload {
  const obj = isObject(raw) ? raw : {};
  return {
    builder_data: safeParseBuilderDoc(obj.builder_data),
    settings: parsePopupSettings(obj.settings),
  };
}

/** Migawka widgetu globalnego -> payload widgetu (lub null przy złym kształcie). */
export function parseGlobalWidgetRevision(raw: unknown): GlobalWidgetData | null {
  return parseGlobalWidgetData(raw);
}

export const builderRevisionsKey = (entityType: BuilderEntityType, entityId: string | null) =>
  ["admin", "builder-revisions", entityType, entityId ?? ""] as const;

export function useBuilderRevisions(entityType: BuilderEntityType, entityId: string | null) {
  return useQuery({
    queryKey: builderRevisionsKey(entityType, entityId),
    enabled: Boolean(entityId),
    queryFn: async (): Promise<BuilderRevision[]> => {
      if (!entityId) return [];
      const { data, error } = await supabase
        .from("builder_revisions")
        .select("id, entity_type, entity_id, name, data, note, created_by, created_at")
        .eq("entity_type", entityType)
        .eq("entity_id", entityId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as BuilderRevision[];
    },
  });
}

export function useRestoreBuilderRevision(entityType: BuilderEntityType) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (revision: BuilderRevision) => {
      if (entityType === "global_widget") {
        const payload = parseGlobalWidgetRevision(revision.data);
        if (!payload) throw new Error("invalid_revision_payload");
        const { error } = await supabase
          .from("builder_global_widgets")
          .update({ data: toJson(payload) })
          .eq("id", revision.entity_id);
        if (error) throw error;
        return;
      }
      const payload = parsePopupRevision(revision.data);
      const { error } = await supabase
        .from("builder_popups")
        .update({
          builder_data: toJson(payload.builder_data),
          settings: toJson(payload.settings),
        })
        .eq("id", revision.entity_id);
      if (error) throw error;
    },
    onSuccess: (_r, revision) => {
      void qc.invalidateQueries({ queryKey: builderRevisionsKey(entityType, revision.entity_id) });
      void qc.invalidateQueries({ queryKey: [WIDGET_QUERY_ROOTS.globalWidgets] });
      void qc.invalidateQueries({
        queryKey: [WIDGET_QUERY_ROOTS.globalWidget, revision.entity_id],
      });
      void qc.invalidateQueries({ queryKey: ["builder-popups-admin"] });
      emitWidgetCacheInvalidate();
    },
  });
}
