// Server functions karty "NES Edge Cache" (/admin/performance?tab=cache).
// Obie operacje pod requireStaff (uwierzytelnienie + rola staff, druga warstwa
// obok RLS); purge jest zawężony do hosta bieżącego żądania, więc admin
// tenanta czyści wyłącznie dokumenty własnego tenanta (doktryna tenant_id).
import { createServerFn } from "@tanstack/react-start";

import { requireStaff } from "@/integrations/supabase/require-staff";
import {
  getDocumentCacheSnapshot,
  purgeDocumentCacheForCurrentHost,
  type DocumentCacheSnapshot,
} from "./http/documentCache.server";

export type { DocumentCacheSnapshot };

export interface EdgeCachePurgeResult {
  removed: number;
  snapshot: DocumentCacheSnapshot;
}

export const getEdgeCacheStats = createServerFn({ method: "GET" })
  .middleware([requireStaff])
  .handler(async (): Promise<DocumentCacheSnapshot> => getDocumentCacheSnapshot());

export const purgeEdgeCache = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .handler(async (): Promise<EdgeCachePurgeResult> => {
    const removed = await purgeDocumentCacheForCurrentHost();
    return { removed, snapshot: getDocumentCacheSnapshot() };
  });
