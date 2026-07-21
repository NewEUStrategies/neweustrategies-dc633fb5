// Warstwa danych edytora wpisu: wiersz posta (RPC get_post_for_edit) +
// słowniki taksonomii + relacje wpisu. Wszystkie odczyty są ograniczone do
// aktywnego tenanta (useRequiredTenant + filtr tenant_id / RPC z kontrolą
// tenanta po stronie serwera), więc obszar roboczy jednej firmy nigdy nie
// zaczytuje danych innej. Wyodrębnione 1:1 z trasy admin.posts.$slug.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRequiredTenant } from "@/hooks/useAuth";
import type { CategoryOpt, PostForm, TagOpt } from "../types";

export function usePostEditorData(routeSlug: string) {
  const tenantId = useRequiredTenant();

  const { data: post, isLoading } = useQuery({
    queryKey: ["post-by-slug", tenantId, routeSlug],
    enabled: !!tenantId,
    // Never background-refetch the row being edited: a refetch (e.g. on network
    // reconnect) replaces `post`, which history.reset()s the form and silently
    // discards unsaved edits + undo history. Explicit invalidations (revision
    // restore, slug change) still refetch and reset intentionally.
    refetchOnReconnect: false,
    queryFn: async (): Promise<PostForm> => {
      // Body columns are revoked from the authenticated role, so `select("*")`
      // would be denied. Staff load the full row (incl. body) through the
      // SECURITY DEFINER get_post_for_edit RPC (is_staff + own tenant enforced
      // server-side; slug is unique per tenant).
      const { data, error } = await supabase
        .rpc("get_post_for_edit", { _slug: routeSlug })
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Post not found or access denied");
      return data as unknown as PostForm;
    },
  });

  const id = post?.id ?? "";

  const { data: allCats } = useQuery({
    queryKey: ["categories", tenantId],
    queryFn: async (): Promise<CategoryOpt[]> =>
      (
        await supabase
          .from("categories")
          .select("id, name_pl, name_en")
          .eq("tenant_id", tenantId)
          .order("name_pl")
      ).data ?? [],
  });
  const { data: allTags } = useQuery({
    queryKey: ["tags", tenantId],
    queryFn: async (): Promise<TagOpt[]> =>
      (await supabase.from("tags").select("id, name").eq("tenant_id", tenantId).order("name"))
        .data ?? [],
  });
  const { data: allPrograms } = useQuery({
    queryKey: ["programs", tenantId],
    queryFn: async () =>
      (
        await supabase
          .from("programs")
          .select("id, name_pl, name_en")
          .eq("tenant_id", tenantId)
          .eq("is_active", true)
          .order("sort_order", { ascending: true })
          .order("name_pl", { ascending: true })
      ).data ?? [],
  });
  const { data: allRegions } = useQuery({
    queryKey: ["regions", tenantId],
    queryFn: async () =>
      (
        await supabase
          .from("regions")
          .select("id, name_pl, name_en")
          .eq("tenant_id", tenantId)
          .order("sort_order", { ascending: true })
          .order("name_pl", { ascending: true })
      ).data ?? [],
  });

  const { data: postCats } = useQuery({
    queryKey: ["post-cats", id],
    enabled: !!id,
    queryFn: async () =>
      (await supabase.from("post_categories").select("category_id").eq("post_id", id)).data ?? [],
  });
  const { data: postTags } = useQuery({
    queryKey: ["post-tags", id],
    enabled: !!id,
    queryFn: async () =>
      (await supabase.from("post_tags").select("tag_id").eq("post_id", id)).data ?? [],
  });
  const { data: postPrograms } = useQuery({
    queryKey: ["post-programs", id],
    enabled: !!id,
    queryFn: async () =>
      (await supabase.from("post_programs").select("program_id").eq("post_id", id)).data ?? [],
  });
  const { data: postRegions } = useQuery({
    queryKey: ["post-regions", id],
    enabled: !!id,
    queryFn: async () =>
      (await supabase.from("post_regions").select("region_id").eq("post_id", id)).data ?? [],
  });

  return {
    tenantId,
    post,
    isLoading,
    id,
    allCats,
    allTags,
    allPrograms,
    allRegions,
    postCats,
    postTags,
    postPrograms,
    postRegions,
  };
}

export type PostEditorData = ReturnType<typeof usePostEditorData>;
