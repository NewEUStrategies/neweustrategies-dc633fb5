// Server functions karty "NES Edge Cache" (/admin/performance?tab=cache).
// Obie operacje pod requireStaff (uwierzytelnienie + rola staff, druga warstwa
// obok RLS); purge jest zawężony do hosta bieżącego żądania, więc admin
// tenanta czyści wyłącznie dokumenty własnego tenanta (doktryna tenant_id).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireStaff } from "@/integrations/supabase/require-staff";
import {
  getDocumentCacheSnapshot,
  probeDocumentCache,
  purgeDocumentCacheForCurrentHost,
  type DocumentCacheProbe,
  type DocumentCacheSnapshot,
} from "./http/documentCache.server";

export type { DocumentCacheProbe, DocumentCacheSnapshot };

const probeSchema = z.object({
  path: z
    .string()
    .trim()
    .min(1)
    .max(512)
    // Wyłącznie ścieżka względna tego serwisu - sonda nie może stać się
    // narzędziem do odpytywania obcych hostów.
    .refine((value) => value.startsWith("/") && !value.startsWith("//"), {
      message: "path must be a site-relative path",
    }),
});

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

/**
 * Sonda pojedynczej ścieżki: odpowiednik nagłówka `x-nes-cache`, czytany
 * bezpośrednio z magazynu. Warstwa hostingu zdejmuje nagłówki diagnostyczne
 * z odpowiedzi, więc to jedyny wiarygodny sposób sprawdzenia stanu cache'a
 * z zewnątrz (z karty /admin/performance).
 */
export const probeEdgeCache = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((data: unknown) => probeSchema.parse(data))
  .handler(async ({ data }): Promise<DocumentCacheProbe> => probeDocumentCache(data.path));
