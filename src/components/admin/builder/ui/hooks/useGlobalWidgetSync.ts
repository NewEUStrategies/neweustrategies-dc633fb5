// Auto-sync for global-widget instances edited inside the builder.
//
// Renderers overlay the LIVE builder_global_widgets record (React Query cache),
// so a properties-panel edit of an instance would otherwise be invisible on the
// canvas. This hook watches the document, and whenever an instance snapshot
// changes it (1) optimistically writes the payload into the query cache - every
// instance on the canvas updates instantly - and (2) pushes it to Supabase with
// a debounce, which fans the change out to every page referencing the global.
//
// Baselines are recorded on first sight of a node (loading a page never pushes
// a possibly-stale snapshot over a newer global) and updated on every observed
// change, so undo/redo also propagates.
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { BuilderDocument, WidgetNode } from "@/lib/builder/types";
import {
  globalWidgetKey,
  pushGlobalWidgetData,
  widgetToGlobalData,
  type GlobalWidgetData,
} from "@/lib/builder/globalWidgets";

const PUSH_DEBOUNCE_MS = 800;

function forEachGlobalInstance(doc: BuilderDocument, fn: (w: WidgetNode) => void): void {
  for (const s of doc.sections ?? []) {
    for (const c of s?.children ?? []) {
      if (!c) continue;
      const cols = c.kind === "column" ? [c] : (c.columns ?? []);
      for (const col of cols) {
        for (const w of col?.children ?? []) {
          if (w?.globalId) fn(w);
        }
      }
    }
  }
}

export function useGlobalWidgetSync(doc: BuilderDocument): void {
  const queryClient = useQueryClient();
  // nodeId -> last observed serialized payload
  const baselineRef = useRef(new Map<string, string>());
  // globalId -> pending debounced push (timer + latest payload)
  const pendingRef = useRef(
    new Map<string, { timer: ReturnType<typeof setTimeout>; payload: GlobalWidgetData }>(),
  );

  useEffect(() => {
    const baseline = baselineRef.current;
    const pending = pendingRef.current;
    const seen = new Set<string>();

    forEachGlobalInstance(doc, (w) => {
      const globalId = w.globalId;
      if (!globalId) return;
      seen.add(w.id);
      const payload = widgetToGlobalData(w);
      const serialized = JSON.stringify(payload);
      const prev = baseline.get(w.id);
      baseline.set(w.id, serialized);
      if (prev === undefined || prev === serialized) return;

      // Instant canvas feedback for every instance of this global.
      queryClient.setQueryData<GlobalWidgetData | null>(globalWidgetKey(globalId), payload);

      const entry = pending.get(globalId);
      if (entry) clearTimeout(entry.timer);
      pending.set(globalId, {
        payload,
        timer: setTimeout(() => {
          pending.delete(globalId);
          void pushGlobalWidgetData(globalId, payload);
        }, PUSH_DEBOUNCE_MS),
      });
    });

    // Prune baselines of removed nodes so re-adding them re-baselines cleanly.
    for (const nodeId of baseline.keys()) {
      if (!seen.has(nodeId)) baseline.delete(nodeId);
    }
  }, [doc, queryClient]);

  // Flush pending pushes on unmount so a quick edit + navigate never drops a sync.
  useEffect(
    () => () => {
      for (const [globalId, entry] of pendingRef.current) {
        clearTimeout(entry.timer);
        void pushGlobalWidgetData(globalId, entry.payload);
      }
      pendingRef.current.clear();
    },
    [],
  );
}
