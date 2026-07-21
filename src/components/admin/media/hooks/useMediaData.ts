/**
 * Single source of truth for tenant-scoped media reads.
 *
 * Every folder/media query lives here so it is IMPOSSIBLE to accidentally read
 * the library without the `tenant_id` filter. Defence in depth:
 *   1. React-Query keys are namespaced by `tenantId` - switching workspace can
 *      never surface another tenant's cached rows.
 *   2. Each query filters `.eq("tenant_id", tenantId)` (RLS is the real guard,
 *      this keeps the wire payload minimal and intent explicit).
 *   3. The query functions re-assert `row.tenant_id === tenantId` client-side
 *      and drop anything that slipped through - a loud tripwire for an RLS or
 *      policy regression rather than a silent cross-tenant leak.
 */
import { useCallback } from "react";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { FolderRow, MediaRow } from "../types";

const MEDIA_KEY = "media";
const FOLDERS_KEY = "media-folders";

export interface UseMediaDataResult {
  foldersQuery: UseQueryResult<FolderRow[]>;
  mediaQuery: UseQueryResult<MediaRow[]>;
  /** Invalidate both media and folder caches across all tenants (safe: an
   *  invalidation only triggers a re-fetch, it never exposes data). */
  invalidate: () => void;
}

export function useMediaData(tenantId: string): UseMediaDataResult {
  const qc = useQueryClient();

  const foldersQuery = useQuery({
    queryKey: [FOLDERS_KEY, tenantId],
    queryFn: async (): Promise<FolderRow[]> => {
      const { data, error } = await supabase
        .from("media_folders")
        .select("id, path, created_at, tenant_id")
        .eq("tenant_id", tenantId)
        .order("path");
      if (error) throw error;
      return (data ?? [])
        .filter((row) => row.tenant_id === tenantId)
        .map(({ id, path, created_at }) => ({ id, path, created_at }));
    },
  });

  const mediaQuery = useQuery({
    queryKey: [MEDIA_KEY, tenantId],
    queryFn: async (): Promise<MediaRow[]> => {
      const { data, error } = await supabase
        .from("media")
        .select(
          "id, tenant_id, storage_path, public_url, filename, mime_type, size_bytes, uploader_id, created_at, folder_path, alt_text",
        )
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).filter((row) => row.tenant_id === tenantId);
    },
  });

  const invalidate = useCallback(() => {
    void qc.invalidateQueries({ queryKey: [MEDIA_KEY] });
    void qc.invalidateQueries({ queryKey: [FOLDERS_KEY] });
  }, [qc]);

  return { foldersQuery, mediaQuery, invalidate };
}
