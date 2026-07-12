// Zapytania i hooki trackera legislacyjnego UE (react-query + supabase).
// Publiczne odczyty przechodzą przez RLS (tylko status = 'published'),
// obserwowanie jest owner-only - insert wymaga jawnego tenant_id dossier.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface PolicyItem {
  id: string;
  tenant_id: string;
  slug: string;
  title_pl: string;
  title_en: string;
  summary_pl: string | null;
  summary_en: string | null;
  policy_area: string;
  stage: string;
  importance: number;
  reference: string | null;
  source_url: string | null;
  next_milestone_pl: string | null;
  next_milestone_en: string | null;
  next_milestone_at: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface PolicyUpdate {
  id: string;
  item_id: string;
  note_pl: string;
  note_en: string;
  stage_from: string | null;
  stage_to: string | null;
  source_url: string | null;
  happened_on: string;
  created_at: string;
}

export interface PolicyItemFilters {
  area?: string;
  stage?: string;
}

const ITEM_FIELDS =
  "id,tenant_id,slug,title_pl,title_en,summary_pl,summary_en,policy_area,stage,importance," +
  "reference,source_url,next_milestone_pl,next_milestone_en,next_milestone_at,status," +
  "created_at,updated_at";

const UPDATE_FIELDS =
  "id,item_id,note_pl,note_en,stage_from,stage_to,source_url,happened_on,created_at";

/** Opublikowane dossier: najważniejsze i ostatnio aktualizowane na górze. */
export async function fetchPublishedItems(filters: PolicyItemFilters = {}): Promise<PolicyItem[]> {
  let query = supabase
    .from("eu_policy_items")
    .select(ITEM_FIELDS)
    .eq("status", "published")
    .order("importance", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(100);
  if (filters.area) query = query.eq("policy_area", filters.area);
  if (filters.stage) query = query.eq("stage", filters.stage);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as PolicyItem[];
}

/** Pojedyncze opublikowane dossier po slugu (null gdy brak/nieopublikowane). */
export async function fetchItemBySlug(slug: string): Promise<PolicyItem | null> {
  const { data, error } = await supabase
    .from("eu_policy_items")
    .select(ITEM_FIELDS)
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as unknown as PolicyItem | null;
}

/** Oś czasu dossier - najnowsze wydarzenia na górze. */
export async function fetchUpdates(itemId: string): Promise<PolicyUpdate[]> {
  const { data, error } = await supabase
    .from("eu_policy_updates")
    .select(UPDATE_FIELDS)
    .eq("item_id", itemId)
    .order("happened_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as unknown as PolicyUpdate[];
}

/** Publiczne liczniki obserwujących (RPC omija owner-only RLS follows). */
export async function fetchFollowerCounts(itemIds: string[]): Promise<Record<string, number>> {
  if (itemIds.length === 0) return {};
  const { data, error } = await supabase.rpc("get_policy_follower_counts", {
    p_item_ids: itemIds,
  });
  if (error) throw error;
  const counts: Record<string, number> = {};
  for (const row of data ?? []) counts[row.item_id] = row.followers;
  return counts;
}

/** Identyfikatory dossier obserwowanych przez użytkownika. */
export async function fetchMyFollows(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("eu_policy_follows")
    .select("item_id")
    .eq("user_id", userId);
  if (error) throw error;
  return (data ?? []).map((row) => row.item_id);
}

/**
 * Rozpocznij obserwowanie dossier. RLS wymaga jawnego tenant_id równego
 * tenant_id dossier - przekazujemy go z wiersza itemu. Duplikat (równoległe
 * kliknięcia) jest ignorowany po kodzie 23505, nie po treści komunikatu.
 */
export async function followItem(input: {
  itemId: string;
  userId: string;
  tenantId: string;
}): Promise<void> {
  const { error } = await supabase.from("eu_policy_follows").insert({
    item_id: input.itemId,
    user_id: input.userId,
    tenant_id: input.tenantId,
  });
  if (error && error.code !== "23505") throw error;
}

/** Przestań obserwować dossier (delete owner-only pod RLS). */
export async function unfollowItem(input: { itemId: string; userId: string }): Promise<void> {
  const { error } = await supabase
    .from("eu_policy_follows")
    .delete()
    .eq("item_id", input.itemId)
    .eq("user_id", input.userId);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Hooki react-query - wspólna przestrzeń kluczy ["tracker", ...]
// ---------------------------------------------------------------------------

export function usePublishedItems(filters: PolicyItemFilters = {}) {
  return useQuery({
    queryKey: ["tracker", "items", filters.area ?? "all", filters.stage ?? "all"] as const,
    queryFn: () => fetchPublishedItems(filters),
    staleTime: 60_000,
  });
}

export function useItemBySlug(slug: string) {
  return useQuery({
    queryKey: ["tracker", "item", slug] as const,
    queryFn: () => fetchItemBySlug(slug),
    staleTime: 60_000,
    enabled: !!slug,
  });
}

export function useItemUpdates(itemId: string | undefined) {
  return useQuery({
    queryKey: ["tracker", "updates", itemId ?? "none"] as const,
    queryFn: () => fetchUpdates(itemId!),
    staleTime: 60_000,
    enabled: !!itemId,
  });
}

export function useFollowerCounts(itemIds: string[]) {
  // Klucz z posortowanych id - stabilny niezależnie od kolejności listy.
  const keyIds = [...itemIds].sort().join(",");
  return useQuery({
    queryKey: ["tracker", "followers", keyIds] as const,
    queryFn: () => fetchFollowerCounts(itemIds),
    staleTime: 60_000,
    enabled: itemIds.length > 0,
  });
}

export function useMyFollows(userId: string | undefined) {
  return useQuery({
    queryKey: ["tracker", "my-follows", userId ?? "anon"] as const,
    queryFn: () => fetchMyFollows(userId!),
    enabled: !!userId,
  });
}

/** Toggle obserwowania z invalidacją listy obserwacji i liczników. */
export function useToggleFollowItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      itemId: string;
      userId: string;
      tenantId: string;
      on: boolean;
    }) => {
      if (input.on) {
        await followItem({ itemId: input.itemId, userId: input.userId, tenantId: input.tenantId });
      } else {
        await unfollowItem({ itemId: input.itemId, userId: input.userId });
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tracker", "my-follows"] });
      void queryClient.invalidateQueries({ queryKey: ["tracker", "followers"] });
    },
  });
}
