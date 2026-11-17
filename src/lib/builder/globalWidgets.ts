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
//   render: useGlobalWidgetNode overlay in ChromeWidgetView, rendered ONLY for
//           nodes with globalId: `GlobalChromeWidgetView` (chrome types, above
//           the frame) and `GlobalFullWidgetView` (content types, BELOW the
//           Suspense boundary of the lazy full dispatcher)
//   detach: delete node.globalId (snapshot stays, widget becomes local)
//
// Ten moduł jest w chunku startowym klienta (ramka widgetu rysuje nakładkę
// globala). Zapis, lista palety i baner panelu właściwości (`useGlobalWidgets`,
// `useGlobalWidgetMeta`, `widgetToGlobalData`, `makeGlobalInstance`,
// `pushGlobalWidgetData`) mieszkają w `globalWidgetsAdmin.ts`, który importuje
// tylko edytor - nie importuj go stąd (roadmapa ładowania §9.1 J3).
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { WidgetNode } from "./types";
import { isKnownWidgetType } from "./schema";
import { WIDGET_QUERY_ROOTS } from "./queryKeys";

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

/** Overlay the live global payload onto an instance (id + globalId stay). */
export function mergeGlobalIntoInstance(instance: WidgetNode, data: GlobalWidgetData): WidgetNode {
  return { ...data, id: instance.id, kind: "widget", globalId: instance.globalId };
}

/**
 * Resolve a global widget for its current rendering context.
 *
 * The builder document is the immediate source of truth while an instance is
 * being edited. Its snapshot already contains the optimistic property change,
 * whereas the shared query can still contain the previous persisted payload
 * until the global-widget sync effect runs. Public/read-only renderers continue
 * to prefer the live shared payload so all instances stay synchronized.
 */
export function resolveGlobalWidgetInstance(
  instance: WidgetNode,
  data: GlobalWidgetData | null,
  preferInstance: boolean,
): WidgetNode {
  if (preferInstance || !instance.globalId || !data) return instance;
  return mergeGlobalIntoInstance(instance, data);
}

// ---------- query keys (registered in WIDGET_LIVE_QUERY_PREFIXES) ----------

export const globalWidgetKey = (id: string) => [WIDGET_QUERY_ROOTS.globalWidget, id] as const;

// ---------- render-side resolution ----------

/** Świeżość rekordu globala - wspólna dla nakładki i list panelu (`globalWidgetsAdmin.ts`). */
export const GLOBAL_WIDGET_STALE = 60_000;
const GLOBAL_WIDGET_GC = 10 * 60_000;

/**
 * Live payload of a global widget for the render overlay. Returns null until
 * loaded (callers fall back to the instance snapshot) and when `globalId` is
 * absent.
 *
 * Wołaj WYŁĄCZNIE z komponentu renderowanego dla węzła z `globalId`
 * (`GlobalChromeWidgetView` / `GlobalFullWidgetView` w `ChromeWidgetView.tsx`;
 * Wydajność PSI 85/95, fala 2, P2.4 - hydration:H10 a). Wywołanie „na
 * wszelki wypadek" w każdej ramce zakładało wyłączone zapytanie z
 * obserwatorem i subskrypcją dla każdego widgetu strony - koszt w commicie
 * hydratacji bez żadnego pożytku. Rekord nie jest pobierany w SSR, więc dla
 * typu treściowego wołaj go POD granicą Suspense leniwego dyspozytora:
 * wynik nad nią byłby aktualizacją granicy, która jeszcze się nie uwodniła.
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
      // Błąd odczytu jest BŁĘDEM zapytania (React Query ponawia i nie zapisuje
      // go w cache jako sukcesu `null`); fallback na migawkę robi `?? null`.
      if (error) throw error;
      return parseGlobalWidgetData(data?.data ?? null);
    },
  });
  return q.data ?? null;
}
