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
 *
 * PAGINACJA (wydanie 12). Pliki czytamy per folder, stronami po
 * `MEDIA_PAGE_SIZE`, kursorem keyset - wcześniej jedno zapytanie bez limitu
 * ściągało CAŁĄ bibliotekę tenanta przy każdym wejściu na /admin/media.
 * Wyszukiwarka filtruje po stronie bazy (`ILIKE` z escapowaniem), więc trafienie
 * spoza pierwszej strony nie „znika". Foldery wynikające z położenia plików
 * (bez wiersza w `media_folders`) daje RPC `media_folder_paths` - bez czytania
 * wszystkich wierszy `media`.
 */
import { useCallback, useMemo } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { mediaRenderUrl } from "@/lib/media/publicUrl";
import type { FolderRow, MediaRow } from "../types";
import {
  MEDIA_PAGE_SIZE,
  ilikeContains,
  keepSameTenantData,
  keysetAfter,
  toMediaPage,
  type MediaCursor,
  type MediaPage,
} from "../lib/mediaPage";
import { normalizePath } from "../lib/mediaPaths";

const MEDIA_KEY = "media";
const FOLDERS_KEY = "media-folders";
const FOLDER_PATHS_KEY = "media-folder-paths";

const MEDIA_COLUMNS =
  "id, tenant_id, storage_path, public_url, filename, mime_type, size_bytes, uploader_id, created_at, folder_path, alt_text";

export interface MediaDataScope {
  /** Folder, którego pliki czytamy (`/`, `/press/`, …). */
  folder: string;
  /** Fraza wyszukiwania po nazwie pliku (już po debounce). */
  search?: string;
}

export interface UseMediaDataResult {
  foldersQuery: UseQueryResult<FolderRow[]>;
  /** Foldery wynikające z położenia plików (także bez wiersza `media_folders`). */
  folderPathsQuery: UseQueryResult<string[]>;
  mediaQuery: UseInfiniteQueryResult<InfiniteData<MediaPage<MediaRow>>>;
  /** Wczytane dotąd pliki bieżącego folderu - strony spłaszczone w jedną listę. */
  media: MediaRow[];
  /** Invalidate both media and folder caches across all tenants (safe: an
   *  invalidation only triggers a re-fetch, it never exposes data). */
  invalidate: () => void;
}

export function useMediaData(tenantId: string, scope: MediaDataScope): UseMediaDataResult {
  const qc = useQueryClient();
  const folder = normalizePath(scope.folder);
  const search = (scope.search ?? "").trim();

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

  const folderPathsQuery = useQuery({
    queryKey: [FOLDER_PATHS_KEY, tenantId],
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase.rpc("media_folder_paths", { _tenant_id: tenantId });
      if (error) throw error;
      return (data ?? []).filter((path): path is string => typeof path === "string");
    },
  });

  const mediaQuery = useInfiniteQuery({
    queryKey: [MEDIA_KEY, tenantId, folder, search],
    initialPageParam: null as MediaCursor | null,
    queryFn: async ({ pageParam }): Promise<MediaPage<MediaRow>> => {
      let query = supabase
        .from("media")
        .select(MEDIA_COLUMNS)
        .eq("tenant_id", tenantId)
        .eq("folder_path", folder);
      if (search) query = query.ilike("filename", ilikeContains(search));
      if (pageParam) query = query.or(keysetAfter(pageParam));
      const { data, error } = await query
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(MEDIA_PAGE_SIZE + 1);
      if (error) throw error;
      const page = toMediaPage(data ?? []);
      return {
        nextCursor: page.nextCursor,
        rows: page.rows
          .filter((row) => row.tenant_id === tenantId)
          .map((row) => ({ ...row, public_url: mediaRenderUrl(row.public_url) })),
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    placeholderData:
      keepSameTenantData<InfiniteData<MediaPage<MediaRow>, MediaCursor | null>>(tenantId),
  });

  const media = useMemo(
    () => mediaQuery.data?.pages.flatMap((page) => page.rows) ?? [],
    [mediaQuery.data],
  );

  const invalidate = useCallback(() => {
    void qc.invalidateQueries({ queryKey: [MEDIA_KEY] });
    void qc.invalidateQueries({ queryKey: [FOLDERS_KEY] });
    void qc.invalidateQueries({ queryKey: [FOLDER_PATHS_KEY] });
  }, [qc]);

  return { foldersQuery, folderPathsQuery, mediaQuery, media, invalidate };
}
